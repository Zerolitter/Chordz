import { expect, test, type Page } from "@playwright/test";
import { encodeWav } from "../../lib/audio/wav";
import type { ReferenceProfile } from "../../lib/audio/reference-analysis-data";

function pulseFixture(seconds = 65) {
  const rate = 12000, pcm = new Float32Array(rate * seconds);
  for (let beat = 0; beat < seconds * 2; beat++) for (let i = 0; i < rate * .12 && beat * rate / 2 + i < pcm.length; i++) pcm[beat * rate / 2 + i] = .6 * Math.sin(2 * Math.PI * 90 * i / rate) * Math.exp(-i / (rate * .03));
  return Buffer.from(encodeWav([pcm], rate, 16));
}
async function savedTrack(page: Page) {
  return page.evaluate(() => new Promise<{ routes: number; movement: boolean } | null>(resolve => {
    const opened = indexedDB.open("chordz-recovery-v1", 1);
    opened.onerror = () => resolve(null);
    opened.onsuccess = () => {
      const db = opened.result; if (!db.objectStoreNames.contains("drafts")) { db.close(); resolve(null); return; }
      const latest = db.transaction("drafts", "readonly").objectStore("drafts").get("guest:latest");
      latest.onsuccess = () => {
        if (!latest.result) { db.close(); resolve(null); return; }
        const draft = db.transaction("drafts", "readonly").objectStore("drafts").get("guest:" + latest.result);
        draft.onsuccess = () => { const track = draft.result?.document?.tracks?.[0]; db.close(); resolve({ routes: track?.modulation?.routes?.length ?? 0, movement: !!track?.chordMovement?.enabled }); };
        draft.onerror = () => { db.close(); resolve(null); };
      };
    };
  }));
}

test("the shipped reference worker decodes, measures real PCM, cancels and retries in Chrome", async ({ page }) => {
  await page.goto("/");
  const report = await page.evaluate(async () => {
    const { StudioEngine } = await import("/lib/audio/engine.ts" as string), { createProject } = await import("/lib/music/project.ts" as string), { encodeWav } = await import("/lib/audio/wav.ts" as string);
    const { analyzeReferenceBuffer, referenceWaveform } = await import("/lib/audio/reference-analysis-client.ts" as string);
    const engine = new StudioEngine(createProject(), async () => { throw new Error("No assets needed for reference decoding."); });
    const rate = 12000, seconds = 65, pcm = new Float32Array(rate * seconds);
    for (let beat = 0; beat < seconds * 2; beat++) for (let i = 0; i < rate * .12; i++) pcm[beat * rate / 2 + i] = .6 * Math.sin(2 * Math.PI * 90 * i / rate) * Math.exp(-i / (rate * .03));
    const blob = new Blob([encodeWav([pcm], rate, 16)], { type: "audio/wav" }), buffer: AudioBuffer = await engine.decode(blob), metadata = { name: "pulse.wav", fingerprint: "browser-private-test", byteLength: blob.size, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, duration: buffer.duration }, range = { startSec: 0, endSec: buffer.duration };
    const before = buffer.getChannelData(0)[100], controller = new AbortController();
    const cancelled = analyzeReferenceBuffer(buffer, metadata, range, { signal: controller.signal }).then(() => "unexpected success", (error: Error) => error.name); controller.abort();
    const cancellation = await cancelled, waveform: number[] = await referenceWaveform(buffer), progress: number[] = [], profile: ReferenceProfile = await analyzeReferenceBuffer(buffer, metadata, range, { onProgress: (v: number) => progress.push(v) });
    engine.dispose();
    return { cancellation, waveformLength: waveform.length, waveformPeak: Math.max(...waveform), before, after: buffer.getChannelData(0)[100], tempo: profile.tempo, rms: profile.dynamics.rmsDbfs, points: profile.curve.length, lastProgress: progress.at(-1) };
  });
  expect(report.cancellation).toBe("AbortError"); expect(report.waveformLength).toBe(320); expect(report.waveformPeak).toBeGreaterThan(.4);
  expect(report.before).toBe(report.after); expect(report.tempo.confidence).toBe("supported"); expect(report.tempo.candidates.some(c => Math.abs(c.bpm - 120) < 1)).toBe(true); expect(report.rms).toBeLessThan(-10); expect(report.points).toBe(65); expect(report.lastProgress).toBe(100);
});

test("private reference proposals stay staged, cancel cleanly, apply once and survive Undo/reload", async ({ page }) => {
  const errors: string[] = [], uploads: string[] = []; page.on("pageerror", error => errors.push(error.message)); page.on("request", request => { if (request.method() === "POST" && request.url().includes("/api/assets")) uploads.push(request.url()); });
  await page.goto("/"); await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", { name: "Songs", exact: true }).click(); await page.getByRole("button", { name: "Blank song", exact: true }).click();
  await page.getByRole("navigation").getByRole("button", { name: "03 Sound" }).click();
  const panel = page.getByRole("region", { name: "Reference analysis" }), rack = page.getByRole("region", { name: "Selected track modulation rack" });
  await expect.poll(() => savedTrack(page)).toEqual({ routes: 0, movement: false });
  await panel.getByLabel("Reference audio").setInputFiles({ name: "private-pulse.wav", mimeType: "audio/wav", buffer: pulseFixture() });
  await expect(panel.getByRole("button", { name: "Analyze selected range", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "Analyze selected range", exact: true }).click(); await expect(panel.getByText("Dynamics", { exact: true })).toBeVisible();
  await panel.getByLabel("Reference tempo", { exact: true }).fill("123.5"); await panel.getByRole("button", { name: "Use tempo in song", exact: true }).click(); await expect(page.getByLabel("Tempo", { exact: true })).toHaveValue("123.5");
  await panel.getByLabel("Reference key", { exact: true }).selectOption("Eb"); await panel.getByRole("button", { name: "Use tonal palette in song", exact: true }).click(); await expect(page.getByLabel("Song key", { exact: true })).toHaveValue("Eb");
  await panel.getByRole("button", { name: "Sound proposal", exact: true }).click(); await expect(rack.locator(".mod-route")).toHaveCount(3);
  await page.waitForTimeout(650); expect(await savedTrack(page)).toEqual({ routes: 0, movement: false });
  await panel.getByRole("button", { name: "Cancel proposal", exact: true }).click(); await expect(rack.locator(".mod-route")).toHaveCount(0);
  await panel.getByRole("button", { name: "Both", exact: true }).click(); await expect(rack.locator(".mod-route")).toHaveCount(3); await panel.getByRole("button", { name: "Apply proposal", exact: true }).click();
  await expect.poll(() => savedTrack(page)).toEqual({ routes: 3, movement: true }); await page.getByLabel("Undo", { exact: true }).click(); await expect(rack.locator(".mod-route")).toHaveCount(0);
  await page.getByLabel("Redo", { exact: true }).click(); await expect(rack.locator(".mod-route")).toHaveCount(3); await expect.poll(() => savedTrack(page)).toEqual({ routes: 3, movement: true });
  await page.reload(); await expect(page.getByLabel("Song title")).toBeEnabled(); await expect(rack.locator(".mod-route")).toHaveCount(3);
  expect(uploads).toEqual([]); expect(errors).toEqual([]);
});
