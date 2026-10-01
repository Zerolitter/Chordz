import { expect, test, type Page, type Locator } from "@playwright/test";

async function openSound(page: Page) {
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Blank song", exact: true }).click();
  await page.getByRole("navigation").getByRole("button", { name: "03 Sound" }).click();
}

async function expectContainedTargets(graph: Locator) {
  await expect.poll(() => graph.evaluate(element => {
    const matrix = (element as SVGSVGElement).getScreenCTM()!;
    return Math.abs(matrix.a - 1) + Math.abs(matrix.d - 1);
  })).toBeLessThan(.01);
  const bounds = (await graph.boundingBox())!;
  for (const node of await graph.locator(".graph-handle-hit").all()) {
    const target = await node.evaluate(element => {
      const rect = element.getBoundingClientRect(), stroke = parseFloat(getComputedStyle(element).strokeWidth);
      return { left: rect.left - stroke / 2, top: rect.top - stroke / 2, right: rect.right + stroke / 2, bottom: rect.bottom + stroke / 2, width: rect.width + stroke, height: rect.height + stroke };
    });
    expect(target.width).toBeGreaterThanOrEqual(43.9);
    expect(target.height).toBeGreaterThanOrEqual(43.9);
    expect(target.left).toBeGreaterThanOrEqual(bounds.x - .1);
    expect(target.top).toBeGreaterThanOrEqual(bounds.y - .1);
    expect(target.right).toBeLessThanOrEqual(bounds.x + bounds.width + .1);
    expect(target.bottom).toBeLessThanOrEqual(bounds.y + bounds.height + .1);
  }
}

test("envelope nodes stay circular and map screen drags to the same timing at every layout", async ({ page }) => {
  await openSound(page);
  const graph = page.getByRole("group", { name: "Instrument envelope editable envelope graph", exact: true });
  const value = page.getByLabel("Attack value", { exact: true });

  for (const [width, height] of [[2515, 1138], [1668, 1244], [960, 720], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await graph.scrollIntoViewIfNeeded();
    await expectContainedTargets(graph);
    for (const node of await graph.locator(".graph-handle").all()) {
      const bounds = (await node.boundingBox())!;
      expect(Math.abs(bounds.width - bounds.height)).toBeLessThan(.1);
      expect(bounds.width).toBeGreaterThanOrEqual(6);
    }
    await expect(graph.locator(".graph-area")).toHaveCount(1);
    await expect(graph).toHaveAccessibleDescription(/Drag attack, decay\/sustain and release nodes/);

    const initial = Number(await value.inputValue());
    const decay = Number(await page.getByLabel("Decay value", { exact: true }).inputValue());
    const release = Number(await page.getByLabel("Release value", { exact: true }).inputValue());
    const duration = (initial + decay + Math.max(.25, (initial + decay) * .5) + release) * 1.15;
    const targetFraction = .18;
    const coordinates = await graph.evaluate((element, targetFraction) => {
      const svg = element as SVGSVGElement, matrix = svg.getScreenCTM()!;
      const node = svg.querySelector(".graph-handle-hit") as SVGCircleElement;
      const start = svg.createSVGPoint(); start.x = node.cx.baseVal.value; start.y = node.cy.baseVal.value;
      const target = svg.createSVGPoint(); target.x = 24 + targetFraction * (svg.viewBox.baseVal.width - 46); target.y = start.y;
      const from = start.matrixTransform(matrix), to = target.matrixTransform(matrix);
      return { from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } };
    }, targetFraction);
    await page.mouse.move(coordinates.from.x, coordinates.from.y);
    await page.mouse.down();
    await page.mouse.move(coordinates.to.x, coordinates.to.y, { steps: 5 });
    await page.mouse.up();
    await expect(value).toHaveValue(String(Math.round(duration * targetFraction * 1000) / 1000));
    await page.getByLabel("Undo", { exact: true }).click();
    await expect(value).toHaveValue(String(initial));
    await page.mouse.move(coordinates.from.x, coordinates.from.y);
    await page.mouse.down();
    await page.mouse.move(coordinates.to.x, coordinates.to.y, { steps: 3 });
    await expect(value).not.toHaveValue(String(initial));
    await page.keyboard.press("Escape");
    await page.mouse.move(coordinates.to.x + 10, coordinates.to.y);
    await page.mouse.up();
    await expect(value).toHaveValue(String(initial));
  }
});

test("full-sized graph targets stay inside compact sources at extreme values", async ({ page }) => {
  await openSound(page);
  const rack = page.getByRole("region", { name: "Selected track modulation rack" });
  for (const kind of ["lfo", "envelope", "step", "reference"]) await rack.getByLabel("Add modulation source").selectOption(kind);
  await rack.getByRole("slider", { name: "LFO 1 phase graph handle", exact: true }).press("End");
  const reference = rack.getByRole("group", { name: "Reference curve 4 editable reference graph", exact: true });
  await reference.getByRole("slider").first().press("Home");
  await reference.getByRole("slider").last().press("End");
  for (const [width, height] of [[1668, 1244], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const graph of await rack.locator(".daw-source-graph>svg").all()) await expectContainedTargets(graph);
  }
});
