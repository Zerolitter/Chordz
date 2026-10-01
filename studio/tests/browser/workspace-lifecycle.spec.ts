import { expect, test, type Page } from "@playwright/test";
import type { NoteEvent, PerformanceEvent } from "../../lib/music/types";

async function blank(page: Page) {
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Blank song", exact: true }).click();
  await builtInSound(page);
}
async function builtInSound(page: Page) {
  // Input ownership tests do not depend on downloading acoustic samples.
  await page.getByRole("button", { name: "Glass FM Synthesizers", exact: true }).click();
  await page.getByRole("button", { name: "Use on selected track", exact: true }).click();
}
async function startTake(page: Page) {
  await page.getByLabel("Recording source").selectOption("midi");
  await page.getByLabel("Start recording", { exact: true }).click();
  await expect(page.locator(".transport-position")).toContainText("Recording ·");
}
async function finishTake(page: Page) {
  await page.getByLabel("Finish recording", { exact: true }).click();
  await expect(page.getByLabel("Start recording", { exact: true })).toBeEnabled();
  await expect.poll(async () => (await savedTake(page))?.notes.length ?? -1).toBeGreaterThanOrEqual(0);
  return (await savedTake(page))!;
}
async function savedTake(page: Page) {
  return page.evaluate(async () => {
    const { latestDraft } = await import("/lib/client/storage.ts" as string);
    const draft = await latestDraft("guest");
    const clip = draft?.document.tracks.flatMap((track: { clips: { name: string; notes: NoteEvent[]; events: PerformanceEvent[] }[] }) => track.clips).filter((clip: { name: string }) => clip.name === "MIDI take").at(-1);
    return clip ? { notes: clip.notes as NoteEvent[], events: clip.events as PerformanceEvent[], tempo: draft.document.tempo as number } : null;
  });
}
async function clickCollapseWithoutReleasingPointer(page: Page) {
  await page.getByLabel("Collapse detail dock", { exact: true }).evaluate(element => (element as HTMLButtonElement).click());
}
async function midi(page: Page, bytes: number[]) {
  return page.evaluate(data => {
    const input = (window as unknown as { workspaceMidi: { onmidimessage: (event: { data: Uint8Array }) => void } }).workspaceMidi;
    input.onmidimessage({ data: new Uint8Array(data) });
    return performance.now();
  }, bytes);
}

test("collapsing Keyboard ends its pointer note during capture while computer input stays held", async ({ page }) => {
  await blank(page);
  await page.getByLabel("Other detail tools").selectOption("keyboard");
  await startTake(page);
  await page.locator("main.studio-shell").evaluate(element => { element.tabIndex = -1; element.focus(); });
  await page.keyboard.down("s");
  const key = page.getByRole("button", { name: "Play C3", exact: true });
  const box = (await key.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator(".piano-key.held")).toHaveCount(2);
  await page.waitForTimeout(120);
  await clickCollapseWithoutReleasingPointer(page);
  await expect(page.getByLabel("Expand detail dock", { exact: true })).toBeVisible();
  await expect(page.locator(".piano-key.held")).toHaveCount(1);
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.keyboard.up("s");
  await expect(page.locator(".piano-key.held")).toHaveCount(0);
  const take = await finishTake(page);
  expect(take.notes).toHaveLength(2);
  const pointer = take.notes.find(note => note.pitch === 48)!;
  const computer = take.notes.find(note => note.pitch !== 48)!;
  expect(pointer.duration).toBeGreaterThan(0);
  expect(computer.tick + computer.duration - pointer.tick - pointer.duration).toBeGreaterThan(take.tempo * 960 * .2 / 60);
});

test("an invalid draft blocks collapse and navigation after the tool's held input has ended", async ({ page }) => {
  await blank(page);
  await page.getByLabel("Other detail tools").selectOption("keyboard");
  await startTake(page);
  const key = page.getByRole("button", { name: "Play C3", exact: true });
  const box = (await key.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(key).toHaveClass(/held/);
  const meter = page.getByLabel("Beats per bar", { exact: true });
  await meter.fill("");
  await clickCollapseWithoutReleasingPointer(page);
  await expect(page.getByLabel("Collapse detail dock", { exact: true })).toBeVisible();
  await expect(key).toBeVisible();
  await expect(key).not.toHaveClass(/held/);
  expect(await key.evaluate(element => element.hasPointerCapture(1))).toBe(false);
  // A subsequent real click must reach its target, rather than the released piano key.
  await page.getByRole("tab", { name: "Sound", exact: true }).click();
  await expect(key).toBeVisible();
  await page.getByRole("navigation").getByRole("button", { name: "02 Write", exact: true }).evaluate(element => (element as HTMLButtonElement).click());
  await expect(page.getByRole("navigation").getByRole("button", { name: "01 Arrange", exact: true })).toHaveAttribute("aria-current", "page");
  await page.waitForTimeout(180);
  await page.mouse.up();
  const take = await finishTake(page);
  expect(take.notes).toHaveLength(1);
  expect(take.notes[0].duration).toBeGreaterThan(0);
  await expect(meter).toHaveValue("");
  await meter.press("Escape");
  await expect(meter).toHaveValue("4");
});

test("an invalid draft blocks a chord-guide handoff after releasing the tool's recorded note", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await builtInSound(page);
  const sections = page.locator(".section-lane .selected"), chords = page.locator(".song-chord-guide [aria-pressed=true]");
  const section = await sections.allTextContents(), chord = await chords.allTextContents();
  await page.getByLabel("Other detail tools").selectOption("keyboard");
  await startTake(page);
  const key = page.getByRole("button", { name: "Play C3", exact: true });
  const box = (await key.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await expect(key).toHaveClass(/held/);
  const meter = page.getByLabel("Beats per bar", { exact: true });
  await meter.fill("");
  await page.locator(".song-chord-guide button").last().evaluate(element => (element as HTMLButtonElement).click());
  await expect(key).not.toHaveClass(/held/);
  expect(await key.evaluate(element => element.hasPointerCapture(1))).toBe(false);
  expect(await sections.allTextContents()).toEqual(section);
  expect(await chords.allTextContents()).toEqual(chord);
  await expect(page.getByRole("navigation").getByRole("button", { name: "01 Arrange", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel("Other detail tools")).toHaveValue("keyboard");
  await page.mouse.up();
  const take = await finishTake(page);
  expect(take.notes).toHaveLength(1);
  expect(take.notes[0].duration).toBeGreaterThan(0);
  await expect(meter).toHaveValue("");
  await meter.press("Escape");
});

test("hiding an active performance knob freezes the last recorded controller value", async ({ page }) => {
  await blank(page);
  await page.getByRole("navigation").getByRole("button", { name: "03 Sound", exact: true }).click();
  await startTake(page);
  const dial = page.getByRole("slider", { name: "Expression", exact: true, includeHidden: true });
  await dial.scrollIntoViewIfNeeded();
  const box = (await dial.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 24, { steps: 4 });
  expect(await dial.evaluate(element => element.hasPointerCapture(1))).toBe(true);
  const value = Number(await dial.getAttribute("aria-valuenow"));
  expect(value).toBeLessThan(1);
  await clickCollapseWithoutReleasingPointer(page);
  expect(await dial.evaluate(element => element.hasPointerCapture(1))).toBe(false);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60);
  await page.mouse.up();
  const take = await finishTake(page);
  const events = take.events.filter(event => event.type === "expression");
  expect(events.at(-1)?.value).toBe(value);
  await page.getByRole("tab", { name: "Sound", exact: true }).click();
  await expect(page.getByLabel("Expression value", { exact: true })).toHaveValue(String(value));
});

test("the same selected clip reopens Notes and a pure collapse retains A/B state", async ({ page }) => {
  await blank(page);
  await page.getByRole("button", { name: "New phrase", exact: true }).click();
  await expect(page.locator(".piano-roll")).toBeVisible();
  await page.getByLabel("Collapse detail dock", { exact: true }).click();
  await page.locator(".timeline-clip-body").first().click();
  await expect(page.getByRole("tab", { name: "Notes / Audio", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".piano-roll")).toBeVisible();
  await page.getByRole("tab", { name: "Sound", exact: true }).click();
  const rack = page.getByRole("region", { name: "Selected track modulation rack" });
  await rack.getByRole("button", { name: "Compare A/B", exact: true }).click();
  await rack.getByRole("button", { name: "B", exact: true }).click();
  await rack.getByLabel("Sound patch preset").selectOption("starter:pulse");
  await expect(rack.locator(".mod-route")).toHaveCount(5);
  await page.getByLabel("Collapse detail dock", { exact: true }).click();
  await page.getByLabel("Expand detail dock", { exact: true }).click();
  await expect(rack.getByRole("button", { name: "Use B", exact: true })).toBeVisible();
  await expect(rack.locator(".mod-route")).toHaveCount(5);
  await page.getByRole("tab", { name: "Notes / Audio", exact: true }).click();
  await page.getByRole("tab", { name: "Sound", exact: true }).click();
  await expect(rack.locator(".mod-route")).toHaveCount(0);
});

test("collapsing a graph drag settles its child gesture while retaining the A/B proposal", async ({ page }) => {
  await blank(page);
  await page.getByRole("tab", { name: "Sound", exact: true }).click();
  const rack = page.getByRole("region", { name: "Selected track modulation rack" });
  await rack.getByRole("button", { name: "Compare A/B", exact: true }).click();
  await rack.getByRole("button", { name: "B", exact: true }).click();
  const value = page.getByLabel("Attack value", { exact: true }), initial = await value.inputValue();
  const handle = page.getByRole("slider", { name: "Instrument envelope attack graph handle", exact: true });
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 20, y, { steps: 4 });
  const changed = await value.inputValue(); expect(changed).not.toBe(initial);
  await clickCollapseWithoutReleasingPointer(page);
  await page.mouse.move(x + 50, y); await page.mouse.up();
  await page.getByLabel("Expand detail dock", { exact: true }).click();
  await expect(value).toHaveValue(changed);
  await expect(rack.getByRole("button", { name: "Use B", exact: true })).toBeVisible();
  await rack.getByRole("button", { name: "Cancel comparison", exact: true }).click();
  await expect(value).toHaveValue(initial);
});

test("a new clip opens near its notes and collapsing Notes preserves the user's pitch scroll", async ({ page }) => {
  await blank(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole("button", { name: "New phrase", exact: true }).click();
  const roll = page.locator(".piano-roll-scroll");
  await expect.poll(() => roll.evaluate(element => element.scrollTop)).toBeGreaterThan(500);
  await roll.evaluate(element => { element.scrollTop = 420; });
  await page.getByLabel("Collapse detail dock", { exact: true }).click();
  await page.getByLabel("Expand detail dock", { exact: true }).click();
  expect(await roll.evaluate(element => element.scrollTop)).toBe(420);
  await page.getByLabel("Duplicate selected clip", { exact: true }).click();
  await expect.poll(() => roll.evaluate(element => element.scrollTop)).toBeGreaterThan(500);
  await page.getByRole("button", { name: "Automation", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Automation", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Automation parameter", { exact: true })).toBeVisible();
});

for (const shared of [false, true]) test(shared ? "closing Sound preserves MIDI pedal ownership until MIDI releases it" : "closing Sound records pedal off when it is the sole owner", async ({ page }) => {
  if (shared) await page.addInitScript(() => {
    const input = { id: "workspace-controller", name: "Workspace controller", state: "connected", onmidimessage: null };
    const access = { inputs: new Map([[input.id, input]]), onstatechange: null };
    Object.defineProperty(navigator, "requestMIDIAccess", { value: async () => access });
    Object.assign(window, { workspaceMidi: input });
  });
  await blank(page);
  await page.getByRole("navigation").getByRole("button", { name: "03 Sound", exact: true }).click();
  if (shared) {
    const rack = page.getByRole("region", { name: "Selected track modulation rack" });
    await rack.locator(".mod-midi-inspector>summary").click();
    await rack.getByRole("button", { name: "Learn CC", exact: true }).click();
    await expect(rack.getByRole("button", { name: "Cancel MIDI learn", exact: true })).toBeVisible();
    await midi(page, [0xb0, 74, 0]);
  }
  await startTake(page);
  const midiDown = shared ? await midi(page, [0xb0, 64, 127]) : 0;
  const pedal = page.getByRole("button", { name: "Hold sustain pedal", exact: true });
  await pedal.scrollIntoViewIfNeeded();
  const box = (await pedal.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(100);
  const closedAt = await page.evaluate(() => performance.now());
  await clickCollapseWithoutReleasingPointer(page);
  await page.waitForTimeout(180);
  await page.mouse.up();
  if (shared) await midi(page, [0xb0, 64, 0]);
  const take = await finishTake(page);
  const events = take.events.filter(event => event.type === "sustain" && event.tick > 0);
  expect(events.map(event => event.value)).toEqual([1, 0]);
  if (shared) expect(events[1].tick - events[0].tick).toBeGreaterThan((closedAt - midiDown + 100) * take.tempo * 960 / 60000);
});
