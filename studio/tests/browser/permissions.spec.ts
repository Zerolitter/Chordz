import { test, expect } from "@playwright/test";

// Fake-device flags used by recording tests override Chrome's microphone permission.
test.use({
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});
test("denied microphone and MIDI permissions leave keyboard input available", async ({
  page,
  context,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "requestMIDIAccess", {
      value: () =>
        Promise.reject(
          new DOMException("MIDI permission denied", "NotAllowedError"),
        ),
    }),
  );
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  const session = await context.newCDPSession(page);
  await session.send("Browser.setPermission", {
    permission: { name: "microphone" },
    setting: "denied",
    origin: "http://127.0.0.1:5173",
  });
  await page.getByLabel("Recording source").selectOption("audio");
  await page.getByLabel("Start recording", { exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    /denied|Permission|allowed|found/i,
  );
  await page.getByLabel("Audio and MIDI devices").click();
  await page.getByRole("button", { name: "Enable MIDI input" }).click();
  await expect(page.getByRole("alert")).toContainText(
    /denied|Permission|allowed/i,
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByLabel("Other detail tools").selectOption("keyboard");
  await page.getByLabel("Play C3", { exact: true }).click();
  await expect(page.locator(".piano-key.white").first()).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
