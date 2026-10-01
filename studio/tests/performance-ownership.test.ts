import {describe,expect,it} from "vitest";
import {capturedExpression, captureReleaseReset, effectiveSustain, type OwnedPerformance} from "../lib/client/performance-ownership";

describe("captured performance ownership",()=>{
  const pedal=(source:string,value:number,trackId="track"):OwnedPerformance=>({source,trackId,event:{tick:0,type:"sustain",value}});
  it("keeps sustain down until the last source on the recording track releases",()=>{
    const before=[pedal("sound:sustain",1),pedal("midi:device:0",1)];
    const firstRelease=[pedal("sound:sustain",0),pedal("midi:device:0",1)];
    const event={tick:0,type:"sustain" as const,value:0};
    expect(capturedExpression(event,120,effectiveSustain(before,"track"),effectiveSustain(firstRelease,"track"))).toBeNull();
    const lastRelease=[pedal("midi:device:0",0)];
    expect(capturedExpression(event,240,effectiveSustain(firstRelease,"track"),effectiveSustain(lastRelease,"track"))).toEqual({...event,tick:240});
  });
  it("treats ownership per track and applies the pedal threshold",()=>{
    expect(effectiveSustain([pedal("other",1,"other-track"),pedal("sound",.49)],"track")).toBe(0);
    expect(effectiveSustain([pedal("sound",.5)],"track")).toBe(1);
    expect(capturedExpression({tick:0,type:"sustain",value:.5},4,0,1)).toEqual({tick:4,type:"sustain",value:1});
  });
  it("retains actual expressive values at the capture tick",()=>{
    expect(capturedExpression({tick:0,type:"pitchBend",value:.37},91,0,0)).toEqual({tick:91,type:"pitchBend",value:.37});
    expect(capturedExpression({tick:0,type:"expression",value:.66},92,1,1)).toEqual({tick:92,type:"expression",value:.66});
  });
  it("captures device disconnect cleanup while freezing closed UI surfaces",()=>{
    expect(captureReleaseReset("midi:device:")).toBe(true);
    expect(captureReleaseReset("midi:device:3:")).toBe(true);
    expect(captureReleaseReset("computer:")).toBe(true);
    expect(captureReleaseReset("custom-input:")).toBe(true);
    for(const source of ["pointer:","pointer:1:","button:","sound:sustain","knob:expression","performance"]){
      expect(captureReleaseReset(source),source).toBe(false);
    }
    expect(captureReleaseReset("midi:sound:sustain:")).toBe(true);
  });
});
