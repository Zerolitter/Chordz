import {expect,test,type Page} from "@playwright/test";
import {mkdirSync,writeFileSync} from "node:fs";
import {encodeWav} from "../../lib/audio/wav";

async function blank(page:Page){
  await page.goto("/");await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button",{name:"Songs",exact:true}).click();
  await page.getByRole("button",{name:"Blank song",exact:true}).click();
}
async function audioDocument(page:Page){
  return page.evaluate(async()=>{
    const {latestDraft}=await import("/lib/client/storage.ts" as string);
    const document=(await latestDraft("guest"))!.document;
    const track=document.tracks.find((t:{kind:string})=>t.kind==="audio");
    return {track,assets:document.assets};
  });
}

test("imported audio exposes tuning and populated modulation at the user's desktop sizes",async({page})=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.setViewportSize({width:2560,height:1440});await blank(page);
  const samples=Float32Array.from({length:48000},(_,i)=>.1*Math.sin(2*Math.PI*220*i/48000));
  await page.getByText("Import audio / Inputs",{exact:true}).click();
  await page.getByLabel("Import audio file",{exact:true}).setInputFiles({name:"sample3.wav",mimeType:"audio/wav",buffer:Buffer.from(encodeWav([samples],48000,16))});
  await expect.poll(async()=>(await audioDocument(page)).track?.kind).toBe("audio");
  const original=await audioDocument(page);
  await page.getByRole("tab",{name:"Sound",exact:true}).click();
  await expect(page.locator(".audio-sound-body")).toBeVisible();
  await expect(page.getByRole("button",{name:"Open arrangement",exact:true})).toHaveCount(0);
  await expect(page.getByLabel("Track name",{exact:true})).toBeHidden();
  await expect(page.getByLabel("Filter cutoff value",{exact:true})).toBeVisible();
  await expect(page.locator(".audio-sound-body").getByLabel("Saturation value",{exact:true})).toBeVisible();
  await expect(page.locator(".instrument-envelope-graph")).toHaveCount(0);
  await expect(page.getByText("Sample mapping",{exact:true})).toHaveCount(0);
  const rack=page.getByRole("region",{name:"Selected track modulation rack"});
  await rack.getByLabel("Sound patch preset").selectOption("starter:pulse");
  await rack.getByLabel("Add modulation source").selectOption("lfo");
  await expect(rack.locator(".mod-source")).toHaveCount(2);await expect(rack.locator(".mod-route")).toHaveCount(5);
  // Match the expanded Arrange dock in the user's sample screenshot through its real layout control.
  await page.getByLabel("Workspace layout",{exact:true}).click();
  await page.getByLabel("Editor height",{exact:true}).fill("60");
  await page.getByLabel("Workspace layout",{exact:true}).click();
  mkdirSync("output/sound-workflow-layout",{recursive:true});
  const evidence=[];
  for(const [width,height] of [[2560,1440],[2555,1271]]){
    await page.setViewportSize({width,height});
    for(const mode of ["arrange","maximized"]){
      if(mode==="arrange"){await page.getByRole("navigation").getByRole("button",{name:"01 Arrange",exact:true}).click();await page.getByRole("tab",{name:"Sound",exact:true}).click();}
      else {await page.getByRole("navigation").getByRole("button",{name:"03 Sound",exact:true}).click();await page.getByLabel("Maximize editor",{exact:true}).click();}
      await page.locator(".detail-body").evaluate(element=>{element.scrollTop=0;});
      const devices=(await page.locator(".sound-devices").boundingBox())!,rackBounds=(await rack.boundingBox())!;
      expect(devices.width).toBeLessThanOrEqual(460);expect(rackBounds.width).toBeGreaterThan(1500);
      expect(rackBounds.x).toBeGreaterThanOrEqual(devices.x+devices.width+4);
      for(const source of await rack.locator(".mod-source").all()){
        const b=(await source.boundingBox())!;expect(b.width).toBeGreaterThanOrEqual(260);expect(b.width).toBeLessThanOrEqual(345);
        expect(b.y+b.height).toBeLessThanOrEqual(height-24);
      }
      await expect(page.getByRole("button",{name:"Assign",exact:true})).toBeInViewport();
      await expect(page.getByLabel("Stop song",{exact:true})).toBeInViewport();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      evidence.push({width,height,mode,devices,rack:rackBounds});
      await page.screenshot({path:`output/sound-workflow-layout/${width}-${mode}-audio.png`,animations:"disabled"});
      if(mode==="maximized")await page.getByLabel("Restore editor size",{exact:true}).click();
    }
  }
  const field=page.locator(".audio-sound-body").getByLabel("Saturation value",{exact:true}),before=await field.inputValue();
  await expect(rack.getByRole("button",{name:"Audition chord",exact:true})).toHaveCount(0);
  await rack.getByRole("button",{name:"Play song from Sound",exact:true}).click();await expect(rack.getByRole("button",{name:"Pause song from Sound",exact:true})).toBeVisible();
  await field.fill("0.25");await field.press("Enter");await expect(field).toHaveValue("0.25");
  await rack.getByRole("button",{name:"Pause song from Sound",exact:true}).click();await expect(rack.getByRole("button",{name:"Play song from Sound",exact:true})).toBeVisible();
  await page.getByLabel("Stop song",{exact:true}).click();
  await page.getByLabel("Undo",{exact:true}).click();await expect(field).toHaveValue(before);
  const after=await audioDocument(page);expect(after.assets).toEqual(original.assets);expect(after.track.clips).toEqual(original.track.clips);
  expect(after.track.modulation.sources).toHaveLength(2);expect(after.track.modulation.routes).toHaveLength(5);
  await page.getByRole("button",{name:"Audio editor",exact:true}).click();await expect(page.getByRole("tab",{name:"Notes / Audio",exact:true})).toHaveAttribute("aria-selected","true");
  await page.getByRole("tab",{name:"Sound",exact:true}).click();await expect(rack.locator(".mod-source")).toHaveCount(2);
  writeFileSync("output/sound-workflow-layout/audio-metrics.json",JSON.stringify({evidence,errors},null,2));expect(errors).toEqual([]);
});

test("optional sound details preserve rename history and keep invalid drafts visible",async({page})=>{
  await page.setViewportSize({width:2560,height:1440});await blank(page);
  await page.getByRole("tab",{name:"Sound",exact:true}).click();
  await expect(page.getByRole("button",{name:"Load sound",exact:true})).toBeVisible();
  const details=page.locator(".sound-details"),summary=details.locator("summary"),name=details.getByLabel("Track name",{exact:true});
  await expect(name).toBeHidden();await summary.click();await expect(name).toBeVisible();
  const original=await name.inputValue();await name.fill("Tuning piano");await name.press("Enter");
  await page.getByLabel("Undo",{exact:true}).click();await expect(name).toHaveValue(original);
  await page.getByLabel("Redo",{exact:true}).click();await expect(name).toHaveValue("Tuning piano");
  await name.fill("");await summary.click();await expect(details).toHaveAttribute("open","");await expect(name).toHaveValue("");
  await name.focus();await name.press("Escape");await expect(name).toHaveValue("Tuning piano");
  await summary.click();await expect(name).toBeHidden();await expect(page.getByLabel("Filter cutoff value",{exact:true})).toBeVisible();
  const rack=page.getByRole("region",{name:"Selected track modulation rack"});
  await rack.getByRole("button",{name:"Compare A/B",exact:true}).click();await rack.getByRole("button",{name:"B",exact:true}).click();
  await rack.getByLabel("Sound patch preset").selectOption("starter:pulse");await expect(rack.locator(".mod-route")).toHaveCount(5);
  await summary.click();await summary.click();await expect(rack.getByRole("button",{name:"Use B",exact:true})).toBeEnabled();
  await expect(rack.locator(".mod-route")).toHaveCount(5);await rack.getByRole("button",{name:"Cancel comparison",exact:true}).click();await expect(rack.locator(".mod-route")).toHaveCount(0);
  await expect(page.getByRole("status",{name:"Device draft status"})).toContainText("Device draft saved");
  await page.reload();await page.getByRole("tab",{name:"Sound",exact:true}).click();await summary.click();await expect(name).toHaveValue("Tuning piano");
});
