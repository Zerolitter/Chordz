import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { encodeWav } from "../../lib/audio/wav";

test("workspace preferences, selected phrases and responsive layout survive navigation",async({page})=>{
  await page.goto("/");await expect(page.getByLabel("Song title")).toBeEnabled();await page.getByRole("button",{name:"Songs",exact:true}).click();await page.getByRole("button",{name:"Blank song"}).click();
  await page.getByRole("navigation").getByRole("button",{name:"02 Write"}).click();
  await page.getByLabel("Density",{exact:true}).fill("0.73");await page.getByRole("button",{name:"Insert",exact:true}).click();await page.getByRole("button",{name:"Edit phrase",exact:true}).click();
  await page.locator(".clip-editor-metadata > summary").click();
  const clipName=await page.getByLabel("Clip name").inputValue();
  await page.getByLabel("Timeline zoom").fill("67");await page.getByLabel("Quantization grid").selectOption("480");
  await page.getByRole("navigation").getByRole("button",{name:"02 Write"}).click();await expect(page.getByLabel("Density",{exact:true})).toHaveValue("0.73");
  await page.getByRole("navigation").getByRole("button",{name:"01 Arrange"}).click();await expect(page.getByLabel("Timeline zoom")).toHaveValue("67");await expect(page.getByLabel("Quantization grid")).toHaveValue("480");await expect(page.getByLabel("Clip name")).toHaveValue(clipName);
  await page.getByRole("navigation").getByRole("button",{name:"02 Write"}).click();
  for(const [width,height]of [[1440,1000],[820,1180],[390,844]]){await page.setViewportSize({width,height});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:"output/playwright/workflow-"+width+".png",fullPage:true});}
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole("navigation").getByRole("button",{name:"01 Arrange"}).click();
  await page.waitForTimeout(500);await page.reload();await expect(page.getByLabel("Song title")).toBeEnabled();await expect(page.getByLabel("Timeline zoom")).toBeVisible();await expect(page.getByLabel("Timeline zoom")).toHaveValue("67");
  await page.locator(".clip-editor-metadata > summary").click();await expect(page.getByLabel("Clip name")).toHaveValue(clipName);
  await page.getByRole("navigation").getByRole("button",{name:"02 Write"}).click();await expect(page.getByLabel("Density",{exact:true})).toHaveValue("0.73");
});

test("accessible piano releases after focus changes and ignores held-key repeats",async({page})=>{
  await page.goto("/");await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByLabel("Other detail tools").selectOption("keyboard");
  for(const key of ["Play C3","Play C#3"]){
    const button=page.getByRole("button",{name:key,exact:true});await button.focus();await page.keyboard.down("Enter");await expect(button).toHaveClass(/held/);
    await page.keyboard.down("Enter");await expect(button).toHaveClass(/held/);
    await page.getByLabel("Song title").focus();await page.keyboard.up("Enter");await expect(button).not.toHaveClass(/held/);
    await button.focus();await page.keyboard.down("Space");await expect(button).toHaveClass(/held/);await page.keyboard.up("Space");await expect(button).not.toHaveClass(/held/);
  }
  await expect(page.locator(".transport-position")).not.toContainText(/Playing/);
});

test("single-zone sample readiness emits loading, retry and cached instrument changes",async({page})=>{
  const wavBytes=[...new Uint8Array(encodeWav([new Float32Array(4800)],48000,16))];
  await page.goto("/");const result=await page.evaluate(async bytes=>{
    const {StudioEngine}=await import("/lib/audio/engine.ts" as string),{createProject,createTrack}=await import("/lib/music/project.ts" as string);
    const p=createProject(),t=createTrack("user");p.tracks=[t];p.userInstruments=[{id:"user",name:"Fixture",family:"test",description:"test",kind:"sample",zones:[{assetId:"fixture",root:60,low:0,high:127,velocityLow:0,velocityHigh:1,roundRobin:0,articulation:"sustain"}],articulations:["sustain"],license:"User supplied",source:"fixture",defaults:{attack:.01,release:.1,detune:0}}];
    const blob=new Blob([Uint8Array.from(bytes)],{type:"audio/wav"});let resolve!:(blob:Blob)=>void,reject!:(e:Error)=>void;let pending=new Promise<Blob>((a,b)=>{resolve=a;reject=b;});
    const engine=new StudioEngine(p,()=>pending),states:string[]=[];engine.subscribe(()=>states.push(engine.instrumentReadiness(t.id).state));await engine.unlock();
    const first=engine.ensureBuffers();await new Promise(r=>setTimeout(r,50));reject(Error("Fixture load failed"));await first.catch(()=>{});const failure=engine.instrumentReadiness(t.id);
    pending=new Promise<Blob>((a,b)=>{resolve=a;reject=b;});const retry=engine.ensureBuffers();await new Promise(r=>setTimeout(r,50));resolve(blob);await retry;
    const ready=engine.instrumentReadiness(t.id).state;p.userInstruments[0].zones[0].assetId="different";engine.updateProject(p);const last=states.at(-1);engine.dispose();return {states,failure,ready,last};
  },wavBytes);expect(result.states).toContain("loading");expect(result.failure.state).toBe("failed");expect(result.ready).toBe("ready");expect(result.last).toBe("unloaded");
});

test("microphone cutoff is frame exact and disconnected pedal sources release only their ownership",async({page})=>{
  await page.goto("/");const result=await page.evaluate(async()=>{
    const {StudioEngine}=await import("/lib/audio/engine.ts" as string),{MicrophoneRecorder}=await import("/lib/audio/recording.ts" as string),{createProject,createTrack}=await import("/lib/music/project.ts" as string);
    const p=createProject(),t=createTrack("lead");p.tracks=[t];t.reverb=0;t.delay=0;t.sound.release=.03;p.master.limiter=false;
    const engine=new StudioEngine(p,async()=>{throw Error("unused");}),context=await engine.unlock(),wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
    await engine.noteOn(t.id,60,.9,"computer:KeyA");await engine.noteOn(t.id,60,.9,"midi:one:0:60");
    engine.expression(t.id,{tick:0,type:"sustain",value:1},context.currentTime,false,"midi:one:0");engine.expression(t.id,{tick:0,type:"sustain",value:1},context.currentTime,false,"midi:two:0");
    engine.noteOff(t.id,60,"computer:KeyA");engine.noteOff(t.id,60,"midi:one:0:60");engine.releaseSource("midi:one:");await wait(200);const remaining=engine.meter().master;
    engine.releaseSource("midi:two:");await wait(p.master.reverbDecay*1000+800);const released=engine.meter().master;
    const recorder=new MicrophoneRecorder();await recorder.prepare(context);const start=context.currentTime+.1;recorder.start(start,context);await wait(600);const end=context.currentTime-.02;
    const recording=await recorder.stop(end),again=await recorder.stop(end+1);const frames=Math.round(end*context.sampleRate)-Math.round(start*context.sampleRate),bytes=new Uint8Array(await recording.blob.arrayBuffer()),retryBytes=new Uint8Array(await again.blob.arrayBuffer());
    const same=bytes.length===retryBytes.length&&bytes.every((v,i)=>v===retryBytes[i]);recorder.dispose();engine.dispose();return {remaining,released,frames,duration:recording.duration,rate:recording.sampleRate,same};
  });expect(result.remaining).toBeGreaterThan(1e-3);expect(result.released).toBeLessThan(1e-4);expect(result.duration*result.rate).toBeCloseTo(result.frames,7);expect(result.same).toBe(true);
});

test("generated phrases, alternative destination, stale audition and existing editor handoff",async({page})=>{
  await page.goto("/");await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button",{name:"Songs",exact:true}).click();await page.getByRole("button",{name:"Blank song"}).click();
  await page.getByRole("navigation").getByRole("button",{name:"02 Write"}).click();
  await page.getByRole("button",{name:"Audition",exact:true}).click();await expect(page.locator(".transport-position")).toContainText(/Audition/);
  await page.getByLabel("Song title").fill("Unrelated title edit");await page.getByLabel("Song title").press("Enter");await expect(page.locator(".transport-position")).toContainText(/Audition/);
  await page.getByLabel("Energy",{exact:true}).fill("0.8");await expect(page.locator(".transport-position")).not.toContainText(/Audition/);
  await page.getByRole("button",{name:"Insert",exact:true}).click();await expect(page.getByRole("button",{name:"Edit phrase",exact:true})).toBeEnabled();
  await page.getByRole("button",{name:"Insert",exact:true}).click();await expect(page.getByRole("alert").filter({hasText:"overlaps"})).toBeVisible();
  await page.getByRole("button",{name:"Insert on alternative track",exact:true}).click();await expect(page.getByLabel("Phrase destination")).toContainText("alternative");
  await page.getByRole("button",{name:"Edit phrase",exact:true}).click();await expect(page.locator(".piano-roll")).toBeVisible();await expect(page.getByRole("button",{name:"Drum steps",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Piano roll",exact:true}).click();await page.locator(".clip-editor-metadata > summary").click();await page.getByLabel("Clip transpose",{exact:true}).fill("2");await page.getByLabel("Clip transpose",{exact:true}).press("Enter");
  await page.getByLabel("Undo",{exact:true}).click();await expect(page.getByLabel("Clip transpose",{exact:true})).toHaveValue("0");
});

test("direct chord editing, grouped fields, invalid draft and guide-only timing",async({page})=>{
  await page.goto("/");await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button",{name:"Songs",exact:true}).click();await page.getByRole("button",{name:"Blank song"}).click();
  await page.getByRole("navigation").getByRole("button",{name:"02 Write"}).click();
  const original=await page.getByLabel("Song title").inputValue();
  await page.getByLabel("Song title").fill("Grouped title");await page.getByLabel("Song title").press("Enter");
  await page.getByLabel("Undo",{exact:true}).click();await expect(page.getByLabel("Song title")).toHaveValue(original);
  await page.getByLabel("Redo",{exact:true}).click();await expect(page.getByLabel("Song title")).toHaveValue("Grouped title");
  await page.getByLabel("Tempo",{exact:true}).fill("");await page.getByRole("navigation").getByRole("button",{name:"01 Arrange"}).click();await expect(page.getByRole("heading",{name:"Find the feeling."})).toBeVisible();
  await page.getByLabel("Song title").fill("Must not replace invalid draft");await expect(page.getByLabel("Song title")).toHaveValue("Grouped title");await page.getByRole("button",{name:"Mute Grand piano",exact:true}).click();await expect(page.getByRole("button",{name:"Mute Grand piano",exact:true})).not.toHaveAttribute("aria-pressed","true");
  await page.getByLabel("Tempo",{exact:true}).press("Escape");await expect(page.getByLabel("Tempo",{exact:true})).toHaveValue("120");
  await page.getByText("Custom chord card",{exact:true}).click();await page.getByLabel("New chord symbol").fill("C");await page.locator(".custom-chord-cards .suggestion-card").focus();await page.keyboard.press("d");await page.keyboard.press("Enter");
  await expect(page.locator(".chord-card")).toHaveCount(1);await expect(page.locator(".chord-card.selected")).toHaveCount(1);
  await page.getByLabel("New chord symbol").fill("Dm");await page.locator(".custom-chord-cards .suggestion-card").focus();await page.keyboard.press("d");await page.keyboard.press("Enter");await expect(page.locator(".chord-card.selected strong")).toHaveText("Dm");
  await page.getByText("More chord options",{exact:true}).click();await page.getByRole("button",{name:"Remove · leave rest",exact:true}).click();await expect(page.locator(".chord-rest")).not.toHaveCount(0);
  await page.getByLabel("Undo",{exact:true}).click();await expect(page.locator(".chord-card.selected strong")).toHaveText("Dm");
  await page.getByText("More chord options",{exact:true}).click();await page.getByLabel("Chord note 1 MIDI pitch").fill("51");await page.getByLabel("Chord note 1 MIDI pitch").press("Enter");await page.getByLabel("Undo",{exact:true}).click();await expect(page.getByLabel("Chord note 1 MIDI pitch")).not.toHaveValue("51");
  const lane=page.locator(".chord-lane"),box=await lane.boundingBox();await page.locator(".chord-handle").first().dragTo(lane,{targetPosition:{x:box!.width*.25,y:80}});await expect(page.locator(".chord-card.selected")).toHaveCount(1);await page.getByLabel("Undo",{exact:true}).click();await expect(page.locator(".chord-card")).toHaveCount(1);
  await page.getByLabel("Selected chord duration in beats").fill("999");await page.getByLabel("Selected chord duration in beats").press("Enter");await expect(page.getByRole("alert").filter({hasText:"Needs"}).first()).toBeVisible();await expect(page.locator(".chord-card")).toHaveCount(1);await page.getByLabel("Selected chord duration in beats").press("Escape");
  await page.getByRole("navigation").getByRole("button",{name:"04 Mix"}).click();const fader=page.getByLabel("Grand piano volume",{exact:true}),volume=await fader.inputValue();await fader.focus();await page.keyboard.down("ArrowLeft");await page.keyboard.press("ArrowLeft");await page.keyboard.up("ArrowLeft");await page.getByLabel("Undo",{exact:true}).click();await expect(fader).toHaveValue(volume);
});

test("activity cancellation silences common output and delayed loads cannot restart", async ({page}) => {
  const wavBytes=[...new Uint8Array(encodeWav([new Float32Array(4800).fill(.1)],48000,16))];
  await page.goto("/");
  const result = await page.evaluate(async bytes => {
    const {StudioEngine} = await import("/lib/audio/engine.ts" as string);
    const {createProject,createTrack} = await import("/lib/music/project.ts" as string);
    const p=createProject(),t=createTrack("lead"); p.tracks=[t]; p.master.reverbDecay=1;
    t.sound.release=1; t.sound.attack=0.005; t.reverb=0.6; t.delay=0.5; t.volume=0;
    const engine=new StudioEngine(p,async()=>{throw Error("unused");});
    const context=await engine.unlock();
    const source=`class Probe extends AudioWorkletProcessor {
      constructor(){super();this.n=0;this.sum=0;this.peak=0;this.finite=true;this.start=currentFrame;}
      process(inputs){const input=inputs[0];for(let i=0;i<128;i++){for(const ch of input){const v=ch[i]??0;this.sum+=v*v;this.peak=Math.max(this.peak,Math.abs(v));this.finite&&=Number.isFinite(v);}this.n++;if(this.n>=sampleRate*.1){this.port.postMessage({start:this.start,end:currentFrame+i,peak:this.peak,rms:Math.sqrt(this.sum/(this.n*Math.max(1,input.length))),finite:this.finite});this.start=currentFrame+i+1;this.n=0;this.sum=0;this.peak=0;this.finite=true;}}return true;}}
      registerProcessor('workflow-probe',Probe);`;
    const url=URL.createObjectURL(new Blob([source],{type:"text/javascript"}));
    await context.audioWorklet.addModule(url); URL.revokeObjectURL(url);
    const probe=new AudioWorkletNode(context,"workflow-probe"),silent=context.createGain();silent.gain.value=0;
    engine.outputNode.connect(probe);probe.connect(silent);silent.connect(context.destination);
    const windows: {start:number;end:number;peak:number;rms:number;finite:boolean}[]=[];
    probe.port.onmessage=(e)=>windows.push(e.data);
    const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
    await engine.previewNotes(t.id,[{trackId:t.id,pitch:60,tick:0,duration:960,velocity:1,index:0},{trackId:t.id,pitch:67,tick:3840,duration:960,velocity:1,index:1}],"fixture");
    await wait(350);const before=Math.max(...windows.map(w=>w.rms));
    const stopFrame=context.currentTime*context.sampleRate;engine.stop();await wait(8500);
    const after=windows.filter(w=>w.start>=stopFrame+context.sampleRate*.1);
    // Same-pitch owners stay independent across key release and activity replacement.
    await engine.noteOn(t.id,60,0.9,"computer:KeyA");await engine.noteOn(t.id,60,0.9,"midi:port:0:60");
    engine.noteOff(t.id,60,"computer:KeyA");await wait(1300);
    const heldAfterRelease=engine.meter().master;
    await engine.preview(t.id,[64],.2,"another");engine.cancelAudition();await wait(100);
    const heldAfterCancel=engine.meter().master;
    const added=createTrack("bass");p.tracks.push(added);engine.updateProject(p);await engine.noteOn(added.id,48,.8,"computer:KeyS");
    const newTrackPlayable=engine.meter().master;engine.stop();
    const blob=new Blob([Uint8Array.from(bytes)],{type:"audio/wav"});
    let release!: (blob:Blob)=>void;const delayed=new Promise<Blob>(r=>release=r);
    const sample={id:"user",name:"Delayed",family:"test",description:"test",kind:"sample",zones:[{assetId:"sample",root:60,low:0,high:127,velocityLow:0,velocityHigh:1,roundRobin:0,articulation:"sustain"}],articulations:["sustain"],license:"User supplied",source:"fixture",defaults:{attack:.01,release:.1,detune:0}};
    p.userInstruments=[sample];t.instrumentId="user";engine.updateProject(p);
    const slow=new StudioEngine(p,()=>delayed);await slow.unlock();
    const slowContext=slow.rawContext;const probeUrl=URL.createObjectURL(new Blob([source],{type:"text/javascript"}));await slowContext.audioWorklet.addModule(probeUrl);URL.revokeObjectURL(probeUrl);
    const slowProbe=new AudioWorkletNode(slowContext,"workflow-probe"),slowSilent=slowContext.createGain();slowSilent.gain.value=0;slow.outputNode.connect(slowProbe);slowProbe.connect(slowSilent);slowSilent.connect(slowContext.destination);const lateWindows: {peak:number;rms:number}[]=[];slowProbe.port.onmessage=(e)=>lateWindows.push(e.data);
    const loading=slow.preview(t.id,[60]);slow.stop();release(blob);await loading;await wait(1200);
    const lateState=slow.state,latePeak=slow.meter().master;
    slow.dispose();engine.dispose();probe.disconnect();silent.disconnect();
    return {before,windows:after,heldAfterRelease,heldAfterCancel,newTrackPlayable,lateWindows,lateState,latePeak};
  },wavBytes);
  expect(result.before).toBeGreaterThan(1e-3);
  expect(result.windows.length).toBeGreaterThan(75);
  for(const window of result.windows) { expect(window.finite).toBe(true);expect(window.peak).toBeLessThan(1e-4);expect(window.rms).toBeLessThan(1e-5); }
  expect(result.heldAfterRelease).toBeGreaterThan(1e-3);
  expect(result.heldAfterCancel).toBeGreaterThan(1e-3);
  expect(result.newTrackPlayable).toBeGreaterThan(0);
  expect(result.lateWindows.length).toBeGreaterThan(5);for(const w of result.lateWindows) {expect(w.peak).toBeLessThan(1e-4);expect(w.rms).toBeLessThan(1e-5);}
  expect(result.lateState.activity).toBe("idle");expect(result.latePeak).toBeLessThan(1e-4);
  mkdirSync("output/playwright",{recursive:true});writeFileSync("output/playwright/cancellation.json",JSON.stringify(result,null,2));
});

test("pre-capture Stop creates no take; failed preservation retries exactly once",async({page})=>{
  await page.goto("/");await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button",{name:"Songs",exact:true}).click();await page.getByRole("button",{name:"Blank song"}).click();
  await page.getByLabel("Recording source").selectOption("audio");
  await page.getByLabel("Start recording",{exact:true}).click();
  await page.getByLabel("Stop song",{exact:true}).click();
  await expect(page.getByLabel("Start recording",{exact:true})).toBeEnabled();
  const empty=await page.evaluate(async()=>{const {latestDraft}=await import("/lib/client/storage.ts" as string);return (await latestDraft("guest")).document.assets.length;});
  expect(empty).toBe(0);
  await page.evaluate(()=>{const original=IDBDatabase.prototype.transaction;let fail=true;IDBDatabase.prototype.transaction=function(...args:Parameters<typeof original>){if(fail&&Array.isArray(args[0])&&args[0].length===3){fail=false;throw new Error("Injected storage failure");}return original.apply(this,args);};});
  await page.getByLabel("Start recording",{exact:true}).click();
  await expect(page.locator(".transport-position")).toContainText("Recording",{timeout:10000});
  await expect(page.getByRole("button",{name:"Add instrument track",exact:true})).toBeDisabled();
  await page.waitForTimeout(350);await page.getByLabel("Stop song",{exact:true}).click();
  await expect(page.getByRole("button",{name:"Retry take save"})).toBeVisible();
  await expect(page.getByText("Take kept in memory",{exact:false})).toBeVisible();
  await page.getByRole("button",{name:"Retry take save"}).evaluate((el)=>{(el as HTMLButtonElement).click();(el as HTMLButtonElement).click();});
  await expect(page.getByLabel("Start recording",{exact:true})).toBeEnabled();
  await page.waitForTimeout(350);
  const saved=await page.evaluate(async()=>{const {latestDraft,pendingAsset}=await import("/lib/client/storage.ts" as string);const d=await latestDraft("guest");return {assets:d.document.assets.length,clips:d.document.tracks.flatMap((t:{clips:unknown[]})=>t.clips).length,pending:!!await pendingAsset("guest",d.document.assets[0].id)};});
  expect(saved).toEqual({assets:1,clips:1,pending:true});
});

test("late microphone preparation cannot stop a successor recording",async({page})=>{
  await page.goto("/");await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByRole("button",{name:"Songs",exact:true}).click();await page.getByRole("button",{name:"Blank song"}).click();
  await page.evaluate(()=>{
    const state=globalThis as unknown as {micCalls:number;releaseFirst:()=>void};
    state.micCalls=0;let release!:()=>void;const gate=new Promise<void>(r=>release=r);state.releaseFirst=release;
    const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async constraints=>{if(++state.micCalls===1) await gate;return original(constraints);};
  });
  await page.getByLabel("Recording source").selectOption("audio");await page.getByLabel("Start recording",{exact:true}).click();
  await page.waitForFunction(()=>(globalThis as unknown as {micCalls:number}).micCalls===1);
  await page.getByLabel("Stop song",{exact:true}).click();await page.getByLabel("Start recording",{exact:true}).click();
  await expect(page.locator(".transport-position")).toContainText("Recording",{timeout:10000});
  await page.evaluate(()=>(globalThis as unknown as {releaseFirst:()=>void}).releaseFirst());await page.waitForTimeout(200);
  await expect(page.locator(".transport-position")).toContainText("Recording");
  await page.getByLabel("Finish recording",{exact:true}).click();
  await expect(page.getByLabel("Start recording",{exact:true})).toBeEnabled();
  await page.waitForTimeout(350);
  const count=await page.evaluate(async()=>{const {latestDraft}=await import("/lib/client/storage.ts" as string);return (await latestDraft("guest")).document.assets.length;});
  expect(count).toBe(1);
});

test("shortcut focus, protected Stop, capture conflicts and preference reload",async({page})=>{
  await page.goto("/");await expect(page.getByLabel("Song title")).toBeEnabled();
  await page.getByLabel("Play song",{exact:true}).click();await expect(page.getByLabel("Pause song",{exact:true})).toBeVisible();
  await page.getByLabel("Song title").focus();await page.keyboard.press("Control+Shift+Enter");await expect(page.getByLabel("Play song",{exact:true})).toBeVisible();
  await page.getByLabel("Song title").press("Space");await expect(page.getByLabel("Play song",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Songs",exact:true}).focus();await page.keyboard.press("Space");await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");await expect(page.getByRole("dialog")).toHaveCount(0);await expect(page.getByLabel("Play song",{exact:true})).toBeVisible();
  await page.getByLabel("Keyboard shortcuts").click();
  const row=page.locator(".shortcut-row").filter({has:page.getByText("Play / pause",{exact:true})});
  await row.getByRole("button",{name:"Space",exact:true}).click();await page.keyboard.press("a");await expect(page.getByRole("alert")).toContainText("performance piano");
  await page.keyboard.press("Control+Shift+Enter");await expect(page.getByRole("alert")).toContainText("reserved");
  await page.keyboard.press("Escape");await expect(page.getByRole("dialog")).toBeVisible();
  await row.getByRole("button",{name:"Space",exact:true}).click();await page.keyboard.press("x");await expect(row.getByRole("button",{name:"X",exact:true})).toBeVisible();
  await page.keyboard.press("Escape");await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator("h1").evaluate(()=>{(document.activeElement as HTMLElement)?.blur();});
  await page.keyboard.press("x");await expect(page.getByLabel("Pause song",{exact:true})).toBeVisible();
  await page.keyboard.press("Control+Shift+Enter");
  await page.keyboard.down("a");await expect(page.locator(".piano-key.held")).toHaveCount(1);
  await page.getByLabel("Song title").focus();await page.keyboard.up("a");await expect(page.locator(".piano-key.held")).toHaveCount(0);
  await page.reload();await expect(page.getByLabel("Song title")).toBeEnabled();await page.getByLabel("Keyboard shortcuts").click();
  await expect(page.locator(".shortcut-row").filter({has:page.getByText("Play / pause",{exact:true})}).getByRole("button",{name:"X",exact:true})).toBeVisible();
});
