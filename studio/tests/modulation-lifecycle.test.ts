import {describe,expect,it} from "vitest";
import {changedMacroEvents,compileModulation,effectiveControlTime,musicalControlTime,emptyPatch,makeSource,ModulationEvaluator} from "../lib/audio/modulation";
import {createTrack,secondsToTick,tickToSeconds} from "../lib/music/project";

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
