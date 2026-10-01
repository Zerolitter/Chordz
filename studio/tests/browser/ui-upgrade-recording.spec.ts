import { test, expect } from "@playwright/test";

test("an invalid meter draft cannot prevent finishing and preserving an active MIDI take", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Blank song", exact: true }).click();
  // MIDI capture guards use a built-in sound; acoustic download behavior has its own tests.
  await page.getByRole("button", {name:"Glass FM Synthesizers",exact:true}).click();
  await page.getByRole("button", {name:"Use on selected track",exact:true}).click();
  await page.getByLabel("Recording source").selectOption("midi");
  await page.getByLabel("Start recording", { exact: true }).click();
  await expect(page.locator(".transport-position")).toContainText("Recording ·");

  // Use the ordinary computer keyboard input so the saved take contains a note.
  await page.locator("main.studio-shell").evaluate(element => {
    element.tabIndex = -1;
    element.focus();
  });
  await page.keyboard.down("a");
  await page.waitForTimeout(200);
  await page.keyboard.up("a");
  const meter = page.getByLabel("Beats per bar", { exact: true });
  await meter.fill("");
  await expect(meter).toHaveValue("");
  await page.getByLabel("Finish recording", { exact: true }).click();
  await expect(page.getByLabel("Start recording", { exact: true })).toBeEnabled();
  await expect(page.locator(".transport-position")).not.toContainText("Recording ·");

  const saved = await page.evaluate(async () => {
    const { latestDraft } = await import("/lib/client/storage.ts" as string);
    const draft = await latestDraft("guest");
    return {
      meter: draft.document.timeSignature,
      takes: draft.document.tracks.flatMap((track: {
        clips: { name: string; notes: { pitch: number; duration: number }[] }[];
      }) => track.clips.filter(clip => clip.name === "MIDI take")),
    };
  });
  expect(saved.meter).toEqual([4, 4]);
  expect(saved.takes).toHaveLength(1);
  expect(saved.takes[0].notes).toHaveLength(1);
  expect(saved.takes[0].notes[0].duration).toBeGreaterThan(0);

  // Finishing the take leaves the invalid field available to correct or cancel.
  await expect(meter).toHaveValue("");
  await page.getByLabel("Start recording", { exact: true }).click();
  await expect(page.getByLabel("Finish recording", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Start recording", { exact: true })).toBeEnabled();
  await meter.press("Escape");
  await expect(meter).toHaveValue("4");
});
