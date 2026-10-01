import {test,expect,type Page} from "@playwright/test";
import type {ProjectDocument} from "../../lib/music/types";

async function selectedSound(page:Page){
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button",{name:"Glass FM Synthesizers",exact:true}).click();
  await page.getByRole("button",{name:"Use on selected track",exact:true}).click();
  await expect(page.locator(".library-browser .library-message")).toContainText("Glass FM replaced.");
  await expect.poll(()=>page.evaluate(async()=>{
    const {latestDraft}=await import("/lib/client/storage.ts" as string);
    return (await latestDraft("guest"))?.document.tracks[0].sound.algorithm;
  })).toBe("fm");
  await page.locator(".timeline-clip-body").first().click();
  await page.getByRole("tab",{name:"Sound",exact:true}).click();
}

test("automating a sound control opens its exact lane without changing the selected phrase or musical history",async({page})=>{
  await selectedSound(page);
  const before=await page.evaluate(async()=>{
    const {latestDraft}=await import("/lib/client/storage.ts" as string);
    return JSON.stringify((await latestDraft("guest"))?.document);
  });
  const selected=await page.locator(".timeline-clip.selected .timeline-clip-body").getAttribute("title");
  await page.getByRole("button",{name:"Automate Filter cutoff",exact:true}).click();
  await expect(page.getByLabel("Automation parameter")).toHaveValue("cutoff");
  await expect(page.locator(".song-canvas")).toBeVisible();
  await expect(page.locator(".timeline-clip.selected .timeline-clip-body")).toHaveAttribute("title",selected!);
  await expect(page.getByLabel("Stop song",{exact:true})).toBeVisible();
  await page.waitForTimeout(350);
  expect(await page.evaluate(async()=>{
    const {latestDraft}=await import("/lib/client/storage.ts" as string);
    return JSON.stringify((await latestDraft("guest"))?.document);
  })).toBe(before);
  await page.getByRole("button",{name:"+ Point at playhead",exact:true}).click();
  await expect(page.locator(".automation-point")).toHaveCount(1);
  await page.getByRole("tab",{name:"Sound",exact:true}).click();
  await expect(page.getByRole("button",{name:"Automate Filter cutoff",exact:true})).toContainText("Automated");
  await page.getByLabel("Undo",{exact:true}).click();
  await expect(page.getByRole("button",{name:"Automate Filter cutoff",exact:true})).toContainText("Automate");
});

test("mixer automation uses the addressed track and its current pan or send value",async({page})=>{
  await selectedSound(page);
  await page.getByRole("navigation").getByRole("button",{name:"04 Mix",exact:true}).click();
  const channel=page.locator(".mixer-channel").nth(1);
  const name=await channel.locator(".channel-title").innerText();
  const pan=channel.getByLabel(name+" pan value",{exact:true});
  await pan.fill("0.37");await pan.press("Enter");
  await channel.getByRole("button",{name:"Automate "+name+" pan",exact:true}).click();
  await expect(page.getByLabel("Automation parameter")).toHaveValue("pan");
  await expect(page.locator(".song-track-header.selected .track-select")).toHaveAttribute("aria-label","Select "+name);
  await page.getByRole("button",{name:"+ Point at playhead",exact:true}).click();
  await expect(page.getByLabel("Automation point 1 value")).toHaveValue("0.37");
  await page.getByRole("navigation").getByRole("button",{name:"04 Mix",exact:true}).click();
  const send=channel.getByLabel(name+" reverb value",{exact:true});
  await send.fill("0.23");await send.press("Enter");
  await channel.getByRole("button",{name:"Automate "+name+" reverb",exact:true}).click();
  await expect(page.getByLabel("Automation parameter")).toHaveValue("reverb");
  await page.getByRole("button",{name:"+ Point at playhead",exact:true}).click();
  await expect(page.getByLabel("Automation point 1 value")).toHaveValue("0.23");
});

test("an invalid sound draft blocks automation navigation and Escape restores the route",async({page})=>{
  await selectedSound(page);
  const cutoff=page.getByLabel("Filter cutoff value",{exact:true});
  await cutoff.fill("invalid");
  await page.getByRole("button",{name:"Automate Filter cutoff",exact:true}).click();
  await expect(page.getByRole("tab",{name:"Sound",exact:true})).toHaveAttribute("aria-selected","true");
  await expect(cutoff).toHaveAttribute("aria-invalid","true");
  await cutoff.press("Escape");
  await page.getByRole("button",{name:"Automate Filter cutoff",exact:true}).click();
  await expect(page.getByLabel("Automation parameter")).toHaveValue("cutoff");
});

test("closing automation releases captured drags before validation and preserves only their owned preview",async({page})=>{
  await selectedSound(page);
  await page.getByRole("button",{name:"Automate Filter cutoff",exact:true}).click();
  await page.getByRole("button",{name:"+ Point at playhead",exact:true}).click();
  const pointBar=page.getByLabel("Automation point 1 bar",{exact:true});
  await pointBar.fill("2");await pointBar.press("Enter");
  const value=page.getByLabel("Automation point 1 value",{exact:true});
  const originalValue=await value.inputValue(),originalBar=await pointBar.inputValue();
  const graph=page.getByLabel("cutoff automation curve",{exact:true});
  async function beginDrag(){
    const point=(await page.locator(".automation-point").boundingBox())!;
    const curve=(await graph.boundingBox())!;
    const x=point.x+point.width/2,y=point.y+point.height/2;
    await page.mouse.move(x,y);await page.mouse.down();
    await page.mouse.move(x+curve.width*.06,Math.min(curve.y+curve.height-8,y+12),{steps:4});
    expect(await graph.evaluate(element=>element.hasPointerCapture(1))).toBe(true);
    return {x,y};
  }
  const savedDocument=()=>page.evaluate(async()=>{
    const {latestDraft}=await import("/lib/client/storage.ts" as string);
    return (await latestDraft("guest"))?.document as ProjectDocument|undefined;
  });
  const first=await beginDrag();
  const committedValue=await value.inputValue(),committedBar=await pointBar.inputValue();
  expect(committedValue).not.toBe(originalValue);
  // A programmatic click leaves the actual mouse pointer held and captured.
  await page.getByLabel("Collapse detail dock",{exact:true}).evaluate(element=>(element as HTMLButtonElement).click());
  expect(await graph.evaluate(element=>element.hasPointerCapture(1))).toBe(false);
  await expect(page.getByLabel("Expand detail dock",{exact:true})).toBeVisible();
  await expect.poll(async()=>(await savedDocument())?.tracks[0].automation.find(lane=>lane.parameter==="cutoff")?.points[0].value).toBe(Number(committedValue));
  const afterOwnedClose=await savedDocument();
  // Explicit late events exercise the old SVG handlers even while it is hidden.
  for(const type of ["pointermove","pointerup"]){
    await graph.evaluate((element,{type,x,y})=>element.dispatchEvent(new PointerEvent(type,{pointerId:1,pointerType:"mouse",buttons:type==="pointermove"?1:0,clientX:x,clientY:y,bubbles:true})),{type,x:first.x+160,y:first.y+28});
  }
  await page.mouse.up();
  await page.getByLabel("Expand detail dock",{exact:true}).click();
  await expect(value).toHaveValue(committedValue);await expect(pointBar).toHaveValue(committedBar);
  expect(await savedDocument()).toEqual(afterOwnedClose);
  await page.getByLabel("Undo",{exact:true}).click();
  await expect(value).toHaveValue(originalValue);await expect(pointBar).toHaveValue(originalBar);
  await page.getByLabel("Redo",{exact:true}).click();await expect(value).toHaveValue(committedValue);

  const second=await beginDrag();
  const secondValue=await value.inputValue(),secondBar=await pointBar.inputValue();
  expect(secondValue).not.toBe(committedValue);
  // A different field commits the valid drag; closing must leave its invalid draft intact.
  const meter=page.getByLabel("Beats per bar",{exact:true});await meter.fill("");
  await expect(meter).toHaveValue("");
  await expect.poll(async()=>(await savedDocument())?.tracks[0].automation.find(lane=>lane.parameter==="cutoff")?.points[0].value).toBe(Number(secondValue));
  const beforeBlockedClose=await savedDocument();
  await page.getByLabel("Collapse detail dock",{exact:true}).evaluate(element=>(element as HTMLButtonElement).click());
  expect(await graph.evaluate(element=>element.hasPointerCapture(1))).toBe(false);
  await expect(page.getByLabel("Collapse detail dock",{exact:true})).toBeVisible();
  await expect(graph).toBeVisible();await expect(meter).toHaveValue("");
  for(const type of ["pointermove","pointerup"]){
    await graph.evaluate((element,{type,x,y})=>element.dispatchEvent(new PointerEvent(type,{pointerId:1,pointerType:"mouse",buttons:type==="pointermove"?1:0,clientX:x,clientY:y,bubbles:true})),{type,x:second.x+160,y:second.y+28});
  }
  await page.mouse.up();
  await expect(value).toHaveValue(secondValue);await expect(pointBar).toHaveValue(secondBar);
  await expect(meter).toHaveValue("");
  await meter.press("Escape");await expect(meter).toHaveValue("4");
  expect(await savedDocument()).toEqual(beforeBlockedClose);
});
