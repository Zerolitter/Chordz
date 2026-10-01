import {test,expect} from "@playwright/test";
import {encodeWav} from "../../lib/audio/wav";
test("reopening the current cloud song preserves the selected phrase and workspace",async({page})=>{
  await page.goto("/signin-with-chatgpt?return_to=/");await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button",{name:"Songs",exact:true}).click();await page.getByRole("button",{name:"Blank song"}).click();
  await page.getByRole("button",{name:"02 Write",exact:true}).click();
  const title="Keep editing "+Date.now();await page.getByLabel("Song title").fill(title);await page.getByLabel("Song title").press("Enter");
  await page.getByRole("button",{name:"Insert",exact:true}).click();await page.getByRole("button",{name:"Edit phrase",exact:true}).click();
  await page.keyboard.press("Control+s");await expect(page.getByText("Saved to cloud",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Songs",exact:true}).click();await page.getByRole("button",{name:new RegExp("^"+title)}).click();
  await expect(page.locator(".clip-editor-metadata > summary")).toBeVisible();await expect(page.locator(".piano-roll")).toBeVisible();
});
test("blank, demo, gapped, overlapping, crossing and recorded v1 projects round-trip without repair",async({page})=>{
  await page.goto("/signin-with-chatgpt?return_to=/");await expect(page.getByLabel("Song title")).toBeEnabled();
  const result=await page.evaluate(async wavBytes=>{
    const {createProject,createDemo,createTrack,emptyClip}=await import("/lib/music/project.ts" as string),{projectBackup,restoreBackup}=await import("/lib/audio/export.ts" as string),{uid}=await import("/lib/music/types.ts" as string);
    const reports=[];
    for(const kind of ["blank","demo","gapped","overlap","crossing","recorded"]){
      const doc=kind==="demo"?createDemo():createProject();doc.title="Roundtrip "+kind+" "+Date.now();const section=doc.sections[0];
      if(["gapped","overlap","crossing"].includes(kind)){section.startTick=960;section.lengthTick=3840;doc.chords=[{id:uid(),sectionId:section.id,tick:960,duration:kind==="gapped"?960:3840,symbol:"C",notes:[48,60,64,67]},{id:uid(),sectionId:section.id,tick:kind==="gapped"?3840:1920,duration:kind==="crossing"?4800:960,symbol:"G",notes:[55,62,67,71]}];}
      const created=await fetch("/api/projects",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(doc)});if(!created.ok)throw Error(await created.text());const base=await created.json() as {revision:number};
      const blobs=new Map<string,Blob>();
      if(kind==="recorded"){const blob=new Blob([new Uint8Array(wavBytes)],{type:"audio/wav"}),id=uid();const asset={id,name:"roundtrip.wav",mime:"audio/wav",byteLength:blob.size,duration:.1,sampleRate:48000,channels:1};const response=await fetch("/api/assets",{method:"POST",headers:{"Content-Type":"audio/wav","X-Project-Id":doc.id,"X-Asset-Id":id,"X-File-Name":"roundtrip.wav","X-Duration":"0.1","X-Sample-Rate":"48000","X-Channels":"1"},body:blob});if(!response.ok)throw Error(await response.text());doc.assets=[asset];const t=createTrack("piano","Recorded", "#c6ad7e","audio");t.clips=[{...emptyClip(960,192),audio:{assetId:id,offsetSec:0,gain:1,fadeInSec:0,fadeOutSec:0}}];doc.tracks.push(t);blobs.set(id,blob);}
      const saved=await fetch("/api/projects/"+doc.id,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({document:doc,expectedRevision:base.revision})});if(!saved.ok)throw Error(await saved.text());const loaded=await (await fetch("/api/projects/"+doc.id)).json() as {document:unknown};
      const backup=await projectBackup(doc,async(id:string)=>blobs.get(id)!);const restored=restoreBackup(backup);let bytesMatch=true;
      for(const [id,blob]of blobs){const expected=new Uint8Array(await blob.arrayBuffer()),cloud=new Uint8Array(await (await fetch("/api/assets/"+id)).arrayBuffer()),local=restored.assets.get(id);bytesMatch&&=JSON.stringify([...expected])===JSON.stringify([...cloud])&&JSON.stringify([...expected])===JSON.stringify([...local]);}
      reports.push({kind,cloud:JSON.stringify(loaded.document)===JSON.stringify(doc),backup:JSON.stringify(restored.document)===JSON.stringify(doc),bytesMatch});
    }return reports;
  },Array.from(new Uint8Array(encodeWav([new Float32Array(4800).fill(.1)],48000,24))));for(const r of result)expect(r,r.kind).toEqual({kind:r.kind,cloud:true,backup:true,bytesMatch:true});
});
