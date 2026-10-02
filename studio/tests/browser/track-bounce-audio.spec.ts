import {expect,test} from "@playwright/test";
import {mkdirSync,writeFileSync} from "node:fs";

function evidence(name:string,report:unknown){mkdirSync("output/phase4-audio",{recursive:true});writeFileSync(`output/phase4-audio/${name}.json`,JSON.stringify(report,null,2));}

test("an instrument stem survives 24-bit WAV and neutral bounced playback with stereo automation and tails",async({page})=>{
  await page.goto("/");
  const report=await page.evaluate(async()=>{
    const {StudioEngine}=await import("/lib/audio/engine.ts" as string),{createProject,createTrack,emptyClip}=await import("/lib/music/project.ts" as string),{encodeWav}=await import("/lib/audio/wav.ts" as string);
    const project=createProject(),source=createTrack("lead","Source");project.tracks=[source];project.seed=481;
    project.master={...project.master,volume:-9,limiter:true,reverbDecay:.3};
    source.volume=-8;source.pan=-.3;source.reverb=.12;source.delay=.08;
    source.sound={...source.sound,algorithm:"subtractive",wave:"sawtooth",detune:0,attack:.002,decay:.02,sustain:.7,release:.2,cutoff:18000,resonance:0,filterEnvelope:0,lfoDepth:0};
    const phrase=emptyClip(960,1920);phrase.notes=[{id:"held",pitch:84,tick:0,duration:1680,velocity:.6},{id:"end",pitch:72,tick:1440,duration:480,velocity:.4}];
    phrase.events=[{type:"expression",tick:0,value:.8},{type:"expression",tick:960,value:.5}];source.clips=[phrase];
    source.automation=[{parameter:"volume",points:[{tick:0,value:-6},{tick:2880,value:-15}]},{parameter:"pan",points:[{tick:0,value:-.3},{tick:2880,value:.35}]}];
    const captured=JSON.stringify(project),engine=new StudioEngine(project,async()=>new Blob());
    const stem=await engine.render(project,source.id,undefined,{range:{startTick:960,endTick:2880},includeTails:true,preMaster:true});
    const wav=encodeWav([stem.getChannelData(0),stem.getChannelData(1)],48000,24),blob=new Blob([wav],{type:"audio/wav"});
    const decoder=new AudioContext({sampleRate:48000}),decoded=await decoder.decodeAudioData(wav.slice(0));await decoder.close();
    const bounced=createTrack("piano","Bounced",source.color,"audio");
    Object.assign(bounced,{volume:0,pan:0,reverb:0,delay:0,low:0,mid:0,high:0,drive:0});bounced.sound={...bounced.sound,cutoff:20000,resonance:0,lfoDepth:0,filterEnvelope:0};
    const region=emptyClip(0,Math.ceil(stem.duration*project.tempo/60*960));region.audio={assetId:"bounce",offsetSec:0,gain:1,fadeInSec:0,fadeOutSec:0};bounced.clips=[region];
    const playback={...project,tracks:[{...source,mute:true},bounced],assets:[{id:"bounce",name:"bounce.wav",mime:blob.type,byteLength:blob.size,duration:stem.duration,sampleRate:48000,channels:2}]};
    const replay=new StudioEngine(playback,async()=>blob);
    try{
      const result=await replay.render(playback,bounced.id,stem.duration,{preMaster:true}),
        fullBefore=await engine.render(project,undefined,stem.duration+.5),
        placed={...playback,tracks:[{...source,mute:true},{...bounced,clips:[{...region,startTick:960}]}]},
        fullAfter=await replay.render(placed,undefined,stem.duration+.5);
      let playbackError=0,quantizationError=0,stereoDifference=0,tailPeak=0,fullMixError=0;
      for(let ch=0;ch<2;ch++)for(let i=0;i<stem.length;i++){
        playbackError=Math.max(playbackError,Math.abs(result.getChannelData(ch)[i]-decoded.getChannelData(ch)[i]));
        quantizationError=Math.max(quantizationError,Math.abs(stem.getChannelData(ch)[i]-decoded.getChannelData(ch)[i]));
        if(i>48000)tailPeak=Math.max(tailPeak,Math.abs(stem.getChannelData(ch)[i]));
        stereoDifference=Math.max(stereoDifference,Math.abs(stem.getChannelData(0)[i]-stem.getChannelData(1)[i]));
      }
      for(let ch=0;ch<2;ch++)for(let i=0;i<fullBefore.length;i++)fullMixError=Math.max(fullMixError,Math.abs(fullBefore.getChannelData(ch)[i]-fullAfter.getChannelData(ch)[i]));
      return {playbackError,quantizationError,stereoDifference,tailPeak,fullMixError,frames:result.length,expectedFrames:stem.length,channels:result.numberOfChannels,rate:result.sampleRate,depth:new DataView(wav).getUint16(34,true),unchanged:JSON.stringify(project)===captured};
    }finally{engine.dispose();replay.dispose();}
  });
  evidence("wav-roundtrip",report);
  expect(report.playbackError).toBeLessThan(1e-6);expect(report.quantizationError).toBeLessThan(2e-7);
  expect(report.fullMixError).toBeLessThan(1e-6);
  expect(report.stereoDifference).toBeGreaterThan(.001);expect(report.tailPeak).toBeGreaterThan(.00001);
  expect(report.frames).toBe(report.expectedFrames);expect(report).toMatchObject({channels:2,rate:48000,depth:24,unchanged:true});
});

for(const startTick of [3841,3839])test(`bounce-plan audio retains sample alignment at tempo 137 and off-grid start tick ${startTick}`,async({page})=>{
  await page.goto("/");
  const report=await page.evaluate(async({startTick})=>{
    const {StudioEngine}=await import("/lib/audio/engine.ts" as string),{planTrackBounce,applyTrackBounce}=await import("/lib/music/track-bounce.ts" as string),
      {createProject,createTrack,emptyClip,tickToSeconds}=await import("/lib/music/project.ts" as string),{encodeWav}=await import("/lib/audio/wav.ts" as string);
    const project=createProject("Off-grid bounce"),source=createTrack("lead","Source");project.tempo=137;project.seed=619;project.tracks=[source];
    project.master={...project.master,volume:0,limiter:false,reverbDecay:.3};source.volume=-8;source.pan=.2;source.reverb=.08;source.delay=.05;
    source.sound={...source.sound,algorithm:"subtractive",wave:"sawtooth",detune:0,attack:.002,decay:.02,sustain:.7,release:.2,cutoff:18000,resonance:0,filterEnvelope:0,lfoDepth:0};
    const phrase=emptyClip(startTick,3333);phrase.notes=[{id:"first",pitch:84,tick:0,duration:2666,velocity:.6},{id:"last",pitch:76,tick:2877,duration:456,velocity:.5}];source.clips=[phrase];
    source.automation=[{parameter:"volume",points:[{tick:0,value:-6},{tick:startTick+3333,value:-15}]},{parameter:"pan",points:[{tick:0,value:-.2},{tick:startTick+3333,value:.3}]}];
    const original=JSON.stringify(project),plan=planTrackBounce(project,source.id,{includeTails:true,muteSource:true}),engine=new StudioEngine(project,async()=>new Blob());
    const stem=await engine.render(plan.renderProject,source.id,undefined,{range:plan.range,includeTails:plan.includeTails,preMaster:true}),
      wav=encodeWav([stem.getChannelData(0),stem.getChannelData(1)],48000,24),blob=new Blob([wav],{type:"audio/wav"}),
      asset={id:plan.assetId,name:"bounce.wav",mime:blob.type,byteLength:blob.size,duration:stem.duration,sampleRate:48000,channels:2},
      result=applyTrackBounce(project,plan,asset),audio=result.document.tracks.find((track:{id:string})=>track.id===result.trackId)!,region=audio.clips[0],
      replay=new StudioEngine(result.document,async()=>blob);
    try{
      const before=await engine.render(project,undefined,plan.renderFrames/48000),after=await replay.render(result.document,undefined,plan.renderFrames/48000);
      let error=0,peak=0;const shiftedErrors=[];
      for(let shift=-2;shift<=2;shift++){
        let shiftedError=0;
        for(let ch=0;ch<2;ch++)for(let i=2;i<before.length-2;i++)shiftedError=Math.max(shiftedError,Math.abs(before.getChannelData(ch)[i]-after.getChannelData(ch)[i+shift]));
        shiftedErrors.push({shift,error:shiftedError});
      }
      for(let ch=0;ch<2;ch++)for(let i=0;i<before.length;i++){error=Math.max(error,Math.abs(before.getChannelData(ch)[i]-after.getChannelData(ch)[i]));peak=Math.max(peak,Math.abs(before.getChannelData(ch)[i]));}
      return {error,peak,shiftedErrors,startTick:region.startTick,startFrameExact:tickToSeconds(region.startTick,project.tempo)*48000,regionTicks:region.lengthTick,
        regionSeconds:tickToSeconds(region.lengthTick,project.tempo),assetSeconds:asset.duration,frames:stem.length,expectedFrames:plan.outputFrames,unchanged:JSON.stringify(project)===original};
    }finally{engine.dispose();replay.dispose();}
  },{startTick});evidence(`off-grid-placement-${startTick}`,report);
  expect(report).toMatchObject({startTick,unchanged:true});expect(report.frames).toBe(report.expectedFrames);
  expect(report.regionSeconds).toBeGreaterThanOrEqual(report.assetSeconds);expect(report.peak).toBeGreaterThan(.001);expect(report.error).toBeLessThan(1e-6);
});

test("bounce with tails prints volume and send automation after the last clip",async({page})=>{
  await page.goto("/");
  const report=await page.evaluate(async()=>{
    const {StudioEngine}=await import("/lib/audio/engine.ts" as string),{planTrackBounce,applyTrackBounce}=await import("/lib/music/track-bounce.ts" as string),
      {createProject,createTrack,emptyClip}=await import("/lib/music/project.ts" as string),{encodeWav}=await import("/lib/audio/wav.ts" as string),
      {holdExportAutomation}=await import("/lib/audio/export-range.ts" as string);
    const project=createProject("Automated tail"),source=createTrack("lead","Source");project.seed=932;project.tracks=[source];
    project.master={...project.master,volume:0,limiter:false,reverbDecay:.3};source.volume=-8;source.pan=.3;source.reverb=.12;source.delay=.05;
    source.sound={...source.sound,algorithm:"subtractive",wave:"sine",detune:0,attack:.01,decay:.02,sustain:.8,release:1,cutoff:18000,resonance:0,filterEnvelope:0,lfoDepth:0};
    const phrase=emptyClip(960,1920);phrase.notes=[{id:"release",pitch:69,tick:0,duration:1920,velocity:.7}];source.clips=[phrase];
    source.automation=[{parameter:"volume",points:[{tick:0,value:-8},{tick:2880,value:-8},{tick:6720,value:-32}]},{parameter:"reverb",points:[{tick:0,value:.12},{tick:2880,value:.12},{tick:4800,value:.35}]}];
    const plan=planTrackBounce(project,source.id,{includeTails:true,muteSource:true}),engine=new StudioEngine(project,async()=>new Blob()),
      stem=await engine.render(plan.renderProject,source.id,undefined,{range:plan.range,includeTails:true,preMaster:true}),
      wav=encodeWav([stem.getChannelData(0),stem.getChannelData(1)],48000,24),blob=new Blob([wav],{type:"audio/wav"}),
      asset={id:plan.assetId,name:"bounce.wav",mime:blob.type,byteLength:blob.size,duration:stem.duration,sampleRate:48000,channels:2},
      result=applyTrackBounce(project,plan,asset),replay=new StudioEngine(result.document,async()=>blob);
    try{
      const before=await engine.render(project,undefined,plan.renderFrames/48000),after=await replay.render(result.document,undefined,plan.renderFrames/48000),
        held=await engine.render(holdExportAutomation(plan.renderProject,plan.range.endTick),source.id,undefined,{range:plan.range,includeTails:true,preMaster:true});
      let error=0,tailPeak=0,tailPolicyDifference=0;
      for(let ch=0;ch<2;ch++)for(let i=0;i<before.length;i++){
        error=Math.max(error,Math.abs(before.getChannelData(ch)[i]-after.getChannelData(ch)[i]));
        if(i>72000)tailPeak=Math.max(tailPeak,Math.abs(before.getChannelData(ch)[i]));
      }
      for(let ch=0;ch<2;ch++)for(let i=48000;i<stem.length;i++)tailPolicyDifference=Math.max(tailPolicyDifference,Math.abs(stem.getChannelData(ch)[i]-held.getChannelData(ch)[i]));
      return {error,tailPeak,tailPolicyDifference,frames:stem.length,expectedFrames:plan.outputFrames};
    }finally{engine.dispose();replay.dispose();}
  });evidence("tail-automation",report);
  expect(report.error).toBeLessThan(1e-6);expect(report.tailPeak).toBeGreaterThan(.001);expect(report.tailPolicyDifference).toBeGreaterThan(.001);expect(report.frames).toBe(report.expectedFrames);
});

test("bounce tails preserve a ten-second static release and its following effects",async({page})=>{
  await page.goto("/");
  const report=await page.evaluate(async()=>{
    const {StudioEngine}=await import("/lib/audio/engine.ts" as string),{planTrackBounce,applyTrackBounce}=await import("/lib/music/track-bounce.ts" as string),
      {createProject,createTrack,emptyClip,tickToSeconds}=await import("/lib/music/project.ts" as string),{encodeWav}=await import("/lib/audio/wav.ts" as string);
    const project=createProject("Long release"),source=createTrack("lead","Source");project.seed=947;project.tracks=[source];
    project.master={...project.master,volume:0,limiter:false,reverbDecay:.3};source.volume=0;source.pan=.2;source.reverb=.2;source.delay=.12;
    source.sound={...source.sound,algorithm:"subtractive",wave:"sine",detune:0,attack:.01,decay:.02,sustain:.8,release:10,cutoff:18000,resonance:0,filterEnvelope:0,lfoDepth:0};
    const phrase=emptyClip(960,1920);phrase.notes=[{id:"long_release",pitch:69,tick:0,duration:1920,velocity:.8}];source.clips=[phrase];
    const plan=planTrackBounce(project,source.id,{includeTails:true,muteSource:true}),engine=new StudioEngine(project,async()=>new Blob()),
      requiredTail=source.sound.release+.1+Math.max(project.master.reverbDecay*2,4),referenceSeconds=tickToSeconds(plan.range.endTick,project.tempo)+requiredTail,
      stem=await engine.render(plan.renderProject,source.id,undefined,{range:plan.range,includeTails:true,preMaster:true}),
      wav=encodeWav([stem.getChannelData(0),stem.getChannelData(1)],48000,24),blob=new Blob([wav],{type:"audio/wav"}),
      asset={id:plan.assetId,name:"bounce.wav",mime:blob.type,byteLength:blob.size,duration:stem.duration,sampleRate:48000,channels:2},
      result=applyTrackBounce(project,plan,asset),replay=new StudioEngine(result.document,async()=>blob);
    try{
      const before=await engine.render(project,undefined,referenceSeconds),after=await replay.render(result.document,undefined,referenceSeconds);
      let error=0,latePeak=0;
      for(let ch=0;ch<2;ch++)for(let i=0;i<before.length;i++){
        error=Math.max(error,Math.abs(before.getChannelData(ch)[i]-after.getChannelData(ch)[i]));
        if(i>6*48000&&i<8*48000)latePeak=Math.max(latePeak,Math.abs(before.getChannelData(ch)[i]));
      }
      return {error,latePeak,frames:stem.length,expectedFrames:plan.outputFrames,duration:stem.duration,requiredDuration:tickToSeconds(plan.range.endTick-plan.range.startTick,project.tempo)+requiredTail};
    }finally{engine.dispose();replay.dispose();}
  });evidence("long-release",report);
  expect(report.error).toBeLessThan(1e-6);expect(report.latePeak).toBeGreaterThan(.0001);expect(report.duration).toBeGreaterThanOrEqual(report.requiredDuration);expect(report.frames).toBe(report.expectedFrames);
});

test("bounce tails preserve slow-tempo feedback echoes beyond the ordinary four-second allowance",async({page})=>{
  await page.goto("/");
  const report=await page.evaluate(async()=>{
    const {StudioEngine}=await import("/lib/audio/engine.ts" as string),{planTrackBounce,applyTrackBounce}=await import("/lib/music/track-bounce.ts" as string),
      {createProject,createTrack,emptyClip}=await import("/lib/music/project.ts" as string),{encodeWav}=await import("/lib/audio/wav.ts" as string);
    const project=createProject("Slow echoes"),source=createTrack("lead","Source");project.tempo=20;project.seed=948;project.tracks=[source];
    project.master={...project.master,volume:0,limiter:false,reverbDecay:.3};source.volume=0;source.pan=.2;source.reverb=0;source.delay=.5;
    source.sound={...source.sound,algorithm:"subtractive",wave:"sine",detune:0,attack:.01,decay:.02,sustain:.8,release:.1,cutoff:18000,resonance:0,filterEnvelope:0,lfoDepth:0};
    const phrase=emptyClip(0,320);phrase.notes=[{id:"echo",pitch:69,tick:0,duration:160,velocity:.8}];source.clips=[phrase];
    const plan=planTrackBounce(project,source.id,{includeTails:true,muteSource:true}),engine=new StudioEngine(project,async()=>new Blob()),
      stem=await engine.render(plan.renderProject,source.id,undefined,{range:plan.range,includeTails:true,preMaster:true}),
      wav=encodeWav([stem.getChannelData(0),stem.getChannelData(1)],48000,24),blob=new Blob([wav],{type:"audio/wav"}),
      asset={id:plan.assetId,name:"bounce.wav",mime:blob.type,byteLength:blob.size,duration:stem.duration,sampleRate:48000,channels:2},
      result=applyTrackBounce(project,plan,asset),replay=new StudioEngine(result.document,async()=>blob);
    try{
      const referenceSeconds=plan.renderFrames/48000+9,before=await engine.render(project,undefined,referenceSeconds),after=await replay.render(result.document,undefined,referenceSeconds);
      let error=0,lateEchoPeak=0,beyondBudgetPeak=0;
      for(let ch=0;ch<2;ch++)for(let i=0;i<before.length;i++){
        error=Math.max(error,Math.abs(before.getChannelData(ch)[i]-after.getChannelData(ch)[i]));
        if(i>6*48000&&i<12*48000)lateEchoPeak=Math.max(lateEchoPeak,Math.abs(before.getChannelData(ch)[i]));
        if(i>stem.length+480)beyondBudgetPeak=Math.max(beyondBudgetPeak,Math.abs(before.getChannelData(ch)[i]));
      }
      return {error,lateEchoPeak,beyondBudgetPeak,duration:stem.duration,frames:stem.length,expectedFrames:plan.outputFrames};
    }finally{engine.dispose();replay.dispose();}
  });evidence("slow-delay",report);
  expect(report.error).toBeLessThan(1e-6);expect(report.lateEchoPeak).toBeGreaterThan(.001);expect(report.beyondBudgetPeak).toBeLessThan(1e-6);expect(report.duration).toBeGreaterThan(45);expect(report.frames).toBe(report.expectedFrames);
});

test("neutral audio is transparent from its first frame including high frequencies and impulses",async({page})=>{
  await page.goto("/");
  const report=await page.evaluate(async()=>{
    const {makeGraph,scheduleAudio}=await import("/lib/audio/graph.ts" as string),{createProject,createTrack}=await import("/lib/music/project.ts" as string);
    const project=createProject(),track=createTrack("piano","Audio","#aaa","audio");project.tracks=[track];
    Object.assign(track,{volume:0,pan:0,reverb:0,delay:0,low:0,mid:0,high:0,drive:0});track.sound={...track.sound,cutoff:20000,resonance:0,lfoDepth:0};
    const context=new OfflineAudioContext(2,48000,48000),buffer=context.createBuffer(2,48000,48000);
    for(let ch=0;ch<2;ch++)for(let i=0;i<48000;i++)buffer.getChannelData(ch)[i]=i===ch*23?.3:.08*Math.sin(2*Math.PI*(ch?18500:19900)*i/48000);
    const graph=makeGraph(context,project,track.id,undefined,true,false,true);scheduleAudio(graph,track.id,buffer,0,1,0,1,0,0);
    const result=await context.startRendering();let error=0,initialError=0;
    for(let ch=0;ch<2;ch++)for(let i=0;i<48000;i++){const delta=Math.abs(result.getChannelData(ch)[i]-buffer.getChannelData(ch)[i]);error=Math.max(error,delta);if(i<960)initialError=Math.max(initialError,delta);}
    graph.dispose();return {error,initialError,frames:result.length};
  });evidence("neutral",report);expect(report.error).toBeLessThan(1e-6);expect(report.initialError).toBeLessThan(1e-6);expect(report.frames).toBe(48000);
});

test("held audio stays aligned through neutral filtered neutral transitions and keeps volume automation",async({page})=>{
  await page.goto("/");
  const report=await page.evaluate(async()=>{
    const {makeGraph,scheduleAudio,applyTrack,scheduleAutomation}=await import("/lib/audio/graph.ts" as string),{createProject,createTrack}=await import("/lib/music/project.ts" as string);
    const project=createProject(),track=createTrack("piano","Audio","#aaa","audio");project.tracks=[track];
    Object.assign(track,{volume:0,pan:0,reverb:0,delay:0,low:0,mid:0,high:0,drive:0});track.sound={...track.sound,cutoff:20000,resonance:0,lfoDepth:0};
    track.automation=[{parameter:"volume",points:[{tick:0,value:-6},{tick:2880,value:-18}]}];
    const context=new OfflineAudioContext(2,72000,48000),buffer=context.createBuffer(2,72000,48000);
    for(let ch=0;ch<2;ch++)for(let i=0;i<72000;i++)buffer.getChannelData(ch)[i]=.07*Math.sin(2*Math.PI*19000*i/48000)+.04*Math.sin(2*Math.PI*(ch?330:220)*i/48000)+(i===57600?.15:0);
    const graph=makeGraph(context,project,track.id,undefined,true,true,true),strip=graph.tracks.get(track.id)!;
    scheduleAutomation(strip,track,project,0,0);scheduleAudio(graph,track.id,buffer,0,1.5,0,1,0,0);
    const first=context.suspend(.4),second=context.suspend(.9),rendering=context.startRendering();
    await first;const filtered={...track,sound:{...track.sound,cutoff:900}};
    applyTrack(strip,filtered,{...project,tracks:[filtered]},context.currentTime,context.currentTime*1920,track.id,false,track,project);await context.resume();
    await second;applyTrack(strip,track,project,context.currentTime,context.currentTime*1920,track.id,false,filtered,{...project,tracks:[filtered]});await context.resume();
    const result=await rendering;let beforeError=0,afterError=0,middleDifference=0,middleEnergy=0;
    const firstGain=Math.pow(10,-6/20),lastGain=Math.pow(10,-18/20);
    for(let ch=0;ch<2;ch++)for(let i=0;i<72000;i++){
      const expected=buffer.getChannelData(ch)[i]*(firstGain+(lastGain-firstGain)*i/72000),actual=result.getChannelData(ch)[i],delta=Math.abs(actual-expected);
      if(i<18000)beforeError=Math.max(beforeError,delta);if(i>45600)afterError=Math.max(afterError,delta);
      if(i>24000&&i<40000){middleDifference=Math.max(middleDifference,delta);middleEnergy=Math.max(middleEnergy,Math.abs(actual));}
    }
    graph.dispose();return {beforeError,afterError,middleDifference,middleEnergy,frames:result.length};
  });evidence("held-transition",report);
  expect(report.beforeError).toBeLessThan(1e-6);expect(report.afterError).toBeLessThan(1e-6);expect(report.middleDifference).toBeGreaterThan(.01);expect(report.middleEnergy).toBeGreaterThan(.003);expect(report.frames).toBe(72000);
});

test("live modulation and pressure restore the authored filter on a held neutral audio source",async({page})=>{
  await page.goto("/");
  const report=await page.evaluate(async()=>{
    const {StudioEngine}=await import("/lib/audio/engine.ts" as string),{makeGraph,scheduleAudio}=await import("/lib/audio/graph.ts" as string),{createProject,createTrack}=await import("/lib/music/project.ts" as string);
    const project=createProject(),track=createTrack("piano","Audio","#aaa","audio");project.tracks=[track];
    Object.assign(track,{volume:0,pan:0,reverb:0,delay:0,low:0,mid:0,high:0,drive:0});track.sound={...track.sound,cutoff:20000,resonance:0,lfoDepth:0,lfoRate:1.2};
    const reports=[];
    for(const type of ["modulation","pressure"] as const){
      const context=new OfflineAudioContext(2,72000,48000),buffer=context.createBuffer(2,72000,48000);
      for(let ch=0;ch<2;ch++)for(let i=0;i<72000;i++)buffer.getChannelData(ch)[i]=.08*Math.sin(2*Math.PI*(ch?18900:19300)*i/48000);
      const graph=makeGraph(context,project,track.id,undefined,true,true,true),engine=new StudioEngine(project,async()=>new Blob());
      // Drive the production live-control dispatch against a deterministic native graph.
      engine.context=context;engine.liveGraph=graph;scheduleAudio(graph,track.id,buffer,0,1.5,0,1,0,0);
      const first=context.suspend(.4),second=context.suspend(.9),rendering=context.startRendering();
      await first;engine.expression(track.id,{type,tick:0,value:1},context.currentTime);await context.resume();
      await second;engine.expression(track.id,{type,tick:0,value:0},context.currentTime);await context.resume();
      const result=await rendering;let beforeError=0,afterError=0,activeDifference=0;
      for(let ch=0;ch<2;ch++)for(let i=0;i<72000;i++){
        const delta=Math.abs(result.getChannelData(ch)[i]-buffer.getChannelData(ch)[i]);
        if(i<18000)beforeError=Math.max(beforeError,delta);if(i>45600)afterError=Math.max(afterError,delta);if(i>24000&&i<40000)activeDifference=Math.max(activeDifference,delta);
      }
      engine.liveGraph=null;engine.context=null;engine.dispose();graph.dispose();reports.push({type,beforeError,afterError,activeDifference});
    }
    return reports;
  });evidence("live-controls",report);
  for(const control of report){expect(control.beforeError).toBeLessThan(1e-6);expect(control.afterError).toBeLessThan(1e-6);expect(control.activeDifference).toBeGreaterThan(.02);}
});
