import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

test("appearance and performance preferences survive reload without changing music", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  const title = await page.getByLabel("Song title").inputValue();
  const dock = page.getByRole("button", { name: "Performance dock", exact: true });
  await expect(dock).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByLabel("Play C3", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByLabel("Accent #e5a95c", { exact: true }).click();
  await page.getByLabel("Track rail width", { exact: true }).fill("9");
  await page.getByLabel("Interface spacing", { exact: true }).selectOption("compact");
  await page.keyboard.press("Escape");
  await dock.click();
  await expect(page.getByLabel("Play C3", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Song title")).toHaveValue(title);
  await expect(page.locator(".studio-shell")).toHaveAttribute("data-density", "compact");
  await expect(dock).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(page.getByLabel("Track rail width", { exact: true })).toHaveValue("9");
  await expect(page.getByLabel("Accent #e5a95c", { exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Reset appearance", exact: true }).click();
  await expect(page.getByLabel("Interface spacing", { exact: true })).toHaveValue("comfortable");
  await expect(page.getByLabel("Track rail width", { exact: true })).toHaveValue("5");
});

test("Stop remains available during an invalid draft and closing the dock releases its keys", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", { name: "Performance dock", exact: true }).click();
  const key = page.getByLabel("Play C3", { exact: true });
  await key.focus();
  await page.keyboard.down("Enter");
  await expect(key).toHaveClass(/held/);
  await page.getByRole("button", { name: "Performance dock", exact: true }).click();
  await page.keyboard.up("Enter");
  await expect(key).not.toHaveClass(/held/);
  await page.getByLabel("Tempo", { exact: true }).fill("");
  await page.getByLabel("Stop song", { exact: true }).click();
  await expect(page.locator(".piano-key.held")).toHaveCount(0);
  await expect(page.getByLabel("Tempo", { exact: true })).toHaveValue("");
  await page.getByLabel("Tempo", { exact: true }).press("Escape");
  await expect(page.getByLabel("Tempo", { exact: true })).toHaveValue("120");
});

test("all workspaces fit the supplied responsive layout and tracks are reachable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  mkdirSync("output/ui-upgrade", { recursive: true });
  for (const [width, height] of [[1440, 1000], [960, 720], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const tab of ["01 Write", "02 Arrange", "03 Sound", "04 Mix"]) {
      await page.getByRole("navigation").getByRole("button", { name: tab }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByLabel("Stop song", { exact: true })).toBeInViewport();
      await page.screenshot({ path: `output/ui-upgrade/${width}-${tab.slice(3).toLowerCase()}.png` });
    }
    if (width < 1024) {
      await page.getByLabel("Show tracks", { exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Song tracks" });
      await expect(dialog.getByLabel("Select Grand piano", { exact: true })).toBeVisible();
      await dialog.getByLabel("Mute Grand piano", { exact: true }).click();
      await expect(dialog.getByLabel("Mute Grand piano", { exact: true })).toHaveAttribute("aria-pressed", "true");
      await dialog.getByLabel("Mute Grand piano", { exact: true }).click();
      await dialog.getByRole("button", { name: "Edit sound", exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole("navigation").getByRole("button", { name: "03 Sound" })).toHaveAttribute("aria-current", "page");
    }
  }
  expect(errors).toEqual([]);
});

test("MP3 export uses the real rendered mix and can be decoded", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Blank song", exact: true }).click();
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByLabel("Export format", { exact: true }).selectOption("mp3");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export MP3", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.mp3$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  mkdirSync("output/ui-upgrade", { recursive: true });
  writeFileSync("output/ui-upgrade/mix.mp3", bytes);
  const decoded = await page.evaluate(async raw => {
    const context = new AudioContext();
    try {
      const buffer = await context.decodeAudioData(Uint8Array.from(raw).buffer);
      return { channels: buffer.numberOfChannels, rate: buffer.sampleRate, duration: buffer.duration,
        peak: Math.max(...Array.from(buffer.getChannelData(0).subarray(0, 48000), Math.abs)) };
    } finally { await context.close(); }
  }, [...bytes]);
  expect(decoded.channels).toBe(2);
  expect(decoded.duration).toBeGreaterThan(4);
  expect(decoded.peak).toBeGreaterThan(.001);
});
