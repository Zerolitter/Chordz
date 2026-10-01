import { test, expect } from "@playwright/test";
import { createProject } from "../../lib/music/project";
import { encodeWav } from "../../lib/audio/wav";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

test("writing, arrangement, keyboard, undo, mixer and responsive layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", {name:"02 Write", exact:true}).click();
  await expect(
    page.getByRole("heading", { name: "Find the feeling." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Blank song" }).click();
  await page.getByRole("button", {name:"02 Write", exact:true}).click();
  await page.getByText("Custom chord card",{exact:true}).click();
  await page.getByLabel("New chord symbol").fill("Cmaj7");
  await page.getByRole("button",{name:"Chord card Cmaj7",exact:true}).focus();
  await page.keyboard.press("d");await page.keyboard.press("Enter");
  await expect(page.locator(".chord-card strong")).toHaveText("Cmaj7");
  await page.getByLabel("Undo", { exact: true }).click();
  await expect(page.locator(".chord-card")).toHaveCount(0);
  await page.getByLabel("Redo", { exact: true }).click();
  await expect(page.locator(".chord-card")).toHaveCount(1);
  await page.getByLabel("Other detail tools").selectOption("keyboard");
  await page.getByLabel("Play C3", { exact: true }).click();
  await page.getByLabel("Play E", { exact: true }).count();
  await page.getByRole("button", {name:"02 Write", exact:true}).click();
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "01 Arrange" })
    .click();
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
  await page.locator(".timeline-clip").click();
  await page.getByLabel("Duplicate selected clip").click();
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Drum steps", exact: true })).toBeDisabled();
  await page.getByLabel("Note transform scope",{exact:true}).selectOption("phrase");
  await page.getByRole("button",{name:"Quantize",exact:true}).click();
  await page.getByRole("button",{name:"Apply note transform",exact:true}).click();
  await page.locator(".clip-editor-metadata > summary").click();
  await page.getByLabel("Clip transpose").fill("2");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "04 Mix" })
    .click();
  await expect(page.getByLabel("Master volume")).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "02 Write" })
    .click();
  mkdirSync("output/playwright", { recursive: true });
  await page.screenshot({
    path: "output/playwright/desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "output/playwright/mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("authenticated cloud save and another browser reopen", async ({
  page,
  browser,
}) => {
  await page.goto("/signin-with-chatgpt?return_to=/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Blank song" }).click();
  const title = "Browser song " + Date.now();
  await page.getByLabel("Song title").fill(title);
  await page.getByLabel("Save song", { exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("Saved to cloud");
  const other = await browser.newContext();
  const second = await other.newPage();
  await second.goto("/signin-with-chatgpt?return_to=/");
  await expect(second.getByLabel("Song title")).toHaveValue(title);
  await other.close();
});

test("cloud conflicts retain edits and reject anonymous access and forgery", async ({
  page,
  request,
}) => {
  await page.goto("/signin-with-chatgpt?return_to=/");
  const doc = createProject("Revision fixture"),
    headers = { Origin: "http://127.0.0.1:5173" };
  const create = await page.request.post("/api/projects", {
    data: doc,
    headers,
  });
  expect(create.status()).toBe(201);
  const original = await create.json();
  const saved = await page.request.put("/api/projects/" + doc.id, {
    data: {
      document: { ...doc, title: "Cloud edit" },
      expectedRevision: original.revision,
    },
    headers,
  });
  expect(saved.ok()).toBe(true);
  const collision = await page.request.put("/api/projects/" + doc.id, {
    data: {
      document: { ...doc, title: "Offline edit" },
      expectedRevision: original.revision,
    },
    headers,
  });
  expect(collision.status()).toBe(409);
  const retained = await page.request.get(
    "/api/projects/" + doc.id + "/versions",
  );
  expect(
    (await retained.json()).some(
      (v: { document: { title: string } }) =>
        v.document.title === "Offline edit",
    ),
  ).toBe(true);
  expect((await request.get("/api/projects/" + doc.id)).status()).toBe(401);
  expect(
    (
      await request.get("/api/projects/" + doc.id, {
        headers: {
          "oai-authenticated-user-id": "local_seedy",
          "oai-authenticated-user-email": "fake@example.test",
        },
      })
    ).status(),
  ).toBe(401);
});

test("real browser audio graph, WAV worker, sustain, looping and microphone worklet", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  const result = await page.evaluate(async () => {
    const { StudioEngine } = await import("/lib/audio/engine.ts" as string),
      { createProject, createTrack, emptyClip } = await import(
        "/lib/music/project.ts" as string
      ),
      { PPQ } = await import("/lib/music/types.ts" as string),
      { AudioProcessor } = await import(
        "/lib/audio/worker-client.ts" as string
      ),
      { MicrophoneRecorder } = await import(
        "/lib/audio/recording.ts" as string
      );
    const project = createProject();
    project.sections[0].lengthTick = PPQ * 4;
    const track = createTrack("lead");
    track.sound.wave = "sine";
    track.sound.algorithm = "subtractive";
    track.sound.detune = 0;
    track.sound.attack = 0.005;
    track.sound.decay = 0.03;
    track.sound.sustain = 0.8;
    track.sound.release = 0.08;
    track.sound.filterEnvelope = 0;
    track.volume = 0;
    track.reverb = 0;
    project.master.volume = 0;
    project.master.limiter = false;
    track.clips = [
      {
        ...emptyClip(0, PPQ * 4),
        notes: [
          { id: "one", pitch: 69, tick: PPQ, duration: PPQ, velocity: 1 },
        ],
        events: [{ tick: PPQ * 1.5, type: "pitchBend", value: 0.5 }],
      },
    ];
    project.tracks = [track];
    const engine = new StudioEngine(project, async () => {
      throw new Error("No assets");
    });
    const buffer = await engine.render(project, undefined, 3),
      data = buffer.getChannelData(0);
    let sum = 0,
      peak = 0,
      before = 0,
      finite = true;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
      peak = Math.max(peak, Math.abs(data[i]));
      finite &&= Number.isFinite(data[i]);
      if (i < 0.48 * buffer.sampleRate)
        before = Math.max(before, Math.abs(data[i]));
    }
    const worker = new AudioProcessor(),
      wav = await worker.encode(buffer, 24);
    engine.setLoop(true, 0, PPQ * 4);
    await engine.play();
    await new Promise((r) => setTimeout(r, 2400));
    const loopTick = engine.state.tick;
    engine.pause();
    await engine.noteOn(track.id, 60);
    engine.expression(track.id, { tick: 0, type: "sustain", value: 1 });
    engine.noteOff(track.id, 60);
    engine.expression(track.id, { tick: 0, type: "sustain", value: 0 });
    engine.stop();
    const microphone = new MicrophoneRecorder(),
      context = await engine.unlock();
    await microphone.prepare(context);
    microphone.start(context.currentTime + 0.1, context);
    await new Promise((r) => setTimeout(r, 1400));
    const recording = await microphone.stop();
    microphone.dispose();
    worker.dispose();
    engine.dispose();
    return {
      rms: Math.sqrt(sum / data.length),
      peak,
      before,
      finite,
      wavBytes: wav.size,
      sampleRate: buffer.sampleRate,
      loopTick,
      recordedSeconds: recording.duration,
      recordedBytes: recording.blob.size,
    };
  });
  expect(result.finite).toBe(true);
  expect(result.rms).toBeGreaterThan(0.005);
  expect(result.peak).toBeLessThan(1);
  expect(result.before).toBeLessThan(0.0001);
  expect(result.wavBytes).toBe(44 + 3 * 48000 * 2 * 3);
  expect(result.sampleRate).toBe(48000);
  expect(result.loopTick).toBeLessThan(3840);
  expect(result.recordedSeconds).toBeGreaterThan(1);
  expect(result.recordedSeconds).toBeLessThan(1.5);
  writeFileSync(
    "output/playwright/audio-check.json",
    JSON.stringify(result, null, 2),
  );
});

test("failed sample download and denied microphone keep musical settings", async ({
  page,
  browser,
}) => {
  await page.route("**/sounds/**", (route) =>
    route.fulfill({ status: 503, body: "offline" }),
  );
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByLabel("Play song", { exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("download failed");
  await expect(page.getByLabel("Song title")).toHaveValue(
    "Where the light returns",
  );
  const denied = await browser.newContext({ permissions: [] });
  const other = await denied.newPage();
  await other.goto("/");
  await expect(other.getByLabel("Song title")).toBeEnabled();
  const denial = await other.evaluate(async () => {
    const { MicrophoneRecorder } = await import(
      "/lib/audio/recording.ts" as string
    );
    const recorder = new MicrophoneRecorder();
    const ctx = new AudioContext();
    try {
      await recorder.prepare(ctx, {
        toString: () => "missing",
      } as unknown as string);
      return "unexpected";
    } catch (error) {
      return error instanceof Error ? error.name : "error";
    } finally {
      recorder.dispose();
      await ctx.close();
    }
  });
  expect(denial).not.toBe("unexpected");
  await denied.close();
});

test("audio import, trim, private upload, WAV and portable backup exports", async ({
  page,
}) => {
  await page.goto("/signin-with-chatgpt?return_to=/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Blank song" }).click();
  const samples = new Float32Array(48000);
  for (let i = 0; i < samples.length; i++)
    samples[i] = Math.sin((i * 2 * Math.PI * 220) / 48000) * 0.1;
  const wav = encodeWav([samples], 48000, 16);
  await page
    .getByLabel("Import audio file", { exact: true })
    .setInputFiles({
      name: "Test take.wav",
      mimeType: "audio/wav",
      buffer: Buffer.from(wav),
    });
  await expect(page.getByLabel("Clip name")).toHaveValue("Test take.wav");
  await page.getByLabel("Source offset").fill("0.05");
  await page.getByLabel("Save song", { exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("Saved to cloud");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByLabel("Export format").selectOption("backup");
  const waiting = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export backup", exact: true })
    .click();
  const download = await waiting;
  expect(download.suggestedFilename()).toContain(".chordz.zip");
  await download.saveAs("output/playwright/imported.chordz.zip");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page
    .getByText("Restore backup", { exact: true })
    .locator("input")
    .setInputFiles("output/playwright/imported.chordz.zip");
  await expect(page.getByLabel("Song title")).toHaveValue(/restored$/);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "01 Arrange" })
    .click();
  await page.locator(".timeline-clip").click();
  await expect(page.getByLabel("Source offset")).toHaveValue("0.05");
  await page.getByLabel("Save song", { exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("Saved to cloud");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByLabel("Export format").selectOption("stems");
  await page.getByLabel("Stem track").selectOption({ label: "Test take" });
  const stemWaiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STEMS", exact: true }).click();
  const stemDownload = await stemWaiting;
  await stemDownload.saveAs("output/playwright/recording-stem.wav");
  const stemBytes = readFileSync("output/playwright/recording-stem.wav");
  expect(stemBytes.readUInt32LE(24)).toBe(48000);
  expect(stemBytes.readUInt16LE(34)).toBe(24);
  expect(stemBytes.readUInt32LE(40) / (48000 * 6)).toBeCloseTo(20.8, 2);
  await page.getByLabel("Export format").selectOption("midi");
  const midiWaiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export MIDI", exact: true }).click();
  expect((await midiWaiting).suggestedFilename()).toContain(".mid");
});

test("five-minute 16-track mixed reference records, saves, reopens and exports", async ({
  page,
  browser,
}) => {
  test.setTimeout(480000);
  await page.goto("/signin-with-chatgpt?return_to=/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  const fixture = await page.evaluate(async () => {
    const { createDemo, createTrack, emptyClip, secondsToTick } = await import(
        "/lib/music/project.ts" as string
      ),
      { MicrophoneRecorder } = await import(
        "/lib/audio/recording.ts" as string
      ),
      { uid } = await import("/lib/music/types.ts" as string);
    const doc = createDemo(true);
    doc.title = "Reference performance " + Date.now();
    const context = new AudioContext({ sampleRate: 48000 });
    await context.resume();
    const mic = new MicrophoneRecorder();
    await mic.prepare(context);
    const start = context.currentTime + 0.2;
    mic.start(start, context);
    await new Promise((r) => setTimeout(r, 2300));
    const take = await mic.stop();
    mic.dispose();
    await context.close();
    doc.tracks.pop();
    const id = uid(),
      asset = {
        id,
        name: "Reference microphone.wav",
        mime: "audio/wav",
        byteLength: take.blob.size,
        duration: take.duration,
        sampleRate: take.sampleRate,
        channels: 1,
      };
    const track = createTrack(
      "piano",
      "Microphone texture",
      "#bd9785",
      "audio",
    );
    track.volume = -24;
    track.clips = [
      {
        ...emptyClip(
          3840,
          secondsToTick(take.duration, 120),
          "Recorded texture",
        ),
        audio: {
          assetId: id,
          offsetSec: 0,
          gain: 1,
          fadeInSec: 0.02,
          fadeOutSec: 0.1,
        },
      },
    ];
    const base = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(doc),
    });
    if (!base.ok) throw new Error("Reference create: " + (await base.text()));
    const created = (await base.json()) as { revision: number };
    const upload = await fetch("/api/assets", {
      method: "POST",
      headers: {
        "Content-Type": "audio/wav",
        "X-Project-Id": doc.id,
        "X-Asset-Id": id,
        "X-File-Name": encodeURIComponent(asset.name),
        "X-Duration": String(asset.duration),
        "X-Sample-Rate": String(asset.sampleRate),
        "X-Channels": "1",
      },
      body: take.blob,
    });
    if (!upload.ok)
      throw new Error("Reference upload: " + (await upload.text()));
    doc.assets = [asset];
    doc.tracks.push(track);
    const save = await fetch("/api/projects/" + doc.id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        document: doc,
        expectedRevision: created.revision,
      }),
    });
    if (!save.ok) throw new Error("Reference save: " + (await save.text()));
    return {
      id: doc.id,
      title: doc.title,
      tracks: doc.tracks.length,
      recordedSeconds: take.duration,
      bytes: JSON.stringify(doc).length,
    };
  });
  const another = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    second = await another.newPage();
  const errors: string[] = [];
  second.on("pageerror", (e) => errors.push(e.message));
  await second.goto("/signin-with-chatgpt?return_to=/");
  await expect(second.getByLabel("Song title")).toHaveValue(fixture.title);
  await expect(second.locator(".track-row")).toHaveCount(16);
  await second
    .getByRole("navigation")
    .getByRole("button", { name: "01 Arrange" })
    .click();
  await second.screenshot({
    path: "output/playwright/reference-arrangement.png",
    fullPage: true,
  });
  await second.getByRole("button", { name: "Export", exact: true }).click();
  const waiting = second.waitForEvent("download", { timeout: 360000 });
  const began = Date.now();
  await second.getByRole("button", { name: "Export WAV", exact: true }).click();
  const download = await waiting;
  await download.saveAs("output/playwright/reference.wav");
  const bytes = readFileSync("output/playwright/reference.wav"),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const rate = view.getUint32(24, true),
    depth = view.getUint16(34, true),
    channels = view.getUint16(22, true),
    samples = view.getUint32(40, true) / (channels * 3);
  let sum = 0,
    peak = 0,
    nonzero = 0;
  for (let i = 44; i < bytes.length; i += 3) {
    let value = bytes.readUIntLE(i, 3);
    if (value & 0x800000) value -= 0x1000000;
    const normalized = value / 8388608;
    sum += normalized * normalized;
    peak = Math.max(peak, Math.abs(normalized));
    if (value) nonzero++;
  }
  const report = {
    ...fixture,
    exportSeconds: samples / rate,
    rate,
    depth,
    channels,
    rms: Math.sqrt(sum / ((bytes.length - 44) / 3)),
    peak,
    nonzero,
    renderWallSeconds: (Date.now() - began) / 1000,
  };
  writeFileSync(
    "output/playwright/reference-check.json",
    JSON.stringify(report, null, 2),
  );
  expect(report.exportSeconds).toBeCloseTo(304.8, 3);
  expect(report.rms).toBeGreaterThan(0.002);
  expect(report.peak).toBeLessThan(1);
  expect(report.rate).toBe(48000);
  expect(report.depth).toBe(24);
  expect(fixture.recordedSeconds).toBeGreaterThan(2);
  expect(errors).toEqual([]);
  await another.close();
});
