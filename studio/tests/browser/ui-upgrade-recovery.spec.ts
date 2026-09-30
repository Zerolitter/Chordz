import { test, expect } from "@playwright/test";

test("intentional device recovery discards an invalid field while normal song actions remain guarded", async ({ page }) => {
  await page.goto("/signin-with-chatgpt?return_to=/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  const title = `Meter recovery ${Date.now()}`;
  await page.evaluate(async title => {
    const { createProject } = await import("/lib/music/project.ts" as string);
    const { saveDraft } = await import("/lib/client/storage.ts" as string);
    const document = createProject(title);
    document.tempo = 97;
    // This is the fixed user ID of the loopback-only dispatch simulation.
    await saveDraft({ owner: "local_seedy", document, revision: 0,
      savedFingerprint: "", updatedAt: new Date().toISOString() });
  }, title);

  const meter = page.getByLabel("Beats per bar", { exact: true });
  await meter.fill("");
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Blank song", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Your songs", exact: true })).toBeVisible();
  await expect(meter).toHaveValue("");

  await page.getByRole("button", { name: "Recovery versions", exact: true }).click();
  await page.locator(".recovery-version").filter({ hasText: title }).click();
  await expect(page.getByRole("dialog", { name: "Recovery versions", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Song title")).toHaveValue(title);
  await expect(meter).toHaveValue("4");
  await expect(page.getByLabel("Tempo", { exact: true })).toHaveValue("97");
  await expect(page.locator(".studio-shell > .studio-notice.error")).toHaveCount(0);
  await page.getByRole("navigation").getByRole("button", { name: "02 Arrange" }).click();
  await expect(page.getByLabel("Timeline zoom")).toBeVisible();
});
