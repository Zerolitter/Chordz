import {describe,it,expect} from "vitest";
import {createProject,emptyClip,projectEnd,tickToSeconds} from "../lib/music/project";
import {compileSong} from "../lib/audio/compile";
import {compileExportSong,exportRange,exportRenderPlan,holdExportAutomation,checkExportActive,waitForExport,acquireExportWriter} from "../lib/audio/export-range";

describe("export boundaries",()=>{
  it("resolves only an existing selected section and uses song ticks",()=>{
    const p=createProject();p.sections=[{...p.sections[0],id:"verse",startTick:3840,lengthTick:1920}];
    expect(exportRange(p,"verse")).toEqual({startTick:3840,endTick:5760});
    expect(exportRange(p)).toEqual({startTick:0,endTick:projectEnd(p)});
    expect(()=>exportRange(p,"removed")).toThrow("section");
  });
  it("keeps preroll and seeded identity while cutting crossing notes and next-section onsets",()=>{
    const p=createProject(),clip=emptyClip(0,7680);clip.notes=[
      {id:"crossing",pitch:60,tick:960,duration:5760,velocity:.7},
      {id:"before-end",pitch:64,tick:5759,duration:960,velocity:.7},
      {id:"next-section",pitch:67,tick:5760,duration:960,velocity:.7}];
    clip.events=[{tick:0,type:"sustain",value:1},{tick:5760,type:"expression",value:0},{tick:6000,type:"sustain",value:0}];p.tracks[0].clips=[clip];
    const original=compileSong(p),song=compileExportSong(p,undefined,{startTick:3840,endTick:5760});
    expect(song.notes.map(n=>[n.id,n.tick,n.duration])).toEqual([["crossing",960,4800],["before-end",5759,1]]);
    expect(song.notes[0].index).toBe(original.notes[0].index);
    expect(song.events).toHaveLength(1);expect(song.events[0].tick).toBe(0);
    expect(compileExportSong(p)).toEqual(original);
  });
  it("retains crossing audio source timing without moving or rewriting the original",()=>{
    const p=createProject(),clip=emptyClip(960,6000);clip.audio={assetId:"take",offsetSec:.25,gain:.8,fadeInSec:.1,fadeOutSec:.2};p.tracks[0].clips=[clip];
    const before=structuredClone(p),song=compileExportSong(p,undefined,{startTick:3840,endTick:5760});
    expect(song.audio[0]).toEqual({clipId:clip.id,trackId:p.tracks[0].id,tick:960,duration:4800,sourceDuration:6000,region:clip.audio});expect(p).toEqual(before);
  });
  it("holds interpolated automation at the boundary through the effect tail",()=>{
    const p=createProject();p.tracks[0].automation=[{parameter:"volume",points:[{tick:0,value:-20},{tick:7680,value:0}]}];
    const held=holdExportAutomation(p,5760);
    expect(held.tracks[0].automation[0].points).toEqual([{tick:0,value:-20},{tick:5760,value:-5}]);
    expect(p.tracks[0].automation[0].points).toHaveLength(2);expect(p.tracks[0].automation[0].points[1].tick).toBe(7680);
  });
  it("uses exact sample boundaries and an explicit tail policy",()=>{
    const p=createProject();p.tempo=137;const range={startTick:3841,endTick:5763};
    const cut=exportRenderPlan(p,range,false),tail=exportRenderPlan(p,range,true);
    expect(cut.startFrame).toBe(Math.round(tickToSeconds(range.startTick,p.tempo)*48000));
    expect(cut.renderFrames).toBe(Math.round(tickToSeconds(range.endTick,p.tempo)*48000));
    expect(cut.outputFrames).toBe(cut.renderFrames-cut.startFrame);
    expect(tail.renderFrames-cut.renderFrames).toBe(Math.ceil(Math.max(p.master.reverbDecay*2,4)*48000));
    expect(tail.outputFrames).toBe(tail.renderFrames-tail.startFrame);
  });
  it("rejects invalid boundaries and aborts before publishing any result",()=>{
    const p=createProject();expect(()=>exportRenderPlan(p,{startTick:5760,endTick:3840},true)).toThrow("range");
    const controller=new AbortController();checkExportActive(controller.signal);controller.abort();
    expect(()=>checkExportActive(controller.signal)).toThrow(/cancelled/);
  });
  it("cancels an outstanding preparation or encoder without waiting for its late result",async()=>{
    const controller=new AbortController();let complete!:(value:string)=>void;
    const pending=waitForExport(new Promise<string>(resolve=>{complete=resolve;}),controller.signal);
    controller.abort();await expect(pending).rejects.toMatchObject({name:"AbortError"});complete("late bytes");
    await expect(waitForExport(Promise.resolve("ready"))).resolves.toBe("ready");
  });
  it("aborts a writable acquired after cancellation without publishing it",async()=>{
    const controller=new AbortController();let acquired!:(writer:{abort:()=>Promise<void>})=>void,aborts=0;
    const result=acquireExportWriter(new Promise<{abort:()=>Promise<void>}>(resolve=>{acquired=resolve;}),controller.signal);
    controller.abort();await expect(result).rejects.toMatchObject({name:"AbortError"});
    acquired({abort:async()=>{aborts++;}});await Promise.resolve();await Promise.resolve();
    expect(aborts).toBe(1);
  });
});
