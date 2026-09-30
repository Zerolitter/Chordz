import { test, expect } from "@playwright/test";
import { encodeWav } from "../../lib/audio/wav";

test("conflict recovery keeps audio that has not reached the cloud", async ({
  page,
}) => {
  await page.goto("/signin-with-chatgpt?return_to=/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Blank song" }).click();
  const title = "Pending conflict " + Date.now();
  await page.getByLabel("Song title").fill(title);
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const document = route.request().postDataJSON();
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Another device saved",
        details: {
          current: {
            document,
            revision: 1,
            updatedAt: new Date().toISOString(),
          },
          conflictId: "simulated-interrupted-create",
        },
      }),
    });
  });
  await page
    .getByLabel("Import audio file", { exact: true })
    .setInputFiles({
      name: "Pending audio.wav",
      mimeType: "audio/wav",
      buffer: Buffer.from(
        encodeWav([new Float32Array(4800).fill(0.05)], 48000),
      ),
    });
  await page.getByLabel("Save song", { exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Both versions are safe" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open the cloud version" }).click();
  await page.unroute("**/api/projects");
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page
    .getByRole("button", { name: "Recovery versions", exact: true })
    .click();
  await page
    .locator(".recovery-version")
    .filter({ hasText: title + " · recovered copy" })
    .click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "02 Arrange" })
    .click();
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
  await page.getByLabel("Save song", { exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("Saved to cloud");
});

test("anonymous idea survives sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  const title = "Device idea " + Date.now();
  await page.getByLabel("Song title").fill(title);
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Song title")).toHaveValue(title);
  await page.getByLabel("Save song", { exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("Saved to cloud");
});

test("failed upload keeps a device draft and retries with its original asset", async ({
  page,
}) => {
  await page.goto("/signin-with-chatgpt?return_to=/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Blank song" }).click();
  await page.route("**/api/assets", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Upload interrupted" }),
    }),
  );
  const samples = new Float32Array(4800).fill(0.05);
  await page
    .getByLabel("Import audio file", { exact: true })
    .setInputFiles({
      name: "Recovery take.wav",
      mimeType: "audio/wav",
      buffer: Buffer.from(encodeWav([samples], 48000)),
    });
  await expect(page.getByLabel("Clip name")).toHaveValue("Recovery take.wav");
  await page.getByLabel("Save song", { exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Upload interrupted");
  await page.waitForTimeout(350);
  await page.reload();
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "02 Arrange" })
    .click();
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
  await page.unroute("**/api/assets");
  await page.getByLabel("Save song", { exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("Saved to cloud");
});

test("acoustic sample roots sound A4 within normal recorded tuning", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { StudioEngine } = await import("/lib/audio/engine.ts" as string),
      { createProject, createTrack, emptyClip } = await import(
        "/lib/music/project.ts" as string
      );
    const p = createProject();
    p.tracks = ["piano", "strings", "cello", "horn", "flute", "glock"].map(
      (id) => {
        const t = createTrack(id, id);
        t.volume = 0;
        t.reverb = 0;
        t.sound.detune = 0;
        t.sound.cutoff = 18000;
        t.sound.attack = 0.005;
        t.sound.decay = 0.01;
        t.sound.sustain = 1;
        t.clips = [
          {
            ...emptyClip(0, 3840),
            notes: [
              {
                id: "tuning",
                pitch: 69,
                tick: 0,
                duration: 1920,
                velocity: 0.8,
              },
            ],
          },
        ];
        return t;
      },
    );
    const e = new StudioEngine(p, async () => {
        throw Error("asset");
      }),
      report = [];
    for (const t of p.tracks) {
      const buffer = await e.render(p, t.id, 1.5),
        data = buffer.getChannelData(0);
      const energies = [220, 440, 880].map((center) => {
        let peak = 0,
          freq = 0;
        for (let f = center - 12; f <= center + 12; f += 2) {
          let re = 0,
            im = 0;
          for (let n = 0; n < 8192; n++) {
            const v =
                data[n + 8000] *
                (0.5 - 0.5 * Math.cos((n / 8191) * Math.PI * 2)),
              angle = ((n * f) / buffer.sampleRate) * Math.PI * 2;
            re += v * Math.cos(angle);
            im += v * Math.sin(angle);
          }
          const a = Math.hypot(re, im);
          if (a > peak) {
            peak = a;
            freq = f;
          }
        }
        return { freq, peak };
      });
      report.push({ id: t.instrumentId, energies });
    }
    e.dispose();
    return report;
  });
  for (const instrument of result) {
    const strongest = [...instrument.energies].sort(
      (a, b) => b.peak - a.peak,
    )[0];
    expect(Math.abs(strongest.freq - 440), instrument.id).toBeLessThan(8);
  }
});
