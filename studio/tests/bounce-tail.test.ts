import {describe,expect,it} from "vitest";
import {bounceTailSeconds,bounceRenderPlan,exportRenderPlan,exportTailSeconds} from "../lib/audio/export-range";
import {createProject,createTrack} from "../lib/music/project";
import {emptyPatch} from "../lib/audio/modulation";

describe("internal bounce tail budget",()=>{
  it("covers static release, bounded filter settling and only reachable effects while preserving ordinary export",()=>{
    const project=createProject();project.tracks=[createTrack("lead")];project.master.reverbDecay=.3;
    const track=project.tracks[0];track.sound.release=10;track.reverb=0;track.delay=0;
    expect(bounceTailSeconds(project)).toBe(18.1);expect(exportTailSeconds(project)).toBe(4);
    const range={startTick:3841,endTick:7174};project.tempo=137;
    const ordinary=exportRenderPlan(project,range,true),bounce=bounceRenderPlan(project,range,true),dry=bounceRenderPlan(project,range,false);
    expect(bounce.startFrame).toBe(ordinary.startFrame);expect(dry).toEqual(exportRenderPlan(project,range,false));
    expect(bounce.renderFrames-dry.renderFrames).toBe(Math.ceil(18.1*48000));expect(bounce.outputFrames).toBe(bounce.renderFrames-bounce.startFrame);
  });
  it("budgets slow feedback delay whenever a send, automation or supported route can reach it",()=>{
    const project=createProject();project.tempo=20;project.tracks=[createTrack("lead")];project.master.reverbDecay=.3;
    const track=project.tracks[0];track.sound.release=.5;track.reverb=0;track.delay=.01;
    expect(bounceTailSeconds(project)).toBe(.5+.1+8+45);
    track.delay=0;track.automation=[{parameter:"delay",points:[{tick:0,value:0},{tick:9000,value:.3}]}];expect(bounceTailSeconds(project)).toBe(.5+.1+8+45);
    track.automation=[];track.modulation=emptyPatch();track.modulation.routes=[{id:"delay",sourceId:"M1",target:"track.delay",amount:1,curve:"linear",slew:0,enabled:true}];
    expect(bounceTailSeconds(project)).toBe(.5+.1+8+45);track.modulation.enabled=false;expect(bounceTailSeconds(project)).toBe(.5+.1+8);
  });
  it("covers routed maximum release and built-in drum duration even beyond a short clip",()=>{
    const project=createProject();project.tracks=[createTrack("lead")];const track=project.tracks[0];track.reverb=0;track.delay=0;
    track.modulation=emptyPatch();track.modulation.routes=[{id:"release",sourceId:"M1",target:"voice.release",amount:1,curve:"linear",slew:0,enabled:true}];
    expect(bounceTailSeconds(project)).toBe(23.1);track.modulation.routes[0].enabled=false;expect(bounceTailSeconds(project)).toBe(track.sound.release+.1+8);
    project.tracks=[createTrack("drums")];project.tracks[0].reverb=0;project.tracks[0].delay=0;expect(bounceTailSeconds(project)).toBe(1.4+.1+8);
  });
});
