import { test, expect, type Page } from "@playwright/test";

async function sound(page: Page) {
  await page.goto("/"); await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button", {name:"Songs",exact:true}).click();
  await page.getByRole("button", {name:"Blank song",exact:true}).click();
  await page.getByRole("navigation").getByRole("button", {name:"03 Sound"}).click();
  return page.getByRole("region", {name:"Selected track modulation rack"});
}
async function savedRoutes(page: Page) {
  return page.evaluate(async()=>{
    const {latestDraft}=await import("/lib/client/storage.ts" as string);
    const draft=await latestDraft("guest");return draft?.document.tracks[0].modulation?.routes.length??0;
  });
}

test("graph and invalid numeric rollback preserve their surrounding A/B audition until Apply",async({page})=>{
  const rack=await sound(page);await expect.poll(()=>savedRoutes(page)).toBe(0);
  await rack.getByRole("button",{name:"Compare A/B",exact:true}).click();
  await rack.getByRole("button",{name:"B",exact:true}).click();
  await rack.getByLabel("Sound patch preset").selectOption("starter:pulse");
  const handle=rack.getByRole("slider",{name:"Pulse amplitude graph handle",exact:true});
  await expect(handle).toHaveAttribute("aria-valuenow","0.5");
  await handle.focus();await page.keyboard.down("ArrowDown");
  await expect(handle).toHaveAttribute("aria-valuenow","0.49");
  await page.keyboard.press("Escape");await page.keyboard.up("ArrowDown");
  await expect(handle).toHaveAttribute("aria-valuenow","0.5");
  await expect(rack.locator(".mod-route")).toHaveCount(5);
  const box=(await handle.boundingBox())!,x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y-12,{steps:3});
  await expect(handle).not.toHaveAttribute("aria-valuenow","0.5");
  await page.keyboard.press("Escape");await page.mouse.move(x,y-20);await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow","0.5");
  await expect(rack.locator(".mod-route")).toHaveCount(5);
  const numeric=rack.getByLabel("M1 amount value",{exact:true});
  await numeric.fill("");await expect(numeric).toHaveAttribute("aria-invalid","true");
  await numeric.press("Escape");await expect(numeric).toHaveValue("0");
  await expect(rack.getByRole("button",{name:"Use B",exact:true})).toBeEnabled();
  await handle.press("ArrowDown");await expect(handle).toHaveAttribute("aria-valuenow","0.49");
  await page.waitForTimeout(700);expect(await savedRoutes(page)).toBe(0);
  await rack.getByRole("button",{name:"Use B",exact:true}).click();
  await expect.poll(()=>savedRoutes(page)).toBe(5);
  await page.getByLabel("Undo",{exact:true}).click();await expect(rack.locator(".mod-route")).toHaveCount(0);
  await page.getByLabel("Redo",{exact:true}).click();await expect(rack.locator(".mod-route")).toHaveCount(5);
  await expect(handle).toHaveAttribute("aria-valuenow","0.49");
});

test("envelope and fixed-grid step graph edits create one undoable musical change",async({page})=>{
  const rack=await sound(page);
  await rack.getByLabel("Add modulation source").selectOption("envelope");
  const attack=rack.getByRole("slider",{name:"Envelope 1 attack graph handle",exact:true});
  const before=await attack.getAttribute("aria-valuenow");
  await attack.focus();await page.keyboard.down("ArrowRight");
  await page.keyboard.press("ArrowRight");await page.keyboard.up("ArrowRight");
  const changed=await attack.getAttribute("aria-valuenow");expect(changed).not.toBe(before);
  await page.getByLabel("Undo",{exact:true}).click();await expect(attack).toHaveAttribute("aria-valuenow",before!);
  await page.getByLabel("Redo",{exact:true}).click();await expect(attack).toHaveAttribute("aria-valuenow",changed!);
  await rack.getByLabel("Add modulation source").selectOption("step");
  const step=rack.getByRole("slider",{name:"Step sequencer 2 step 1 graph handle",exact:true});
  const time=await step.getAttribute("cx"),value=await step.getAttribute("aria-valuenow");
  await step.press("ArrowDown");expect(await step.getAttribute("aria-valuenow")).not.toBe(value);
  await expect(step).toHaveAttribute("cx",time!);
  await page.getByLabel("Undo",{exact:true}).click();await expect(step).toHaveAttribute("aria-valuenow",value!);
});

test("Mix accepts same-track parameter drops and rejects a different track identity",async({page})=>{
  const rack=await sound(page);
  const identity=await rack.locator('.macro-label [draggable="true"]').first().evaluate(element=>{
    const data=new DataTransfer();element.dispatchEvent(new DragEvent("dragstart",{bubbles:true,dataTransfer:data}));
    return data.getData("application/x-chordz-track-id");
  });
  expect(identity).not.toBe("");
  await page.getByRole("navigation").getByRole("button",{name:"04 Mix"}).click();
  const destination=page.locator(".mixer-channel").first().locator(".daw-knob").first();
  async function drop(origin:string){await destination.evaluate((element,origin)=>{
    const data=new DataTransfer();data.setData("application/x-chordz-mod-source","M1");data.setData("application/x-chordz-track-id",origin);
    element.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:data}));
  },origin);}
  await drop("different-track");await expect(page.getByRole("alert").filter({hasText:"Assign a source from this track."})).toBeVisible();
  expect(await savedRoutes(page)).toBe(0);
  await drop(identity);await expect.poll(()=>savedRoutes(page)).toBe(1);
  await page.getByRole("navigation").getByRole("button",{name:"03 Sound"}).click();
  await expect(rack.locator(".mod-route")).toHaveCount(1);
  await expect(rack.getByRole("button",{name:/Track pan/}).first()).toBeVisible();
});
