import { expect, test } from "@playwright/test";

test("device draft failure is distinct from cloud state and a successful retry saves current edits", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await expect(page.getByRole("status", { name: "Device draft status" })).toContainText("Device draft saved");
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    const state = window as unknown as { failDraft: boolean };
    state.failDraft = true;
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
      if (state.failDraft && args[1] === "readwrite" && Array.isArray(args[0]) && args[0].includes("staging") && args[0].includes("drafts")) throw new Error("Injected draft failure");
      return original.apply(this, args);
    };
  });
  await page.getByLabel("Song title").fill("Current unsaved idea");
  await page.getByLabel("Song title").press("Enter");
  await expect(page.getByRole("status", { name: "Device draft status" })).toContainText("Device draft unavailable");
  await expect(page.locator(".save-status")).not.toContainText("Saved to cloud");
  await expect(page.getByRole("button", { name: "Retry device draft" })).toBeVisible();
  await page.evaluate(() => { (window as unknown as { failDraft: boolean }).failDraft = false; });
  await page.getByRole("button", { name: "Retry device draft" }).click();
  await expect(page.getByRole("status", { name: "Device draft status" })).toContainText("Device draft saved");
  await page.reload();
  await expect(page.getByLabel("Song title")).toHaveValue("Current unsaved idea");
});

test("a failed device refresh after a successful cloud save keeps both states accurate", async ({ page }) => {
  await page.route("**/api/projects**", async route => {
    const method = route.request().method();
    if (method === "GET") return route.fulfill({ status: 200, json: [] });
    const body = route.request().postDataJSON();
    const document = method === "POST" ? body : body.document;
    await route.fulfill({ status: 200, json: { document, revision: method === "POST" ? 1 : 2, updatedAt: new Date().toISOString() } });
  });
  await page.goto("/signin-with-chatgpt?return_to=/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Blank song", exact: true }).click();
  await expect(page.getByRole("status", { name: "Device draft status" })).toContainText("Device draft saved");
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
      if (args[1] === "readwrite" && Array.isArray(args[0]) && args[0].includes("staging") && args[0].includes("drafts")) throw new Error("Injected post-cloud device failure");
      return original.apply(this, args);
    };
  });
  await page.getByLabel("Song title").fill("Cloud kept this idea");
  await page.getByLabel("Song title").press("Enter");
  await page.getByLabel("Save song", { exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("Saved to cloud");
  await expect(page.getByRole("status", { name: "Device draft status" })).toContainText("Device draft unavailable");
  await expect(page.getByRole("button", { name: "Retry device draft" })).toBeVisible();
});
