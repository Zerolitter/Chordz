import {describe,expect,it} from "vitest";
import {isNeutralAudioFilter} from "../lib/audio/graph";
import {createProject,createTrack,emptyClip} from "../lib/music/project";
import {emptyPatch} from "../lib/audio/modulation";

function fixture(){
  const project=createProject(),track=createTrack("piano","Audio","#aaa","audio");
  track.sound={...track.sound,cutoff:20000,resonance:0,lfoDepth:0};project.tracks=[track];return {project,track};
}

describe("transparent audio filter settings",()=>{
  it("preserves instrument and imported-audio filters unless their existing settings are neutral",()=>{
    const {project,track}=fixture();expect(isNeutralAudioFilter(track,project)).toBe(true);
    expect(isNeutralAudioFilter({...track,kind:"instrument"},project)).toBe(false);
    expect(isNeutralAudioFilter(createTrack("piano","Imported","#aaa","audio"),project)).toBe(false);
    for(const change of [{cutoff:19999},{resonance:.01},{lfoDepth:.01}])expect(isNeutralAudioFilter({...track,sound:{...track.sound,...change}},project)).toBe(false);
  });
  it("retains authored filter automation and legacy modulation or pressure performance",()=>{
    const {project,track}=fixture();
    for(const parameter of ["cutoff","modulation"] as const)expect(isNeutralAudioFilter({...track,automation:[{parameter,points:[{tick:0,value:0}]}]},project)).toBe(false);
    expect(isNeutralAudioFilter({...track,automation:[{parameter:"volume",points:[{tick:0,value:-12}]}]},project)).toBe(true);
    for(const type of ["modulation","pressure"] as const){const clip=emptyClip(0,960);clip.events=[{type,tick:0,value:1}];expect(isNeutralAudioFilter({...track,clips:[clip]},project)).toBe(false);}
  });
  it("responds to enabled filter routes while leaving gain routes and inactive patches transparent",()=>{
    const {project,track}=fixture(),patch=emptyPatch(7);track.modulation=patch;
    for(const target of ["track.cutoff","track.resonance"] as const){
      patch.routes=[{id:"filter",sourceId:"M1",target,amount:1,curve:"linear",slew:0,enabled:true}];expect(isNeutralAudioFilter(track,project)).toBe(false);
      patch.routes[0].enabled=false;expect(isNeutralAudioFilter(track,project)).toBe(true);
      patch.routes[0].enabled=true;patch.enabled=false;expect(isNeutralAudioFilter(track,project)).toBe(true);patch.enabled=true;
    }
    patch.routes=[{id:"gain",sourceId:"M1",target:"track.gain",amount:1,curve:"linear",slew:0,enabled:true}];expect(isNeutralAudioFilter(track,project)).toBe(true);
    patch.routes=[{id:"unsupported",sourceId:"M1",target:"voice.cutoff",amount:1,curve:"linear",slew:0,enabled:true}];expect(isNeutralAudioFilter(track,project)).toBe(true);
  });
});
