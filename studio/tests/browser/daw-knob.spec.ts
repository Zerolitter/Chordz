import { expect, test, type Page, type Locator } from "@playwright/test";
import { mkdirSync } from "node:fs";

async function sound(page: Page) {
  await page.goto("/"); await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Blank song", exact: true }).click();
  await page.getByRole("navigation").getByRole("button", { name: "03 Sound" }).click();
  return page.getByRole("region", { name: "Selected track modulation rack" });
}
const number = async (knob: Locator) => Number(await knob.getAttribute("aria-valuenow"));
async function drag(page: Page, knob: Locator, dx: number, dy: number, fine = false) {
  await knob.scrollIntoViewIfNeeded();
  const box = (await knob.boundingBox())!;
  if (fine) await page.keyboard.down("Shift");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 }); await page.mouse.up();
  if (fine) await page.keyboard.up("Shift");
}

test("knobs accept exact values, reject invalid drafts, reset and preserve Undo", async ({ page }) => {
  await sound(page);
  const field = page.getByLabel("Resonance value", { exact: true }), knob = page.getByRole("slider", { name: "Resonance", exact: true });
  const initial = await number(knob);
  expect((await knob.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  expect((await field.boundingBox())!.height).toBeLessThanOrEqual(28);
  await field.fill("3.75"); await field.press("Enter"); await expect(knob).toHaveAttribute("aria-valuenow", "3.75");
  await page.getByLabel("Undo", { exact: true }).click(); await expect(knob).toHaveAttribute("aria-valuenow", String(initial));
  await page.getByLabel("Redo", { exact: true }).click(); await expect(field).toHaveValue("3.75");
  await page.getByLabel("Reset Resonance", { exact: true }).click(); await expect(knob).toHaveAttribute("aria-valuenow", String(initial));
  await page.getByLabel("Undo", { exact: true }).click(); await expect(field).toHaveValue("3.75");
  await field.fill("25"); await field.press("Enter"); await expect(field).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("navigation").getByRole("button", { name: "04 Mix" }).click(); await expect(knob).toBeVisible();
  await field.press("Escape"); await expect(field).toHaveValue("3.75");
  await expect(field).not.toHaveAttribute("aria-invalid", "true");
});

test("vertical dragging groups Undo and Shift is a smaller movement", async ({ page }) => {
  await sound(page);
  const knob = page.getByRole("slider", { name: "Resonance", exact: true }), initial = await number(knob);
  await drag(page, knob, 30, 0); await expect(knob).toHaveAttribute("aria-valuenow", String(initial));
  await drag(page, knob, 0, -25); const coarse = await number(knob); expect(coarse).toBeGreaterThan(initial);
  await page.getByLabel("Undo", { exact: true }).click(); await expect(knob).toHaveAttribute("aria-valuenow", String(initial));
  await drag(page, knob, 0, -25, true); const fine = await number(knob);
  expect(fine).toBeGreaterThan(initial); expect(fine - initial).toBeLessThan((coarse - initial) / 2);
  await page.getByLabel("Undo", { exact: true }).click(); await expect(knob).toHaveAttribute("aria-valuenow", String(initial));
});

test("Escape and capture loss restore pointer previews and ignore late pointer events", async ({ page }) => {
  await sound(page);
  const knob = page.getByRole("slider", { name: "Resonance", exact: true }), initial = await number(knob);
  await knob.scrollIntoViewIfNeeded();
  const box = (await knob.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y - 20, { steps: 5 });
  expect(await number(knob)).toBeGreaterThan(initial); await page.keyboard.press("Escape");
  await expect(knob).toHaveAttribute("aria-valuenow", String(initial));
  await page.mouse.move(x, y - 40); await page.mouse.up(); await page.waitForTimeout(80);
  await expect(knob).toHaveAttribute("aria-valuenow", String(initial));
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y - 20, { steps: 5 });
  await knob.evaluate(element => { const id = 1; if (!element.hasPointerCapture(id)) throw new Error("The knob did not capture its pointer."); element.releasePointerCapture(id); });
  await page.mouse.move(x, y - 30); await page.mouse.up();
  await expect(knob).toHaveAttribute("aria-valuenow", String(initial));
});

test("held keyboard edits use one Undo and Escape blocks repeat callbacks", async ({ page }) => {
  await sound(page);
  const knob = page.getByRole("slider", { name: "Resonance", exact: true }), initial = await number(knob);
  await knob.focus(); await page.keyboard.down("ArrowUp"); await page.keyboard.down("ArrowUp"); await page.keyboard.down("ArrowUp"); await page.keyboard.up("ArrowUp");
  expect(await number(knob)).toBeGreaterThan(initial);
  await page.getByLabel("Undo", { exact: true }).click(); await expect(knob).toHaveAttribute("aria-valuenow", String(initial));
  await knob.focus(); await page.keyboard.down("ArrowUp"); await page.keyboard.press("Escape"); await page.keyboard.down("ArrowUp"); await page.keyboard.up("ArrowUp");
  await expect(knob).toHaveAttribute("aria-valuenow", String(initial));
  await knob.press("Shift+ArrowUp"); expect(await number(knob)).toBeGreaterThan(initial);
});

test("cancelling a knob preserves earlier edits in its A/B audition", async ({ page }) => {
  const rack = await sound(page);
  await rack.getByRole("button", { name: "Compare A/B", exact: true }).click();
  await rack.getByRole("button", { name: "B", exact: true }).click();
  await rack.getByLabel("Sound patch preset").selectOption("starter:pulse"); await expect(rack.locator(".mod-route")).toHaveCount(5);
  const field = page.getByLabel("Filter cutoff value", { exact: true }), initial = await field.inputValue();
  await field.fill("1234"); await field.press("Escape"); await expect(field).toHaveValue(initial);
  await expect(rack.locator(".mod-route")).toHaveCount(5); await expect(rack.getByRole("button", { name: "Use B", exact: true })).toBeEnabled();
  await field.fill("2345"); await field.press("Enter"); await rack.getByRole("button", { name: "Use B", exact: true }).click();
  await expect(field).toHaveValue("2345"); await page.getByLabel("Undo", { exact: true }).click(); await expect(rack.locator(".mod-route")).toHaveCount(0);
});

test("the instrument envelope graph edits the real ADSR values without adding a source", async ({ page }) => {
  const rack=await sound(page), attack=page.getByRole("slider",{name:"Instrument envelope attack graph handle",exact:true});
  const numeric=page.getByLabel("Attack value",{exact:true}), before=await numeric.inputValue();
  await attack.press("ArrowRight"); const after=await numeric.inputValue(); expect(after).not.toBe(before);
  await page.getByLabel("Undo",{exact:true}).click(); await expect(numeric).toHaveValue(before);
  await page.getByLabel("Redo",{exact:true}).click(); await expect(numeric).toHaveValue(after);
  await attack.focus(); await page.keyboard.down("ArrowRight"); await page.keyboard.press("Escape"); await page.keyboard.up("ArrowRight"); await expect(numeric).toHaveValue(after);
  await expect(rack.locator(".mod-source")).toHaveCount(0);
});

test("performance knobs remain live while a take records and persist their expression events", async ({ page }) => {
  await sound(page);
  await page.getByLabel("Recording source").selectOption("midi"); await page.getByLabel("Start recording", { exact: true }).click();
  await expect(page.locator(".transport-position")).toContainText("Recording ·");
  await expect(page.getByLabel("Resonance value",{exact:true})).toBeDisabled();
  await expect(page.getByRole("button",{name:"Reset sound",exact:true})).toBeDisabled();
  await page.getByLabel("Pitch bend value", { exact: true }).fill("0.3"); await page.getByLabel("Pitch bend value", { exact: true }).press("Enter");
  const expression=page.getByLabel("Expression value",{exact:true});await expression.fill("0.42");await expression.fill("");
  await expect(expression).toHaveAttribute("aria-invalid","true");
  await page.getByLabel("Finish recording", { exact: true }).click(); await expect(page.getByLabel("Start recording", { exact: true })).toBeEnabled();
  await expect(expression).toHaveValue("0.42");
  const events = await page.evaluate(async () => {
    const { latestDraft } = await import("/lib/client/storage.ts" as string); const draft = await latestDraft("guest");
    return draft.document.tracks[0].clips.filter((clip: {name:string}) => clip.name === "MIDI take").at(-1).events;
  });
  expect(events).toEqual(expect.arrayContaining([expect.objectContaining({type:"expression",value:.42}),expect.objectContaining({type:"pitchBend",value:.3})]));
});

test("Sound and Mix knobs fit desktop, tablet and phone layouts with visible focus", async ({ page }) => {
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const rack=await sound(page);mkdirSync("output/daw-knob",{recursive:true});
  await rack.getByLabel("Sound patch preset").selectOption("starter:pulse");
  for(const kind of ["envelope","step","random","reference"]) await rack.getByLabel("Add modulation source").selectOption(kind);
  await expect(rack.locator(".mod-source")).toHaveCount(5);
  for(const [width,height] of [[1440,1000],[960,720],[800,720],[390,844]]) {
    await page.setViewportSize({width,height});
    for(const [tab,mode] of [["03 Sound","sound"],["04 Mix","mix"]]) {
      await page.getByRole("navigation").getByRole("button",{name:tab}).click();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await expect(page.getByLabel("Stop song",{exact:true})).toBeInViewport();
      if(mode==="sound") {
        await expect.poll(()=>rack.locator(".mod-source-grid").evaluate(element=>getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length)).toBe(width===1440?3:width===390?1:2);
        await rack.locator(".mod-patch-actions>summary").click();
        const menu=rack.locator(".mod-action-menu");await expect(menu).toBeVisible();
        const bounds=(await menu.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);
        await rack.locator(".mod-patch-actions>summary").click();
      }
      const dial=page.locator(".daw-knob-dial:visible").first();await page.keyboard.press("Tab");await dial.focus();
      expect((await dial.boundingBox())!.width).toBeGreaterThanOrEqual(44);
      expect(await dial.evaluate(element=>getComputedStyle(element).outlineStyle)).not.toBe("none");
      await page.screenshot({path:`output/daw-knob/${width}-${mode}.png`});
    }
  }
  expect(errors).toEqual([]);
});
