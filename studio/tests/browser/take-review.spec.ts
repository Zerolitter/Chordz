import { expect, test, type Page } from "@playwright/test";
import type { ProjectDocument } from "../../lib/music/types";
import { encodeWav } from "../../lib/audio/wav";

async function fixture(page: Page) {
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await expect.poll(() => page.evaluate(async () => {
    const { latestDraft } = await import("/lib/client/storage.ts" as string);
    return !!await latestDraft("guest");
  })).toBe(true);
  await page.evaluate(async bytes => {
    const { createProject, createTrack, emptyClip } = await import("/lib/music/project.ts" as string);
    const { saveDraft, keepPendingAsset } = await import("/lib/client/storage.ts" as string);
    const project = createProject("Take comparison fixture") as ProjectDocument;
    project.id = "take_review_fixture";
    const track = createTrack("piano", "Voice attempts", undefined, "audio");
    track.id = "voice_attempts"; track.reverb = 0; track.delay = 0;
    track.automation = [{ parameter: "volume", points: [{ tick: 0, value: -40 }] }];
    track.clips = [
      { ...emptyClip(0, 7680, "First attempt"), id: "first_attempt", audio: { assetId: "attempt_audio", offsetSec: .1, gain: .8, fadeInSec: .02, fadeOutSec: .04 } },
      { ...emptyClip(0, 5760, "Second attempt"), id: "second_attempt", audio: { assetId: "attempt_audio", offsetSec: .3, gain: .6, fadeInSec: .04, fadeOutSec: .08 } },
    ];
    const blob = new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
    const asset = { id: "attempt_audio", name: "Attempts.wav", mime: "audio/wav", byteLength: blob.size, duration: 5, sampleRate: 48000, channels: 1 };
    project.assets = [asset]; project.tracks = [track]; project.chords = [];
    await keepPendingAsset({ owner: "guest", projectId: project.id, asset, blob });
    await saveDraft({ owner: "guest", document: project, revision: 0, savedFingerprint: "", updatedAt: new Date().toISOString() });
  }, [...new Uint8Array(encodeWav([Float32Array.from({ length: 240000 }, (_, i) => .15 * Math.sin(i * 2 * Math.PI * 220 / 48000))], 48000, 24))]);
  await page.reload();
  await expect(page.getByLabel("Song title")).toHaveValue("Take comparison fixture");
  await page.locator(".timeline-clip-body").first().focus();
  await page.keyboard.press("Enter");
}

async function savedDocument(page: Page): Promise<ProjectDocument> {
  return page.evaluate(async () => {
    const { latestDraft } = await import("/lib/client/storage.ts" as string);
    return (await latestDraft("guest"))!.document;
  });
}

test("choose and compare audio attempts without changing their song regions or history", async ({ page }) => {
  await fixture(page);
  const review = page.getByRole("region", { name: "Audio take comparison", exact: true });
  await expect(review).toBeVisible();
  await expect(review.getByLabel("Choose a take", { exact: true })).toHaveValue("first_attempt");
  await expect(review).toContainText("Region audition · no song automation");
  await expect(review).toContainText("Overlapping regions still play together in the song");
  const before = await savedDocument(page), undo = await page.getByLabel("Undo", { exact: true }).isEnabled();
  await review.getByLabel("Choose a take", { exact: true }).selectOption("second_attempt");
  await page.locator(".clip-editor-metadata > summary").click();
  await expect(page.getByLabel("Clip name", { exact: true })).toHaveValue("Second attempt");
  await review.getByRole("button", { name: "Preview take", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(review.getByRole("button", { name: "Stop take preview", exact: true })).toBeVisible();
  await expect(page.locator(".transport-position")).toContainText("Audition");
  await expect(page.getByLabel("Play song", { exact: true })).toBeVisible();
  await review.getByRole("button", { name: "Stop take preview", exact: true }).click();
  await expect(review.getByRole("button", { name: "Preview take", exact: true })).toBeVisible();
  expect(await savedDocument(page)).toEqual(before);
  expect(await page.getByLabel("Undo", { exact: true }).isEnabled()).toBe(undo);
  await page.reload();
  await expect(page.getByLabel("Song title")).toHaveValue("Take comparison fixture");
  await expect(page.getByLabel("Choose a take", { exact: true })).toHaveValue("second_attempt");
});

test("changing the chosen attempt and protected Stop end isolated take audition", async ({ page }) => {
  await fixture(page);
  const review = page.getByRole("region", { name: "Audio take comparison", exact: true });
  await review.getByRole("button", { name: "Preview take", exact: true }).click();
  await expect(review.getByRole("button", { name: "Stop take preview", exact: true })).toBeVisible();
  await review.getByLabel("Choose a take", { exact: true }).selectOption("second_attempt");
  await expect(review.getByRole("button", { name: "Preview take", exact: true })).toBeVisible();
  await expect(page.locator(".transport-position")).not.toContainText("Audition");
  await review.getByRole("button", { name: "Preview take", exact: true }).click();
  await expect(review.getByRole("button", { name: "Stop take preview", exact: true })).toBeVisible();
  await page.getByLabel("Stop song", { exact: true }).click();
  await expect(review.getByRole("button", { name: "Preview take", exact: true })).toBeVisible();
  await expect(page.locator(".transport-position")).not.toContainText("Audition");
});

test("take comparison controls wrap inside the editor at narrow widths", async ({ page }) => {
  await fixture(page);
  for (const [width, height] of [[1366, 768], [1024, 768], [390, 844]]) {
    await page.setViewportSize({ width, height });
    const review = page.getByRole("region", { name: "Audio take comparison", exact: true });
    await expect(review).toBeVisible();
    await expect(review.getByRole("button", { name: "Preview take", exact: true })).toBeVisible();
    expect(await review.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("collapsing the editor cancels a pending take decode without a late audition", async ({ page }) => {
  await fixture(page);
  const review = page.getByRole("region", { name: "Audio take comparison", exact: true });
  const before = await savedDocument(page);
  await page.evaluate(() => {
    const state = window as unknown as { takeDecodeHeld: boolean; releaseTakeDecode: () => void };
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const decode = AudioContext.prototype.decodeAudioData;
    state.takeDecodeHeld = false; state.releaseTakeDecode = release;
    AudioContext.prototype.decodeAudioData = async function(...args: Parameters<typeof decode>) {
      AudioContext.prototype.decodeAudioData = decode;
      state.takeDecodeHeld = true;
      await gate;
      return decode.apply(this, args);
    };
  });
  await review.getByRole("button", { name: "Preview take", exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { takeDecodeHeld: boolean }).takeDecodeHeld);
  await expect(review.getByRole("button", { name: "Stop take preview", exact: true })).toBeVisible();
  await page.getByLabel("Collapse detail dock", { exact: true }).click();
  await expect(review).not.toBeVisible();
  await page.evaluate(() => (window as unknown as { releaseTakeDecode: () => void }).releaseTakeDecode());
  await page.waitForTimeout(300);
  await expect(page.locator(".transport-position")).not.toContainText("Audition");
  await page.getByLabel("Expand detail dock", { exact: true }).click();
  await expect(review.getByRole("button", { name: "Preview take", exact: true })).toBeVisible();
  expect(await savedDocument(page)).toEqual(before);
});

test("a blocked collapse still ends take audition while retaining the invalid field", async ({ page }) => {
  await fixture(page);
  const review = page.getByRole("region", { name: "Audio take comparison", exact: true });
  await review.getByRole("button", { name: "Preview take", exact: true }).click();
  await expect(review.getByRole("button", { name: "Stop take preview", exact: true })).toBeVisible();
  await page.locator(".clip-editor-metadata > summary").click();
  await page.getByLabel("Clip start bar", { exact: true }).fill("");
  await page.getByLabel("Collapse detail dock", { exact: true }).evaluate(element => (element as HTMLButtonElement).click());
  await expect(review).toBeVisible();
  await expect(page.getByLabel("Clip start bar", { exact: true })).toHaveValue("");
  await expect(page.locator(".transport-position")).not.toContainText("Audition");
  await page.getByLabel("Clip start bar", { exact: true }).press("Escape");
});

test("take audition pauses an already playing song at its current position", async ({ page }) => {
  await fixture(page);
  const review = page.getByRole("region", { name: "Audio take comparison", exact: true });
  await page.getByLabel("Song playhead", { exact: true }).fill("1920");
  await page.getByLabel("Play song", { exact: true }).click();
  await expect(page.getByLabel("Pause song", { exact: true })).toBeVisible();
  await expect.poll(async () => Number(await page.getByLabel("Song playhead", { exact: true }).inputValue())).toBeGreaterThan(2160);
  const before = Number(await page.getByLabel("Song playhead", { exact: true }).inputValue());
  await review.getByRole("button", { name: "Preview take", exact: true }).click();
  await expect(review.getByRole("button", { name: "Stop take preview", exact: true })).toBeVisible();
  await expect(page.getByLabel("Play song", { exact: true })).toBeVisible();
  const paused = Number(await page.getByLabel("Song playhead", { exact: true }).inputValue());
  expect(paused).toBeGreaterThanOrEqual(before);
  expect(paused - before).toBeLessThan(960);
  await page.waitForTimeout(150);
  await review.getByRole("button", { name: "Stop take preview", exact: true }).click();
  await expect(page.getByLabel("Play song", { exact: true })).toBeVisible();
  expect(Number(await page.getByLabel("Song playhead", { exact: true }).inputValue())).toBe(paused);
});

test("closing during the first engine import preserves a successor take preview", async ({ page }) => {
  let release!: () => void, held = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(url => url.pathname === "/lib/audio/engine.ts", async route => {
    held = true;
    await gate;
    await route.continue();
  });
  try {
    await fixture(page);
    await expect.poll(() => held).toBe(true);
    const review = page.getByRole("region", { name: "Audio take comparison", exact: true });
    await review.getByRole("button", { name: "Preview take", exact: true }).click();
    await page.getByLabel("Collapse detail dock", { exact: true }).click();
    await expect(review).not.toBeVisible();
    await page.getByLabel("Expand detail dock", { exact: true }).click();
    await review.getByLabel("Choose a take", { exact: true }).selectOption("second_attempt");
    await review.getByRole("button", { name: "Preview take", exact: true }).click();
    release();
    await expect(review.getByRole("button", { name: "Stop take preview", exact: true })).toBeVisible();
    await expect(review.getByLabel("Choose a take", { exact: true })).toHaveValue("second_attempt");
    await page.waitForTimeout(150);
    await expect(review.getByRole("button", { name: "Stop take preview", exact: true })).toBeVisible();
    await review.getByRole("button", { name: "Stop take preview", exact: true }).click();
    await expect(page.locator(".transport-position")).not.toContainText("Audition");
  } finally { release(); }
});
