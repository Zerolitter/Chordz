import { expect, test } from "@playwright/test";
import { encodeWav } from "../../lib/audio/wav";

test("candidate audition schedules same-window native bends and pressure after note onset", async ({page}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const {StudioEngine} = await import("/lib/audio/engine.ts" as string), {createProject,createTrack,emptyClip} = await import("/lib/music/project.ts" as string);
    const project = createProject(), track = createTrack("lead"), clip = emptyClip(0,3840);
    track.sound.detune = 0; track.sound.cutoff = 2400; track.sound.lfoDepth = 0;
    track.reverb = 0; track.delay = 0;
    clip.notes = [{id:"held-note",pitch:69,tick:0,duration:1920,velocity:.7}];
    clip.events = [{type:"pressure",tick:48,value:.5},{type:"pitchBend",tick:96,value:1},{type:"pitchBend",tick:768,value:-.5}];
    track.clips = [clip]; project.tracks = [track]; project.master.limiter = false;
    const engine = new StudioEngine(project,async () => {throw Error("No asset in this fixture");});
    await engine.unlock();
    try {
      const started = await engine.previewSnapshot(project,async () => {throw Error("No asset");},"same-window");
      await new Promise(resolve => setTimeout(resolve,220));
      const first = engine.candidateAudition.voices[0].bend.map((param:AudioParam) => param.value);
      const pressure = engine.candidateAudition.graph.tracks.get(track.id).lfoGain.gain.value;
      await new Promise(resolve => setTimeout(resolve,350));
      const later = engine.candidateAudition.voices[0].bend.map((param:AudioParam) => param.value);
      return {started,first,pressure,later};
    } finally {engine.dispose();}
  });
  expect(result.started).toBe(true);
  expect(result.first.length).toBeGreaterThan(0);
  for (const value of result.first) expect(value).toBeCloseTo(200,1);
  expect(result.pressure).toBeCloseTo(420,1);
  for (const value of result.later) expect(value).toBeCloseTo(-100,1);
});

test("song playback and document survive a separately owned candidate preview and cancellation", async ({page}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const {StudioEngine} = await import("/lib/audio/engine.ts" as string), {createProject,createTrack,emptyClip} = await import("/lib/music/project.ts" as string);
    const project = createProject(), track = createTrack("lead"), clip = emptyClip(0,15360);
    track.sound.detune = 0; track.reverb = 0; track.delay = 0;
    clip.notes = [{id:"song-note",pitch:57,tick:0,duration:15360,velocity:.5}];
    track.clips = [clip]; project.tracks = [track]; project.sections[0].lengthTick = 15360;
    const snapshot = JSON.stringify(project), engine = new StudioEngine(project,async () => {throw Error("No assets");});
    await engine.unlock();
    try {
      await engine.play();
      await new Promise(resolve => setTimeout(resolve,150));
      const before = engine.state;
      const candidate = structuredClone(project); candidate.tracks[0].clips[0].notes[0].pitch = 72;
      const started = await engine.previewSnapshot(candidate,async () => {throw Error("No assets");},"independent-preview");
      await new Promise(resolve => setTimeout(resolve,200));
      const during = engine.state, candidateVoices = engine.candidateAudition.voices.length, songVoices = engine.voices.length;
      engine.cancelCandidateAudition();
      const after = engine.state;
      await new Promise(resolve => setTimeout(resolve,120));
      return {started,before,during,after,final:engine.state,candidateVoices,songVoices,unchanged:JSON.stringify(project) === snapshot};
    } finally {engine.dispose();}
  });
  expect(result.started).toBe(true);
  expect(result.before.playing).toBe(true);
  expect(result.during.playing).toBe(true);
  expect(result.during.previewId).toBe("independent-preview");
  expect(result.candidateVoices).toBeGreaterThan(0);
  expect(result.songVoices).toBeGreaterThan(0);
  expect(result.after.playing).toBe(true);
  expect(result.after.previewId).toBeNull();
  expect(result.after.tick).toBeGreaterThan(result.before.tick);
  expect(result.final.tick).toBeGreaterThan(result.after.tick);
  expect(result.unchanged).toBe(true);
});

test("cancelled candidate asset loading cannot resurrect audio or stop the playing song", async ({page}) => {
  await page.goto("/");
  const bytes = [...new Uint8Array(encodeWav([Float32Array.from({length:4800},(_,index) => .2*Math.sin(index*Math.PI/48))],48000,24))];
  const result = await page.evaluate(async bytes => {
    const {StudioEngine} = await import("/lib/audio/engine.ts" as string), {createProject,createTrack,emptyClip} = await import("/lib/music/project.ts" as string);
    const project = createProject(), track = createTrack("lead"), clip = emptyClip(0,15360);
    clip.notes = [{id:"song-note",pitch:60,tick:0,duration:15360,velocity:.4}];track.clips = [clip]; project.tracks = [track];project.sections[0].lengthTick = 15360;
    const candidate = createProject(), audioTrack = createTrack("lead","Candidate audio",undefined,"audio"), audioClip = emptyClip(0,192);
    audioClip.audio = {assetId:"delayed-audio",offsetSec:0,gain:1,fadeInSec:0,fadeOutSec:0};audioTrack.clips = [audioClip];candidate.tracks = [audioTrack];
    candidate.assets = [{id:"delayed-audio",name:"Delayed.wav",mime:"audio/wav",byteLength:bytes.length,duration:.1,sampleRate:48000,channels:1}];
    const engine = new StudioEngine(project,async () => {throw Error("Song uses no assets");});await engine.unlock();
    let release!:(blob:Blob) => void;
    const request = {count:0};
    const gate = new Promise<Blob>(resolve => {release = resolve;});
    try {
      await engine.play();
      const operation = engine.previewSnapshot(candidate,async () => {request.count++;return gate;},"cancelled-loading");
      while (!request.count) await new Promise(resolve => setTimeout(resolve,10));
      const loading = engine.state;engine.cancelCandidateAudition();
      release(new Blob([new Uint8Array(bytes)],{type:"audio/wav"}));
      const started = await operation;
      await new Promise(resolve => setTimeout(resolve,200));
      return {requested:request.count > 0,loading,started,after:engine.state,candidateGone:engine.candidateAudition === null,songVoices:engine.voices.length,privateBufferRetained:engine.buffers.has("delayed-audio")};
    } finally {engine.dispose();}
  },bytes);
  expect(result.requested).toBe(true);
  expect(result.loading.playing).toBe(true);
  expect(result.loading.previewId).toBe("cancelled-loading");
  expect(result.started).toBe(false);
  expect(result.after.playing).toBe(true);
  expect(result.after.previewId).toBeNull();
  expect(result.candidateGone).toBe(true);
  expect(result.songVoices).toBeGreaterThan(0);
  expect(result.privateBufferRetained).toBe(false);
});

test("repeated sample and audio previews release private decoded copies and preserve shared caches", async ({page}) => {
  const bytes = [...new Uint8Array(encodeWav([Float32Array.from({length:4800},(_,index) => .2*Math.sin(index*Math.PI/48))],48000,24))];
  await page.route("**/__candidate_factory.wav",route => route.fulfill({body:Buffer.from(bytes),contentType:"audio/wav"}));
  await page.goto("/");
  const result = await page.evaluate(async bytes => {
    const {StudioEngine} = await import("/lib/audio/engine.ts" as string), {createProject,createTrack,emptyClip} = await import("/lib/music/project.ts" as string),
      {createSoundEntry,createPhraseEntry,materializeLibraryEntry} = await import("/lib/music/reusable-library.ts" as string);
    const project = createProject(), sample = createTrack("owned-sample"), audio = createTrack("lead","Original audio",undefined,"audio"), note = emptyClip(0,192), take = emptyClip(0,192);
    sample.reverb = 0;sample.delay = 0;sample.sound.release = .01;
    note.notes = [{id:"source-note",pitch:60,tick:0,duration:192,velocity:.7}];sample.clips = [note];
    take.audio = {assetId:"project-audio",offsetSec:0,gain:1,fadeInSec:0,fadeOutSec:0};audio.clips = [take];audio.reverb = 0;audio.delay = 0;
    const asset = {id:"project-sample",name:"Original.wav",mime:"audio/wav",byteLength:bytes.length,duration:.1,sampleRate:48000,channels:1};
    project.assets = [asset,{...asset,id:"project-audio"}];project.tracks = [sample,audio];project.sections[0].lengthTick = 192;project.master.reverbDecay = .2;
    project.userInstruments = [{id:"owned-sample",name:"Original sample",family:"Samples",description:"Native fixture",kind:"sample",zones:[{assetId:asset.id,root:60,low:0,high:127,velocityLow:0,velocityHigh:1,roundRobin:0,articulation:"sustain"}],articulations:["sustain"],license:"User supplied",source:"Fixture",defaults:{attack:.001,release:.01,detune:0}}];
    const sound = createSoundEntry(project,sample,"Saved sample"), phrase = createPhraseEntry(project,audio,take,"Saved audio"), blob = new Blob([new Uint8Array(bytes)],{type:"audio/wav"}), engine = new StudioEngine(project,async () => blob);
    function candidate(entry:typeof sound) {
      const doc = createProject(), {instrument,...settings} = entry.sound, track = createTrack(instrument.id,entry.name,undefined,entry.kind === "audio" ? "audio" : "instrument");
      Object.assign(track,settings);track.reverb = 0;track.delay = 0;
      const clip = entry.clip ?? structuredClone(note);track.clips = [clip];doc.tracks = [track];doc.userInstruments = [instrument];doc.assets = entry.assets;doc.sections[0].lengthTick = 192;doc.master.reverbDecay = .2;
      return doc;
    }
    try {
      await engine.ensureBuffers();
      const uses: {kind:string;during:boolean;after:boolean}[] = [];
      for (let round = 0;round < 3;round++) for (const entry of [sound,phrase]) {
        const fresh = materializeLibraryEntry(entry).entry, id = fresh.assets[0].id;
        await engine.previewSnapshot(candidate(fresh),async () => blob,`copy-${round}-${entry.kind}`);
        const during = engine.buffers.has(id);engine.cancelCandidateAudition();
        uses.push({kind:entry.kind,during,after:engine.buffers.has(id)});
      }
      const factory = candidate(structuredClone(sound));factory.assets = [];factory.userInstruments[0].zones[0].url = "/__candidate_factory.wav";delete factory.userInstruments[0].zones[0].assetId;
      await engine.previewSnapshot(factory,async () => blob,"factory-url");engine.cancelCandidateAudition();
      const shared = materializeLibraryEntry(phrase).entry, sharedId = shared.assets[0].id;
      let release!:(blob:Blob) => void, requested = false;
      const gate = new Promise<Blob>(resolve => {release = resolve;});
      const pending = engine.previewSnapshot(candidate(shared),async () => {requested = true;return gate;},"old-pending");
      while (!requested) await new Promise(resolve => setTimeout(resolve,5));
      engine.cancelCandidateAudition();
      const replacement = engine.previewSnapshot(candidate(shared),async () => blob,"current-candidate");
      release(blob);const previousStarted = await pending, replacementStarted = await replacement, sharedDuring = engine.buffers.has(sharedId);
      engine.cancelCandidateAudition();const sharedAfter = engine.buffers.has(sharedId);
      const failedEntry = materializeLibraryEntry(phrase).entry, failedId = failedEntry.assets[0].id, failedDoc = candidate(failedEntry);
      failedDoc.assets.push({...asset,id:"failed-candidate-audio"});failedDoc.tracks[0].clips.push({...structuredClone(take),id:"failed-clip",audio:{...take.audio,assetId:"failed-candidate-audio"}});
      let finishPartial!:(blob:Blob) => void;
      const partial = new Promise<Blob>(resolve => {finishPartial = resolve;});
      let rejected = false;
      try {await engine.previewSnapshot(failedDoc,async (id:string) => {if(id === failedId)return partial;throw Error("Fixture unavailable asset");},"partially-failed");}
      catch {rejected = true;}
      finishPartial(blob);
      const partialDeadline = performance.now()+2000;
      while (engine.bufferJobs.has(failedId) && performance.now() < partialDeadline) await new Promise(resolve => setTimeout(resolve,10));
      const failedBuffer = engine.buffers.has(failedId);
      const completed = materializeLibraryEntry(phrase).entry, completedId = completed.assets[0].id;
      await engine.previewSnapshot(candidate(completed),async () => blob,"natural-completion");
      const deadline = performance.now()+9000;
      while (engine.candidateAudition && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve,25));
      return {uses,previousStarted,replacementStarted,sharedDuring,sharedAfter,rejected,failedBuffer,completed:engine.candidateAudition === null,completedBuffer:engine.buffers.has(completedId),mainSample:engine.buffers.has("project-sample"),mainAudio:engine.buffers.has("project-audio"),factory:engine.buffers.has("/__candidate_factory.wav"),cached:[...engine.buffers.keys()]};
    } finally {engine.dispose();}
  },bytes);
  expect(result.uses).toHaveLength(6);
  for (const use of result.uses) {expect(use.during).toBe(true);expect(use.after).toBe(false);}
  expect(result.previousStarted).toBe(false);expect(result.replacementStarted).toBe(true);
  expect(result.sharedDuring).toBe(true);expect(result.sharedAfter).toBe(false);
  expect(result.rejected).toBe(true);expect(result.failedBuffer).toBe(false);
  expect(result.completed).toBe(true);expect(result.completedBuffer).toBe(false);
  expect(result.mainSample).toBe(true);expect(result.mainAudio).toBe(true);expect(result.factory).toBe(true);
  expect(result.cached.sort()).toEqual(["/__candidate_factory.wav","project-audio","project-sample"].sort());
});

test("audio library offset and fades preserve rendered PCM while unsupported modulation remains raw inactive data", async ({page}) => {
  await page.goto("/");
  const bytes = [...new Uint8Array(encodeWav([Float32Array.from({length:48000},(_,index) => .2*Math.sin(index*Math.PI/48))],48000,24))];
  const result = await page.evaluate(async bytes => {
    const {StudioEngine} = await import("/lib/audio/engine.ts" as string), {createProject,createTrack,emptyClip} = await import("/lib/music/project.ts" as string),
      {createPhraseEntry,materializeLibraryEntry,applyLibraryEntry} = await import("/lib/music/reusable-library.ts" as string), {emptyPatch} = await import("/lib/audio/modulation.ts" as string);
    const project = createProject(), track = createTrack("lead","Original",undefined,"audio"), clip = emptyClip(0,960);
    track.reverb = 0;track.delay = 0;track.sound.lfoDepth = 0;track.volume = -12;
    clip.audio = {assetId:"source-take",offsetSec:.25,gain:.7,fadeInSec:.05,fadeOutSec:.1};track.clips = [clip];project.tracks = [track];
    project.assets = [{id:"source-take",name:"Source.wav",mime:"audio/wav",byteLength:bytes.length,duration:1,sampleRate:48000,channels:1}];
    const source = createPhraseEntry(project,track,clip,"Independent audio"), materialized = materializeLibraryEntry(source), destination = createProject();
    destination.tempo = 60;destination.master = structuredClone(project.master);
    const inserted = applyLibraryEntry(destination,materialized.entry,{trackId:destination.tracks[0].id,sectionId:destination.sections[0].id},"alternative");
    if (!inserted.ok) throw Error(inserted.error);
    const copied = inserted.document;copied.tracks = [copied.tracks.find((t:{id:string}) => t.id === inserted.trackId)];
    const audio = copied.tracks[0];audio.volume = track.volume;audio.pan = track.pan;copied.seed = project.seed;
    audio.modulation = {...emptyPatch(),routes:[{id:"unsupported",sourceId:"M1",target:"voice.fmIndex",amount:3,curve:"linear",slew:0,enabled:true}]};
    audio.automation = [{parameter:"M1",points:[{tick:0,value:.8}]}];
    const authored = JSON.stringify(audio.modulation), blob = new Blob([new Uint8Array(bytes)],{type:"audio/wav"}), engine = new StudioEngine(project,async () => blob);
    try {
      // Compare independent bytes at the same musical tempo, keeping the source's
      // known half-second visible region. Tempo-dependent sends are a separate effect.
      const baseline = structuredClone(project);baseline.tempo = 60;baseline.tracks[0].clips[0].lengthTick = 480;baseline.tracks[0].clips[0].sourceLengthTick = 480;
      const original = await engine.render(baseline,undefined,1), active = await engine.render(copied,undefined,1), disabled = structuredClone(copied);
      delete disabled.tracks[0].modulation;
      const reference = await engine.render(disabled,undefined,1);
      let copyError = 0, unsupportedError = 0, peak = 0;
      for (let channel = 0;channel < active.numberOfChannels;channel++) {
        const values = active.getChannelData(channel), old = original.getChannelData(channel), clean = reference.getChannelData(channel);
        for (let index = 0;index < values.length;index++) {copyError = Math.max(copyError,Math.abs(values[index]-old[index]));unsupportedError = Math.max(unsupportedError,Math.abs(values[index]-clean[index]));peak = Math.max(peak,Math.abs(values[index]));}
      }
      return {copyError,unsupportedError,peak,rawPreserved:JSON.stringify(audio.modulation) === authored,sourcePreserved:JSON.stringify(source.clip.audio) === JSON.stringify(clip.audio),lengthTick:audio.clips[0].lengthTick,audio:audio.clips[0].audio,sourceAudio:clip.audio,independentAsset:audio.clips[0].audio.assetId !== clip.audio.assetId};
    } finally {engine.dispose();}
  },bytes);
  expect(result.peak).toBeGreaterThan(.005);
  expect(result.copyError,JSON.stringify(result)).toBeLessThan(1e-6);
  expect(result.unsupportedError).toBeLessThan(1e-6);
  expect(result.rawPreserved).toBe(true);
  expect(result.sourcePreserved).toBe(true);
  expect(result.lengthTick).toBe(480);
  expect(result.independentAsset).toBe(true);
  expect({...result.audio,assetId:result.sourceAudio.assetId}).toEqual(result.sourceAudio);
});
