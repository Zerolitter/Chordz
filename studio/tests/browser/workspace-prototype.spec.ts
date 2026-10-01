import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

test("populated presets retain the same bounded song and selected phrase", async ({page}) => {
  const errors:string[]=[]; page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({width:1366,height:768});
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await expect(page.getByRole("button",{name:"01 Arrange",exact:true})).toHaveAttribute("aria-current","page");
  const canvas = page.getByRole("region", {name:"Song canvas",exact:true});
  await expect(canvas).toBeVisible();
  const clips=page.locator(".timeline-clip");
  expect(await clips.count()).toBeGreaterThan(8);
  await clips.first().click();
  await expect(page.locator(".clip-editor-metadata > summary")).toBeVisible();
  expect((await page.locator(".piano-roll-scroll").boundingBox())!.height).toBeGreaterThan(80);
  expect(await page.locator(".piano-roll-scroll").evaluate(roll => { const box=roll.getBoundingClientRect(); return [...roll.querySelectorAll(".roll-note")].some(note => {const rect=note.getBoundingClientRect();return rect.bottom>box.top && rect.top<box.bottom && rect.right>box.left && rect.left<box.right;}); })).toBe(true);
  const selected = await page.getByLabel("Clip name",{exact:true}).inputValue();
  await canvas.evaluate(node => node.setAttribute("data-persistent-probe","same-canvas"));
  mkdirSync("output/workspace-prototype",{recursive:true});
  for(const [name,mode] of [["01 Arrange","arrange"],["02 Write","write"],["03 Sound","sound"],["04 Mix","mix"]]) {
    await page.getByRole("button",{name,exact:true}).click();
    await expect(canvas).toHaveAttribute("data-persistent-probe","same-canvas");
    await expect(page.getByLabel("Stop song",{exact:true})).toBeInViewport();
    const box=(await canvas.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(220);
    expect(box.width).toBeGreaterThan(700);
    expect(box.y + box.height).toBeLessThanOrEqual(768);
    expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight)).toBe(true);
    await page.screenshot({path:`output/workspace-prototype/1366-${mode}.png`,animations:"disabled"});
  }
  await page.getByRole("tab",{name:"Notes / Audio",exact:true}).click();
  await expect(page.getByLabel("Clip name",{exact:true})).toHaveValue(selected);
  expect(errors).toEqual([]);
});

test("responsive presets retain transport, canvas and internal editor scrolling",async({page})=>{
  await page.goto("/"); await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.locator(".timeline-clip").first().click();
  for(const [width,height] of [[1920,1080],[1024,768],[390,844]]) {
    await page.setViewportSize({width,height});
    for(const [name,mode] of [["01 Arrange","arrange"],["02 Write","write"],["03 Sound","sound"],["04 Mix","mix"]]) {
      await page.getByRole("button",{name,exact:true}).click();
      await expect(page.getByLabel("Stop song",{exact:true})).toBeInViewport();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight)).toBe(true);
      const canvas=(await page.getByRole("region",{name:"Song canvas",exact:true}).boundingBox())!;
      expect(canvas.height).toBeGreaterThanOrEqual(width<700?160:220);
      await page.screenshot({path:`output/workspace-prototype/${width}-${mode}.png`,animations:"disabled"});
    }
    if(width<1100) {
      await page.getByLabel("Toggle assets panel").click();
      await expect(page.getByRole("complementary",{name:"Existing sounds and assets"})).toBeVisible();
      await expect(page.getByLabel("Stop song",{exact:true})).toBeInViewport();
      await page.getByLabel("Toggle assets panel").click();
    }
  }
});

test("empty initialization and reset keep layout separate from the music selection",async({page})=>{
  await page.goto("/"); await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button",{name:"Songs",exact:true}).click();
  await page.getByRole("button",{name:"Blank song",exact:true}).click();
  await expect(page.getByRole("button",{name:"01 Arrange",exact:true})).toHaveAttribute("aria-current","page");
  await expect(page.getByLabel("Expand detail dock")).toBeVisible();
  await page.getByRole("button",{name:"03 Sound",exact:true}).click();
  await expect(page.getByRole("tab",{name:"Sound",exact:true})).toHaveAttribute("aria-selected","true");
  await page.locator(".layout-options > summary").click();
  await page.getByLabel("Editor height").fill("65");
  await page.getByRole("button",{name:"Reset layout",exact:true}).click();
  await expect(page.getByLabel("Editor height")).toHaveValue("40");
  await expect(page.getByRole("tab",{name:"Sound",exact:true})).toHaveAttribute("aria-selected","true");
});

test("empty presets fit all acceptance viewports",async({page})=>{
  await page.goto("/"); await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button",{name:"Songs",exact:true}).click();
  await page.getByRole("button",{name:"Blank song",exact:true}).click();
  for(const [width,height] of [[1366,768],[1920,1080],[1024,768],[390,844]]) {
    await page.setViewportSize({width,height});
    for(const [name,mode] of [["01 Arrange","arrange"],["02 Write","write"],["03 Sound","sound"],["04 Mix","mix"]]) {
      await page.getByRole("button",{name,exact:true}).click();
      await expect(page.getByLabel("Stop song",{exact:true})).toBeInViewport();
      const box=(await page.getByRole("region",{name:"Song canvas",exact:true}).boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(width<700?160:220);
      expect(box.y+box.height).toBeLessThanOrEqual(height);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`output/workspace-prototype/${width}-${mode}-empty.png`,animations:"disabled"});
    }
  }
});

test("unavailable preference storage keeps the session usable and reports failure",async({page})=>{
  await page.addInitScript(()=>{
    const write=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){ if(key.startsWith("chordz-view-v2:") || key.startsWith("chordz-layout-v1:")) throw new DOMException("Full","QuotaExceededError"); return write.call(this,key,value); };
  });
  await page.goto("/"); await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button",{name:"03 Sound",exact:true}).click();
  await expect(page.locator(".workspace-preference-error")).toContainText("View preferences could not be saved");
  await page.getByLabel("Other detail tools").selectOption("keyboard");
  await expect(page.getByLabel("Play C3",{exact:true})).toBeVisible();
  await expect(page.locator(".workspace-preference-error")).toContainText("Layout preferences could not be saved");
  await expect(page.getByLabel("Stop song",{exact:true})).toBeInViewport();
});

test("resetting a Mix layout validates drafts before hiding its editor",async({page})=>{
  await page.goto("/"); await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button",{name:"04 Mix",exact:true}).click();
  await page.getByLabel("Other detail tools").selectOption("keyboard");
  await page.getByLabel("Beats per bar",{exact:true}).fill("");
  await page.locator(".layout-options > summary").click();
  await page.getByRole("button",{name:"Reset layout",exact:true}).click();
  await expect(page.getByLabel("Collapse detail dock")).toBeVisible();
  await expect(page.getByLabel("Other detail tools")).toHaveValue("keyboard");
  await expect(page.getByLabel("Beats per bar",{exact:true})).toHaveValue("");
  await page.getByLabel("Beats per bar",{exact:true}).press("Escape");
  await page.getByRole("button",{name:"Reset layout",exact:true}).click();
  await expect(page.getByLabel("Expand detail dock")).toBeVisible();
});
