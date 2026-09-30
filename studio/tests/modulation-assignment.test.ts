import { describe, expect, it } from "vitest";
import { emptyPatch, makeSource } from "../lib/audio/modulation";
import { assignModulationRoute } from "../lib/music/modulation-assignment";
const synth={audio:false,synth:true,fm:false};
describe("parameter modulation assignment",()=>{
  it("shares destination depth, enables the patch and accepts built-in controls",()=>{
    const p=emptyPatch();p.enabled=false;
    const result=assignModulationRoute(p,"M1","track.cutoff","route",synth,"track");
    expect(result.ok).toBe(true);if(result.ok){expect(result.patch.enabled).toBe(true);expect(result.patch.routes[0].amount).toBe(.8);}
    expect(p.routes).toHaveLength(0);
  });
  it("rejects unavailable, missing and cross-track sources without changing a patch",()=>{
    const p=emptyPatch();
    expect(assignModulationRoute(p,"missing","track.pan","route",synth,"track").ok).toBe(false);
    expect(assignModulationRoute(p,"M1","voice.fmIndex","route",synth,"track").ok).toBe(false);
    expect(assignModulationRoute(p,"M1","voice.gain","route",{...synth,audio:true},"track").ok).toBe(false);
    expect(assignModulationRoute(p,"M1","voice.cutoff","route",{...synth,synth:false},"track").ok).toBe(false);
    expect(assignModulationRoute(p,"M1","track.pan","route",synth,"track","another").ok).toBe(false);
  });
  it("rejects voice-to-track routes, source loops and the route limit",()=>{
    const p=emptyPatch();const a=makeSource("lfo","a"),b=makeSource("lfo","b");p.sources=[a,b];
    a.scope="voice";expect(assignModulationRoute(p,a.id,"track.pan","route",synth,"track").ok).toBe(false);a.scope="track";
    expect(assignModulationRoute(p,a.id,`source:${a.id}:rate`,"route",synth,"track").ok).toBe(false);
    const first=assignModulationRoute(p,a.id,`source:${b.id}:rate`,"route",synth,"track");expect(first.ok).toBe(true);
    if(first.ok)expect(assignModulationRoute(first.patch,b.id,`source:${a.id}:amplitude`,"other",synth,"track").ok).toBe(false);
    p.routes=Array.from({length:32},(_,i)=>({id:`route-${i}`,sourceId:"M1",target:"track.pan",amount:.1,curve:"linear",slew:.01,enabled:true}));
    expect(assignModulationRoute(p,"M1","track.pan","overflow",synth,"track").ok).toBe(false);
  });
});
