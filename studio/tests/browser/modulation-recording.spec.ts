import { test, expect } from "@playwright/test";

test("live movement records emitted notes once and keeps four independent macros through recovery", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Blank song", exact: true }).click();
  // Test movement and macro capture independently of downloading the acoustic catalog.
  await page.getByRole("button", { name: "Glass FM Synthesizers", exact: true }).click();
  await page.getByRole("button", { name: "Use on selected track", exact: true }).click();
  await page.getByRole("navigation").getByRole("button", { name: "03 Sound" }).click();
  const rack = page.getByRole("region", { name: "Selected track modulation rack" });
  await page.getByLabel("Other detail tools").selectOption("movement");
  if(await rack.locator(".movement-inspector").getAttribute("open") === null) await rack.getByText("Live & generated chord movement", { exact: true }).click();
  await rack.getByLabel("Live arpeggiator", { exact: true }).check();
  await rack.getByLabel("Movement pattern", { exact: true }).selectOption("up");
  await rack.getByLabel("Movement rate").selectOption("240");
  await page.getByRole("tab", {name:"Sound",exact:true}).click();
  await rack.getByLabel("Route source", { exact: true }).selectOption("M1");
  await rack.getByRole("button", { name: "Assign", exact: true }).click();
  await page.getByLabel("Recording source").selectOption("midi");
  await page.getByLabel("Start recording", { exact: true }).click();
  await expect(page.locator(".transport-position")).toContainText("Recording ·");
  await expect(rack.getByLabel("Add modulation source")).toBeDisabled();
  await page.locator("main.studio-shell").evaluate(element => { element.tabIndex = -1; element.focus(); });
  await page.keyboard.down("a"); await page.keyboard.down("d"); await page.keyboard.down("g");
  await page.waitForTimeout(450);
  await rack.getByLabel("M1 performance value", { exact: true }).fill("0.73");
  await rack.getByLabel("M2 performance value", { exact: true }).fill("0.28");
  await page.waitForTimeout(250);
  await page.keyboard.up("a"); await page.keyboard.up("d"); await page.keyboard.up("g");
  await page.getByLabel("Finish recording", { exact: true }).click();
  await expect(page.getByLabel("Start recording", { exact: true })).toBeEnabled();
  const saved = await page.evaluate(async () => {
    const { latestDraft } = await import("/lib/client/storage.ts" as string);
    const draft = await latestDraft("guest");
    const track = draft.document.tracks[0];
    return { patch: track.modulation, clips: track.clips.filter((clip: { name: string }) => clip.name === "MIDI take") };
  });
  expect(saved.clips).toHaveLength(1);
  const clip = saved.clips[0];
  expect(clip.notes.length).toBeGreaterThan(3);
  expect(new Set(clip.notes.map((note: { id: string }) => note.id)).size).toBe(clip.notes.length);
  expect(clip.notes.every((note: { duration: number }) => note.duration <= 240)).toBe(true);
  expect(clip.events.filter((event: { type: string; tick: number }) => event.type === "macro" && event.tick === 0)).toHaveLength(4);
  expect(clip.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "macro", macroId: "M1", value: .73 }),
    expect.objectContaining({ type: "macro", macroId: "M2", value: .28 }),
  ]));
  expect(saved.patch.macros.slice(0, 2)).toEqual([.73, .28]);
  // Finish now opens the captured take for review; return to Sound to set the next macro.
  await page.getByRole("tab", { name: "Sound", exact: true }).click();
  await rack.getByLabel("M1 amount value", { exact: true }).fill("0.12");
  await rack.getByLabel("M1 amount value", { exact: true }).blur();
  await page.getByLabel("Start recording", { exact: true }).click();
  await expect(page.locator(".transport-position")).toContainText("Recording ·");
  await rack.getByLabel("M3 performance value", { exact: true }).fill("0.41");
  await page.getByLabel("Finish recording", { exact: true }).click();
  await expect(page.getByLabel("Start recording", { exact: true })).toBeEnabled();
  const secondEvents = await page.evaluate(async () => {
    const { latestDraft } = await import("/lib/client/storage.ts" as string);
    const draft = await latestDraft("guest");
    return draft.document.tracks[0].clips.filter((clip: { name: string }) => clip.name === "MIDI take").at(-1).events;
  });
  expect(secondEvents).toEqual(expect.arrayContaining([expect.objectContaining({ type: "macro", macroId: "M1", tick: 0, value: .12 })]));
  await page.reload();
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("tab", { name: "Sound", exact: true }).click();
  await expect(rack.getByLabel("M1 amount value", { exact: true })).toHaveValue("0.12");
  await expect(rack.getByLabel("M2 amount value", { exact: true })).toHaveValue("0.28");
  await page.getByLabel("Stop song", { exact: true }).click();
  await expect(page.locator(".piano-key.held")).toHaveCount(0);
});

test("releasing live input removes queued arpeggio notes from the recorded take", async ({ page }) => {
  await page.addInitScript(() => {
    const timing = { down: 0, up: 0 };
    Object.assign(window, { chordzKeyTiming: timing });
    window.addEventListener("keydown", event => { if (event.key === "a") timing.down = performance.now(); });
    window.addEventListener("keyup", event => { if (event.key === "a") timing.up = performance.now(); });
  });
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Blank song", exact: true }).click();
  // Test input-release timing independently of downloading the acoustic catalog.
  await page.getByRole("button", { name: "Glass FM Synthesizers", exact: true }).click();
  await page.getByRole("button", { name: "Use on selected track", exact: true }).click();
  await page.getByRole("navigation").getByRole("button", { name: "03 Sound" }).click();
  const rack = page.getByRole("region", { name: "Selected track modulation rack" });
  await page.getByLabel("Other detail tools").selectOption("movement");
  if(await rack.locator(".movement-inspector").getAttribute("open") === null) await rack.getByText("Live & generated chord movement", { exact: true }).click();
  await rack.getByLabel("Live arpeggiator", { exact: true }).check();
  await rack.getByLabel("Movement rate").selectOption("240");
  await page.getByLabel("Start recording", { exact: true }).click();
  await expect(page.locator(".transport-position")).toContainText("Recording ·");
  await page.locator("main.studio-shell").evaluate(element => { element.tabIndex = -1; element.focus(); });
  await page.keyboard.down("a");
  // Cross at least one 240-tick step (125 ms at 120 BPM) regardless of song-grid phase.
  // The assertions still use the measured hold window and bound every released note.
  await page.waitForTimeout(180);
  await page.keyboard.up("a");
  await page.waitForTimeout(400);
  await page.getByLabel("Finish recording", { exact: true }).click();
  await expect(page.getByLabel("Start recording", { exact: true })).toBeEnabled();
  const result = await page.evaluate(async () => {
    const { latestDraft } = await import("/lib/client/storage.ts" as string);
    const draft = await latestDraft("guest");
    const timing = (window as unknown as { chordzKeyTiming: { down: number; up: number } }).chordzKeyTiming;
    return { notes: draft.document.tracks[0].clips.flatMap((clip: { name: string; notes: { tick: number; duration: number }[] }) => clip.name === "MIDI take" ? clip.notes : []), heldTicks: (timing.up - timing.down) * draft.document.tempo * 960 / 60000 };
  });
  // Browser input acknowledgement can exceed a step; use the observed hold window.
  expect(result.notes.length, JSON.stringify(result)).toBeGreaterThan(0);
  expect(result.notes.length, JSON.stringify(result)).toBeLessThanOrEqual(Math.floor(result.heldTicks / 240) + 1);
  const releaseBound = Math.min(...result.notes.map((note: { tick: number }) => note.tick)) + Math.ceil(result.heldTicks) + 16;
  expect(result.notes.every((note: { tick: number; duration: number }) => note.tick + note.duration <= releaseBound), JSON.stringify(result)).toBe(true);
});

test("MIDI CC channels remain independent and disconnect records controller cleanup", async ({ page }) => {
  await page.addInitScript(() => {
    const input = { id: "fixture-device", name: "Fixture controller", state: "connected", onmidimessage: null };
    const access = { inputs: new Map([[input.id, input]]), onstatechange: null };
    Object.defineProperty(navigator, "requestMIDIAccess", { value: async () => access });
    Object.assign(window, { chordzMidiFixture: { input, access } });
  });
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Blank song", exact: true }).click();
  await page.getByRole("navigation").getByRole("button", { name: "03 Sound" }).click();
  const rack = page.getByRole("region", { name: "Selected track modulation rack" });
  await rack.locator(".mod-midi-inspector>summary").click();
  await rack.getByRole("button", { name: "Learn CC", exact: true }).click();
  await expect(rack.getByRole("button", { name: "Cancel MIDI learn", exact: true })).toBeVisible();
  await page.evaluate(() => {
    const fixture = (window as unknown as { chordzMidiFixture: { input: { onmidimessage: (event: { data: Uint8Array }) => void } } }).chordzMidiFixture;
    fixture.input.onmidimessage({ data: new Uint8Array([0xb3, 20, 64]) });
  });
  await expect(rack.getByLabel("Route source", { exact: true })).toHaveValue("cc:3:20");
  await rack.getByRole("button", { name: "Assign", exact: true }).click();
  await page.getByLabel("Start recording", { exact: true }).click();
  await expect(page.locator(".transport-position")).toContainText("Recording ·");
  await page.evaluate(() => {
    const fixture = (window as unknown as { chordzMidiFixture: { input: { onmidimessage: (event: { data: Uint8Array }) => void }; access: { onstatechange: (event: { port: { id: string; state: string } }) => void } } }).chordzMidiFixture;
    fixture.input.onmidimessage({ data: new Uint8Array([0xb0, 20, 32]) });
    fixture.input.onmidimessage({ data: new Uint8Array([0xb3, 20, 96]) });
    fixture.access.onstatechange({ port: { id: "fixture-device", state: "disconnected" } });
  });
  await page.waitForTimeout(80);
  await page.getByLabel("Finish recording", { exact: true }).click();
  await expect(page.getByLabel("Start recording", { exact: true })).toBeEnabled();
  const events = await page.evaluate(async () => {
    const { latestDraft } = await import("/lib/client/storage.ts" as string);
    const draft = await latestDraft("guest");
    return draft.document.tracks[0].clips.find((clip: { name: string }) => clip.name === "MIDI take").events;
  });
  expect(events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "controlChange", cc: 20, channel: 0, value: 32 / 127 }),
    expect.objectContaining({ type: "controlChange", cc: 20, channel: 3, value: 96 / 127 }),
    expect.objectContaining({ type: "controlChange", cc: 20, channel: 0, value: 0 }),
    expect.objectContaining({ type: "controlChange", cc: 20, channel: 3, value: 0 }),
  ]));
});
