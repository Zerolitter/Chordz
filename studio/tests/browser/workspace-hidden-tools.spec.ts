import { expect, test, type Page } from "@playwright/test";

async function watchToolWork(page: Page) {
  const session = await page.context().newCDPSession(page);
  const calls = { graphs: 0, generation: 0, audition: 0 };
  const breakpoints = new Map<string, keyof typeof calls>();
  const scripts: { scriptId: string; url: string }[] = [];
  session.on("Debugger.scriptParsed", script => scripts.push(script));
  session.on("Debugger.paused", event => {
    for (const id of event.hitBreakpoints ?? []) {
      const key = breakpoints.get(id); if (key) calls[key]++;
    }
    void session.send("Debugger.resume");
  });
  await session.send("Debugger.enable");
  for (const [key, module, name] of [
    ["graphs", "/source-graph-math.ts", "sourceGraphPoints"],
    ["generation", "/generate.ts", "generatePart"],
    ["audition", "/use-studio.tsx", "audition"],
  ] as const) {
    const candidates = scripts.filter(script => script.url.includes(module));
    if (!candidates.length) throw new Error(`Could not inspect the loaded ${name} script.`);
    for (const script of candidates) {
      const { scriptSource } = await session.send("Debugger.getScriptSource", { scriptId: script.scriptId });
      const lineNumber = scriptSource.split("\n").findIndex(line => line.includes(`function ${name}(`)) + 1;
      if (!lineNumber) throw new Error(`Could not inspect ${name}.`);
      const { breakpointId } = await session.send("Debugger.setBreakpoint", { location: { scriptId: script.scriptId, lineNumber } });
      breakpoints.set(breakpointId, key);
    }
  }
  return { calls, close: async () => { await session.send("Debugger.disable"); await session.detach(); } };
}

test("retained hidden tools suspend graph and phrase computation, then resume on reveal", async ({ page }) => {
  const graphErrors: string[] = [];
  page.on("console", message => { if (message.type() === "error" && message.text().includes("<path> attribute d")) graphErrors.push(message.text()); });
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  const work = await watchToolWork(page);
  try {
    for (let index = 0; index < 5; index++) await page.getByLabel("Song title").fill(`Hidden tool work ${index}`);
    const hidden = { ...work.calls };
    await test.info().attach("hidden-tool-work.json", { body: JSON.stringify(hidden), contentType: "application/json" });
    expect(hidden).toEqual({ graphs: 0, generation: 0, audition: 0 });
    await page.getByRole("button", { name: "Writing", exact: true }).click();
    await expect.poll(() => work.calls.generation).toBeGreaterThan(0);
    await page.getByRole("tab", { name: "Sound", exact: true }).click();
    await expect.poll(() => work.calls.graphs).toBeGreaterThan(0);
    expect(graphErrors).toEqual([]);
  } finally { await work.close(); }
});

test("hidden Writing and Lyrics do not audition chord Undo and Redo under the Write preset", async ({ page }) => {
  await page.goto("/"); await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", { name: "Glass FM Synthesizers", exact: true }).click();
  await page.getByRole("button", { name: "Use on selected track", exact: true }).click();
  await page.getByRole("navigation").getByRole("button", { name: "02 Write", exact: true }).click();
  await page.locator(".chord-select").first().click();
  await page.getByRole("button", { name: "Next inversion", exact: true }).click();
  await page.getByRole("tab", { name: "Sound", exact: true }).click();
  const work = await watchToolWork(page);
  try {
    await page.getByLabel("Undo", { exact: true }).click();
    await expect(page.getByRole("tab", { name: "Sound", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.getByLabel("Other detail tools").selectOption("lyrics");
    await page.getByLabel("Redo", { exact: true }).click();
    await expect(page.getByLabel("Section lyrics", { exact: true })).toBeVisible();
    expect(work.calls.audition).toBe(0);
    await page.getByRole("button", { name: "Writing", exact: true }).click();
    await page.getByLabel("Undo", { exact: true }).click();
    await expect.poll(() => work.calls.audition).toBeGreaterThan(0);
  } finally { await work.close(); }
});
