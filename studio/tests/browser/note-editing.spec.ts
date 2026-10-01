import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Clip, ProjectDocument } from "../../lib/music/types";
import { DEFAULT_SHORTCUTS } from "../../lib/client/shortcuts";
import { mkdirSync } from "node:fs";
import { encodeWav } from "../../lib/audio/wav";

const sourceTicks = 15360;
async function fixture(page: Page, options: { offGrid?: boolean; extremes?: boolean; second?: boolean; zeroVelocity?: boolean; sourceBars?: number; adjacentShort?: number; adjacentLong?: boolean; longFirst?: boolean } = {}) {
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  // Let initialization finish its first durable save before replacing the
  // fixture, rather than racing the app's startup autosave on page reload.
  await expect.poll(() => page.evaluate(async () => {
    const { latestDraft } = await import("/lib/client/storage.ts" as string);
    return !!(await latestDraft("guest"));
  })).toBe(true);
  const projectId = await page.evaluate(async options => {
    const { createProject, createTrack } = await import("/lib/music/project.ts" as string);
    const { projectSchema } = await import("/lib/music/schema.ts" as string);
    const { saveDraft } = await import("/lib/client/storage.ts" as string);
    const project = createProject("Direct note editing fixture") as ProjectDocument;
    project.id = "note_editing_" + crypto.randomUUID().replaceAll("-", "");
    const track = createTrack("lead", "Glass FM notes");
    track.id = "note_editing_track";
    track.clips = [{
      id: "note_editing_clip", name: "Four bar source", startTick: 3840,
      lengthTick: 30720, sourceLengthTick: 15360, loop: true, transpose: 0,
      notes: [
        { id: "fixture_c", pitch: 60, tick: 0, duration: 960, velocity: .6 },
        { id: "fixture_e", pitch: 64, tick: 1920, duration: 480, velocity: .8, articulation: "sustain" },
        { id: "fixture_g", pitch: 67, tick: 5760, duration: 1920, velocity: .4 },
      ],
      events: [{ type: "controlChange", tick: 120, cc: 74, channel: 0, value: .3 }],
    }];
    if (options.offGrid) {
      track.clips[0].notes[0].tick = 121;
      track.clips[0].notes[1].tick = 2181;
    }
    if (options.zeroVelocity) track.clips[0].notes[0].velocity = 0;
    if (options.sourceBars) track.clips[0].sourceLengthTick = options.sourceBars * 3840;
    if (options.adjacentShort) {
      const firstDuration = options.longFirst ? 960 : options.adjacentShort;
      track.clips[0].notes[0] = { ...track.clips[0].notes[0], tick: 1920, duration: firstDuration };
      track.clips[0].notes[1] = { ...track.clips[0].notes[1], pitch: 60, tick: 1920 + Math.max(120, firstDuration), duration: options.adjacentLong && !options.longFirst ? 960 : options.adjacentShort };
    }
    if (options.extremes) track.clips[0].notes.push(
      { id: "fixture_low", pitch: 0, tick: 9600, duration: 240, velocity: .5 },
      { id: "fixture_high", pitch: 127, tick: 11520, duration: 240, velocity: .5 },
    );
    if (options.second) track.clips.push({
      ...structuredClone(track.clips[0]), id: "note_editing_second", name: "Second source", startTick: 38400,
      loop: false, lengthTick: 15360,
      // Legacy projects permit the same note ID in different phrases. Editor
      // ownership must use the complete clip scope, not a note ID alone.
      notes: [{ id: "fixture_c", pitch: 62, tick: 0, duration: 960, velocity: .7 }],
    });
    project.tracks = [track];
    projectSchema.parse(project);
    await saveDraft({ owner: "guest", document: project, revision: 100, savedFingerprint: "", updatedAt: new Date().toISOString() });
    return project.id;
  }, options);
  await page.reload();
  await expect(page.getByLabel("Song title")).toHaveValue("Direct note editing fixture");
  await page.getByRole("navigation").getByRole("button", { name: "01 Arrange", exact: true }).click();
  await page.locator(".timeline-clip-body").first().click();
  await expect(page.locator(".roll-note")).toHaveCount(options.extremes ? 5 : 3);
  await page.getByLabel("Quantization grid").selectOption("240");
  return projectId;
}
async function savedDocument(page: Page, owner = "guest"): Promise<ProjectDocument> {
  return page.evaluate(async owner => {
    const { latestDraft } = await import("/lib/client/storage.ts" as string);
    return (await latestDraft(owner))!.document;
  }, owner);
}
async function clip(page: Page): Promise<Clip> { return (await savedDocument(page)).tracks[0].clips[0]; }
const note = (page: Page, id: string) => page.locator(`.roll-note[data-note-id="${id}"]`);
const selected = (page: Page) => page.locator('.roll-note[aria-pressed="true"]');
async function styles(page: Page) {
  return page.locator(".roll-note").evaluateAll(elements => elements.map(element => ({ id: element.getAttribute("data-note-id"), style: element.getAttribute("style") })));
}
async function moveHeld(page: Page, target: Locator, ticks = 960, pitches = 0) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!, roll = (await page.locator(".note-grid-lines").boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + roll.width * ticks / sourceTicks, y - 18 * pitches);
}
async function selectPair(page: Page) {
  await note(page, "fixture_c").click();
  await note(page, "fixture_e").click({ modifiers: ["Shift"] });
  await expect(selected(page)).toHaveCount(2);
}

test("live note movement previews before mouse-up and commits exactly one reversible source edit", async ({ page }) => {
  await fixture(page);
  const before = await clip(page);
  const note = page.getByRole("button", { name: "C4 note at beat 1", exact: true });
  await note.click();
  await moveHeld(page, note, 960, 1);
  await expect(page.getByLabel("Note beat", { exact: true })).toHaveValue("2");
  await expect(page.getByLabel("Note MIDI pitch", { exact: true })).toHaveValue("61");
  // Hold past the device autosave debounce: an unfinished gesture must not
  // become a committed recovery document merely because the user pauses.
  await page.waitForTimeout(550);
  expect(await clip(page)).toEqual(before);
  await page.mouse.up();
  await expect.poll(async () => (await clip(page)).notes[0]).toEqual({ ...before.notes[0], tick: 960, pitch: 61 });
  expect({ ...(await clip(page)), notes: before.notes }).toEqual(before);
  await page.getByLabel("Undo", { exact: true }).click();
  await expect.poll(() => clip(page)).toEqual(before);
  await page.getByLabel("Redo", { exact: true }).click();
  await expect.poll(async () => (await clip(page)).notes[0]).toEqual({ ...before.notes[0], tick: 960, pitch: 61 });
});

test("selected notes move live as one group and keep relative timing, events and loop geometry", async ({ page }) => {
  await fixture(page); await selectPair(page);
  const before = await clip(page), initial = await styles(page);
  await moveHeld(page, note(page, "fixture_e"), 960, 2);
  await expect.poll(() => styles(page)).not.toEqual(initial);
  expect(await clip(page)).toEqual(before);
  await page.mouse.up();
  const after = { ...before, notes: before.notes.map(n => n.id === "fixture_g" ? n : { ...n, tick: n.tick + 960, pitch: n.pitch + 2 }) };
  await expect.poll(() => clip(page)).toEqual(after);
  await expect(selected(page)).toHaveCount(2);
  await page.getByLabel("Undo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(before);
  await page.getByLabel("Redo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(after);
});

test("both note edges resize live in source ticks and each release creates one Undo step", async ({ page }) => {
  await fixture(page);
  const before = await clip(page);
  await note(page, "fixture_e").click();
  const end = page.locator('.note-edge[data-note-id="fixture_e"][data-note-edge="end"]');
  await moveHeld(page, end, 480);
  await expect(page.getByLabel("Note duration beats", { exact: true })).toHaveValue("1");
  expect(await clip(page)).toEqual(before);
  await page.mouse.up();
  const enlarged = { ...before, notes: before.notes.map(n => n.id === "fixture_e" ? { ...n, duration: 960 } : n) };
  await expect.poll(() => clip(page)).toEqual(enlarged);
  await page.getByLabel("Undo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(before);
  await page.getByLabel("Redo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(enlarged);
  const start = page.locator('.note-edge[data-note-id="fixture_e"][data-note-edge="start"]');
  await moveHeld(page, start, 240);
  await expect(page.getByLabel("Note beat", { exact: true })).toHaveValue("3.25");
  await expect(page.getByLabel("Note duration beats", { exact: true })).toHaveValue("0.75");
  await page.mouse.up();
  const shortened = { ...enlarged, notes: enlarged.notes.map(n => n.id === "fixture_e" ? { ...n, tick: 2160, duration: 720 } : n) };
  await expect.poll(() => clip(page)).toEqual(shortened);
  await page.getByLabel("Undo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(enlarged);
});

test("adjacent short-note centers move the intended group and both edges resize with one Undo", async ({ page }) => {
  let fixtureDuration = 0;
  async function pressRealTarget(target: Locator, capture = true) {
    await target.scrollIntoViewIfNeeded();
    const box = (await target.boundingBox())!, point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // Check the actual hit surface before sending a native pointer-down: a
    // sibling resize handle must not intercept this note or the other edge.
    const hit = await target.evaluate((element, point) => {
      const actual = document.elementFromPoint(point.x, point.y);
      const describe = (target: Element | null) => target ? { tag: target.tagName, classes: target.getAttribute("class"), noteId: target.getAttribute("data-note-id"), edge: target.getAttribute("data-note-edge") } : null;
      return { matches: actual === element, intended: describe(element), bounds: element.getBoundingClientRect().toJSON(), point, actual: describe(actual) };
    }, point);
    expect(hit.matches, JSON.stringify({ fixtureDuration, ...hit })).toBe(true);
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    expect(await target.evaluate(element => element.hasPointerCapture(1)), JSON.stringify({ fixtureDuration, captureExpected: capture, ...hit })).toBe(capture);
    return point;
  }
  for (const duration of [240, 60]) {
    fixtureDuration = duration;
    await fixture(page, { sourceBars: 8, adjacentShort: duration });
    const before = await clip(page), c = note(page, "fixture_c"), e = note(page, "fixture_e");
    expect((await c.boundingBox())!.width).toBeCloseTo(duration === 240 ? 6.25 : 3, 2);
    expect((await e.boundingBox())!.width).toBeCloseTo(duration === 240 ? 6.25 : 3, 2);
    await pressRealTarget(c); await page.mouse.up();
    await page.keyboard.down("Shift"); await pressRealTarget(e, false); await page.mouse.up(); await page.keyboard.up("Shift");
    await expect(selected(page)).toHaveCount(2);
    await expect(page.getByLabel("Undo", { exact: true })).toBeDisabled();

    const body = await pressRealTarget(e), gridWidth = (await page.locator(".note-grid-lines").boundingBox())!.width;
    await page.mouse.move(body.x + gridWidth * 960 / before.sourceLengthTick, body.y - 18);
    await expect(page.getByLabel("Note MIDI pitch", { exact: true })).toHaveValue("61");
    await expect(page.getByLabel("Note beat", { exact: true })).toHaveValue(String(before.notes[1].tick / 960 + 2));
    expect(await clip(page)).toEqual(before);
    await page.mouse.up();
    const moved = { ...before, notes: before.notes.map(n => n.id === "fixture_g" ? n : { ...n, tick: n.tick + 960, pitch: n.pitch + 1 }) };
    await expect.poll(() => clip(page)).toEqual(moved);
    await page.getByLabel("Undo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(before);
    await expect(page.getByLabel("Undo", { exact: true })).toBeDisabled();
    await page.getByLabel("Redo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(moved);
    await page.getByLabel("Undo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(before);

    // Resize the outside corners of the adjacent pair. Their musical onsets,
    // duration and source span remain exact, including the 3px display floor.
    for (const [id, edge, delta] of [["fixture_c", "start", -240], ["fixture_e", "end", 240]] as const) {
      await note(page, id).focus(); await page.keyboard.press("Enter");
      await expect(selected(page)).toHaveCount(1);
      await expect(note(page, id)).toHaveAttribute("aria-pressed", "true");
      await pressRealTarget(note(page, id)); await page.mouse.up();
      const handle = page.locator(`.note-edge[data-note-id="${id}"][data-note-edge="${edge}"]`);
      const point = await pressRealTarget(handle);
      await page.mouse.move(point.x + gridWidth * delta / before.sourceLengthTick, point.y);
      await expect(page.getByLabel("Note duration beats", { exact: true })).toHaveValue(String((duration + 240) / 960));
      expect(await clip(page)).toEqual(before);
      await page.mouse.up();
      const resized = { ...before, notes: before.notes.map(n => n.id === id ? { ...n, ...(edge === "start" ? { tick: n.tick - 240 } : {}), duration: n.duration + 240 } : n) };
      await expect.poll(() => clip(page)).toEqual(resized);
      await page.getByLabel("Undo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(before);
      await expect(page.getByLabel("Undo", { exact: true })).toBeDisabled();
    }
  }
});

test("a minimum-width note beside a long note retains its own move and resize targets", async ({ page }) => {
  let ordering = "";
  async function pressRealTarget(target: Locator) {
    await target.scrollIntoViewIfNeeded();
    const box = (await target.boundingBox())!, point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const hit = await target.evaluate((element, point) => {
      const actual = document.elementFromPoint(point.x, point.y);
      const describe = (target: Element | null) => target ? { tag: target.tagName, classes: target.getAttribute("class"), noteId: target.getAttribute("data-note-id"), edge: target.getAttribute("data-note-edge") } : null;
      return { matches: actual === element, intended: describe(element), bounds: element.getBoundingClientRect().toJSON(), point, actual: describe(actual) };
    }, point);
    expect(hit.matches, JSON.stringify({ ordering, shortDuration: 60, longDuration: 960, ...hit })).toBe(true);
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    expect(await target.evaluate(element => element.hasPointerCapture(1)), JSON.stringify({ ordering, ...hit })).toBe(true);
    return point;
  }
  for (const longFirst of [false, true]) {
    ordering = longFirst ? "long-to-short" : "short-to-long";
    await fixture(page, { sourceBars: 8, adjacentShort: 60, adjacentLong: true, longFirst });
    const before = await clip(page), gridWidth = (await page.locator(".note-grid-lines").boundingBox())!.width;
    for (const id of ["fixture_c", "fixture_e"]) {
      const original = before.notes.find(n => n.id === id)!;
      expect((await note(page, id).boundingBox())!.width).toBeCloseTo(original.duration === 60 ? 3 : 25, 2);
      const point = await pressRealTarget(note(page, id));
      await page.mouse.move(point.x + gridWidth * 960 / before.sourceLengthTick, point.y - 18);
      await expect(page.getByLabel("Note MIDI pitch", { exact: true })).toHaveValue("61");
      await expect(page.getByLabel("Note beat", { exact: true })).toHaveValue(String(original.tick / 960 + 2));
      expect(await clip(page)).toEqual(before);
      await page.mouse.up();
      const moved = { ...before, notes: before.notes.map(n => n.id === id ? { ...n, tick: n.tick + 960, pitch: n.pitch + 1 } : n) };
      await expect.poll(() => clip(page)).toEqual(moved);
      await page.getByLabel("Undo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(before);
      await expect(page.getByLabel("Undo", { exact: true })).toBeDisabled();
      await page.getByLabel("Redo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(moved);
      await page.getByLabel("Undo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(before);

      for (const [edge, delta] of [["start", -240], ["end", 240]] as const) {
        await note(page, id).focus(); await page.keyboard.press("Enter");
        await expect(selected(page)).toHaveCount(1);
        await expect(note(page, id)).toHaveAttribute("aria-pressed", "true");
        const handle = page.locator(`.note-edge[data-note-id="${id}"][data-note-edge="${edge}"]`);
        const edgePoint = await pressRealTarget(handle);
        await page.mouse.move(edgePoint.x + gridWidth * delta / before.sourceLengthTick, edgePoint.y);
        await expect(page.getByLabel("Note duration beats", { exact: true })).toHaveValue(String((original.duration + 240) / 960));
        expect(await clip(page)).toEqual(before);
        await page.mouse.up();
        const resized = { ...before, notes: before.notes.map(n => n.id === id ? { ...n, ...(edge === "start" ? { tick: n.tick - 240 } : {}), duration: n.duration + 240 } : n) };
        await expect.poll(() => clip(page)).toEqual(resized);
        await page.getByLabel("Undo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(before);
        await expect(page.getByLabel("Undo", { exact: true })).toBeDisabled();
      }
    }
  }
});

for (const cancellation of ["Escape", "pointercancel", "lostcapture", "blur"] as const) {
  test(`note pointer ${cancellation} restores its preview and ignores foreign and late pointer events`, async ({ page }) => {
    await fixture(page);
    const before = await clip(page), target = note(page, "fixture_e");
    await target.click(); const initial = await styles(page);
    await moveHeld(page, target, 960, 1);
    await expect.poll(() => styles(page)).not.toEqual(initial);
    const preview = await styles(page);
    for (const type of ["pointermove", "pointerup", "pointercancel", "lostpointercapture"]) {
      await target.dispatchEvent(type, { pointerId: 99, pointerType: "mouse", clientX: 5, clientY: 5, bubbles: true });
      expect(await styles(page)).toEqual(preview);
      expect(await target.evaluate(element => element.hasPointerCapture(1))).toBe(true);
    }
    if (cancellation === "Escape") await page.keyboard.press("Escape");
    else if (cancellation === "pointercancel") await target.dispatchEvent("pointercancel", { pointerId: 1, bubbles: true });
    else if (cancellation === "lostcapture") {
      await target.evaluate(element => element.releasePointerCapture(1));
      expect(await target.evaluate(element => element.hasPointerCapture(1))).toBe(false);
      // Chromium delivers pending lostpointercapture at the next native pointer
      // event; drive it before checking cancellation, then test further events.
      await page.mouse.move(5, 5);
    }
    else await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect.poll(() => styles(page)).toEqual(initial);
    await page.mouse.move(5, 5); await page.mouse.up();
    await target.dispatchEvent("pointerup", { pointerId: 1, clientX: 1000, clientY: 1, bubbles: true });
    expect(await clip(page)).toEqual(before);
    await expect(page.getByLabel("Undo", { exact: true })).toBeDisabled();
  });
}

test("collapse cancels a note drag, releases capture and late events cannot cancel a retained transform", async ({ page }) => {
  await fixture(page, { offGrid: true });
  const before = await clip(page), target = note(page, "fixture_c");
  await target.click(); await moveHeld(page, target, 960, 1);
  await page.getByLabel("Collapse detail dock", { exact: true }).evaluate(element => (element as HTMLButtonElement).click());
  expect(await target.evaluate(element => element.hasPointerCapture(1))).toBe(false);
  await page.mouse.up();
  await page.getByLabel("Expand detail dock", { exact: true }).click();
  expect(await clip(page)).toEqual(before);
  await page.getByRole("button", { name: "Quantize", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply note transform", exact: true })).toBeVisible();
  const proposal = await styles(page);
  for (const type of ["pointermove", "pointerup", "pointercancel", "lostpointercapture"]) {
    await target.dispatchEvent(type, { pointerId: 1, clientX: 1000, clientY: 1, bubbles: true });
  }
  expect(await styles(page)).toEqual(proposal);
  await expect(page.getByRole("button", { name: "Apply note transform", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel note transform", exact: true }).click();
  expect(await clip(page)).toEqual(before);
});

test("marquee and Shift selection support group transpose and velocity as separate atomic edits", async ({ page }) => {
  await fixture(page);
  const before = await clip(page);
  const c = (await note(page, "fixture_c").boundingBox())!, e = (await note(page, "fixture_e").boundingBox())!;
  // Begin in empty time/pitch space, enclosing C and E but not the later G.
  await page.mouse.move(e.x + e.width + 8, e.y - 8); await page.mouse.down();
  await page.mouse.move(c.x + 1, c.y + c.height + 6); await page.mouse.up();
  await expect(selected(page)).toHaveCount(2);
  await page.getByLabel("Transpose selected notes", { exact: true }).fill("12");
  await page.getByRole("button", { name: "Apply transpose", exact: true }).click();
  const transposed = { ...before, notes: before.notes.map(n => n.id === "fixture_g" ? n : { ...n, pitch: n.pitch + 12 }) };
  await expect.poll(() => clip(page)).toEqual(transposed);
  await page.getByLabel("Selected note velocity", { exact: true }).fill("0.25");
  await page.getByRole("button", { name: "Apply velocity", exact: true }).click();
  const balanced = { ...transposed, notes: transposed.notes.map(n => n.id === "fixture_g" ? n : { ...n, velocity: .25 }) };
  await expect.poll(() => clip(page)).toEqual(balanced);
  await page.getByLabel("Undo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(transposed);
  await page.getByLabel("Undo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(before);
  await note(page, "fixture_g").click({ modifiers: ["Shift"] });
  await expect(selected(page)).toHaveCount(3);
});

test("a silent note stays silent on a velocity click or downward key and an upward key undoes exactly", async ({ page }) => {
  await fixture(page, { zeroVelocity: true });
  const before = await clip(page), bar = page.locator('.note-velocity-bar[data-note-id="fixture_c"]');
  await bar.click();
  await expect(page.getByLabel("Undo", { exact: true })).toBeDisabled();
  expect(await clip(page)).toEqual(before);
  await bar.focus(); await page.keyboard.press("ArrowDown");
  await expect(page.getByLabel("Undo", { exact: true })).toBeDisabled();
  expect(await clip(page)).toEqual(before);
  await page.keyboard.press("ArrowUp");
  const raised = { ...before, notes: before.notes.map(n => n.id === "fixture_c" ? { ...n, velocity: .01 } : n) };
  await expect.poll(() => clip(page)).toEqual(raised);
  await page.getByLabel("Undo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(before);
});

test("copy and repeated paste allocate independent note IDs, retain articulation and leave controllers untouched", async ({ page }) => {
  await fixture(page); await selectPair(page);
  const before = await clip(page);
  await page.getByRole("button", { name: "Copy notes", exact: true }).click();
  expect(await clip(page)).toEqual(before);
  await expect(page.getByLabel("Undo", { exact: true })).toBeDisabled();
  await page.getByLabel("Paste at tick", { exact: true }).fill("9600");
  await page.getByRole("button", { name: "Paste notes", exact: true }).click();
  await expect.poll(async () => (await clip(page)).notes.length).toBe(5);
  const once = await clip(page), pasted = once.notes.filter(n => !before.notes.some(original => original.id === n.id));
  const withoutIdentity = (n: Clip["notes"][number]) => Object.fromEntries(Object.entries(n).filter(([key]) => key !== "id"));
  expect(pasted.map(withoutIdentity)).toEqual(before.notes.slice(0, 2).map(n => withoutIdentity({ ...n, tick: n.tick + 9600 })));
  expect(new Set(once.notes.map(n => n.id)).size).toBe(5);
  expect({ ...once, notes: before.notes }).toEqual(before);
  await page.getByRole("button", { name: "Paste notes", exact: true }).click();
  await expect.poll(async () => (await clip(page)).notes.length).toBe(7);
  const twice = await clip(page);
  expect(new Set(twice.notes.map(n => n.id)).size).toBe(7);
  await page.getByLabel("Undo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(once);
  await page.getByLabel("Undo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(before);
  await page.getByLabel("Redo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(once);
});

test("focused note shortcuts stay local while text inputs preserve native selection and typing", async ({ page }) => {
  await page.addInitScript(preferences => localStorage.setItem("chordz-shortcuts-v1", JSON.stringify(preferences)), {
    ...DEFAULT_SHORTCUTS,
    bindings: { ...DEFAULT_SHORTCUTS.bindings, togglePlay: { code: "KeyC", primary: true, shift: false, alt: false } },
  });
  await fixture(page);
  await page.locator("main.studio-shell").evaluate(element => { element.tabIndex = -1; element.focus(); });
  await page.keyboard.press("Control+c");
  await expect(page.getByLabel("Pause song", { exact: true })).toBeVisible();
  await page.getByLabel("Stop song", { exact: true }).click();
  const before = await clip(page);
  await note(page, "fixture_c").focus(); await page.keyboard.press("Control+a");
  await expect(selected(page)).toHaveCount(3);
  await page.keyboard.press("Control+c");
  await page.waitForTimeout(100);
  await expect(page.getByLabel("Play song", { exact: true })).toBeVisible();
  await page.getByLabel("Paste at tick", { exact: true }).fill("7200");
  await note(page, "fixture_c").focus(); await page.keyboard.press("Control+v");
  await expect.poll(async () => (await clip(page)).notes.length).toBe(6);
  await page.getByLabel("Undo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(before);
  await page.getByLabel("Play song", { exact: true }).click();
  await expect(page.getByLabel("Pause song", { exact: true })).toBeVisible();
  await note(page, "fixture_c").focus();
  const noteSelection = await selected(page).evaluateAll(elements => elements.map(element => element.getAttribute("data-note-id")));
  await page.keyboard.press("Control+Shift+Enter");
  await expect(page.getByLabel("Play song", { exact: true })).toBeVisible();
  expect(await selected(page).evaluateAll(elements => elements.map(element => element.getAttribute("data-note-id")))).toEqual(noteSelection);
  await page.getByLabel("Song title").fill("A native text draft");
  await page.getByLabel("Song title").press("Control+a");
  expect(await page.getByLabel("Song title").evaluate(element => ({ start: (element as HTMLInputElement).selectionStart, end: (element as HTMLInputElement).selectionEnd }))).toEqual({ start: 0, end: 19 });
  await page.getByLabel("Song title").press("Escape");
  expect((await clip(page)).notes).toEqual(before.notes);
});

test("note selection belongs to each clip and is pruned after deletion without leaking through owner changes", async ({ page }) => {
  await fixture(page, { second: true }); await selectPair(page);
  await page.route("**/api/projects**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/projects" && request.method() === "GET")
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    if (request.method() === "POST" || request.method() === "PUT") {
      const payload = request.postDataJSON();
      return route.fulfill({ status: request.method() === "POST" ? 201 : 200, contentType: "application/json", body: JSON.stringify({ document: payload.document ?? payload, revision: request.method() === "POST" ? 1 : 2, updatedAt: new Date().toISOString() }) });
    }
    return route.continue();
  });
  const surface = page.locator(".piano-roll"), viewport = (await page.locator(".piano-roll-scroll").boundingBox())!;
  const grid = (await page.locator(".note-grid-lines").boundingBox())!;
  await page.mouse.move(grid.x + grid.width * .3, viewport.y + viewport.height / 2); await page.mouse.down();
  expect(await surface.evaluate(element => element.hasPointerCapture(1))).toBe(true);
  await page.locator(".timeline-clip-body").nth(1).evaluate(element => (element as HTMLButtonElement).click());
  expect(await surface.evaluate(element => element.hasPointerCapture(1))).toBe(false);
  await page.mouse.up();
  await expect(page.locator(".roll-note")).toHaveCount(1);
  await expect(selected(page)).toHaveCount(0);
  await note(page, "fixture_c").click(); await expect(selected(page)).toHaveCount(1);
  await page.locator(".timeline-clip-body").first().click();
  await expect(selected(page)).toHaveCount(2);
  await page.getByRole("button", { name: "Copy notes", exact: true }).click();
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page.locator("a.avatar")).toBeVisible();
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Blank song", exact: true }).click();
  await page.getByRole("button", { name: "New phrase", exact: true }).click();
  await expect(selected(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Paste notes", exact: true })).toBeDisabled();
  await page.locator("a.avatar").click();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await expect(page.getByLabel("Song title")).toHaveValue("Direct note editing fixture");
  await page.locator(".timeline-clip-body").first().click();
  await page.getByRole("button", { name: "Select all notes", exact: true }).click();
  await page.getByRole("button", { name: "Delete selected notes", exact: true }).click();
  await expect(page.locator(".roll-note")).toHaveCount(0); await expect(selected(page)).toHaveCount(0);
  await page.getByLabel("Undo", { exact: true }).click();
  await expect(page.locator(".roll-note")).toHaveCount(3);
  const existingIds = new Set((await clip(page)).notes.map(n => n.id));
  for (const id of await selected(page).evaluateAll(elements => elements.map(element => element.getAttribute("data-note-id")!))) expect(existingIds.has(id)).toBe(true);
});

test("a real audio clip handoff retains the source phrase selection, clipboard and editor view", async ({ page }) => {
  await fixture(page, { sourceBars: 24 }); await selectPair(page);
  const before = await clip(page), history = await page.getByLabel("Undo", { exact: true }).isEnabled();
  await page.getByRole("button", { name: "Copy notes", exact: true }).click();
  await page.getByLabel("Fold to used notes", { exact: true }).check();
  await page.getByLabel("Highlight scale", { exact: true }).check();
  await page.getByLabel("Note scale", { exact: true }).selectOption("C:minor");
  await page.locator(".piano-roll-scroll").evaluate(element => { element.scrollLeft = 140; });
  await expect.poll(() => page.locator(".piano-roll-scroll").evaluate(element => element.scrollLeft)).toBe(140);
  const viewport = await page.locator(".piano-roll-scroll").evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }));
  expect(await clip(page)).toEqual(before);
  expect(await page.getByLabel("Undo", { exact: true }).isEnabled()).toBe(history);
  await page.getByLabel("Import audio file", { exact: true }).setInputFiles({
    name: "Note session hop.wav", mimeType: "audio/wav",
    buffer: Buffer.from(encodeWav([new Float32Array(4800).fill(.05)], 48000)),
  });
  await expect(page.locator(".timeline-clip.selected")).toContainText("Note session hop.wav");
  await expect(page.locator(".roll-note")).toHaveCount(0);
  await expect(page.getByLabel("Fade in", { exact: true })).toBeVisible();
  await expect.poll(async () => (await savedDocument(page)).tracks.flatMap(track => track.clips).some(c => !!c.audio)).toBe(true);
  const imported = await savedDocument(page);
  await page.locator(".timeline-clip-body").first().click();
  await expect(selected(page)).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Paste notes", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Fold to used notes", { exact: true })).toBeChecked();
  await expect(page.getByLabel("Highlight scale", { exact: true })).toBeChecked();
  await expect(page.getByLabel("Note scale", { exact: true })).toHaveValue("C:minor");
  await expect.poll(() => page.locator(".piano-roll-scroll").evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }))).toEqual(viewport);
  expect(await clip(page)).toEqual(before);
  expect(await savedDocument(page)).toEqual(imported);
  await page.getByLabel("Undo", { exact: true }).click();
  await expect.poll(async () => (await savedDocument(page)).tracks.flatMap(track => track.clips).some(c => !!c.audio)).toBe(false);
  expect(await clip(page)).toEqual(before);
});

test("selected quantize is an explicit proposal with Apply, Cancel, recovery and one Undo step", async ({ page }) => {
  await fixture(page, { offGrid: true }); await note(page, "fixture_c").click();
  await page.getByLabel("Note transform scope", { exact: true }).selectOption("selected");
  const before = await clip(page), initial = await styles(page);
  await page.getByRole("button", { name: "Quantize", exact: true }).click();
  await expect.poll(() => styles(page)).not.toEqual(initial);
  await page.waitForTimeout(550);
  expect(await clip(page)).toEqual(before);
  await page.getByRole("button", { name: "Cancel note transform", exact: true }).click();
  expect(await styles(page)).toEqual(initial); expect(await clip(page)).toEqual(before);
  await page.getByRole("button", { name: "Quantize", exact: true }).click();
  await page.getByRole("button", { name: "Apply note transform", exact: true }).click();
  const quantized = { ...before, notes: before.notes.map(n => n.id === "fixture_c" ? { ...n, tick: 240 } : n) };
  await expect.poll(() => clip(page)).toEqual(quantized);
  await page.getByLabel("Undo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(before);
  await page.getByLabel("Redo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(quantized);
  await page.reload(); await expect(page.getByLabel("Song title")).toBeEnabled();
  await expect.poll(() => clip(page)).toEqual(quantized);
});

test("humanize is deterministic, supports phrase scope and survives only pure collapse", async ({ page }) => {
  await fixture(page);
  await page.getByLabel("Note transform scope", { exact: true }).selectOption("phrase");
  const before = await clip(page), initial = await styles(page);
  await page.getByRole("button", { name: "Humanize", exact: true }).click();
  const candidate = await styles(page); expect(candidate).not.toEqual(initial);
  expect(await clip(page)).toEqual(before);
  await page.getByRole("button", { name: "Cancel note transform", exact: true }).click();
  await page.getByRole("button", { name: "Humanize", exact: true }).click();
  expect(await styles(page)).toEqual(candidate);
  await page.getByLabel("Collapse detail dock", { exact: true }).click();
  await page.getByLabel("Expand detail dock", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply note transform", exact: true })).toBeVisible();
  expect(await styles(page)).toEqual(candidate);
  await page.getByRole("tab", { name: "Sound", exact: true }).click();
  await page.getByRole("tab", { name: "Notes / Audio", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply note transform", exact: true })).toHaveCount(0);
  expect(await styles(page)).toEqual(initial); expect(await clip(page)).toEqual(before);
  await page.getByRole("button", { name: "Humanize", exact: true }).click();
  await page.getByRole("button", { name: "Apply note transform", exact: true }).click();
  await expect.poll(async () => (await clip(page)).notes).not.toEqual(before.notes);
  expect({ ...(await clip(page)), notes: before.notes }).toEqual(before);
  await page.getByLabel("Undo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(before);
});

test("a mocked cloud save completing during a note proposal preserves committed recovery and the proposal", async ({ page }) => {
  const projectId = await fixture(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let createStarted = false;
  await page.route("**/api/projects**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/projects" && request.method() === "GET")
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    if (path === "/api/projects" && request.method() === "POST") {
      const saved = request.postDataJSON() as ProjectDocument;
      createStarted = true;
      await gate;
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ document: saved, revision: 1, updatedAt: new Date().toISOString() }) });
    }
    if (path.startsWith("/api/projects/") && request.method() === "PUT") {
      const saved = request.postDataJSON() as { document: ProjectDocument };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ document: saved.document, revision: 2, updatedAt: new Date().toISOString() }) });
    }
    return route.continue();
  });
  try {
    // Use the unchanged local test sign-in route; every project request above is
    // mocked, so this exercises save completion without writing cloud music.
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await expect(page.locator("a.avatar")).toBeVisible();
    await expect(page.getByLabel("Song title")).toHaveValue("Direct note editing fixture");
    await expect.poll(() => createStarted).toBe(true);
    const owner = await page.evaluate(async projectId => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("chordz-recovery-v1");
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      try {
        const values = await new Promise<unknown[]>((resolve, reject) => {
          const request = db.transaction("drafts", "readonly").objectStore("drafts").getAll();
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        const account = values.find(value => value && typeof value === "object" && "owner" in value && "document" in value && value.owner !== "guest" && (value.document as ProjectDocument).id === projectId) as { owner: string } | undefined;
        if (!account) throw Error("The local signed-in fixture was not restored.");
        return account.owner;
      } finally { db.close(); }
    }, projectId);
    const committed = await savedDocument(page, owner);
    await page.locator(".timeline-clip-body").first().click();
    await page.getByLabel("Note transform scope", { exact: true }).selectOption("phrase");
    await page.getByRole("button", { name: "Humanize", exact: true }).click();
    await expect(page.getByRole("button", { name: "Apply note transform", exact: true })).toBeVisible();
    const proposal = await styles(page);
    release();
    await expect.poll(() => page.evaluate(async owner => {
      const { latestDraft } = await import("/lib/client/storage.ts" as string);
      return (await latestDraft(owner))?.revision ?? 0;
    }, owner)).toBe(2);
    expect(await savedDocument(page, owner)).toEqual(committed);
    expect(await styles(page)).toEqual(proposal);
    await expect(page.getByRole("button", { name: "Apply note transform", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cancel note transform", exact: true }).click();
    expect(await savedDocument(page, owner)).toEqual(committed);
  } finally { release(); }
});

test("a rejected note draft blocks transforms and paste without dropping the draft or musical selection", async ({ page }) => {
  await fixture(page); await note(page, "fixture_e").click();
  await page.getByRole("button", { name: "Copy notes", exact: true }).click();
  const before = await clip(page);
  const pitch = page.getByLabel("Note MIDI pitch", { exact: true });
  await pitch.fill("");
  await note(page, "fixture_g").focus(); await page.keyboard.press("ArrowRight");
  await expect(note(page, "fixture_e")).toHaveAttribute("aria-pressed", "true");
  await expect(note(page, "fixture_g")).toHaveAttribute("aria-pressed", "false");
  await expect(pitch).toHaveValue(""); expect(await clip(page)).toEqual(before);
  await page.getByRole("button", { name: "Quantize", exact: true }).click();
  await expect(pitch).toHaveValue("");
  await expect(page.getByRole("button", { name: "Apply note transform", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Paste notes", exact: true }).click();
  await expect(pitch).toHaveValue(""); expect(await clip(page)).toEqual(before);
  await expect(note(page, "fixture_e")).toHaveAttribute("aria-pressed", "true");
  await pitch.press("Escape"); await expect(pitch).toHaveValue("64");
  await note(page, "fixture_g").focus(); await page.keyboard.press("ArrowRight");
  const moved = { ...before, notes: before.notes.map(n => n.id === "fixture_g" ? { ...n, tick: n.tick + 240 } : n) };
  await expect.poll(() => clip(page)).toEqual(moved);
  await page.getByLabel("Undo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(before);
});

test("a valid note draft settles before Shift selection changes inspector identity and subsequent edits undo separately", async ({ page }) => {
  await fixture(page); await note(page, "fixture_e").click();
  const before = await clip(page), beat = page.getByLabel("Note beat", { exact: true });
  const oldInput = (await beat.elementHandle())!;
  await beat.fill("4");
  // Pointer selection settles the valid E draft without requiring Enter, then
  // the inspector belongs to G rather than carrying E's buffered raw value.
  await note(page, "fixture_g").click({ modifiers: ["Shift"] });
  await expect(selected(page)).toHaveCount(2);
  await expect(beat).toHaveValue("7");
  const first = { ...before, notes: before.notes.map(n => n.id === "fixture_e" ? { ...n, tick: 2880 } : n) };
  await expect.poll(() => clip(page)).toEqual(first);
  await beat.fill("8");
  await oldInput.evaluate(element => element.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true })));
  await beat.press("Enter");
  const second = { ...first, notes: first.notes.map(n => n.id === "fixture_g" ? { ...n, tick: 6720 } : n) };
  await expect.poll(() => clip(page)).toEqual(second);
  await page.getByLabel("Undo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(first);
  await page.getByLabel("Undo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(before);
});

test("Select all during a retained note transform preserves its immutable proposal until explicit Cancel", async ({ page }) => {
  await fixture(page, { offGrid: true }); await note(page, "fixture_c").click();
  const before = await clip(page);
  await page.getByRole("button", { name: "Quantize", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply note transform", exact: true })).toBeVisible();
  const proposal = await styles(page);
  const caption = await page.locator(".note-transform-proposal").getByText(/preview ·/).innerText();
  await page.getByRole("button", { name: "Select all notes", exact: true }).click();
  await expect(selected(page)).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Apply note transform", exact: true })).toBeVisible();
  await expect(page.locator(".note-transform-proposal").getByText(/preview ·/)).toHaveText(caption);
  expect(await styles(page)).toEqual(proposal);
  expect(await clip(page)).toEqual(before);
  await page.getByRole("button", { name: "Cancel note transform", exact: true }).click();
  expect(await clip(page)).toEqual(before);
  await expect(page.getByLabel("Undo", { exact: true })).toBeDisabled();
});

test("full-range fold and scale aids preserve original pitches and do not enter music history", async ({ page }) => {
  await fixture(page, { extremes: true });
  const before = await clip(page);
  await expect(note(page, "fixture_low")).toHaveCount(1); await expect(note(page, "fixture_high")).toHaveCount(1);
  await page.getByLabel("Fold to used notes", { exact: true }).check();
  await expect(page.locator(".roll-note-label")).toHaveCount(5);
  await expect(note(page, "fixture_low")).toBeVisible(); await expect(note(page, "fixture_high")).toBeVisible();
  await page.getByLabel("Highlight scale", { exact: true }).check();
  await page.getByLabel("Note scale", { exact: true }).selectOption("C:minor");
  expect(await clip(page)).toEqual(before);
  await page.getByLabel("Fold to used notes", { exact: true }).uncheck();
  await expect(page.locator(".roll-note-label")).toHaveCount(128);
  expect(await clip(page)).toEqual(before);
  await expect(page.getByLabel("Undo", { exact: true })).toBeDisabled();
});

test("a folded note drag keeps its original row mapping across repeated preview and release", async ({ page }) => {
  await fixture(page); await page.getByLabel("Fold to used notes", { exact: true }).check();
  const before = await clip(page), target = note(page, "fixture_g");
  await target.click(); await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!, x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + 18);
  await expect(target).toHaveAttribute("aria-label", "E4 note at beat 7");
  await expect(page.locator(".roll-note-label")).toHaveCount(3);
  // The first preview removes G from the used-pitch rows. The same physical
  // position must retain its initial row meaning instead of descending again.
  await target.dispatchEvent("pointermove", { pointerId: 1, pointerType: "mouse", clientX: x, clientY: y + 18, buttons: 1, bubbles: true });
  await expect(target).toHaveAttribute("aria-label", "E4 note at beat 7");
  await page.mouse.up();
  const moved = { ...before, notes: before.notes.map(n => n.id === "fixture_g" ? { ...n, pitch: 64 } : n) };
  await expect.poll(() => clip(page)).toEqual(moved);
  await expect(page.locator(".roll-note-label")).toHaveCount(2);
  await page.getByLabel("Undo", { exact: true }).click(); await expect.poll(() => clip(page)).toEqual(before);
  await expect(page.locator(".roll-note-label")).toHaveCount(3);
});

test("recording blocks note authoring while preserving selection and the committed phrase", async ({ page }) => {
  await fixture(page); await selectPair(page);
  const before = await clip(page);
  await page.getByLabel("Recording source").selectOption("midi");
  await page.getByLabel("Start recording", { exact: true }).click();
  await expect(page.locator(".transport-position")).toContainText("Recording ·");
  for (const label of ["Quantize", "Humanize", "Paste notes", "Delete selected notes", "Apply transpose", "Apply velocity"])
    await expect(page.getByRole("button", { name: label, exact: true })).toBeDisabled();
  await moveHeld(page, note(page, "fixture_e"), 960, 1); await page.mouse.up();
  expect(await clip(page)).toEqual(before);
  await expect(selected(page)).toHaveCount(2);
  await page.getByLabel("Finish recording", { exact: true }).click();
  await expect(page.getByLabel("Start recording", { exact: true })).toBeEnabled();
  expect(await clip(page)).toEqual(before);
});

for (const [width, height] of [[1366, 768], [1920, 1080], [1024, 768], [390, 844]]) {
  test(`direct note editor at ${width}×${height} retains song context, transport and internal scrolling`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await fixture(page);
    await expect(page.getByLabel("Stop song", { exact: true })).toBeInViewport();
    const canvas = (await page.getByRole("region", { name: "Song canvas", exact: true }).boundingBox())!;
    expect(canvas.height).toBeGreaterThanOrEqual(width < 700 ? 160 : 220);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await note(page, "fixture_e").click();
    await page.getByRole("button", { name: "Copy notes", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Copy notes", exact: true })).toBeInViewport();
    await expect(page.locator(".precise-note-inspector")).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("region", { name: "Note velocity lane", exact: true })).toBeInViewport({ ratio: 1 });
    await expect(note(page, "fixture_e")).toBeInViewport({ ratio: 1 });
    await expect(page.getByLabel("Stop song", { exact: true })).toBeInViewport();
    const scroll = await page.locator(".piano-roll-scroll").evaluate(element => ({ height: element.clientHeight, content: element.scrollHeight, overflow: getComputedStyle(element).overflowY }));
    expect(scroll.height).toBeGreaterThan(0); expect(scroll.content).toBeGreaterThan(scroll.height);
    expect(["auto", "scroll"]).toContain(scroll.overflow);
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });
    mkdirSync("output/phase1-review", { recursive: true });
    await page.screenshot({ path: `output/phase1-review/${width}-notes-populated.png`, animations: "disabled" });
    await page.getByRole("button", { name: "Select all notes", exact: true }).click();
    await page.getByRole("button", { name: "Delete selected notes", exact: true }).click();
    await expect(page.locator(".roll-note")).toHaveCount(0);
    await expect(page.getByLabel("Stop song", { exact: true })).toBeInViewport();
    expect((await page.getByRole("region", { name: "Song canvas", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(width < 700 ? 160 : 220);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/phase1-review/${width}-notes-empty.png`, animations: "disabled" });
  });
}
