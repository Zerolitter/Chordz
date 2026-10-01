import { expect, test, type Page } from "@playwright/test";

async function blank(page: Page) {
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Blank song", exact: true }).click();
  await page.getByRole("button", { name: "Glass FM Synthesizers", exact: true }).click();
  await page.getByRole("button", { name: "Use on selected track", exact: true }).click();
  await page.getByLabel("Recording setup", { exact: true }).click();
}

test("record setup names its destination and count-in, and Finish opens the saved take dock", async ({ page }) => {
  await blank(page);
  await expect(page.getByLabel("Recording destination")).toContainText("Grand piano");
  await page.getByLabel("Recording count-in").selectOption("0");
  await expect(page.getByRole("status", { name: "Recording readiness" })).toContainText("Computer keyboard");
  await page.getByLabel("Other detail tools").selectOption("keyboard");
  await page.getByLabel("Collapse detail dock", { exact: true }).click();
  await page.getByLabel("Start recording", { exact: true }).click();
  await expect(page.locator(".transport-position")).toContainText("Recording ·");
  await page.locator("main.studio-shell").evaluate(element => { element.tabIndex = -1; element.focus(); });
  await page.keyboard.down("a");
  await page.waitForTimeout(180);
  await page.keyboard.up("a");
  await page.getByLabel("Finish recording", { exact: true }).click();
  await expect(page.locator(".clip-editor")).toBeVisible();
  await expect(page.locator(".piano-roll")).toBeVisible();
  await expect(page.locator(".workspace-selection")).toContainText("MIDI take");
  const saved = await page.evaluate(async () => {
    const { latestDraft } = await import("/lib/client/storage.ts" as string);
    const document = (await latestDraft("guest"))!.document;
    return document.tracks.flatMap((track: { clips: { name: string; notes: unknown[] }[] }) => track.clips).filter((clip: { name: string }) => clip.name === "MIDI take");
  });
  expect(saved).toHaveLength(1);
  expect(saved[0].notes).toHaveLength(1);
});

test("a microphone check meters input without a take and closing setup releases it despite an invalid draft", async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    (window as unknown as { checkedStreams: MediaStream[] }).checkedStreams = [];
    navigator.mediaDevices.getUserMedia = async constraints => {
      // Permission still uses the fake device; a known Web Audio tone verifies the dB meter.
      const permission = await original(constraints);
      permission.getTracks().forEach(track => track.stop());
      const context = new AudioContext({ sampleRate: 48000 });
      await context.resume();
      const oscillator = context.createOscillator(), gain = context.createGain(), output = context.createMediaStreamDestination();
      gain.gain.value = .1; oscillator.connect(gain); gain.connect(output); oscillator.start();
      const stream = output.stream;
      (window as unknown as { checkedStreams: MediaStream[] }).checkedStreams.push(stream);
      return stream;
    };
  });
  await blank(page);
  await page.getByLabel("Recording source").selectOption("audio");
  await expect(page.getByLabel("Recording monitor input")).not.toBeChecked();
  await page.getByRole("button", { name: "Check microphone", exact: true }).click();
  await expect(page.getByRole("status", { name: "Recording readiness" })).toContainText("Input ready");
  await expect.poll(() => page.getByRole("meter", { name: "Recording input level" }).getAttribute("aria-valuenow").then(Number)).toBeGreaterThan(-40);
  await page.getByLabel("Tempo", { exact: true }).fill("");
  await page.getByLabel("Recording setup", { exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { checkedStreams: MediaStream[] }).checkedStreams.flatMap(stream => stream.getTracks()).every(track => track.readyState === "ended"))).toBe(true);
  await expect(page.getByLabel("Tempo", { exact: true })).toHaveValue("");
  await page.getByLabel("Tempo", { exact: true }).press("Escape");
  await page.getByLabel("Recording setup", { exact: true }).click();
  await page.getByLabel("Recording count-in").selectOption("0");
  await page.getByLabel("Start recording", { exact: true }).click();
  await expect(page.locator(".transport-position")).toContainText("Recording ·");
  await page.waitForTimeout(200);
  await page.getByLabel("Finish recording", { exact: true }).click();
  await expect(page.locator(".audio-editor")).toBeVisible();
  await expect(page.locator(".workspace-selection")).toContainText("Microphone take");
});

test("denied microphone check reports a local problem and MIDI recording stays usable", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Microphone permission denied", "NotAllowedError"); };
  });
  await blank(page);
  await page.getByLabel("Recording source").selectOption("audio");
  await page.getByRole("button", { name: "Check microphone", exact: true }).click();
  await expect(page.getByRole("status", { name: "Recording readiness" })).toContainText("permission denied");
  await page.getByLabel("Recording source").selectOption("midi");
  await page.getByLabel("Recording count-in").selectOption("2");
  await page.getByLabel("Start recording", { exact: true }).click();
  await expect(page.locator(".transport-position")).toContainText("Count-in");
  await page.getByLabel("Stop song", { exact: true }).click();
  await expect(page.getByLabel("Start recording", { exact: true })).toBeEnabled();
  await expect(page.locator(".timeline-clip")).toHaveCount(0);
});

test("a late microphone permission result cannot restart a closed input check or disturb a successor take", async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const state = window as unknown as { checkedStreams: MediaStream[]; releaseInput?: () => void };
    state.checkedStreams = [];
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await original(constraints);
      state.checkedStreams.push(stream);
      await new Promise<void>(resolve => { state.releaseInput = resolve; });
      return stream;
    };
  });
  await blank(page);
  await page.getByLabel("Recording source").selectOption("audio");
  await page.getByRole("button", { name: "Check microphone", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { checkedStreams: MediaStream[] }).checkedStreams.length)).toBe(1);
  await page.getByLabel("Recording setup", { exact: true }).click();
  await page.getByLabel("Recording source").selectOption("midi");
  await page.getByLabel("Recording setup", { exact: true }).click();
  await page.getByLabel("Recording count-in").selectOption("0");
  await page.getByLabel("Start recording", { exact: true }).click();
  await expect(page.locator(".transport-position")).toContainText("Recording ·");
  await page.evaluate(() => (window as unknown as { releaseInput: () => void }).releaseInput());
  await expect.poll(() => page.evaluate(() => (window as unknown as { checkedStreams: MediaStream[] }).checkedStreams.flatMap(stream => stream.getTracks()).every(track => track.readyState === "ended"))).toBe(true);
  await page.locator("main.studio-shell").evaluate(element => { element.tabIndex = -1; element.focus(); });
  await page.keyboard.down("a"); await page.waitForTimeout(120); await page.keyboard.up("a");
  await page.getByLabel("Finish recording", { exact: true }).click();
  await expect(page.locator(".workspace-selection")).toContainText("MIDI take");
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
});

test("an explicit MIDI destination keeps its identity while another track is selected", async ({ page }) => {
  await blank(page);
  await expect.poll(() => page.evaluate(async () => {
    const { latestDraft } = await import("/lib/client/storage.ts" as string);
    return (await latestDraft("guest"))!.document.tracks[0].sound.algorithm;
  })).toBe("fm");
  await page.evaluate(async () => {
    const { latestDraft, saveDraft } = await import("/lib/client/storage.ts" as string);
    const { createTrack } = await import("/lib/music/project.ts" as string);
    const draft = (await latestDraft("guest"))!;
    const track = createTrack("lead", "Second instrument"); track.id = "second_recording_target";
    draft.document.tracks.push(track); await saveDraft(draft);
  });
  await page.reload();
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByLabel("Recording setup", { exact: true }).click();
  await page.getByLabel("Recording destination").selectOption("second_recording_target");
  await page.getByLabel("Recording count-in").selectOption("0");
  await page.getByLabel("Start recording", { exact: true }).click();
  await expect(page.locator(".transport-position")).toContainText("Recording ·");
  await page.getByRole("button", { name: "Select Grand piano", exact: true }).click();
  await page.locator("main.studio-shell").evaluate(element => { element.tabIndex = -1; element.focus(); });
  await page.keyboard.down("s"); await page.waitForTimeout(150); await page.keyboard.up("s");
  await page.getByLabel("Finish recording", { exact: true }).click();
  await expect(page.locator(".workspace-selection")).toContainText("Second instrument / MIDI take");
  const destinations = await page.evaluate(async () => {
    const { latestDraft } = await import("/lib/client/storage.ts" as string);
    return (await latestDraft("guest"))!.document.tracks.map((track: { id: string; clips: unknown[] }) => ({ id: track.id, clips: track.clips.length }));
  });
  expect(destinations.find((track: { id: string }) => track.id === "second_recording_target")?.clips).toBe(1);
  expect(destinations[0].clips).toBe(0);
});

test("record setup stays inside laptop, desktop, tablet and narrow viewports", async ({ page }) => {
  await blank(page);
  for (const [width, height] of [[1920, 1080], [1366, 768], [850, 768], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByLabel("Stop song", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Recording count-in")).toBeVisible();
    await expect.poll(() => page.locator(".recording-setup-body").evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight;
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/phase3-review/${width}-recording.png` });
  }
});
