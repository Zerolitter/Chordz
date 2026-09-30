import {describe,expect,it} from "vitest";
import {changedMacroEvents,compileModulation,effectiveControlTime,musicalControlTime,emptyPatch,makeSource,ModulationEvaluator} from "../lib/audio/modulation";
import {createProject,createTrack,emptyClip,secondsToTick,tickToSeconds} from "../lib/music/project";
import type {ModRoute,ModScope,ModulationPatch} from "../lib/music/modulation-types";
import {classifyProjectChanges} from "../lib/audio/engine";

describe("modulation runtime lifecycle",()=>{
  it("resets all four macros when a patch is removed or created, without resurrecting earlier live values",()=>{
    const initial={...createTrack("lead"),id:"track",modulation:{...emptyPatch(),macros:[.2,.1,0,0] as [number,number,number,number]}};
    const absent={...initial,modulation:undefined};
    const restored={...initial,modulation:{...emptyPatch(),macros:[.3,0,0,0] as [number,number,number,number]}};
    const removed=changedMacroEvents([initial],[absent]),created=changedMacroEvents([absent],[restored]);
    expect(removed.map(e=>e.event.value)).toEqual([0,0,0,0]);
    expect(created.map(e=>e.event.value)).toEqual([.3,0,0,0]);
    const history=[{seconds:1,type:"macro",macroId:"M1",value:.9},
      ...removed.map(e=>({...e.event,seconds:2})),...created.map(e=>({...e.event,seconds:3}))];
    const evaluator=new ModulationEvaluator(compileModulation(restored.modulation,"track",120,history));
    expect(evaluator.sample(3.5).sources.M1).toBe(.3);
  });
  it("resynchronizes only the configured macro changes and leaves unchanged live controls alone",()=>{
    const previous={...createTrack("lead"),modulation:emptyPatch()};
    expect(changedMacroEvents([previous],[previous])).toEqual([]);
    const next={...previous,modulation:{...previous.modulation,macros:[0,.7,0,0] as [number,number,number,number]}};
    expect(changedMacroEvents([previous],[next]).map(e=>[e.event.macroId,e.event.value])).toEqual([["M2",.7]]);
    expect(previous.modulation.macros).toEqual([0,0,0,0]);
  });
  it("stamps newly arrived controls two native render quanta ahead and retains requested future times",()=>{
    expect(effectiveControlTime(3,3,48000)).toBeCloseTo(3+256/48000,12);
    expect(effectiveControlTime(2,3,44100)).toBeCloseTo(3+256/44100,12);
    expect(effectiveControlTime(4,3,48000)).toBe(4);
  });
  it("aligns live macro and CC times with integer saved ticks across capture origins and tempos",()=>{
    for(const tempo of [73,120,137,241])for(const captureTick of [0,4800,15517]) {
      const origin=103.137,songOrigin=tickToSeconds(captureTick,tempo);
      for(const elapsed of [-.02,.0001,.3594,.58668,1.09375]) {
        const requested=effectiveControlTime(origin+elapsed,origin+elapsed,48000);
        const at=musicalControlTime(requested,tempo,origin,songOrigin);
        expect(at).toBeGreaterThanOrEqual(requested-1e-12);
        expect(at-requested).toBeLessThan(60/tempo/960+1e-12);
        const savedTick=captureTick+secondsToTick(at-origin,tempo),savedSeconds=tickToSeconds(savedTick,tempo);
        const liveSeconds=at-origin+songOrigin;
        expect(savedSeconds).toBeCloseTo(liveSeconds,11);
        const patch={...emptyPatch(),routes:[{id:"macro",sourceId:"M1",target:"track.gain" as const,amount:-6,curve:"linear" as const,slew:0,enabled:true},
          {id:"cc",sourceId:"cc:all:1",target:"track.pan" as const,amount:.5,curve:"linear" as const,slew:0,enabled:true}]};
        const events=[{seconds:liveSeconds,type:"macro",macroId:"M1",value:.75},
          {seconds:liveSeconds,type:"controlChange",cc:1,channel:3,value:.6}];
        const live=new ModulationEvaluator(compileModulation(patch,"track",tempo,events));
        const replay=new ModulationEvaluator(compileModulation(patch,"track",tempo,events.map(event=>({...event,seconds:savedSeconds}))));
        const before=Math.max(0,liveSeconds-1/128),after=liveSeconds+1/128;
        expect(live.sample(before)).toEqual(replay.sample(before));
        expect(live.sample(after)).toEqual(replay.sample(after));
      }
    }
  });
  it("reports the exact source rate and amplitude after DAG routing for both scopes",()=>{
    const patch={...emptyPatch(),macros:[1,.5,0,0] as [number,number,number,number],sources:[
      {...makeSource("lfo","track"),sync:false,rate:1,amplitude:.2},
      {...makeSource("lfo","voice","voice"),sync:false,rate:2},
    ],routes:[
      {id:"rate",sourceId:"M1",target:"source:track:rate" as const,amount:1,curve:"linear" as const,slew:0,enabled:true},
      {id:"amplitude",sourceId:"M2",target:"source:track:amplitude" as const,amount:.4,curve:"linear" as const,slew:0,enabled:true},
      {id:"voice-rate",sourceId:"M1",target:"source:voice:rate" as const,amount:1,curve:"linear" as const,slew:0,enabled:true},
    ]};
    const evaluator=new ModulationEvaluator(compileModulation(patch,"t",120));
    const sample=evaluator.sample(.25,{key:"note",start:0,pitch:60,velocity:.75});
    expect(sample.sourceParameters?.["source:track:rate"]).toBe(2);
    expect(sample.sourceParameters?.["source:track:amplitude"]).toBe(.4);
    expect(sample.sourceParameters?.["source:voice:rate"]).toBe(4);
  });
});

function classifiedFixture() {
  const project=createProject(),first={...createTrack("lead"),id:"first"},second={...createTrack("piano"),id:"second"};
  first.modulation={...emptyPatch(),sources:[liveSource("osc")],routes:[liveRoute("pitch","voice.pitch",80,"osc")]};
  project.tracks=[first,second];return project;
}

describe("live project change classification",()=>{
  it.each(["metadata","mix","sound","macro","source","route"] as const)("keeps %s edits outside timeline and backend invalidation",kind=>{
    const previous=classifiedFixture(),next=structuredClone(previous),track=next.tracks[0];
    if(kind==="metadata"){next.title="Renamed song";next.notes="Notes";next.sections[0].name="Renamed section";track.name="Renamed track";}
    if(kind==="mix"){track.pan=.3;track.volume=-9;}
    if(kind==="sound")track.sound.attack+=.05;
    if(kind==="macro")track.modulation!.macros[0]=.7;
    if(kind==="source")track.modulation!.sources[0].rate=2;
    if(kind==="route")track.modulation!.routes[0].amount=120;
    const changes=classifyProjectChanges(previous,next);
    expect(changes.timeline).toBe(false);expect(changes.structure).toBe(false);expect(changes.backend).toEqual([]);
    expect(changes.audibility).toBe(false);expect(changes.tempo).toBe(false);expect(changes.meter).toBe(false);
    expect(changes.modulation).toEqual(["macro","source","route"].includes(kind)?["first"]:[]);
    expect(changes.sound).toEqual(kind==="sound"?["first"]:[]);
    expect(changes.mix).toEqual(kind==="mix"?["first"]:[]);
    expect(previous.tracks[0].modulation!.sources[0].rate).toBe(1);
  });

  it.each(["clips","seed","section length"] as const)("marks %s changes as timeline changes",kind=>{
    const previous=classifiedFixture(),next=structuredClone(previous);
    if(kind==="clips")next.tracks[0].clips.push(emptyClip(0,960,"New phrase"));
    if(kind==="seed")next.seed+=1;
    if(kind==="section length")next.sections[0].lengthTick+=960;
    const changes=classifyProjectChanges(previous,next);
    expect(changes.timeline).toBe(true);expect(changes.backend).toEqual([]);
    expect(changes.sound).toEqual([]);expect(changes.modulation).toEqual([]);
  });

  it.each(["algorithm","articulation","instrument"] as const)("limits %s backend invalidation to its affected track",kind=>{
    const previous=classifiedFixture(),next=structuredClone(previous),track=next.tracks[0];
    if(kind==="algorithm")track.sound.algorithm=track.sound.algorithm==="fm"?"subtractive":"fm";
    if(kind==="articulation")track.sound.articulation="staccato";
    if(kind==="instrument")track.instrumentId="bass";
    const changes=classifyProjectChanges(previous,next);
    expect(changes.backend).toEqual(["first"]);expect(changes.timeline).toBe(false);
    expect(changes.modulation).toEqual([]);expect(changes.structure).toBe(false);
  });

  it("updates every track's mix and marks audibility when the first solo is enabled",()=>{
    const previous=classifiedFixture(),next=structuredClone(previous);next.tracks[0].solo=true;
    const changes=classifyProjectChanges(previous,next);
    expect(changes.mix).toEqual(["first","second"]);expect(changes.audibility).toBe(true);
    expect(changes.timeline).toBe(false);expect(changes.backend).toEqual([]);
  });
});

const liveSource=(id:string,scope:ModScope="track",rate=1)=>({...makeSource("lfo",id,scope),sync:false,rate,phase:0});
const liveRoute=(id:string,target:ModRoute["target"],amount=1,sourceId="M1",slew=0):ModRoute=>
  ({id,target,amount,sourceId,slew,curve:"linear",enabled:true});
const liveEvaluator=(patch:ModulationPatch)=>new ModulationEvaluator(compileModulation(patch,"live-track",120));

describe("prospective modulation reconfiguration",()=>{
  it.each([.125,.123])("preserves LFO phase and recent past snapshots when rate changes at %s seconds",at=>{
    const patch={...emptyPatch(),sources:[liveSource("osc")],routes:[liveRoute("pan","track.pan",.5,"osc")]};
    const runtime=liveEvaluator(patch),past=structuredClone(runtime.sample(.0625));
    // A scheduler has already evaluated its lookahead; the edit must replace that future.
    runtime.sample(.75);
    runtime.reconfigure(compileModulation({...patch,sources:[{...patch.sources[0],rate:2}]},"live-track",120),at);
    const boundary=runtime.sample(.125),future=runtime.sample(.25);
    expect(boundary.sourceStates!.osc.phase).toBeCloseTo(.125,12);
    expect(boundary.sourceStates!.osc.rate).toBe(2);
    expect(future.sourceStates!.osc.phase).toBeCloseTo(.375,12);
    expect(future.sources.osc).toBeCloseTo(Math.sin(.375*Math.PI*2),12);
    expect(future.targets["track.pan"]).toBeCloseTo(.5*Math.sin(.375*Math.PI*2),12);
    expect(runtime.sample(.0625)).toEqual(past);
    expect(runtime.sample(.25)).toEqual(future);
    expect(runtime.sample(.375).sourceStates!.osc.phase).toBeCloseTo(.625,12);
  });

  it("continues each held voice's phase while an unchanged track clock keeps running",()=>{
    const patch={...emptyPatch(),sources:[liveSource("shared"),liveSource("voice","voice")]};
    const runtime=liveEvaluator(patch),baseline=liveEvaluator(patch);
    const voices=[{key:"held-a",pitch:60,velocity:.7,start:.03125},{key:"held-b",pitch:67,velocity:.6,start:.0625}];
    const past=voices.map(voice=>structuredClone(runtime.sample(.09375,voice)));
    for(const voice of voices)runtime.sample(.75,voice);
    runtime.reconfigure(compileModulation({...patch,sources:patch.sources.map(source=>source.id==="voice"?{...source,rate:2}:source)},"live-track",120),.125);
    for(const [index,voice]of voices.entries()) {
      const future=runtime.sample(.25,voice);
      expect(future.sourceStates!.voice.phase).toBeCloseTo(.125-voice.start+.125*2,12);
      expect(future.sourceStates!.shared).toEqual(baseline.sample(.25).sourceStates!.shared);
      expect(runtime.sample(.09375,voice)).toEqual(past[index]);
      expect(runtime.sample(.25,voice)).toEqual(future);
    }
  });

  it("retains slew memory by route ID through depth edits and route reordering",()=>{
    const patch={...emptyPatch(),macros:[1,.4,0,0] as [number,number,number,number],routes:[
      liveRoute("smooth-pan","track.pan",1,"M1",.2),liveRoute("steady-level","track.gain",-3,"M2",.15),
    ]};
    const runtime=liveEvaluator(patch),baseline=liveEvaluator(patch),past=structuredClone(runtime.sample(.25));
    runtime.sample(.75);
    const next={...patch,routes:[patch.routes[1],{...patch.routes[0],amount:-1,slew:.4}]};
    runtime.reconfigure(compileModulation(next,"live-track",120),.5);
    const boundary=runtime.sample(.5),future=runtime.sample(.5+1/128),alpha=1-Math.exp(-1/(128*.4));
    expect(boundary.targets["track.pan"]).toBeGreaterThan(.8);
    expect(future.targets["track.pan"]).toBeCloseTo(boundary.targets["track.pan"]+(-1-boundary.targets["track.pan"])*alpha,12);
    expect(future.targets["track.gain"]).toBe(baseline.sample(.5+1/128).targets["track.gain"]);
    expect(runtime.sample(.25)).toEqual(past);
  });

  it("adds and removes sources without resetting surviving LFO or seeded random clocks",()=>{
    const patch={...emptyPatch(27),sources:[liveSource("steady"),{...makeSource("random","random"),sync:false,rate:3},liveSource("removed", "track",2)],
      routes:[liveRoute("old-pan","track.pan",.4,"removed")]};
    const runtime=liveEvaluator(patch),baseline=liveEvaluator(patch),past=structuredClone(runtime.sample(.25));
    runtime.sample(1.25);
    const next={...patch,sources:[...patch.sources.filter(source=>source.id!=="removed"),liveSource("added","track",.5)],
      routes:[liveRoute("new-level","track.gain",-6,"added")]};
    runtime.reconfigure(compileModulation(next,"live-track",120),.375);
    for(const seconds of [.375,.5,1,1.125]) {
      const sample=runtime.sample(seconds),expected=baseline.sample(seconds);
      expect(sample.sourceStates!.steady).toEqual(expected.sourceStates!.steady);
      expect(sample.sourceStates!.random).toEqual(expected.sourceStates!.random);
      expect(sample.sources).not.toHaveProperty("removed");
      expect(sample.sourceStates).not.toHaveProperty("removed");
      expect(sample.targets).not.toHaveProperty("track.pan");
      expect(Number.isFinite(sample.sourceStates!.added.phase)).toBe(true);
      expect(Number.isFinite(sample.targets["track.gain"])).toBe(true);
    }
    expect(runtime.sample(.25)).toEqual(past);
    expect(runtime.sample(.25).sources).not.toHaveProperty("added");
  });

  it("adds and removes a rate route prospectively without rebuilding its destination clock",()=>{
    const patch={...emptyPatch(),macros:[1,0,0,0] as [number,number,number,number],sources:[liveSource("osc")]};
    const runtime=liveEvaluator(patch),next={...patch,routes:[liveRoute("rate","source:osc:rate",1)]};
    runtime.sample(.75);
    runtime.reconfigure(compileModulation(next,"live-track",120),.125);
    expect(runtime.sample(.25).sourceStates!.osc.phase).toBeCloseTo(.375,12);
    runtime.reconfigure(compileModulation(patch,"live-track",120),.25);
    expect(runtime.sample(.25).sourceStates!.osc.phase).toBeCloseTo(.375,12);
    expect(runtime.sample(.25).sourceStates!.osc.rate).toBe(1);
    expect(runtime.sample(.5).sourceStates!.osc.phase).toBeCloseTo(.625,12);
    expect(runtime.sample(.0625).sourceStates!.osc.phase).toBeCloseTo(.0625,12);
  });

  it("coalesces edits in one control frame without applying the elapsed phase twice",()=>{
    const patch={...emptyPatch(),sources:[liveSource("osc")]},runtime=liveEvaluator(patch);
    const past=structuredClone(runtime.sample(.0625));runtime.sample(.75);
    for(const [index,rate]of [2,3,4].entries())runtime.reconfigure(
      compileModulation({...patch,sources:[{...patch.sources[0],rate}]},"live-track",120),.123+index*.0001);
    const sample=runtime.sample(.25);
    expect(sample.sourceStates!.osc.rate).toBe(4);
    expect(sample.sourceStates!.osc.phase).toBeCloseTo(.125+.125*4,12);
    expect(runtime.sample(.0625)).toEqual(past);
  });

  it.each(["track","voice"] as const)("retains the %s phase after bounded revision history rolls over with scheduled lookahead",scope=>{
    const patch={...emptyPatch(),sources:[liveSource("osc",scope)]},runtime=liveEvaluator(patch);
    const voice=scope==="voice"?{key:"long-held",pitch:60,velocity:.7,start:.03125}:undefined;
    let phase=0,previousAt=voice?.start??0,previousRate=1;
    for(let index=0;index<150;index++) {
      const at=.125+index*4/128,rate=index%2===0?2:1;
      phase+=(at-previousAt)*previousRate;
      runtime.sample(at+.0625,voice);
      runtime.reconfigure(compileModulation({...patch,sources:[{...patch.sources[0],rate}]},"live-track",120),at);
      expect(runtime.sample(at,voice).sourceStates!.osc.phase,`edit ${index+1}`).toBeCloseTo(phase,12);
      expect(runtime.sample(at+2/128,voice).sourceStates!.osc.phase,`lookahead after edit ${index+1}`).toBeCloseTo(phase+rate*2/128,12);
      previousAt=at;previousRate=rate;
    }
    if(voice) {
      const release=previousAt+2/128,heldPhase=runtime.sample(release,voice).sourceStates!.osc.phase;
      const released={...voice,release};
      expect(runtime.sample(release,released).sourceStates!.osc.phase,"release must retain the bounded phase anchor").toBe(heldPhase);
      expect(runtime.sample(release+.0625,released).sourceStates!.osc.phase).toBeCloseTo(heldPhase+previousRate*.0625,12);
    }
  });

  it("returns independent source snapshots using the same phase, value, rate and amplitude as the evaluator",()=>{
    const patch={...emptyPatch(27),sources:[{...liveSource("osc","track",2),phase:.125,amplitude:.4}]},runtime=liveEvaluator(patch);
    const sample=runtime.sample(.125),state=sample.sourceStates!.osc;
    expect(state.phase).toBeCloseTo(.375,12);
    expect(state.value).toBe(sample.sources.osc);
    expect(state.rate).toBe(2);expect(state.amplitude).toBe(.4);
    expect(state.value).toBeCloseTo(.4*Math.sin(state.phase*Math.PI*2),12);
    const copy=runtime.sample(.125).sourceStates!.osc;
    expect(copy).toEqual(state);expect(copy).not.toBe(state);
    try { Reflect.set(state,"phase",999);Reflect.set(state,"value",999); } catch { /* Frozen snapshots are also safe. */ }
    const reread=runtime.sample(.125).sourceStates!.osc;
    expect(reread.phase).toBeCloseTo(.375,12);
    expect(reread.value).toBeCloseTo(.4*Math.sin(.375*Math.PI*2),12);
  });
});
