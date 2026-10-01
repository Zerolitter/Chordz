import { test, expect, type Locator, type Page } from "@playwright/test";
import { createProject } from "../../lib/music/project";
import { emptyPatch } from "../../lib/audio/modulation";
import { DEFAULT_CHORD_MOVEMENT } from "../../lib/music/chord-movement";

async function blankSound(page: Page) {
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Blank song", exact: true }).click();
  await page.getByRole("navigation").getByRole("button", { name: "03 Sound" }).click();
}

async function openRouteSettings(rack: Locator) {
  for (const inspector of await rack.locator(".mod-route-controls>details").all()) {
    if (await inspector.getAttribute("open") === null) await inspector.locator(":scope>summary").click();
  }
}

async function savedRoutes(page: Page) {
  return page.evaluate(() => new Promise<{ count: number; amount?: number } | null>(resolve => {
    const opened = indexedDB.open("chordz-recovery-v1", 1);
    opened.onerror = () => resolve(null);
    opened.onsuccess = () => {
      const db = opened.result;
      if (!db.objectStoreNames.contains("drafts")) { db.close(); resolve(null); return; }
      const latest = db.transaction("drafts", "readonly").objectStore("drafts").get("guest:latest");
      latest.onsuccess = () => {
        if (!latest.result) { db.close(); resolve(null); return; }
        const draft = db.transaction("drafts", "readonly").objectStore("drafts").get(`guest:${latest.result}`);
        draft.onsuccess = () => { const routes = draft.result?.document?.tracks?.[0]?.modulation?.routes ?? []; db.close(); resolve({ count: routes.length, amount: routes[0]?.amount }); };
        draft.onerror = () => { db.close(); resolve(null); };
      };
    };
  }));
}

test("assign, precise edit, cancellation, Undo and reload retain a real modulation route", async ({ page }) => {
  await blankSound(page);
  const rack = page.getByRole("region", { name: "Selected track modulation rack" });
  await rack.getByLabel("Route source", { exact: true }).selectOption("M1");
  await rack.getByLabel("Route destination", { exact: true }).selectOption("track.cutoff");
  await rack.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(rack.locator(".mod-route")).toHaveCount(1);
  const depth = rack.getByLabel("Depth to Track filter value", { exact: true });
  await depth.fill("1.25"); await depth.blur();
  await depth.fill("2"); await depth.press("Escape");
  await expect(depth).toHaveValue("1.25");
  await page.getByLabel("Undo", { exact: true }).click();
  await expect(depth).toHaveValue("0.8");
  await page.getByLabel("Redo", { exact: true }).click();
  await expect(depth).toHaveValue("1.25");
  await page.getByLabel("Save song", { exact: true }).click();
  await expect.poll(() => savedRoutes(page)).toEqual({ count: 1, amount: 1.25 });
  await page.reload();
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await expect(rack.locator(".mod-route")).toHaveCount(1);
  await expect(depth).toHaveValue("1.25");
});

test("A/B audition is cancelled safely or committed as one edit", async ({ page }) => {
  await blankSound(page);
  const rack = page.getByRole("region", { name: "Selected track modulation rack" });
  await expect.poll(() => savedRoutes(page)).toEqual({ count: 0, amount: undefined });
  await rack.getByRole("button", { name: "Compare A/B", exact: true }).click();
  await rack.getByRole("button", { name: "B", exact: true }).click();
  await rack.getByLabel("Sound patch preset").selectOption("starter:pulse");
  await expect(rack.locator(".mod-route")).toHaveCount(5);
  await openRouteSettings(rack);
  await expect(rack.getByLabel("Source for Pulse · amplitude", { exact: true })).toHaveValue("M1");
  await expect(rack.getByLabel("Source for Track filter", { exact: true })).toHaveValue("M2");
  await expect(rack.getByLabel("Source for Reverb send", { exact: true })).toHaveValue("M3");
  await expect(rack.getByLabel("Source for High EQ", { exact: true })).toHaveValue("M4");
  await expect(rack.getByLabel("M4 name", { exact: true })).toHaveValue("Air");
  await rack.getByRole("button", { name: "A", exact: true }).click();
  await expect(rack.locator(".mod-route")).toHaveCount(0);
  await rack.getByRole("button", { name: "B", exact: true }).click();
  await expect(rack.locator(".mod-route")).toHaveCount(5);
  await rack.getByRole("button", { name: "Cancel comparison", exact: true }).click();
  await expect(rack.locator(".mod-route")).toHaveCount(0);
  await rack.getByRole("button", { name: "Compare A/B", exact: true }).click();
  await rack.getByRole("button", { name: "B", exact: true }).click();
  await rack.getByLabel("Sound patch preset").selectOption("starter:drift");
  await rack.getByRole("button", { name: "Use B", exact: true }).click();
  await expect(rack.locator(".mod-route")).toHaveCount(5);
  await page.getByLabel("Undo", { exact: true }).click();
  await expect(rack.locator(".mod-route")).toHaveCount(0);
});

test("staged number and name fields follow A/B switching and cancellation", async ({ page }) => {
  await blankSound(page);
  const rack = page.getByRole("region", { name: "Selected track modulation rack" });
  const amount = rack.getByLabel("M1 amount value", { exact: true }), name = rack.getByLabel("M1 name", { exact: true });
  await rack.getByRole("button", { name: "Compare A/B", exact: true }).click();
  await rack.getByRole("button", { name: "B", exact: true }).click();
  await amount.fill("0.7"); await amount.blur();
  await name.fill("Bright"); await name.blur();
  await rack.getByRole("button", { name: "A", exact: true }).click();
  await expect(amount).toHaveValue("0"); await expect(name).toHaveValue("Motion");
  await rack.getByRole("button", { name: "B", exact: true }).click();
  await expect(amount).toHaveValue("0.7"); await expect(name).toHaveValue("Bright");
  await amount.fill(""); await amount.blur();
  await expect(amount).toHaveValue("");
  await rack.getByRole("button", { name: "Cancel comparison", exact: true }).click();
  await expect(amount).toHaveValue("0"); await expect(name).toHaveValue("Motion");
});

test("malformed clipboard and stored patches are rejected before an A/B draft can render", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const valid = { sound: createProject().tracks[0].sound, modulation: emptyPatch(), chordMovement: { ...DEFAULT_CHORD_MOVEMENT } };
  await page.addInitScript(({ patch }) => {
    localStorage.setItem("chordz-modulation-presets-v1", JSON.stringify([{ name: "Broken", patch: { sound: {}, modulation: { sources: [], routes: [] }, chordMovement: {} } }, { name: "Working", patch }]));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: async () => JSON.stringify({ chordzPatch: 1, sound: {}, modulation: { sources: [], routes: [] }, chordMovement: {} }), writeText: async () => {} } });
  }, { patch: valid });
  await blankSound(page);
  const rack = page.getByRole("region", { name: "Selected track modulation rack" });
  await expect(rack.getByRole("alert")).toHaveText("Some saved sound patches are invalid and were skipped.");
  await expect(rack.getByLabel("Sound patch preset").locator('option[value="user:Broken"]')).toHaveCount(0);
  await rack.getByLabel("Sound patch preset").selectOption("user:Working");
  await rack.getByRole("button", { name: "Compare A/B", exact: true }).click();
  await rack.locator(".mod-patch-actions>summary").click();
  await rack.getByRole("button", { name: "Paste patch", exact: true }).click();
  await expect(rack.getByRole("alert")).toHaveText("The clipboard does not contain a valid Chordz sound patch.");
  await expect(rack.getByLabel("M1 name", { exact: true })).toHaveValue("Motion");
  await expect(rack.locator(".mod-route")).toHaveCount(0);
  await rack.getByRole("button", { name: "Cancel comparison", exact: true }).click();
  await expect(rack.getByRole("button", { name: "Compare A/B", exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("unapplied A/B patches stay out of recovery and navigation discards them", async ({ page }) => {
  await blankSound(page);
  const rack = page.getByRole("region", { name: "Selected track modulation rack" });
  await expect.poll(() => savedRoutes(page)).toEqual({ count: 0, amount: undefined });
  await page.clock.install();
  await rack.getByRole("button", { name: "Compare A/B", exact: true }).click();
  await rack.getByLabel("Sound patch preset").selectOption("starter:pulse");
  await expect(rack.locator(".mod-route")).toHaveCount(5);
  await page.clock.runFor(600);
  await expect.poll(() => savedRoutes(page)).toEqual({ count: 0, amount: undefined });
  await page.getByRole("navigation").getByRole("button", { name: "04 Mix" }).click();
  await page.getByRole("navigation").getByRole("button", { name: "03 Sound" }).click();
  await expect(rack.locator(".mod-route")).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await expect(rack.locator(".mod-route")).toHaveCount(0);
});

test("pointer cancellation restores a macro and dock arpeggiator controls share saved state", async ({ page }) => {
  await blankSound(page);
  const rack = page.getByRole("region", { name: "Selected track modulation rack" });
  const macro = rack.getByRole("slider", { name: "M1 amount", exact: true });
  await macro.scrollIntoViewIfNeeded();
  const box = (await macro.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 40);
  await expect(rack.getByLabel("M1 amount value", { exact: true })).not.toHaveValue("0");
  await macro.dispatchEvent("pointercancel", { pointerId: 1 }); await page.mouse.up();
  await expect(rack.getByLabel("M1 amount value", { exact: true })).toHaveValue("0");
  await page.getByLabel("Other detail tools").selectOption("keyboard");
  await page.getByLabel("Performance live arpeggiator", { exact: true }).check();
  await page.getByLabel("Performance arpeggiator hold", { exact: true }).check();
  await page.getByRole("button", { name: "Edit movement", exact: true }).click();
  await expect(rack.getByLabel("Live arpeggiator", { exact: true })).toBeChecked();
  await expect(rack.getByLabel("Hold input notes", { exact: true })).toBeChecked();
  await page.getByLabel("Collapse detail dock", { exact: true }).click();
  await page.getByLabel("Stop song", { exact: true }).click();
  await expect(page.locator(".piano-key.held")).toHaveCount(0);
});

test("source routing rejects feedback and instrument-incompatible destinations", async ({ page }) => {
  await blankSound(page);
  const rack = page.getByRole("region", { name: "Selected track modulation rack" });
  await rack.getByLabel("Add modulation source").selectOption("lfo");
  const source = await rack.getByLabel("Route source", { exact: true }).inputValue();
  await rack.getByLabel("Route destination", { exact: true }).selectOption(`source:${source}:rate`);
  await rack.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(rack.getByRole("alert")).toHaveText("Modulation feedback loops are not allowed.");
  await expect(rack.locator(".mod-route")).toHaveCount(0);
  await expect(rack.getByLabel("Route destination", { exact: true }).locator('option[value="voice.fmIndex"]')).toHaveAttribute("disabled", "");
});

test("movement controls produce editable notes and fit tablet/mobile layouts", async ({ page }) => {
  await blankSound(page);
  await page.getByRole("navigation").getByRole("button", { name: "02 Write" }).click();
  const idea = page.locator(".idea-panel");
  await idea.getByText("Voicing, rhythm & movement", { exact: true }).click();
  await idea.getByLabel("Use in generation", { exact: true }).check();
  await idea.getByLabel("Movement pattern", { exact: true }).selectOption("upDown");
  await idea.getByLabel("Movement rate").selectOption("240");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("navigation").getByRole("button", { name: "01 Arrange" }).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
  await page.getByRole("navigation").getByRole("button", { name: "03 Sound" }).click();
  for (const [width, height] of [[960, 720], [390, 844]]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByLabel("Stop song", { exact: true })).toBeInViewport();
    await expect(page.getByLabel("Route source", { exact: true })).toBeVisible();
  }
});

test("the Assign picker creates a route using the keyboard", async ({ page }) => {
  await blankSound(page);
  const rack = page.getByRole("region", { name: "Selected track modulation rack" });
  await rack.getByLabel("Route source", { exact: true }).focus();
  await page.keyboard.press("Home"); await page.keyboard.press("ArrowDown");
  await rack.getByRole("button", { name: "Assign", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(rack.locator(".mod-route")).toHaveCount(1);
  await openRouteSettings(rack);
  await expect(rack.getByLabel("Source for Track filter", { exact: true })).toHaveValue("M2");
});

test("the Assign picker remains usable with emulated tablet touch", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 960, height: 720 } });
  try {
    const page = await context.newPage(); await blankSound(page);
    const rack = page.getByRole("region", { name: "Selected track modulation rack" });
    await rack.getByLabel("Route source", { exact: true }).selectOption("M3");
    await rack.getByRole("button", { name: "Assign", exact: true }).tap();
    await expect(rack.locator(".mod-route")).toHaveCount(1);
    await openRouteSettings(rack);
    await expect(rack.getByLabel("Source for Track filter", { exact: true })).toHaveValue("M3");
  } finally { await context.close(); }
});
