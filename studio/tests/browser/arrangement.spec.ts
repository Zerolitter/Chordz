import { test, expect, type Page } from "@playwright/test";

async function blankArrangement(page: Page) {
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Blank song" }).click();
  await page.getByRole("navigation").getByRole("button", { name: "02 Arrange" }).click();
  await page.getByRole("button", { name: "New phrase", exact: true }).click();
  await expect(page.getByLabel("Clip name")).toHaveValue("New phrase");
}

test("clip movement and right edge resize are snapped, reversible gestures and preserve looping source", async ({ page }) => {
  await blankArrangement(page);
  await page.getByLabel("Loop source bars").fill("2");
  await page.getByLabel("Loop source bars").press("Enter");
  await page.getByLabel("Loop", { exact: true }).check();
  const body = page.locator(".timeline-clip-body").first();
  const box = (await body.boundingBox())!;
  await page.mouse.move(box.x + 50, box.y + 10); await page.mouse.down();
  await page.mouse.move(box.x + 69, box.y + 10); await page.mouse.move(box.x + 88, box.y + 10); await page.mouse.up();
  await expect(page.getByLabel("Clip start bar")).toHaveValue("2");
  await page.getByLabel("Undo", { exact: true }).click();
  await expect(page.getByLabel("Clip start bar")).toHaveValue("1");
  await page.getByLabel("Redo", { exact: true }).click();
  const handle = page.getByRole("slider", { name: "Resize New phrase clip" });
  const edge = (await handle.boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2); await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + 19, edge.y + edge.height / 2);
  await page.mouse.move(edge.x + edge.width / 2 + 38, edge.y + edge.height / 2); await page.mouse.up();
  await expect(page.getByLabel("Clip length bars")).toHaveValue("9");
  await expect(page.getByLabel("Loop source bars")).toHaveValue("2");
  await expect(page.getByLabel("Loop", { exact: true })).toBeChecked();
  await page.getByLabel("Undo", { exact: true }).click();
  await expect(page.getByLabel("Clip length bars")).toHaveValue("8");
  await expect(page.getByLabel("Clip start bar")).toHaveValue("2");
});

test("Escape and pointer cancellation restore clip gestures without committing", async ({ page }) => {
  await blankArrangement(page);
  const body = page.locator(".timeline-clip-body").first(), box = (await body.boundingBox())!;
  await page.mouse.move(box.x + 50, box.y + 10); await page.mouse.down();
  await page.mouse.move(box.x + 88, box.y + 10);
  await expect(page.getByLabel("Clip start bar")).toHaveValue("2");
  await page.keyboard.press("Escape"); await page.mouse.up();
  await expect(page.getByLabel("Clip start bar")).toHaveValue("1");
  const handle = page.getByRole("slider", { name: "Resize New phrase clip" }), edge = (await handle.boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + 10); await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + 38, edge.y + 10);
  await expect(page.getByLabel("Clip length bars")).toHaveValue("9");
  await handle.dispatchEvent("pointercancel", { pointerId: 1 }); await page.mouse.up();
  await expect(page.getByLabel("Clip length bars")).toHaveValue("8");
  await page.getByLabel("Undo", { exact: true }).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(0);
});

test("automation curve adds, merges dragged points, undoes once and supports numeric editing and Delete", async ({ page }) => {
  await blankArrangement(page);
  await page.getByLabel("Automation parameter").selectOption("pan");
  const graph = page.locator(".automation-graph");
  await graph.scrollIntoViewIfNeeded();
  const box = (await graph.boundingBox())!;
  await page.mouse.click(box.x + box.width * .25, box.y + box.height * .5);
  await page.mouse.click(box.x + box.width * .75, box.y + box.height * .5);
  await expect(page.locator(".automation-point")).toHaveCount(2);
  const point = (await page.locator(".automation-point").first().boundingBox())!;
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .5, box.y + 5);
  await page.mouse.move(box.x + box.width * .75, box.y - 30); await page.mouse.up();
  await expect(page.locator(".automation-point")).toHaveCount(1);
  await expect(page.getByLabel("Automation point 1 value")).toHaveValue("1");
  await page.getByLabel("Undo", { exact: true }).click();
  await expect(page.locator(".automation-point")).toHaveCount(2);
  await page.getByLabel("Automation point 1 bar").fill("8");
  await page.getByLabel("Automation point 2 bar").press("Enter");
  await expect(page.getByLabel("Automation point 2 bar")).toHaveValue("8");
  await page.getByLabel("Undo", { exact: true }).click();
  await expect(page.getByLabel("Automation point 1 bar")).toHaveValue("3");
  await page.locator(".automation-point").first().focus(); await page.keyboard.press("Delete");
  await expect(page.locator(".automation-point")).toHaveCount(1);
  await page.getByLabel("Undo", { exact: true }).click();
  await expect(page.locator(".automation-point")).toHaveCount(2);
});

test("automation drag Escape and pointercancel preserve the original curve", async ({ page }) => {
  await blankArrangement(page);
  await page.getByLabel("Automation parameter").selectOption("expression");
  const graph = page.locator(".automation-graph"); await graph.scrollIntoViewIfNeeded();
  const box = (await graph.boundingBox())!;
  await page.mouse.click(box.x + box.width * .25, box.y + box.height * .5);
  const before = await page.getByLabel("Automation point 1 value").inputValue();
  for (const action of ["escape", "pointercancel"]) {
    const point = (await page.locator(".automation-point").first().boundingBox())!;
    await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width * .75, box.y - 20);
    if (action === "escape") await page.keyboard.press("Escape");
    else await graph.dispatchEvent("pointercancel", { pointerId: 1 });
    await page.mouse.up();
    await expect(page.getByLabel("Automation point 1 bar")).toHaveValue("3");
    await expect(page.getByLabel("Automation point 1 value")).toHaveValue(before);
  }
  await page.getByLabel("Undo", { exact: true }).click();
  await expect(page.locator(".automation-point")).toHaveCount(0);
});
