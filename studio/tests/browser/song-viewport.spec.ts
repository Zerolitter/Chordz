import { test, expect, type Page } from "@playwright/test";
import { createProject, createTrack, emptyClip, ticksPerBar } from "../../lib/music/project";
import { studioViewKey } from "../../lib/client/studio-view";
import type { ProjectDocument } from "../../lib/music/types";

function viewportSong(title: string) {
  const project = createProject(title), bar = ticksPerBar(project);
  project.sections[0].lengthTick = bar * 64;
  project.tracks = Array.from({ length: 14 }, (_, index) => createTrack("lead", `Viewport track ${index + 1}`));
  project.tracks[0].clips = [emptyClip(bar * 8, bar * 8, "Viewport phrase"), emptyClip(bar * 40, bar * 8, "Later phrase")];
  return project;
}

async function openFixture(page: Page, project: ProjectDocument) {
  // Seed from a same-origin document without the studio's autosave timer.
  await page.goto("/api/projects");
  await page.evaluate(async document => {
    const { saveDraft } = await import("/lib/client/storage.ts" as string);
    await saveDraft({ owner: "guest", document, revision: 0, savedFingerprint: "", updatedAt: new Date().toISOString() });
  }, project);
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toHaveValue(project.title);
  await expect(page.getByLabel("Timeline zoom")).toBeEnabled();
}

async function savedViewport(page: Page, project: ProjectDocument) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null")?.songViewport, studioViewKey("guest", project.id));
}

async function scrollSong(page: Page, left: number, top: number) {
  await page.getByLabel("Song arrangement", { exact: true }).evaluate(async (node, position) => {
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await frame(); await frame();
    node.scrollLeft = position.left; node.scrollTop = position.top;
    await frame(); await frame();
  }, { left, top });
}

async function scrollPosition(page: Page) {
  return page.getByLabel("Song arrangement", { exact: true }).evaluate(node => ({
    left: node.scrollLeft, top: node.scrollTop, width: node.clientWidth, height: node.clientHeight,
    maxLeft: node.scrollWidth - node.clientWidth, maxTop: node.scrollHeight - node.clientHeight,
  }));
}

test("song viewport restores per project and ignores the old global zoom", async ({ page }) => {
  const songA = viewportSong("Viewport A"), songB = viewportSong("Viewport B");
  await page.addInitScript(() => localStorage.setItem("chordz-ui-v1:timeline-zoom", JSON.stringify({ version: 1, value: 100 })));
  await openFixture(page, songA);
  await expect(page.getByLabel("Timeline zoom")).toHaveValue("38");
  await page.getByLabel("Timeline zoom").fill("67");
  await scrollSong(page, 600, 180);
  await expect.poll(async () => (await savedViewport(page, songA))?.leftTick).toBe(Math.round(600 / 67 * ticksPerBar(songA)));
  await expect.poll(async () => (await savedViewport(page, songA))?.scrollTop).toBe(180);
  for (const name of ["02 Write", "03 Sound", "04 Mix", "01 Arrange"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByLabel("Timeline zoom")).toHaveValue("67");
  }
  await page.reload();
  await expect(page.getByLabel("Song title")).toHaveValue(songA.title);
  await expect(page.getByLabel("Timeline zoom")).toHaveValue("67");
  await expect.poll(async () => Math.abs((await scrollPosition(page)).left - 600)).toBeLessThan(1);
  await expect.poll(async () => (await scrollPosition(page)).top).toBe(180);
  await openFixture(page, songB);
  await expect(page.getByLabel("Timeline zoom")).toHaveValue("38");
  expect((await scrollPosition(page)).left).toBe(0);
  await openFixture(page, songA);
  await expect(page.getByLabel("Timeline zoom")).toHaveValue("67");
  await expect.poll(async () => Math.abs((await scrollPosition(page)).left - 600)).toBeLessThan(1);
  await expect(page.getByLabel("Play song", { exact: true })).toBeVisible();
  expect(await page.evaluate(async () => {
    const { latestDraft } = await import("/lib/client/storage.ts" as string);
    return (await latestDraft("guest"))?.document;
  })).toEqual(songA);
});

test("temporary viewport clamps retain the requested song position across responsive resizing", async ({ page }) => {
  const song = viewportSong("Responsive viewport");
  await openFixture(page, song);
  await page.getByLabel("Timeline zoom").fill("100");
  await page.setViewportSize({ width: 390, height: 844 });
  await scrollSong(page, 100000, 100000);
  const narrow = await scrollPosition(page);
  await expect.poll(async () => (await savedViewport(page, song))?.scrollTop).toBe(narrow.maxTop);
  const requested = await savedViewport(page, song);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect.poll(async () => (await scrollPosition(page)).left).toBeLessThan(narrow.left);
  await expect.poll(async () => (await scrollPosition(page)).top).toBeLessThan(narrow.top);
  expect(await savedViewport(page, song)).toEqual(requested);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => Math.abs((await scrollPosition(page)).left - narrow.left)).toBeLessThan(1);
  await expect.poll(async () => (await scrollPosition(page)).top).toBe(narrow.top);
  expect(await savedViewport(page, song)).toEqual(requested);
});

test("one scrolling canvas aligns sticky guides and headers and fits real song and phrase extents", async ({ page }) => {
  const song = viewportSong("Aligned viewport");
  await openFixture(page, song);
  await page.getByLabel("Timeline zoom").fill("100");
  await scrollSong(page, 500, 300);
  const viewport = page.getByLabel("Song arrangement", { exact: true });
  const box = (await viewport.boundingBox())!;
  const guide = (await page.locator(".song-timeline-guides").boundingBox())!;
  const header = (await page.locator(".song-track-header").nth(5).boundingBox())!;
  expect(Math.abs(guide.y - box.y)).toBeLessThan(1);
  expect(Math.abs(header.x - box.x)).toBeLessThan(1);
  await page.getByLabel("Fit song", { exact: true }).click();
  await expect.poll(async () => (await scrollPosition(page)).left).toBe(0);
  expect((await scrollPosition(page)).maxLeft).toBeLessThanOrEqual(1);
  await scrollSong(page, 0, 0);
  await page.locator(".timeline-clip-body").filter({ hasText: "Viewport phrase" }).click();
  await page.getByLabel("Fit selected clip or section", { exact: true }).click();
  const clip = (await page.locator(".timeline-clip.selected").boundingBox())!;
  const lane = (await page.locator(".song-guide-heading").first().boundingBox())!;
  const current = (await viewport.boundingBox())!;
  expect(Math.abs(clip.x - lane.x - lane.width)).toBeLessThan(2);
  expect(clip.x + clip.width).toBeLessThanOrEqual(current.x + current.width + 1);
  await expect(page.getByLabel("Follow playhead")).toHaveAttribute("aria-pressed", "false");
});

test("Follow persists while stopped, follows song playback and yields to native scrolling", async ({ page }) => {
  const song = viewportSong("Follow viewport");
  await openFixture(page, song);
  await page.getByLabel("Timeline zoom").fill("100");
  await expect.poll(async () => (await savedViewport(page, song))?.zoom).toBe(100);
  const stoppedLeft = (await scrollPosition(page)).left;
  await page.getByLabel("Follow playhead").click();
  await page.reload();
  await expect(page.getByLabel("Song title")).toHaveValue(song.title);
  await expect(page.getByLabel("Follow playhead")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => Math.abs((await scrollPosition(page)).left - stoppedLeft)).toBeLessThan(1);
  await page.getByLabel("Song playhead", { exact: true }).fill(String(ticksPerBar(song) * 45));
  await page.getByLabel("Play song", { exact: true }).click();
  await expect(page.getByLabel("Pause song", { exact: true })).toBeVisible();
  await expect.poll(async () => (await scrollPosition(page)).left).toBeGreaterThan(1000);
  await expect(page.getByLabel("Follow playhead")).toHaveAttribute("aria-pressed", "true");
  const left = (await scrollPosition(page)).left;
  await scrollSong(page, left - 100, 0);
  await expect(page.getByLabel("Follow playhead")).toHaveAttribute("aria-pressed", "false");
  await page.getByLabel("Stop song", { exact: true }).click();
  await page.getByLabel("Follow playhead").click();
  await page.getByLabel("Song arrangement", { exact: true }).focus();
  await page.keyboard.press("PageDown");
  await expect(page.getByLabel("Follow playhead")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await scrollPosition(page)).top).toBeGreaterThan(0);
});

test("split, delete and Undo retain a valid selection and stable song viewport", async ({ page }) => {
  const song = viewportSong("Edited viewport");
  await openFixture(page, song);
  await page.locator(".timeline-clip-body").filter({ hasText: "Viewport phrase" }).click();
  await page.getByLabel("Timeline zoom").fill("67");
  await scrollSong(page, 300, 120);
  await expect.poll(async () => (await savedViewport(page, song))?.scrollTop).toBe(120);
  const before = await savedViewport(page, song);
  await page.getByLabel("Song playhead", { exact: true }).fill(String(ticksPerBar(song) * 12));
  await page.getByLabel("Split clip at playhead", { exact: true }).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(3);
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(1);
  await page.getByLabel("Undo", { exact: true }).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(1);
  await page.getByLabel("Delete selected clip", { exact: true }).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(0);
  await page.getByLabel("Undo", { exact: true }).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  expect(await savedViewport(page, song)).toEqual(before);
  await page.locator(".timeline-clip-body").filter({ hasText: "Viewport phrase" }).click();
  await page.getByLabel("Fit selected clip or section", { exact: true }).click();
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(1);
  await expect(page.getByLabel("Play song", { exact: true })).toBeVisible();
});
