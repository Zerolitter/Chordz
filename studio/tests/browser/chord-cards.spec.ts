import {test,expect} from "@playwright/test";
import {mkdirSync,writeFileSync} from "node:fs";
import type {Track} from "../../lib/music/types";

async function blank(page:import("@playwright/test").Page){await page.goto("/");await expect(page.getByLabel("Song title")).toBeEnabled();await page.getByRole("button",{name:"Songs",exact:true}).click();await page.getByRole("button",{name:"Blank song"}).click();}
test("chord cards audition on click, drop into rests, replace occupied bars and support keyboard placement",async({page})=>{
  await blank(page);await expect(page.getByRole("button",{name:"Insert chord",exact:true})).toHaveCount(0);await expect(page.locator(".insertion-marker")).toHaveCount(0);
  const palette=page.locator(".compact-suggestions .suggestion-card"),first=palette.first(),symbol=await first.locator("strong").innerText();
  await first.click();await expect(page.locator(".transport-position")).toContainText("Audition");await first.click();await expect(page.locator(".transport-position")).not.toContainText("Audition");
  const lane=page.locator(".chord-lane"),box=await lane.boundingBox();await first.dragTo(lane,{targetPosition:{x:3,y:40}});await expect(page.locator(".chord-card.selected strong")).toHaveText(symbol);await expect(page.getByLabel("Selected chord duration in beats")).toHaveValue("4");
  const second=palette.filter({hasText:"F"}).first(),replacement=await second.locator("strong").innerText();await second.dragTo(lane,{targetPosition:{x:box!.width/32,y:40}});await expect(page.locator(".chord-card")).toHaveCount(1);await expect(page.locator(".chord-card strong")).toHaveText(replacement);
  await page.getByLabel("Undo",{exact:true}).click();await expect(page.locator(".chord-card strong")).toHaveText(symbol);
  await palette.first().focus();await page.keyboard.press("d");await page.keyboard.press("Shift+ArrowRight");await page.keyboard.press("Enter");await expect(page.locator(".chord-card")).toHaveCount(2);
  await palette.first().focus();await page.keyboard.press("d");await page.keyboard.press("Escape");await page.keyboard.press("Enter");await expect(page.locator(".chord-card")).toHaveCount(2);await expect(page.locator(".insertion-marker")).toHaveCount(0);
  await palette.first().focus();await page.keyboard.press("d");await page.keyboard.press("Control+Shift+Enter");await expect(page.locator(".insertion-marker")).toHaveCount(0);await page.keyboard.press("Enter");await expect(page.locator(".chord-card")).toHaveCount(2);
  await palette.first().focus();await page.keyboard.press("d");await page.keyboard.press("Control+z");await expect(page.locator(".insertion-marker")).toHaveCount(0);await page.keyboard.press("Enter");await expect(page.locator(".chord-card")).toHaveCount(2);
  await page.getByText("Custom chord card",{exact:true}).click();await page.getByLabel("New chord symbol").fill("Cmaj9");await page.locator(".custom-chord-cards .suggestion-card").focus();await page.keyboard.press("d");await page.keyboard.press("Shift+ArrowRight");await page.keyboard.press("Enter");await expect(page.locator(".chord-card.selected strong")).toHaveText("Cmaj9");
});

test("tuning preserves FM pitch, quiet bus levels and a release shortened during attack",async({page})=>{
  await page.goto("/");const result=await page.evaluate(async()=>{
    const {makeGraph,makeVoice}=await import("/lib/audio/graph.ts" as string),{instrumentFor}=await import("/lib/audio/catalog.ts" as string),{createProject,createTrack}=await import("/lib/music/project.ts" as string),{StudioEngine}=await import("/lib/audio/engine.ts" as string);
    const p=createProject(),t=createTrack("lead");p.tracks=[t];p.master.limiter=false;t.reverb=0;t.delay=0;t.drive=0;t.volume=-6;
    t.sound={...t.sound,algorithm:"fm",detune:31,cutoff:9000,filterEnvelope:0,lfoDepth:0,attack:.18,decay:.15,sustain:.8,release:.8};
    const context=new OfflineAudioContext(2,48000,48000),graph=makeGraph(context,p,undefined,context.destination,false,true),voice=makeVoice(graph,t,instrumentFor(p,t),{trackId:t.id,pitch:69,tick:0,duration:768,velocity:1,index:0},0,.4,new Map());
    voice.updateSound({...t,sound:{...t.sound,cutoff:6000,release:.05}},.03);
    const buffer=await context.startRendering(),data=buffer.getChannelData(0),peak=(a:number,b:number)=>Math.max(...data.subarray(a*48000,b*48000).map(Math.abs));
    const carrier=voice.bend[0].value,modulator=voice.bend[1].value,attackPeak=peak(.05,.15),releaseTailPeak=peak(.48,.6);graph.dispose();
    t.volume=-60;t.sound.attack=.005;const engine=new StudioEngine(p,async()=>{throw Error("unused");});const live=await engine.unlock();
    const source=`class Probe extends AudioWorkletProcessor {process(inputs){let peak=0;for(const ch of inputs[0])for(const n of ch)peak=Math.max(peak,Math.abs(n));this.port.postMessage(peak);return true;}}registerProcessor('tuning-level',Probe);`;
    const url=URL.createObjectURL(new Blob([source],{type:"text/javascript"}));await live.audioWorklet.addModule(url);URL.revokeObjectURL(url);
    const probe=new AudioWorkletNode(live,"tuning-level"),silent=live.createGain();silent.gain.value=0;engine.outputNode.connect(probe);probe.connect(silent);silent.connect(live.destination);let peaks:number[]=[];probe.port.onmessage=e=>peaks.push(e.data);const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
    await engine.previewNotes(t.id,[{trackId:t.id,pitch:69,tick:0,duration:7680,velocity:.8,index:0}],"quiet");
    // Change bend while the first note is queued: its initial onset must not reset it.
    engine.expression(t.id,{tick:0,type:"pitchBend",value:.5});await wait(200);const queuedBend=engine.voices[0].bend.map((param:AudioParam)=>param.value);
    const before=Math.max(...peaks);peaks=[];engine.updateProject({...p,master:{...p.master,reverbDecay:.7}});await wait(250);const after=Math.max(...peaks),identity=engine.state.previewId;engine.dispose();probe.disconnect();silent.disconnect();
    return {carrier,modulator,attackPeak,releaseTailPeak,queuedBend,before,after,identity};
  });expect(result.carrier).toBeCloseTo(31,2);expect(result.modulator).toBeCloseTo(0,2);expect(result.attackPeak).toBeGreaterThan(.005);expect(result.releaseTailPeak).toBeLessThan(1e-5);expect(result.queuedBend[0]).toBeCloseTo(131,1);expect(result.queuedBend[1]).toBeCloseTo(100,1);expect(result.before).toBeGreaterThan(1e-6);expect(result.after).toBeLessThan(result.before*2);expect(result.identity).toBe("quiet");
  mkdirSync("output/playwright",{recursive:true});writeFileSync("output/playwright/tuning-regressions.json",JSON.stringify(result,null,2));
});

test("tuning during sample loading keeps a preview; swapping its instrument prevents late sound",async({page})=>{
  await page.goto("/");const result=await page.evaluate(async()=>{
    const {StudioEngine}=await import("/lib/audio/engine.ts" as string),{createProject,createTrack}=await import("/lib/music/project.ts" as string),{encodeWav}=await import("/lib/audio/wav.ts" as string);
    const p=createProject(),t=createTrack("lead");p.tracks=[t];t.reverb=0;t.delay=0;const pcm=new Float32Array(48000);for(let i=0;i<pcm.length;i++)pcm[i]=.3*Math.sin(i/48000*2*Math.PI*440);const blob=new Blob([encodeWav([pcm],48000,16)],{type:"audio/wav"});
    p.userInstruments=[{id:"user",name:"Delayed",family:"test",description:"test",kind:"sample",zones:[{assetId:"sample",root:69,low:0,high:127,velocityLow:0,velocityHigh:1,roundRobin:0,articulation:"sustain"}],articulations:["sustain"],license:"User supplied",source:"fixture",defaults:{attack:.01,release:.1,detune:0}}];t.instrumentId="user";
    const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
    let release!:(blob:Blob)=>void;const pending=new Promise<Blob>(r=>release=r),engine=new StudioEngine(p,()=>pending);await engine.unlock();
    const loading=engine.preview(t.id,[69],.7,"loading-tune");const tuned={...p,tracks:[{...t,volume:-30,sound:{...t.sound,detune:12}}]};engine.updateProject(tuned);const stillLoading=engine.state.previewId;release(blob);await loading;await wait(200);const playing=engine.state.previewId,peak=engine.meter().master;engine.dispose();
    let releaseSwap!:(blob:Blob)=>void;const delayed=new Promise<Blob>(r=>releaseSwap=r),swapped=new StudioEngine(p,()=>delayed);await swapped.unlock();const old=swapped.preview(t.id,[69],.7,"old-instrument");swapped.updateProject({...p,tracks:[{...t,instrumentId:"lead"}]});releaseSwap(blob);await old;await wait(300);const afterSwap=swapped.state,latePeak=swapped.meter().master;swapped.dispose();return {stillLoading,playing,peak,afterSwap,latePeak};
  });expect(result.stillLoading).toBe("loading-tune");expect(result.playing).toBe("loading-tune");expect(result.peak).toBeGreaterThan(1e-5);expect(result.peak).toBeLessThan(.03);expect(result.afterSwap.activity).toBe("idle");expect(result.latePeak).toBeLessThan(1e-4);
  mkdirSync("output/playwright",{recursive:true});writeFileSync("output/playwright/loading-tuning.json",JSON.stringify(result,null,2));
});

test("moving full-section cards repeatedly keeps whole neighbours and Undo restores the guide",async({page})=>{
  await page.goto("/");await expect(page.getByLabel("Song title")).toBeEnabled();
  const tiles=page.locator(".chord-card"),lane=page.locator(".chord-lane"),box=await lane.boundingBox();
  const guide=()=>tiles.evaluateAll(cards=>cards.map(c=>({left:(c as HTMLElement).style.left,width:(c as HTMLElement).style.width,symbol:c.querySelector("strong")?.textContent,notes:c.querySelector(".chord-select span")?.textContent})).sort((a,b)=>parseFloat(a.left)-parseFloat(b.left)));
  const original=await guide();expect(original).toHaveLength(8);
  for(let i=0;i<3;i++){
    await page.getByRole("button",{name:"Move Dm chord 1",exact:true}).dragTo(lane,{targetPosition:{x:box!.width*.54,y:40}});
    await expect(tiles).toHaveCount(8);await expect(page.getByLabel("Selected chord duration in beats")).toHaveValue("4");
    expect((await guide()).every(c=>c.width==="12.5%")).toBe(true);await expect(page.getByRole("alert").filter({hasText:"Needs"})).toHaveCount(0);
    await page.getByLabel("Undo",{exact:true}).click();expect(await guide()).toEqual(original);
  }
  await tiles.first().locator(".chord-select").click();await page.getByText("More chord options",{exact:true}).click();await page.getByRole("button",{name:"Move later",exact:true}).click();await expect(tiles).toHaveCount(8);await page.getByLabel("Undo",{exact:true}).click();expect(await guide()).toEqual(original);
  // Short existing spans occupy exactly their real timing, even below the old 40px minimum.
  await page.getByLabel("Chord snap").selectOption("quarter");await page.getByLabel("Selected chord duration in beats").fill("0.25");await page.getByLabel("Selected chord duration in beats").press("Enter");
  const geometry=await tiles.evaluateAll(cards=>cards.map(c=>{const box=c.getBoundingClientRect(),style=(c as HTMLElement).style,lane=c.parentElement!.getBoundingClientRect();return {left:box.left,width:box.width,expected:parseFloat(style.width)/100*lane.width};}).sort((a,b)=>a.left-b.left));
  expect(geometry[0].width).toBeLessThan(40);for(const g of geometry)expect(Math.abs(g.width-g.expected)).toBeLessThan(1);for(let i=1;i<geometry.length;i++)expect(geometry[i-1].left+geometry[i-1].width).toBeLessThanOrEqual(geometry[i].left+1);
  await page.screenshot({path:"output/playwright/intact-chord-moves.png",fullPage:true});
});

test("touch card pickup cancelled with Escape cannot commit on a late release",async({page})=>{
  await page.setViewportSize({width:1440,height:1400});await blank(page);await page.locator('[data-slot="dialog-overlay"]').waitFor({state:"detached"});await page.locator(".compact-suggestions .suggestion-card").first().scrollIntoViewIfNeeded();
  const source=await page.locator(".compact-suggestions .suggestion-card").first().boundingBox(),lane=await page.locator(".chord-lane").boundingBox(),session=await page.context().newCDPSession(page);
  await session.send("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:1});
  const point=(x:number,y:number)=>[{x,y,id:1,radiusX:1,radiusY:1,force:1}];
  await session.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:point(source!.x+20,source!.y+20)});
  await session.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:point(lane!.x+20,lane!.y+40)});await expect(page.locator(".insertion-marker")).toHaveCount(1);
  await page.keyboard.press("Escape");await session.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await expect(page.locator(".chord-card")).toHaveCount(0);await expect(page.locator(".insertion-marker")).toHaveCount(0);
  await session.detach();
});

test("chord end handles resize in snapped gestures, cancel on Escape, and keep an invalid end unchanged",async({page})=>{
  await blank(page);await page.locator(".compact-suggestions .suggestion-card").first().focus();await page.keyboard.press("d");await page.keyboard.press("Enter");
  const length=page.getByLabel("Selected chord duration in beats"),handle=page.getByRole("slider",{name:/Resize .* chord/}),lane=await page.locator(".chord-lane").boundingBox();
  await handle.focus();await page.keyboard.down("ArrowRight");await page.keyboard.press("ArrowRight");await page.keyboard.up("ArrowRight");await expect(length).toHaveValue("6");await page.getByLabel("Undo",{exact:true}).click();await expect(length).toHaveValue("4");
  let h=await handle.boundingBox();await page.mouse.move(h!.x+h!.width/2,h!.y+h!.height/2);await page.mouse.down();await page.mouse.move(h!.x+h!.width/2+lane!.width/8,h!.y+h!.height/2,{steps:8});await page.mouse.up();await expect(length).toHaveValue("8");await page.getByLabel("Undo",{exact:true}).click();await expect(length).toHaveValue("4");
  h=await handle.boundingBox();await page.mouse.move(h!.x+h!.width/2,h!.y+h!.height/2);await page.mouse.down();await page.mouse.move(h!.x+lane!.width/8,h!.y+30);await page.keyboard.press("Escape");await page.mouse.up();await expect(length).toHaveValue("4");
  h=await handle.boundingBox();await page.mouse.move(h!.x+h!.width/2,h!.y+30);await page.mouse.down();await page.mouse.move(h!.x+lane!.width*1.3,h!.y+30,{steps:6});await page.mouse.up();await expect(length).toHaveValue("4");await expect(page.getByRole("alert").filter({hasText:"Needs"})).toBeVisible();
  const oldOctave=await page.getByLabel("Chord note 1 octave").inputValue(),newOctave=String(Number(oldOctave)+1);
  await page.getByLabel("Chord note 1 octave").fill(newOctave);await page.getByLabel("Chord note 1 octave").press("Enter");await expect(page.getByLabel("Chord note 1 octave")).toHaveValue(newOctave);await page.getByLabel("Undo",{exact:true}).click();await expect(page.getByLabel("Chord note 1 octave")).toHaveValue(oldOctave);
  await handle.focus();await page.keyboard.down("ArrowRight");await page.keyboard.press("Escape");await page.keyboard.down("ArrowRight");await page.keyboard.up("ArrowRight");await expect(length).toHaveValue("4");
  for(const [width,height]of [[1346,1244],[820,1180],[390,844]]){await page.setViewportSize({width,height});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:"output/playwright/chord-cards-"+width+".png",fullPage:true});}
});

test("sound workspace tuning preserves the audition while instrument swaps cancel it",async({page})=>{
  await blank(page);await page.getByLabel("Add instrument track").click();await page.getByRole("button",{name:/Glass FM.*Synthesizers/}).click();await page.getByRole("button",{name:"Audition",exact:true}).click();await expect(page.locator(".transport-position")).toContainText("Audition");
  await page.getByRole("navigation").getByRole("button",{name:"03 Sound"}).click();await page.getByLabel("FM depth value",{exact:true}).fill("7");await expect(page.locator(".transport-position")).toContainText("Audition");
  const cutoff=Math.exp(Math.log(40)+.7*(Math.log(18000)-Math.log(40)));
  await page.getByLabel("Filter cutoff value",{exact:true}).fill(String(cutoff));await page.getByLabel("Expression value",{exact:true}).fill("0.5");await expect(page.locator(".transport-position")).toContainText("Audition");
  await page.getByRole("navigation").getByRole("button",{name:"04 Mix"}).click();await page.getByLabel("Glass FM volume",{exact:true}).fill("-10");await expect(page.locator(".transport-position")).toContainText("Audition");
  await page.locator(".instrument-select").click();await page.getByRole("button",{name:/Warm sub bass.*Synthesizers/}).click();await expect(page.locator(".transport-position")).not.toContainText("Audition");
});

test("held and future preview notes adopt tuning without a restart and Stop stays silent",async({page})=>{
  await page.goto("/");const result=await page.evaluate(async()=>{
    const {StudioEngine}=await import("/lib/audio/engine.ts" as string),{createProject,createTrack}=await import("/lib/music/project.ts" as string);
    let p=createProject();const t=createTrack("lead");p.tracks=[t];p.master.limiter=false;t.reverb=0;t.delay=0;t.drive=0;t.sound={...t.sound,algorithm:"subtractive",wave:"sawtooth",cutoff:9000,resonance:.7,filterEnvelope:0,detune:0,attack:.005,decay:.02,sustain:.8,release:.06};
    t.automation=[{parameter:"volume",points:[{tick:0,value:-80}]},{parameter:"cutoff",points:[{tick:0,value:40}]}];
    const engine=new StudioEngine(p,async()=>{throw Error("unused");});await engine.unlock();const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
    const rms=()=>{const data=new Float32Array(2048);engine.outputNode.getFloatTimeDomainData(data);return Math.sqrt(data.reduce((sum:number,n:number)=>sum+n*n,0)/data.length);};
    await engine.previewNotes(t.id,[{trackId:t.id,pitch:69,tick:0,duration:7680,velocity:.9,index:0},{trackId:t.id,pitch:72,tick:9600,duration:960,velocity:.8,index:1}],"continuous");await wait(350);const before=rms();
    const tune=(patch:Record<string,unknown>)=>{p={...p,tracks:p.tracks.map((track:Track)=>({...track,sound:{...track.sound,...patch}}))};engine.updateProject(p);};
    tune({cutoff:100});await wait(200);const dark=rms(),afterCutoff=engine.state.previewId;
    tune({cutoff:9000,wave:"sine",detune:9});await wait(200);const reopened=rms();engine.expression(t.id,{tick:0,type:"expression",value:.01});await wait(200);const quiet=rms();engine.expression(t.id,{tick:0,type:"expression",value:1});
    p={...p,master:{...p.master,reverbDecay:.5,limiter:true}};engine.updateProject(p);await wait(200);const afterBus=engine.state.previewId,afterBusRms=rms();
    tune({algorithm:"fm",fmRatio:3,fmIndex:5});await wait(4200);const futureRms=rms(),futureState=engine.state.previewId;
    engine.stop();await wait(150);const stopped=rms();engine.dispose();return {before,dark,afterCutoff,reopened,quiet,afterBus,afterBusRms,futureRms,futureState,stopped};
  });expect(result.before).toBeGreaterThan(.01);expect(result.dark).toBeLessThan(result.before*.3);expect(result.afterCutoff).toBe("continuous");expect(result.reopened).toBeGreaterThan(result.dark*2);expect(result.quiet).toBeLessThan(result.reopened*.2);expect(result.afterBus).toBe("continuous");expect(result.afterBusRms).toBeGreaterThan(.001);expect(result.futureState).toBe("continuous");expect(result.futureRms).toBeGreaterThan(.001);expect(result.stopped).toBeLessThan(1e-5);
  mkdirSync("output/playwright",{recursive:true});writeFileSync("output/playwright/continuous-tuning.json",JSON.stringify(result,null,2));
});
