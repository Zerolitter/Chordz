import { expect, test, type Page } from "@playwright/test";
import { encodeWav } from "../../lib/audio/wav";

function fixture(seconds = 8) {
  const rate = 12000, left = new Float32Array(rate * seconds), right = new Float32Array(left.length);
  for (const start of [1, 5]) for (let i = 0; i < rate && start * rate + i < left.length; i++) {
    left[start * rate + i] = .4 * Math.sin(2 * Math.PI * 440 * i / rate);
    right[start * rate + i] = -.2 * Math.sin(2 * Math.PI * 440 * i / rate);
  }
  return Buffer.from(encodeWav([left, right], rate));
}
async function openRefinement(page: Page) {
  await page.goto("/"); await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Blank song", exact: true }).click();
  await page.getByRole("navigation").getByRole("button", { name: "03 Sound" }).click();
  await page.getByLabel("Other detail tools").selectOption("reference");
  const reference = page.getByRole("region", { name: "Reference analysis", exact: true });
  await reference.getByLabel("Reference audio", { exact: true }).setInputFiles({ name: "private-refinement.wav", mimeType: "audio/wav", buffer: fixture() });
  const panel = page.getByRole("region", { name: "Sample refinement", exact: true });
  await expect(panel.getByRole("button", { name: "Keep as mixed texture", exact: true })).toBeEnabled();
  return panel;
}
async function library(page: Page) {
  return page.evaluate(() => new Promise<{ name: string; kind: string; assets: number; channels: number[]; status?: string; root?: number }[]>(resolve => {
    const request = indexedDB.open("chordz-library-v1", 1);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("entries")) { db.close(); resolve([]); return; }
      const entries = db.transaction("entries").objectStore("entries").getAll();
      entries.onsuccess = () => { db.close(); resolve(entries.result.map(record => ({ name: record.entry.name, kind: record.entry.kind, assets: record.entry.assets.length, channels: record.entry.assets.map((a: { channels: number }) => a.channels), status: record.entry.refinement?.provenance.status, root: record.entry.sound.instrument.zones[0]?.root }))); };
    };
  }));
}

test("mixed snippets require audition, remain honestly labeled, and retain separate original audio across reload", async ({ page }) => {
  const errors: string[] = [], posted: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.method() === "POST") posted.push(request.url()); });
  const panel = await openRefinement(page);
  await expect(panel.getByRole("button", { name: "Extract selected sound", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "Keep as mixed texture", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Save mixed texture", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "Extracted / natural", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Save mixed texture", exact: true })).toBeEnabled();
  await panel.getByLabel("Library sample name", { exact: true }).fill("Honest mixed texture");
  await panel.getByRole("button", { name: "Save mixed texture", exact: true }).click();
  await expect.poll(() => library(page)).toEqual([{ name: "Honest mixed texture", kind: "audio", assets: 2, channels: [2, 2], status: "mixed-texture" }]);
  await panel.getByText("Make a playable sampled instrument", { exact: true }).click();
  await expect(panel.getByRole("button", { name: "Save sampled instrument", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "Insert saved sample on a new track", exact: true }).click();
  await expect(page.getByRole("button", { name: "Select Honest mixed texture", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Honest mixed texture Mixed texture", exact: true })).toHaveCount(0);
  await page.getByLabel("Undo", { exact: true }).click();
  await page.reload(); await expect(page.getByLabel("Song title")).toBeEnabled();
  expect((await library(page))[0]).toMatchObject({ name: "Honest mixed texture", assets: 2, status: "mixed-texture" });
  expect(posted.filter(url => url.includes("/api/assets") || url.includes("47831"))).toEqual([]);
  expect(errors).toEqual([]);
});

test("the shipped streaming worker finds repeated stereo material without changing the selection until chosen", async ({ page }) => {
  const panel = await openRefinement(page);
  await panel.getByLabel("Sample start", { exact: true }).fill("1");
  await panel.getByLabel("Sample end", { exact: true }).fill("2");
  await panel.getByRole("button", { name: "Find similar moments", exact: true }).click();
  await expect(panel.getByLabel("Similar sample moments")).toBeVisible();
  await expect(panel.getByLabel("Sample start", { exact: true })).toHaveValue("1");
  const match = panel.getByLabel("Similar sample moments").getByRole("button").first();
  await expect(match).toContainText(/0:0[45]/);
  await match.click();
  expect(Number(await panel.getByLabel("Sample start", { exact: true }).inputValue())).toBeGreaterThan(4);
});

test("synthetic local-engine contract supports review and a manually rooted sample without claiming model quality", async ({ page }) => {
  let audio: Buffer | null = null, deleted = 0;
  const calls: string[] = [];
  await page.route("http://127.0.0.1:47831/**", async route => {
    const request = route.request(), url = new URL(request.url()); calls.push(request.method() + " " + url.pathname);
    expect(request.headers().authorization).toBe("Bearer " + "x".repeat(32));
    if (url.pathname === "/v1/capabilities") return route.fulfill({ json: { version: 1, maxSeconds: 24, models: [{ id: "htdemucs", ready: true, targets: ["drums", "bass", "vocals", "other"] }] } });
    const id = url.pathname.split("/")[3];
    if (request.method() === "POST") { audio = request.postDataBuffer(); return route.fulfill({ status: 202, json: { id, state: "queued" } }); }
    if (request.method() === "DELETE") { deleted++; return route.fulfill({ json: { id, state: "cancelled" } }); }
    if (url.pathname.endsWith("/audio")) return route.fulfill({ contentType: "audio/wav", body: audio! });
    return route.fulfill({ json: { id, state: "complete" } });
  });
  const panel = await openRefinement(page);
  await panel.getByLabel("Sample start", { exact: true }).fill("1");
  await panel.getByLabel("Sample end", { exact: true }).fill("2");
  await panel.getByLabel("Sound to keep", { exact: true }).selectOption("bass");
  await panel.locator(".sample-engine summary").click();
  await panel.getByLabel("Engine session token", { exact: true }).fill("x".repeat(32));
  await panel.getByRole("button", { name: "Connect local engine", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Extract selected sound", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "Extract selected sound", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Residual", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Refined", exact: true }).click();
  const review = panel.getByLabel("I checked for remaining instruments and damaged attacks or tails.", { exact: true });
  await expect(review).toBeEnabled(); await review.check();
  await panel.getByText("Make a playable sampled instrument", { exact: true }).click();
  await panel.getByLabel("I hear one isolated note or hit, not a chord.", { exact: true }).check();
  await panel.getByLabel("Sample root MIDI note", { exact: true }).fill("47");
  await panel.getByLabel("Library sample name", { exact: true }).fill("Reviewed fixture note");
  await panel.getByRole("button", { name: "Save sampled instrument", exact: true }).click();
  await expect.poll(() => library(page)).toEqual([{ name: "Reviewed fixture note", kind: "sound", assets: 2, channels: [2, 2], status: "approved", root: 47 }]);
  expect(deleted).toBe(1); expect(calls.some(call => call.startsWith("POST"))).toBe(true);
  await page.reload(); await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByLabel("Other detail tools").selectOption("reference");
  const reference = page.getByRole("region", { name: "Reference analysis", exact: true });
  await reference.getByLabel("Reference audio", { exact: true }).setInputFiles({ name: "fresh.wav", mimeType: "audio/wav", buffer: fixture() });
  await page.locator(".sample-engine summary").click();
  await expect(page.getByLabel("Engine session token", { exact: true })).toHaveValue("");
});

test("invalid sample ranges cannot be extracted or saved", async ({ page }) => {
  const panel = await openRefinement(page);
  await panel.getByLabel("Sample end", { exact: true }).fill("99");
  await expect(panel.getByRole("button", { name: "Keep as mixed texture", exact: true })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Find similar moments", exact: true })).toBeDisabled();
  await panel.getByLabel("Sample end", { exact: true }).fill("");
  await expect(panel.getByRole("button", { name: "Hear source", exact: true })).toBeDisabled();
});
