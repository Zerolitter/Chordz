import {test,expect,type Page} from "@playwright/test";
import {unzipSync} from "fflate";
import {mkdirSync,writeFileSync} from "node:fs";

async function blank(page:Page){
  await page.goto("/");await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button",{name:"Songs",exact:true}).click();
  await page.getByRole("button",{name:"Blank song",exact:true}).click();
}
async function bytes(download:import("@playwright/test").Download){
  const stream=await download.createReadStream(),chunks:Buffer[]=[];
  for await(const chunk of stream!)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);
}

test("export identifies section, destination and tail policy while MIDI and backup keep the complete song",async({page})=>{
  await blank(page);await page.getByRole("button",{name:"Export",exact:true}).click();
  await page.getByLabel("Export range",{exact:true}).selectOption("section");
  await expect(page.getByRole("status",{name:"Export summary"})).toContainText("Verse");
  await page.getByLabel("Include effect tails",{exact:true}).uncheck();
  await page.getByLabel("Export destination",{exact:true}).selectOption("download");
  await page.getByLabel("Export format",{exact:true}).selectOption("midi");
  await expect(page.getByLabel("Export range",{exact:true})).toHaveCount(0);
  await expect(page.getByRole("status",{name:"Export summary"})).toContainText("Full song");
  await page.getByLabel("Export format",{exact:true}).selectOption("backup");
  await expect(page.getByRole("status",{name:"Export summary"})).toContainText("Complete project");
});

test("native section rendering preserves crossing voices, automation and original audio fades and excludes next-section music",async({page})=>{
  await page.goto("/");
  const report=await page.evaluate(async()=>{
    const {StudioEngine}=await import("/lib/audio/engine.ts" as string),
      {createProject,createTrack,emptyClip}=await import("/lib/music/project.ts" as string),
      {encodeWav}=await import("/lib/audio/wav.ts" as string);
    const p=createProject();p.tracks=[createTrack("lead")];const track=p.tracks[0];
    track.volume=0;track.reverb=0;track.delay=0;track.drive=0;
    track.sound={...track.sound,algorithm:"subtractive",wave:"sine",detune:0,cutoff:18000,resonance:0,filterEnvelope:0,lfoDepth:0,attack:.005,decay:.01,sustain:1,release:.03};
    p.master={...p.master,volume:0,limiter:false,reverbDecay:.05};
    const clip=emptyClip(0,7680);clip.notes=[{id:"crossing",pitch:69,tick:0,duration:5760,velocity:.5},{id:"future",pitch:84,tick:3840,duration:3840,velocity:1}];
    clip.events=[{tick:0,type:"expression",value:.6}];track.clips=[clip];
    track.automation=[{parameter:"volume",points:[{tick:0,value:-18},{tick:7680,value:0}]}];
    const audio=createTrack("piano","Audio","#aaa","audio"),region=emptyClip(0,5760);
    region.audio={assetId:"recorded",offsetSec:0,gain:.5,fadeInSec:.3,fadeOutSec:1.4};audio.clips=[region];audio.volume=0;audio.reverb=0;audio.delay=0;p.tracks.push(audio);
    const pcm=new Float32Array(4*48000);for(let i=0;i<pcm.length;i++)pcm[i]=.1*Math.sin(i/48000*2*Math.PI*220);
    const blob=new Blob([encodeWav([pcm],48000)],{type:"audio/wav"});p.assets=[{id:"recorded",name:"source.wav",mime:blob.type,byteLength:blob.size,duration:4,sampleRate:48000,channels:1}];
    const original=JSON.stringify(p),engine=new StudioEngine(p,async()=>blob);
    try{
      const reference=await engine.render(p,undefined,4),range={startTick:1920,endTick:3840},
        exact=await engine.render(p,undefined,undefined,{range,includeTails:false}),
        tail=await engine.render(p,undefined,undefined,{range,includeTails:true});
      let error=0,tailPeak=0,peak=0;
      for(let ch=0;ch<2;ch++){
        const cut=exact.getChannelData(ch),full=reference.getChannelData(ch),ended=tail.getChannelData(ch);
        // The final limiter/filter boundary quantum is outside this pre-cutoff comparison.
        for(let i=0;i<cut.length-256;i++){error=Math.max(error,Math.abs(cut[i]-full[i+48000]));peak=Math.max(peak,Math.abs(cut[i]));}
        for(let i=2*48000;i<ended.length;i++)tailPeak=Math.max(tailPeak,Math.abs(ended[i]));
      }
      return {error,peak,tailPeak,exactFrames:exact.length,tailFrames:tail.length,unchanged:original===JSON.stringify(p)};
    }finally{engine.dispose();}
  });
  expect(report.error).toBeLessThan(1e-6);expect(report.peak).toBeGreaterThan(.001);
  expect(report.tailPeak).toBeLessThan(1e-5);expect(report.exactFrames).toBe(48000);expect(report.tailFrames).toBe(240000);expect(report.unchanged).toBe(true);
  mkdirSync("output/phase3-export-review",{recursive:true});writeFileSync("output/phase3-export-review/native-range.json",JSON.stringify(report,null,2));
});

test("all stems download as one ZIP without folder access and share selected-section sample boundaries",async({page})=>{
  await blank(page);await page.getByRole("button",{name:"Glass FM Synthesizers",exact:true}).click();
  await page.getByRole("button",{name:"Use on selected track",exact:true}).click();
  await page.getByRole("button",{name:"Add instrument track",exact:true}).click();
  await page.getByRole("button",{name:"Export",exact:true}).click();
  await page.getByLabel("Export format",{exact:true}).selectOption("stems");
  await page.getByLabel("Export range",{exact:true}).selectOption("section");
  await page.getByLabel("Include effect tails",{exact:true}).uncheck();
  const pending=page.waitForEvent("download");await page.getByRole("button",{name:"Export STEMS",exact:true}).click();
  const download=await pending;expect(download.suggestedFilename()).toMatch(/\.stems\.zip$/);
  const archive=await bytes(download);
  const report=Object.entries(unzipSync(archive)).map(([name,content])=>{const view=new DataView(content.buffer,content.byteOffset,content.byteLength);return {name,rate:view.getUint32(24,true),depth:view.getUint16(34,true),frames:view.getUint32(40,true)/6};});
  expect(report).toHaveLength(2);for(const stem of report)expect(stem).toMatchObject({rate:48000,depth:24,frames:16*48000});
  await expect(page.getByRole("status",{name:"Export summary"})).toContainText("Verse");
});

test("cancel during MP3 encoding discards late worker bytes and completion",async({page})=>{
  await page.addInitScript(()=>{
    const Native=window.Worker,encoders:{onmessage:((event:MessageEvent)=>void)|null;terminated:boolean}[]=[];
    const Encoder=class {
      onmessage:((event:MessageEvent)=>void)|null=null;onerror:unknown=null;onmessageerror:unknown=null;terminated=false;
      constructor(){encoders.push(this);}
      postMessage(){this.onmessage?.(new MessageEvent("message",{data:{type:"progress",percent:25}}));}
      terminate(){this.terminated=true;}
    };
    (window as unknown as {Worker:unknown}).Worker=function(url:string|URL,options?:WorkerOptions){return String(url).includes("mp3.worker")?new Encoder():new Native(url,options);};
    (window as unknown as {finishExportEncoder:()=>void}).finishExportEncoder=()=>encoders.forEach(encoder=>encoder.onmessage?.(new MessageEvent("message",{data:{type:"result",mp3:new ArrayBuffer(8)}})));
    (window as unknown as {exportEncoderStopped:()=>boolean}).exportEncoderStopped=()=>encoders.length===1&&encoders.every(encoder=>encoder.terminated);
  });
  await blank(page);await page.getByRole("button",{name:"Glass FM Synthesizers",exact:true}).click();await page.getByRole("button",{name:"Use on selected track",exact:true}).click();
  await page.getByRole("button",{name:"Export",exact:true}).click();await page.getByLabel("Export format",{exact:true}).selectOption("mp3");
  const downloads:string[]=[];page.on("download",download=>downloads.push(download.suggestedFilename()));
  await page.getByRole("button",{name:"Export MP3",exact:true}).click();await expect(page.getByText("Encoding MP3 · 25%",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Cancel export",exact:true}).click();await expect(page.getByRole("button",{name:"Export MP3",exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>(window as unknown as {exportEncoderStopped:()=>boolean}).exportEncoderStopped())).toBe(true);
  await page.evaluate(()=>(window as unknown as {finishExportEncoder:()=>void}).finishExportEncoder());
  await expect(page.getByText("Export complete.",{exact:true})).toHaveCount(0);expect(downloads).toEqual([]);
});

test("cancel while a folder writable is pending aborts its late handle without writing or closing",async({page})=>{
  await page.addInitScript(()=>{
    const fixture={resolve:null as null|((writer:unknown)=>void),requested:false,writes:0,closes:0,aborts:0};
    (window as unknown as {lateWriterFixture:typeof fixture}).lateWriterFixture=fixture;
    const writer={write:async()=>{fixture.writes++;},close:async()=>{fixture.closes++;},abort:async()=>{fixture.aborts++;}};
    const directory={getDirectoryHandle:async()=>directory,getFileHandle:async()=>({createWritable:()=>{fixture.requested=true;return new Promise(resolve=>{fixture.resolve=resolve;});}})};
    (window as unknown as {showDirectoryPicker:()=>Promise<unknown>}).showDirectoryPicker=async()=>directory;
    (window as unknown as {resolveLateWriter:()=>void}).resolveLateWriter=()=>fixture.resolve?.(writer);
  });
  await blank(page);await page.getByRole("button",{name:"Export",exact:true}).click();
  await page.getByLabel("Export format",{exact:true}).selectOption("midi");await page.getByLabel("Export destination",{exact:true}).selectOption("folder");
  const downloads:string[]=[];page.on("download",download=>downloads.push(download.suggestedFilename()));
  await page.getByRole("button",{name:"Export MIDI",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {lateWriterFixture:{requested:boolean}}).lateWriterFixture.requested)).toBe(true);
  await page.getByRole("button",{name:"Cancel export",exact:true}).click();await expect(page.getByRole("button",{name:"Export MIDI",exact:true})).toBeEnabled();
  await page.evaluate(()=>(window as unknown as {resolveLateWriter:()=>void}).resolveLateWriter());
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {lateWriterFixture:{aborts:number}}).lateWriterFixture.aborts)).toBe(1);
  expect(await page.evaluate(()=>(window as unknown as {lateWriterFixture:{writes:number;closes:number;aborts:number}}).lateWriterFixture)).toMatchObject({writes:0,closes:0,aborts:1});
  await expect(page.getByText("Export complete.",{exact:true})).toHaveCount(0);expect(downloads).toEqual([]);
});

test("cancel while a folder picker is pending suppresses late folder writes and allows a fresh export",async({page})=>{
  await page.addInitScript(()=>{
    const fixture={resolve:null as null|((handle:unknown)=>void),folders:[] as string[],files:[] as string[]};
    (window as unknown as {exportFolderFixture:typeof fixture}).exportFolderFixture=fixture;
    const handle={getDirectoryHandle:async(name:string)=>{fixture.folders.push(name);return handle;},getFileHandle:async(name:string)=>({createWritable:async()=>({write:async()=>{fixture.files.push(name);},close:async()=>{},abort:async()=>{}})})};
    (window as unknown as {showDirectoryPicker:()=>Promise<unknown>}).showDirectoryPicker=()=>new Promise(resolve=>{fixture.resolve=resolve;});
    (window as unknown as {resolveExportFolder:()=>void}).resolveExportFolder=()=>fixture.resolve?.(handle);
  });
  await blank(page);await page.getByRole("button",{name:"Export",exact:true}).click();
  await page.getByLabel("Export format",{exact:true}).selectOption("midi");
  await page.getByLabel("Export destination",{exact:true}).selectOption("folder");
  const downloads:string[]=[];page.on("download",download=>downloads.push(download.suggestedFilename()));
  await page.getByRole("button",{name:"Export MIDI",exact:true}).click();
  await expect(page.getByRole("button",{name:"Cancel export",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Cancel export",exact:true}).click();
  await expect(page.getByRole("button",{name:"Export MIDI",exact:true})).toBeEnabled();
  await page.evaluate(()=>(window as unknown as {resolveExportFolder:()=>void}).resolveExportFolder());
  await expect(page.getByText("Export cancelled. Completed folder files are kept.",{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as unknown as {exportFolderFixture:{folders:string[];files:string[]}}).exportFolderFixture)).toMatchObject({folders:[],files:[]});
  expect(downloads).toEqual([]);
  await page.getByLabel("Export destination",{exact:true}).selectOption("download");
  const pending=page.waitForEvent("download");await page.getByRole("button",{name:"Export MIDI",exact:true}).click();
  expect((await pending).suggestedFilename()).toMatch(/\.mid$/);
});

test("cancel during native render suppresses completion and the engine renders a fresh result",async({page})=>{
  await page.goto("/");const report=await page.evaluate(async()=>{
    const {StudioEngine}=await import("/lib/audio/engine.ts" as string),{createProject,createTrack,emptyClip}=await import("/lib/music/project.ts" as string);
    const p=createProject();p.tracks=[createTrack("lead")];const clip=emptyClip(0,30720);clip.notes=[{id:"long",pitch:60,tick:0,duration:30720,velocity:.7}];p.tracks[0].clips=[clip];
    const engine=new StudioEngine(p,async()=>new Blob()),controller=new AbortController(),statuses:string[]=[];
    engine.onStatus=(text:string)=>{statuses.push(text);if(text.startsWith("Rendering "))controller.abort();};
    let aborted=false;try{await engine.render(p,undefined,12,{signal:controller.signal});}catch(error){aborted=error instanceof DOMException&&error.name==="AbortError";}
    const cancelledCompleted=statuses.includes("Render complete");engine.onStatus=()=>{};
    const retry=await engine.render(p,undefined,.25);engine.dispose();
    return {aborted,cancelledCompleted,retryFrames:retry.length};
  });expect(report).toEqual({aborted:true,cancelledCompleted:false,retryFrames:12000});
});

test("cancelling during the offline clock releases a later native suspension",async({page})=>{
  await page.goto("/");const state=await page.evaluate(async()=>{
    const Native=window.OfflineAudioContext,contexts:OfflineAudioContext[]=[];
    window.OfflineAudioContext=class extends Native{
      constructor(options:OfflineAudioContextOptions);
      constructor(channels:number,frames:number,rate:number);
      constructor(options:number|OfflineAudioContextOptions,frames?:number,rate?:number){super(typeof options==="number"?{numberOfChannels:options,length:frames!,sampleRate:rate!}:options);contexts.push(this);}
    };
    const {StudioEngine}=await import("/lib/audio/engine.ts" as string),{createProject,createTrack}=await import("/lib/music/project.ts" as string);
    const p=createProject();p.tracks=[createTrack("lead")];const engine=new StudioEngine(p,async()=>new Blob()),controller=new AbortController();
    const result=engine.render(p,undefined,12,{signal:controller.signal});
    setTimeout(()=>controller.abort(),0);await result.catch(()=>{});
    await new Promise(resolve=>setTimeout(resolve,250));engine.dispose();window.OfflineAudioContext=Native;
    return contexts.map(context=>context.state);
  });expect(state).toEqual(["closed"]);
});

test("export controls remain reachable in compact viewports without page overflow",async({page})=>{
  await blank(page);await page.getByRole("button",{name:"Export",exact:true}).click();
  for(const [width,height] of [[1366,768],[1920,1080],[1024,768],[390,844]]){
    await page.setViewportSize({width,height});await page.getByLabel("Export format",{exact:true}).selectOption("stems");
    await expect(page.getByLabel("Export range",{exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Export STEMS",exact:true}).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button",{name:"Export STEMS",exact:true})).toBeInViewport();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`output/phase3-export-review/${width}-export.png`});
  }
});
