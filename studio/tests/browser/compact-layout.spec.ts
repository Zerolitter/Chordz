import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

test("compact settings and mixer retain exact editing and useful space", async ({ page }) => {
  await page.setViewportSize({ width: 1668, height: 1244 });
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await expect(page.getByText("Your next song starts with a few notes.", { exact: true })).toHaveCount(0);
  await page.getByRole("navigation").getByRole("button", { name: "04 Mix" }).click();
  const field = page.getByLabel("Low EQ value", { exact: true });
  const initial = await field.inputValue();
  const bounds = (await field.boundingBox())!;
  expect(bounds.width).toBeLessThan(60);
  expect(bounds.height).toBeLessThanOrEqual(28);
  const colors = await field.evaluate(element => {
    const lightness = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number).reduce((a, b) => a + b) / 3;
    return { field: lightness(getComputedStyle(element).backgroundColor), panel: lightness(getComputedStyle(element.closest(".channel-effects")!).backgroundColor) };
  });
  expect(colors.field - colors.panel).toBeGreaterThan(20);
  await field.fill("-3.75"); await field.press("Enter");
  await expect(page.getByRole("slider", { name: "Low EQ", exact: true })).toHaveAttribute("aria-valuenow", "-3.75");
  await page.getByLabel("Undo", { exact: true }).click(); await expect(field).toHaveValue(initial);
  expect((await page.locator(".channel-effects").boundingBox())!.width).toBeLessThan(450);
  const bank = (await page.locator(".mixer-scroll").boundingBox())!;
  const master = (await page.locator(".master-channel").boundingBox())!;
  expect(Math.abs(bank.x + bank.width - master.x - master.width)).toBeLessThan(3);
  mkdirSync("output/compact-layout", { recursive: true });
  await page.screenshot({ path: "output/compact-layout/1668-mix.png", animations: "disabled" });
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Appearance" });
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(360);
  expect((await dialog.boundingBox())!.height).toBeLessThan(360);
  await expect(dialog.getByText("Make the studio feel yours.", { exact: false })).toHaveCount(0);
  await page.screenshot({ path: "output/compact-layout/appearance.png", animations: "disabled" });
  await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Appearance", exact: true })).toBeFocused();
});

test("empty and populated Sound racks remain compact at reference viewport sizes", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/"); await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Blank song", exact: true }).click();
  await page.getByRole("navigation").getByRole("button", { name: "03 Sound" }).click();
  const rack = page.getByRole("region", { name: "Selected track modulation rack" });
  expect((await rack.locator(".mod-source-empty").boundingBox())!.height).toBeLessThan(100);
  await rack.getByLabel("Sound patch preset").selectOption("starter:pulse");
  await expect(rack.locator(".mod-route").first().locator(".mod-route-controls > .daw-knob > .daw-knob-readout")).toContainText("dB");
  await rack.locator(".mod-base-details > summary").click();
  await expect(rack.locator(".mod-base-inspector > .tiny")).toContainText("Hz effective");
  await rack.locator(".mod-base-details > summary").click();
  await rack.getByLabel("Add modulation source").selectOption("envelope");
  await rack.getByLabel("Add modulation source").selectOption("step");
  await expect(rack.locator(".mod-source")).toHaveCount(3);
  await rack.locator(".movement-inspector > summary").click();
  await expect(rack.getByLabel("Movement timing", { exact: true })).toBeVisible();
  await expect(rack.getByLabel("Movement voicing", { exact: true })).toBeVisible();
  await rack.getByLabel("Movement pattern", { exact: true }).selectOption("down");
  await expect(rack.getByLabel("Movement pattern", { exact: true })).toHaveValue("down");
  await page.getByLabel("Undo", { exact: true }).click();
  await expect(rack.getByLabel("Movement pattern", { exact: true })).toHaveValue("chord");
  mkdirSync("output/compact-layout", { recursive: true });
  await rack.locator(".movement-controls").screenshot({ path: "output/compact-layout/movement.png", animations: "disabled" });
  for (const [width, height] of [[2515, 1138], [1668, 1244], [960, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.locator(".workspace-content").evaluate(element => { element.scrollTop = 0; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await page.locator(".sound-panel").boundingBox())!.width).toBeLessThanOrEqual(1320);
    await expect(page.getByLabel("Stop song", { exact: true })).toBeInViewport();
    await page.screenshot({ path: `output/compact-layout/${width}-sound.png`, animations: "disabled" });
  }
  expect(errors).toEqual([]);
});

test.describe("compact fields on touch screens", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("numeric readout retains a 44px touch target around its small field", async ({ page }) => {
    await page.goto("/"); await expect(page.getByLabel("Song title")).toBeEnabled();
    await page.getByRole("navigation").getByRole("button", { name: "04 Mix" }).tap();
    const field = page.getByLabel("Low EQ value", { exact: true });
    await field.scrollIntoViewIfNeeded();
    const readout = field.locator("..");
    expect((await readout.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await readout.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    expect((await field.boundingBox())!.height).toBeLessThanOrEqual(28);
    await readout.tap(); await expect(field).toBeFocused();
    await field.fill("2.5"); await field.press("Enter");
    await expect(page.getByRole("slider", { name: "Low EQ", exact: true })).toHaveAttribute("aria-valuenow", "2.5");
    const dial = (await page.getByRole("slider", { name: "Low EQ", exact: true }).boundingBox())!;
    const reset = (await page.getByLabel("Reset Low EQ", { exact: true }).boundingBox())!;
    expect(reset.x).toBeGreaterThanOrEqual(dial.x + dial.width - .5);
    await page.getByRole("navigation").getByRole("button", { name: "03 Sound" }).tap();
    const rack = page.getByRole("region", { name: "Selected track modulation rack" });
    await rack.getByRole("button", { name: "Assign", exact: true }).tap();
    const route = rack.locator(".mod-route").first(); await route.scrollIntoViewIfNeeded();
    const routeDial = (await route.getByRole("slider").boundingBox())!;
    const routeReset = (await route.getByLabel("Reset Depth to Track filter", { exact: true }).boundingBox())!;
    expect(routeReset.x).toBeGreaterThanOrEqual(routeDial.x + routeDial.width - .5);
    await expect(page.getByLabel("Stop song", { exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
