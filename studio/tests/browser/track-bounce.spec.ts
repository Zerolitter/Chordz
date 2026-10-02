import {expect,test,type Page} from "@playwright/test";
import {mkdirSync} from "node:fs";
import type {ProjectDocument} from "../../lib/music/types";

async function fixture(page:Page,owner="guest"){
  await page.goto(owner==="guest"?"/":"/signin-with-chatgpt?return_to=/");await expect(page.getByLabel("Song title")).toBeEnabled();
  await expect.poll(()=>page.evaluate(async saveOwner=>{
    const {latestDraft}=await import("/lib/client/storage.ts" as string);return !!await latestDraft(saveOwner);
  },owner)).toBe(true);
  await page.evaluate(async saveOwner=>{
    const {createProject,createTrack,emptyClip}=await import("/lib/music/project.ts" as string),{saveDraft}=await import("/lib/client/storage.ts" as string);
    const document=createProject("Track bounce fixture") as ProjectDocument;document.id="track_bounce_fixture";
    const source=createTrack("lead","Bounce source"),other=createTrack("bass","Other instrument");
    source.id="bounce_source";source.solo=true;source.volume=-15;source.pan=.2;source.reverb=.1;source.delay=.08;
    source.sound={...source.sound,detune:0,lfoDepth:0,attack:.01,release:.15};
    const phrase=emptyClip(1920,3840,"Original instrument phrase");phrase.id="bounce_phrase";
    phrase.notes=[{id:"original_note",pitch:60,tick:0,duration:1920,velocity:.6},{id:"later_note",pitch:67,tick:2400,duration:960,velocity:.5}];
    phrase.events=[{tick:0,type:"expression",value:.8}];source.clips=[phrase];
    source.automation=[{parameter:"pan",points:[{tick:1920,value:-.2},{tick:5760,value:.3}]}];
    other.id="other_instrument";document.tracks=[source,other];document.chords=[];
    await saveDraft({owner:saveOwner,document,revision:0,savedFingerprint:"",updatedAt:new Date().toISOString()});
  },owner);
  await page.reload();await expect(page.getByLabel("Song title")).toHaveValue("Track bounce fixture");
  await page.locator(".timeline-clip-body").filter({hasText:"Original instrument phrase"}).focus();await page.keyboard.press("Enter");
  await openBounce(page);
}
async function openBounce(page:Page){
  const summary=page.getByText("Bounce to audio",{exact:true});await expect(summary).toBeVisible();
  if(!await page.getByRole("button",{name:"Create audio copy",exact:true}).isVisible())await summary.click();
  await expect(page.getByRole("button",{name:"Create audio copy",exact:true})).toBeEnabled();
}
async function savedDocument(page:Page,owner="guest"):Promise<ProjectDocument>{
  return page.evaluate(async saveOwner=>{
    const {latestDraft}=await import("/lib/client/storage.ts" as string);return (await latestDraft(saveOwner))!.document;
  },owner);
}
async function expectCopies(page:Page,count:number){
  await expect.poll(async()=>(await savedDocument(page)).tracks.filter(track=>track.kind==="audio").length).toBe(count);
}
async function assetDigest(page:Page,id:string){
  return page.evaluate(async assetId=>{
    const {resolveAsset,pendingAsset}=await import("/lib/client/storage.ts" as string),blob=await resolveAsset("guest",assetId);
    const digest=await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());
    return {bytes:blob.size,sha256:[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,"0")).join(""),pending:!!await pendingAsset("guest",assetId)};
  },id);
}
async function ownedStorageCounts(page:Page){
  return page.evaluate(async()=>{
    const database=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open("chordz-recovery-v1",2);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try{
      const transaction=database.transaction(["assets","pending","staging"],"readonly");
      const counts=await Promise.all(["assets","pending","staging"].map(store=>new Promise<number>((resolve,reject)=>{const request=transaction.objectStore(store).count();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);})))
      return {assets:counts[0],pending:counts[1],staging:counts[2]};
    }finally{database.close();}
  });
}
async function holdRender(page:Page,afterRender=false){
  await page.evaluate(after=>{
    const state=window as unknown as {bounceRenderHeld:boolean;releaseBounceRender:()=>void};
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    state.bounceRenderHeld=false;state.releaseBounceRender=release;
    // Native prototypes are shared with the UI's bundled engine module instance.
    const original=OfflineAudioContext.prototype.startRendering;
    OfflineAudioContext.prototype.startRendering=async function(){
      OfflineAudioContext.prototype.startRendering=original;
      if(after){const buffer=await original.call(this);state.bounceRenderHeld=true;await gate;return buffer;}
      state.bounceRenderHeld=true;await gate;return original.call(this);
    };
  },afterRender);
}
const releaseRender=(page:Page)=>page.evaluate(()=>(window as unknown as {releaseBounceRender:()=>void}).releaseBounceRender());
const renderHeld=(page:Page)=>page.waitForFunction(()=>(window as unknown as {bounceRenderHeld:boolean}).bounceRenderHeld);
async function holdStaging(page:Page){
  await page.evaluate(()=>{
    const state=window as unknown as {bounceStageHeld:boolean;releaseBounceStage:()=>void};
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});state.bounceStageHeld=false;state.releaseBounceStage=release;
    const original=IDBDatabase.prototype.transaction,descriptor=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,"oncomplete")!;
    IDBDatabase.prototype.transaction=function(...args:Parameters<typeof original>){
      const transaction=original.apply(this,args),stores=Array.from(transaction.objectStoreNames);
      if(this.name==="chordz-recovery-v1"&&args[1]==="readwrite"&&stores.length===3&&["assets","pending","staging"].every(store=>stores.includes(store))){
        IDBDatabase.prototype.transaction=original;
        Object.defineProperty(transaction,"oncomplete",{configurable:true,set(handler){descriptor.set!.call(transaction,async(event:Event)=>{state.bounceStageHeld=true;await gate;handler?.call(transaction,event);});}});
      }
      return transaction;
    };
  });
}

test("bounce retains the instrument and solo isolation, with one Undo step and durable independent bytes",async({page})=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));await fixture(page);
  await expect(page.getByLabel("Include bounce effect tails",{exact:true})).toBeChecked();
  await expect(page.getByLabel("Mute source after bounce",{exact:true})).toBeChecked();
  const before=await savedDocument(page),source=before.tracks[0];
  await page.getByRole("button",{name:"Create audio copy",exact:true}).focus();await page.keyboard.press("Enter");
  await expectCopies(page,1);await expect(page.getByRole("status",{name:"Device draft status"})).toContainText("Device draft saved");
  const bounced=await savedDocument(page),copy=bounced.tracks.find(track=>track.kind==="audio")!,asset=bounced.assets[0],region=copy.clips[0];
  expect(bounced.tracks[0]).toEqual({...source,mute:true});expect(bounced.tracks[1]).toEqual(before.tracks[1]);expect(copy.solo).toBe(true);
  expect(copy).toMatchObject({volume:0,pan:0,reverb:0,delay:0,low:0,mid:0,high:0,drive:0,automation:[]});
  expect(region).toMatchObject({startTick:source.clips[0].startTick,loop:false,transpose:0,notes:[],events:[],audio:{assetId:asset.id,offsetSec:0,gain:1,fadeInSec:0,fadeOutSec:0}});
  expect(region.lengthTick).toBe(Math.ceil(asset.duration*bounced.tempo*960/60));expect(asset).toMatchObject({mime:"audio/wav",sampleRate:48000,channels:2});
  expect(asset.duration).toBeGreaterThan(2);expect([copy.id,region.id,asset.id].every(id=>!JSON.stringify(before).includes(id))).toBe(true);
  const digest=await assetDigest(page,asset.id);expect(digest).toMatchObject({bytes:asset.byteLength,pending:true});expect(digest.sha256).toMatch(/^[a-f0-9]{64}$/);
  await page.getByLabel("Undo",{exact:true}).click();await expectCopies(page,0);
  expect(await savedDocument(page)).toEqual(before);expect(await assetDigest(page,asset.id)).toEqual(digest);
  await page.getByLabel("Redo",{exact:true}).click();await expectCopies(page,1);expect(await assetDigest(page,asset.id)).toEqual(digest);
  await page.reload();await expect(page.getByLabel("Song title")).toHaveValue(before.title);
  expect(await savedDocument(page)).toEqual(bounced);expect(await assetDigest(page,asset.id)).toEqual(digest);expect(errors).toEqual([]);
});

test("turning source mute and tails off adds only an audio copy of the explicit phrase range",async({page})=>{
  await fixture(page);const before=await savedDocument(page);
  await page.getByLabel("Mute source after bounce",{exact:true}).uncheck();await page.getByLabel("Include bounce effect tails",{exact:true}).uncheck();
  await page.getByRole("button",{name:"Create audio copy",exact:true}).click();await expectCopies(page,1);
  const bounced=await savedDocument(page),copy=bounced.tracks.find(track=>track.kind==="audio")!;
  expect(bounced.tracks.slice(0,2)).toEqual(before.tracks);expect(bounced.assets[0].duration).toBeCloseTo(2,5);expect(copy.clips[0].lengthTick).toBe(3840);
});

for(const invalidSample of ["clipped","nonfinite"]as const){
  test(`bounce rejects ${invalidSample} native PCM without changing the source or retaining audio`,async({page})=>{
    await fixture(page);const before=await savedDocument(page),undo=await page.getByLabel("Undo",{exact:true}).isEnabled();
    await page.evaluate(kind=>{
      const original=OfflineAudioContext.prototype.startRendering;
      OfflineAudioContext.prototype.startRendering=async function(){
        OfflineAudioContext.prototype.startRendering=original;
        const buffer=await original.call(this);
        buffer.getChannelData(0)[Math.floor(buffer.length/2)]=kind==="clipped"?1.25:Number.NaN;
        return buffer;
      };
    },invalidSample);
    await page.getByRole("button",{name:"Create audio copy",exact:true}).click();
    await expect(page.getByRole("status",{name:"Bounce status"})).toContainText("clips or is not finite");
    await expect(page.getByRole("button",{name:"Create audio copy",exact:true})).toBeEnabled();
    expect(await savedDocument(page)).toEqual(before);expect(await ownedStorageCounts(page)).toEqual({assets:0,pending:0,staging:0});
    expect(await page.getByLabel("Undo",{exact:true}).isEnabled()).toBe(undo);
  });
}

test("Cancel rejects a late rendered result without disturbing its successor bounce",async({page})=>{
  await fixture(page);await holdRender(page,true);
  try{
    await page.getByRole("button",{name:"Create audio copy",exact:true}).click();await renderHeld(page);
    await page.getByRole("button",{name:"Cancel bounce",exact:true}).click();
    await expect(page.getByRole("status",{name:"Bounce status"})).toContainText("cancelled");await expectCopies(page,0);
    await page.getByRole("button",{name:"Create audio copy",exact:true}).click();await expectCopies(page,1);
    const successor=await savedDocument(page);await releaseRender(page);await page.waitForTimeout(250);
    expect(await savedDocument(page)).toEqual(successor);expect(await ownedStorageCounts(page)).toEqual({assets:1,pending:1,staging:0});
  }finally{await releaseRender(page);}
});

test("Cancel terminates only its owned pending encoder once and a late message cannot affect the successor",async({page})=>{
  await fixture(page);const before=await savedDocument(page);
  await page.evaluate(()=>{
    const state=window as unknown as {bounceEncodeHeld:boolean;bounceEncoderTerminations:number;releaseBounceEncode:()=>void};
    state.bounceEncodeHeld=false;state.bounceEncoderTerminations=0;
    const originalPost=Worker.prototype.postMessage,originalTerminate=Worker.prototype.terminate;
    const ownedWorkers=new Set<Worker>();let delivered=false;
    Worker.prototype.terminate=function(){if(ownedWorkers.has(this))state.bounceEncoderTerminations++;originalTerminate.call(this);};
    Worker.prototype.postMessage=function(message:unknown,transferOrOptions?:Transferable[]|StructuredSerializeOptions){
      const args=transferOrOptions===undefined?[message]:[message,transferOrOptions];
      if(message&&typeof message==="object"&&"type"in message&&message.type==="encode"){
        Worker.prototype.postMessage=originalPost;ownedWorkers.add(this);state.bounceEncodeHeld=true;
        state.releaseBounceEncode=()=>{
          if(delivered)return;delivered=true;
          try{Reflect.apply(originalPost,this,args);}catch(error){if(!(error instanceof DOMException&&error.name==="InvalidStateError"))throw error;}
        };
        return;
      }
      Reflect.apply(originalPost,this,args);
    };
  });
  try{
    await page.getByRole("button",{name:"Create audio copy",exact:true}).click();
    await page.waitForFunction(()=>(window as unknown as {bounceEncodeHeld:boolean}).bounceEncodeHeld);
    await page.getByRole("button",{name:"Cancel bounce",exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as unknown as {bounceEncoderTerminations:number}).bounceEncoderTerminations)).toBe(1);
    expect(await savedDocument(page)).toEqual(before);expect(await ownedStorageCounts(page)).toEqual({assets:0,pending:0,staging:0});
    await page.getByRole("button",{name:"Create audio copy",exact:true}).click();await expectCopies(page,1);
    const successor=await savedDocument(page);
    await page.evaluate(()=>(window as unknown as {releaseBounceEncode:()=>void}).releaseBounceEncode());await page.waitForTimeout(250);
    expect(await savedDocument(page)).toEqual(successor);expect(await ownedStorageCounts(page)).toEqual({assets:1,pending:1,staging:0});
    expect(await page.evaluate(()=>(window as unknown as {bounceEncoderTerminations:number}).bounceEncoderTerminations)).toBe(1);
    await expect(page.getByRole("status",{name:"Bounce status"})).toContainText("Audio copy saved");
  }finally{await page.evaluate(()=>(window as unknown as {releaseBounceEncode?:()=>void}).releaseBounceEncode?.());}
});

test("a source edit followed by Undo invalidates the pending render despite matching final content",async({page})=>{
  await fixture(page);const before=await savedDocument(page);await holdRender(page);
  try{
    await page.getByRole("button",{name:"Create audio copy",exact:true}).click();await renderHeld(page);
    await page.getByRole("button",{name:"Mute Bounce source",exact:true}).first().click();
    await expect.poll(async()=>(await savedDocument(page)).tracks[0].mute).toBe(true);
    await page.getByLabel("Undo",{exact:true}).click();await expect.poll(async()=>(await savedDocument(page)).tracks[0].mute).toBe(false);
    await releaseRender(page);await expect(page.getByRole("button",{name:"Create audio copy",exact:true})).toBeEnabled();
    await page.waitForTimeout(250);expect(await savedDocument(page)).toEqual(before);expect(await ownedStorageCounts(page)).toEqual({assets:0,pending:0,staging:0});
  }finally{await releaseRender(page);}
});

test("unrelated title and other-track edits survive a pending bounce",async({page})=>{
  await fixture(page);const before=await savedDocument(page);await holdRender(page);
  try{
    await page.getByRole("button",{name:"Create audio copy",exact:true}).click();await renderHeld(page);
    await page.getByLabel("Song title").fill("Title edited while bouncing");await page.getByLabel("Song title").press("Enter");
    await page.getByRole("button",{name:"Mute Other instrument",exact:true}).first().click();
    await expect.poll(async()=>(await savedDocument(page)).tracks[1].mute).toBe(true);
    await releaseRender(page);await expectCopies(page,1);const bounced=await savedDocument(page);
    expect(bounced.title).toBe("Title edited while bouncing");expect(bounced.tracks[1]).toEqual({...before.tracks[1],mute:true});
    expect(bounced.tracks[0]).toEqual({...before.tracks[0],mute:true});
    await page.getByLabel("Undo",{exact:true}).click();await expectCopies(page,0);
    const undone=await savedDocument(page);expect(undone.title).toBe(bounced.title);expect(undone.tracks[1]).toEqual(bounced.tracks[1]);expect(undone.tracks[0]).toEqual(before.tracks[0]);
  }finally{await releaseRender(page);}
});

test("failed atomic audio staging keeps the source unchanged and retry inserts exactly once",async({page})=>{
  await fixture(page);const before=await savedDocument(page);
  await page.evaluate(()=>{
    const original=IDBDatabase.prototype.transaction;let fail=true;
    IDBDatabase.prototype.transaction=function(...args:Parameters<typeof original>){
      const stores=args[0];
      if(fail&&this.name==="chordz-recovery-v1"&&args[1]==="readwrite"&&Array.isArray(stores)&&stores.length===3&&["assets","pending","staging"].every(store=>stores.includes(store))){fail=false;throw new Error("Injected bounce staging failure");}
      return original.apply(this,args);
    };
  });
  await page.getByRole("button",{name:"Create audio copy",exact:true}).click();
  await expect(page.getByRole("status",{name:"Bounce status"})).toContainText("failure");await expect(page.getByRole("button",{name:"Create audio copy",exact:true})).toBeEnabled();
  expect(await savedDocument(page)).toEqual(before);expect(await ownedStorageCounts(page)).toEqual({assets:0,pending:0,staging:0});
  await page.getByRole("button",{name:"Create audio copy",exact:true}).evaluate(element=>{(element as HTMLButtonElement).click();(element as HTMLButtonElement).click();});
  await expectCopies(page,1);const bounced=await savedDocument(page);
  expect(bounced.assets).toHaveLength(1);expect(bounced.tracks[0]).toEqual({...before.tracks[0],mute:true});expect(await ownedStorageCounts(page)).toEqual({assets:1,pending:1,staging:0});
});

test("a postcommit device-save failure retains the audio and Retry saves the current song",async({page})=>{
  await fixture(page);
  await page.evaluate(()=>{
    const state=window as unknown as {failBounceDraft:boolean};state.failBounceDraft=true;
    const original=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(...args:Parameters<typeof original>){
      const stores=args[0];
      if(state.failBounceDraft&&this.name==="chordz-recovery-v1"&&args[1]==="readwrite"&&Array.isArray(stores)&&stores.includes("drafts")&&stores.includes("staging"))throw new Error("Injected bounce draft failure");
      return original.apply(this,args);
    };
  });
  await page.getByRole("button",{name:"Create audio copy",exact:true}).click();
  await expect(page.locator(".audio-editor")).toBeVisible();await expect(page.getByRole("status",{name:"Device draft status"})).toContainText("Device draft unavailable");
  expect(await ownedStorageCounts(page)).toEqual({assets:1,pending:1,staging:0});
  await page.getByLabel("Song title").fill("Current bounced idea");await page.getByLabel("Song title").press("Enter");
  await expect(page.getByRole("status",{name:"Device draft status"})).toContainText("Device draft unavailable");
  await page.getByRole("button",{name:"Retry device draft",exact:true}).evaluate(element=>{
    (window as unknown as {failBounceDraft:boolean}).failBounceDraft=false;(element as HTMLButtonElement).click();
  });await expectCopies(page,1);
  await expect(page.getByRole("status",{name:"Device draft status"})).toContainText("Device draft saved");
  const document=await savedDocument(page),asset=document.assets[0],digest=await assetDigest(page,asset.id);
  expect(document.title).toBe("Current bounced idea");expect(document.assets).toHaveLength(1);
  await page.reload();await expect(page.getByLabel("Song title")).toHaveValue(document.title);expect(await assetDigest(page,asset.id)).toEqual(digest);
});

test("an unrelated invalid field remains intact when it prevents pending bounce insertion",async({page})=>{
  await fixture(page);const before=await savedDocument(page);await holdRender(page);
  try{
    await page.getByRole("button",{name:"Create audio copy",exact:true}).click();await renderHeld(page);
    await page.getByLabel("Song title").fill("");await expect(page.getByLabel("Song title")).toHaveValue("");
    await releaseRender(page);await expect(page.getByRole("status",{name:"Bounce status"})).toContainText("unfinished");
    await expect.poll(()=>ownedStorageCounts(page)).toEqual({assets:0,pending:0,staging:0});
    await expect(page.getByLabel("Song title")).toHaveValue("");expect(await savedDocument(page)).toEqual(before);
    await page.getByLabel("Song title").press("Escape");await expect(page.getByLabel("Song title")).toHaveValue(before.title);
    await page.getByRole("button",{name:"Create audio copy",exact:true}).click();await expectCopies(page,1);
  }finally{await releaseRender(page);}
});

test("Undo during pending promotion saves the current song and retains the audio explicitly for Redo",async({page})=>{
  await fixture(page);const before=await savedDocument(page);
  await page.evaluate(()=>{
    const state=window as unknown as {bouncePromotionHeld:boolean;releaseBouncePromotion:()=>void};
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});state.bouncePromotionHeld=false;state.releaseBouncePromotion=release;
    const original=IDBDatabase.prototype.transaction,descriptor=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,"oncomplete")!;
    IDBDatabase.prototype.transaction=function(...args:Parameters<typeof original>){
      const transaction=original.apply(this,args),stores=Array.from(transaction.objectStoreNames);
      if(this.name==="chordz-recovery-v1"&&args[1]==="readwrite"&&stores.length===2&&["pending","staging"].every(store=>stores.includes(store))){
        IDBDatabase.prototype.transaction=original;
        Object.defineProperty(transaction,"oncomplete",{configurable:true,set(handler){descriptor.set!.call(transaction,async(event:Event)=>{state.bouncePromotionHeld=true;await gate;handler?.call(transaction,event);});}});
      }
      return transaction;
    };
  });
  try{
    await page.getByRole("button",{name:"Create audio copy",exact:true}).click();
    await page.waitForFunction(()=>(window as unknown as {bouncePromotionHeld:boolean}).bouncePromotionHeld);
    await expect(page.locator(".timeline-clip")).toHaveCount(2);
    await page.getByLabel("Undo",{exact:true}).click();await expect(page.locator(".timeline-clip")).toHaveCount(1);
    await page.evaluate(()=>(window as unknown as {releaseBouncePromotion:()=>void}).releaseBouncePromotion());
    await expect(page.getByRole("status",{name:"Bounce status"})).toContainText("retained for Redo");
    await expect(page.getByRole("status",{name:"Device draft status"})).toContainText("Device draft saved");expect(await savedDocument(page)).toEqual(before);
    expect(await ownedStorageCounts(page)).toEqual({assets:1,pending:1,staging:0});
    await page.getByLabel("Redo",{exact:true}).click();await expectCopies(page,1);
    const asset=(await savedDocument(page)).assets[0];expect(await assetDigest(page,asset.id)).toMatchObject({bytes:asset.byteLength,pending:true});
  }finally{await page.evaluate(()=>(window as unknown as {releaseBouncePromotion:()=>void}).releaseBouncePromotion());}
});

test("opening a new song rejects a late completed render and resets the bounce receipt",async({page})=>{
  await fixture(page);await holdRender(page,true);
  try{
    await page.getByRole("button",{name:"Create audio copy",exact:true}).click();await renderHeld(page);
    await page.getByRole("button",{name:"Songs",exact:true}).click();await page.getByRole("button",{name:"Blank song",exact:true}).click();
    await expect(page.getByLabel("Song title")).toHaveValue("Untitled song");
    await releaseRender(page);await page.waitForTimeout(250);
    await expect.poll(async()=>(await savedDocument(page)).id).not.toBe("track_bounce_fixture");
    const current=await savedDocument(page);expect(current.assets).toHaveLength(0);expect(current.tracks.filter(track=>track.kind==="audio")).toHaveLength(0);
    if(!await page.locator(".track-bounce").evaluate(element=>(element as HTMLDetailsElement).open))await page.getByText("Bounce to audio",{exact:true}).click();
    await expect(page.getByRole("status",{name:"Bounce status"})).toHaveText("");
    expect(await ownedStorageCounts(page)).toEqual({assets:0,pending:0,staging:0});
  }finally{await releaseRender(page);}
});

test("same-ID device recovery invalidates a captured render even when its source contents match",async({page})=>{
  await page.route("**/api/projects**",async route=>{
    if(route.request().method()==="GET")return route.fulfill({status:200,json:[]});
    const body=route.request().postDataJSON(),document=route.request().method()==="POST"?body:body.document;
    return route.fulfill({status:200,json:{document,revision:1,updatedAt:new Date().toISOString()}});
  });
  // The loopback dispatch owner is the same existing recovery fixture used elsewhere.
  await fixture(page,"local_seedy");const before=await savedDocument(page,"local_seedy");await holdRender(page,true);
  try{
    await page.getByRole("button",{name:"Create audio copy",exact:true}).click();await renderHeld(page);
    await page.getByRole("button",{name:"Songs",exact:true}).click();await page.getByRole("button",{name:"Recovery versions",exact:true}).click();
    await page.locator(".recovery-version").filter({hasText:before.title}).click();
    await expect(page.getByRole("dialog",{name:"Recovery versions",exact:true})).toHaveCount(0);
    await releaseRender(page);await page.waitForTimeout(250);expect(await savedDocument(page,"local_seedy")).toEqual(before);
    expect(await ownedStorageCounts(page)).toEqual({assets:0,pending:0,staging:0});
    await expect(page.getByRole("status",{name:"Bounce status"})).toHaveText("");
  }finally{await releaseRender(page);}
});

test("bounce popup supports keyboard controls and stays within desktop, laptop and narrow viewports",async({page})=>{
  await fixture(page);const before=await savedDocument(page);mkdirSync("output/phase4-ui-review",{recursive:true});
  await page.getByRole("button",{name:"Close bounce",exact:true}).click();
  for(const [width,height]of [[1920,1080],[1366,768],[1024,768],[390,844]]){
    await page.setViewportSize({width,height});const summary=page.getByText("Bounce to audio",{exact:true});
    await summary.focus();await page.keyboard.press("Enter");
    await expect(page.getByRole("button",{name:"Create audio copy",exact:true})).toBeVisible();
    const tails=page.getByLabel("Include bounce effect tails",{exact:true});await tails.focus();await page.keyboard.press("Space");await expect(tails).not.toBeChecked();
    await page.keyboard.press("Space");await expect(tails).toBeChecked();await expect(page.getByLabel("Play song",{exact:true})).toBeVisible();
    await expect(page.locator(".track-bounce-body")).toContainText("Tails extend the audio region");
    await expect.poll(()=>page.locator(".track-bounce-body").evaluate(element=>{const bounds=element.getBoundingClientRect();return bounds.left>=0&&bounds.right<=innerWidth&&bounds.top>=0&&bounds.bottom<=innerHeight;})).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`output/phase4-ui-review/${width}-bounce.png`,animations:"disabled"});
    await page.getByRole("button",{name:"Create audio copy",exact:true}).focus();await page.keyboard.press("Escape");
    await expect(page.getByRole("button",{name:"Create audio copy",exact:true})).not.toBeVisible();await expect(summary).toBeFocused();
  }
  expect(await savedDocument(page)).toEqual(before);
});

test("closing bounce during held staging rejects late insertion and cleans only its uncommitted bytes",async({page})=>{
  await fixture(page);const before=await savedDocument(page);
  await page.evaluate(async()=>{
    const {keepPendingAsset}=await import("/lib/client/storage.ts" as string),{encodeWav}=await import("/lib/audio/wav.ts" as string);
    const blob=new Blob([encodeWav([new Float32Array(100).fill(.1)],48000,24)],{type:"audio/wav"});
    const asset={id:"prior_owned_audio",name:"Prior retained audio.wav",mime:blob.type,byteLength:blob.size,duration:100/48000,sampleRate:48000,channels:1};
    await keepPendingAsset({owner:"guest",projectId:"track_bounce_fixture",asset,blob});
  });
  const retained=await assetDigest(page,"prior_owned_audio");await holdStaging(page);
  try{
    await page.getByRole("button",{name:"Create audio copy",exact:true}).click();
    await page.waitForFunction(()=>(window as unknown as {bounceStageHeld:boolean}).bounceStageHeld);
    expect(await ownedStorageCounts(page)).toEqual({assets:2,pending:2,staging:1});
    await page.getByRole("button",{name:"Close bounce",exact:true}).click();await expect(page.getByRole("button",{name:"Create audio copy",exact:true})).not.toBeVisible();
    await page.evaluate(()=>(window as unknown as {releaseBounceStage:()=>void}).releaseBounceStage());
    await expect.poll(()=>ownedStorageCounts(page)).toEqual({assets:1,pending:1,staging:0});expect(await savedDocument(page)).toEqual(before);
    expect(await assetDigest(page,"prior_owned_audio")).toEqual(retained);
    await openBounce(page);
    await page.getByRole("button",{name:"Create audio copy",exact:true}).click();await expectCopies(page,1);
  }finally{await page.evaluate(()=>(window as unknown as {releaseBounceStage:()=>void}).releaseBounceStage());}
});
