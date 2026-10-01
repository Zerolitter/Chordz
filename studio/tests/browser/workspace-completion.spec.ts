import { expect, test } from "@playwright/test";

test("detail tabs support arrow navigation and keep a rejected draft in its editor", async ({page}) => {
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.locator(".timeline-clip").first().click();
  const notes = page.getByRole("tab", {name:"Notes / Audio", exact:true});
  const sound = page.getByRole("tab", {name:"Sound", exact:true});
  await expect(notes).toHaveAttribute("tabindex", "0");
  await expect(sound).toHaveAttribute("tabindex", "-1");
  await notes.focus();
  await page.keyboard.press("ArrowRight");
  await expect(sound).toBeFocused();
  await expect(sound).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", {name:"Sound", exact:true})).toBeVisible();
  await page.keyboard.press("Home");
  await expect(notes).toBeFocused();
  const meter = page.getByLabel("Beats per bar", {exact:true});
  await meter.fill("");
  await notes.focus();
  await page.keyboard.press("ArrowRight");
  await expect(notes).toHaveAttribute("aria-selected", "true");
  await expect(notes).toBeFocused();
  await expect(meter).toHaveValue("");
  await meter.press("Escape");
  await notes.focus();
  await page.keyboard.press("End");
  await expect(sound).toHaveAttribute("aria-selected", "true");
});

test("narrow assets and layout popovers have Escape routes without stopping the song", async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", {name:"Songs", exact:true}).click();
  await page.getByRole("button", {name:"Blank song", exact:true}).click();
  const toggle = page.getByLabel("Toggle assets panel");
  const assets = page.getByRole("complementary", {name:"Existing sounds and assets"});
  await toggle.click();
  await page.getByRole("button", {name:"Glass FM Synthesizers", exact:true}).click();
  await page.getByRole("button", {name:"Use on selected track", exact:true}).click();
  await page.getByRole("button", {name:"Import audio / Inputs", exact:true}).click();
  await expect(assets).not.toBeVisible();
  await expect(page.getByLabel("Play C3", {exact:true})).toBeVisible();
  await page.getByLabel("Play song", {exact:true}).click();
  await expect(page.getByLabel("Pause song", {exact:true})).toBeVisible();
  await toggle.click();
  const catalog = page.getByRole("button", {name:"Glass FM Synthesizers", exact:true});
  await catalog.focus();
  await page.keyboard.press("Escape");
  await expect(assets).not.toBeVisible();
  await expect(toggle).toBeFocused();
  await expect(page.getByLabel("Pause song", {exact:true})).toBeVisible();
  const layout = page.getByLabel("Workspace layout", {exact:true});
  await layout.click();
  await page.getByLabel("Editor height").focus();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Editor height")).not.toBeVisible();
  await expect(layout).toBeFocused();
  await expect(page.getByLabel("Pause song", {exact:true})).toBeVisible();
  await toggle.click();
  await page.getByRole("button", {name:"04 Mix", exact:true}).click();
  await expect(assets).not.toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("failed layout writes retain independent song profiles for the session", async ({page}) => {
  await page.addInitScript(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if(key.startsWith("chordz-layout-v1:")) throw new DOMException("Full", "QuotaExceededError");
      return write.call(this, key, value);
    };
  });
  await page.goto("/signin-with-chatgpt?return_to=/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  const names = [`Layout A ${Date.now()}`, `Layout B ${Date.now()}`];
  for(const [index, name] of names.entries()) {
    await page.getByRole("button", {name:"Songs", exact:true}).click();
    await page.getByRole("button", {name:"Blank song", exact:true}).click();
    await page.getByLabel("Song title").fill(name);
    await page.getByLabel("Song title").press("Enter");
    await page.getByRole("button", {name:"03 Sound", exact:true}).click();
    await page.getByLabel("Workspace layout").click();
    await page.getByLabel("Editor height").fill(index === 0 ? "65" : "25");
    await expect(page.locator(".workspace-preference-error")).toContainText("Layout preferences could not be saved");
    await page.getByLabel("Workspace layout").press("Escape");
    await page.keyboard.press("Control+s");
    await expect(page.getByText("Saved to cloud", {exact:true})).toBeVisible();
  }
  for(const [index, name] of names.entries()) {
    await page.getByRole("button", {name:"Songs", exact:true}).click();
    await page.getByRole("button", {name:new RegExp(`^${name}`)}).click();
    await expect(page.getByLabel("Song title")).toHaveValue(name);
    await expect(page.getByRole("button", {name:"03 Sound", exact:true})).toHaveAttribute("aria-current", "page");
    await page.getByLabel("Workspace layout").click();
    await expect(page.getByLabel("Editor height")).toHaveValue(index === 0 ? "65" : "25");
    await page.getByLabel("Workspace layout").press("Escape");
  }
});

test("maximizing an editor cannot hide a mixer with a rejected numeric draft", async ({page}) => {
  await page.setViewportSize({width:1920,height:1080});
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", {name:"04 Mix", exact:true}).click();
  await page.getByLabel("Other detail tools").selectOption("keyboard");
  const pan = page.getByLabel("Grand piano pan value", {exact:true});
  await expect(pan).toBeVisible();
  const before = await page.locator(".detail-body").boundingBox();
  await pan.fill("");
  await page.getByLabel("Maximize editor", {exact:true}).click();
  await expect(pan).toBeVisible();
  await expect(pan).toHaveValue("");
  await expect(page.getByLabel("Maximize editor", {exact:true})).toBeVisible();
  await pan.press("Escape");
  await page.getByLabel("Maximize editor", {exact:true}).click();
  await expect(pan).not.toBeVisible();
  await expect(page.getByLabel("Restore editor size", {exact:true})).toBeVisible();
  expect((await page.locator(".detail-body").boundingBox())!.height).toBeGreaterThan(before!.height);
});
