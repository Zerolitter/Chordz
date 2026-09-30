import {describe,it,expect} from "vitest";
import {emptyPatch,makeSource} from "../lib/audio/modulation";
import {projectSchema} from "../lib/music/schema";
import {modulationSchema} from "../lib/music/modulation-schema";
import {createProject,createTrack,emptyClip} from "../lib/music/project";
import {splitClip} from "../lib/music/edit";
import {omitsStudioExtensions,performanceKey} from "../lib/music/performance";
import {exportMidi,projectBackup,restoreBackup} from "../lib/audio/export";
import {Midi} from "@tonejs/midi";
import type {ModRoute} from "../lib/music/modulation-types";
const route=(id:string,sourceId:string,target:ModRoute["target"]):ModRoute=>({id,sourceId,target,amount:1,curve:"linear",slew:0,enabled:true});
describe("saved modulation contracts",()=>{
  it("keeps v1 legacy documents and round-trips enhanced settings",()=>{
    const project=createProject(),track=createTrack("pad","Motion");
    expect(projectSchema.parse(project).schemaVersion).toBe(1);
    track.modulation=emptyPatch(42);track.modulation.sources=[makeSource("lfo","LFO")];track.modulation.routes=[route("route","LFO","track.cutoff")];project.tracks=[track];
    expect(projectSchema.parse(JSON.parse(JSON.stringify(project)))).toEqual(project);
  });
  it("rejects feedback, dangling sources, invalid scope, excess depth and limits",()=>{
    const patch=emptyPatch();patch.sources=[makeSource("lfo","a"),makeSource("random","b")];
    patch.routes=[route("r1","a","source:b:rate"),route("r2","b","source:a:rate")];expect(modulationSchema.safeParse(patch).success).toBe(false);
    patch.routes=[route("r1","missing","track.cutoff")];expect(modulationSchema.safeParse(patch).success).toBe(false);
    patch.routes=[route("r1","velocity","track.cutoff")];expect(modulationSchema.safeParse(patch).success).toBe(false);
    patch.routes=[{...route("r1","M1","track.pan"),amount:3}];expect(modulationSchema.safeParse(patch).success).toBe(false);
    patch.routes=Array.from({length:33},(_,i)=>route("r"+i,"M1","track.cutoff"));expect(modulationSchema.safeParse(patch).success).toBe(false);
    patch.routes=[];patch.sources=Array.from({length:9},(_,i)=>makeSource("lfo","l"+i));expect(modulationSchema.safeParse(patch).success).toBe(false);
  });
  it("validates independent identified performance events",()=>{
    const project=createProject(),track=createTrack("pad","Motion"),clip=emptyClip(0,1920,"Take");
    track.clips=[clip];project.tracks=[track];
    clip.events=[{tick:0,type:"macro",macroId:"M1",value:.2},{tick:0,type:"macro",macroId:"M2",value:.8},{tick:20,type:"controlChange",cc:74,channel:0,value:.5},{tick:25,type:"controlChange",cc:74,channel:1,value:.8}];
    expect(new Set(clip.events.map(performanceKey)).size).toBe(4);expect(projectSchema.safeParse(project).success).toBe(true);
    const [,right]=splitClip(clip,960,120);expect(new Set(right.events.map(performanceKey)).size).toBe(4);expect(right.events.every(e=>e.tick===0)).toBe(true);
    clip.events=[{tick:0,type:"macro",value:.5}];expect(projectSchema.safeParse(project).success).toBe(false);
    clip.events=[{tick:0,type:"controlChange",cc:120,channel:0,value:.5}];expect(projectSchema.safeParse(project).success).toBe(false);
  });
  it("protects enhanced tracks from legacy omission while allowing deletion/reset",()=>{
    const before=createProject(),track=createTrack("pad","Motion");track.modulation=emptyPatch();before.tracks=[track];
    const next=structuredClone(before);delete next.tracks[0].modulation;expect(omitsStudioExtensions(before,next)).toBe(true);
    next.tracks[0].modulation=emptyPatch();expect(omitsStudioExtensions(before,next)).toBe(false);
    next.tracks=[];expect(omitsStudioExtensions(before,next)).toBe(false);
  });
  it("exports learned controllers as MIDI CC and preserves patches in backups",async()=>{
    const project=createProject(),track=createTrack("pad","Motion"),clip=emptyClip(0,1920,"Take");
    track.modulation=emptyPatch();track.modulation.sources=[makeSource("lfo","a")];track.clips=[clip];project.tracks=[track];
    clip.events=[{tick:960,type:"controlChange",cc:74,channel:0,value:.75},{tick:0,type:"macro",macroId:"M2",value:.2}];
    const midi=new Midi(exportMidi(project));expect(midi.tracks[0].controlChanges[74][0].value).toBeCloseTo(.75,1);
    const backup=await projectBackup(project,async()=>{throw Error("No assets expected");});
    expect(restoreBackup(backup).document).toEqual(project);
  });
});
