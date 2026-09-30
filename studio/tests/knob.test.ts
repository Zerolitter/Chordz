import { describe, expect, it } from "vitest";
import { knobFromUnit, knobToUnit, knobQuantize, knobKeyValue, knobParseNumber, knobArc } from "../lib/client/knob";
import { knobModulationBase, knobModulationBounds } from "../lib/client/knob-modulation";
import { emptyPatch, makeSource } from "../lib/audio/modulation";
import { createTrack } from "../lib/music/project";

describe("DAW knob parameter boundaries", () => {
  it("maps positive frequency ranges logarithmically in both directions", () => {
    expect(knobFromUnit(.5, 20, 20000, true)).toBeCloseTo(Math.sqrt(20 * 20000), 9);
    for (const value of [20, 40, 1000, 18000, 20000]) {
      expect(knobFromUnit(knobToUnit(value, 20, 20000, true), 20, 20000, true)).toBeCloseTo(value, 8);
    }
    expect(knobToUnit(0, 20, 20000, true)).toBe(0);
    expect(knobFromUnit(2, 20, 20000, true)).toBe(20000);
  });
  it("keeps bipolar and zero-based controls finite when log mapping is unavailable", () => {
    expect(knobToUnit(0, -1, 1, true)).toBe(.5);
    expect(knobFromUnit(.25, -1, 1, true)).toBe(-.5);
    expect(knobToUnit(3, 3, 3)).toBe(0);
    expect(knobFromUnit(.5, 3, 3)).toBe(3);
  });
  it("quantizes relative to the minimum and preserves reachable endpoints", () => {
    expect(knobQuantize(.114, .1, 20, .01)).toBe(.11);
    expect(knobQuantize(.005, .001, 10, .01)).toBe(.001);
    expect(knobQuantize(10, .001, 10, .01)).toBe(10);
    expect(knobQuantize(-3, -1, 1, .01)).toBe(-1);
    expect(knobQuantize(Number.NaN, 0, 1, .01)).toBe(0);
  });
  it("supports arrows, pages and endpoints with fine keyboard movement", () => {
    const bounds = { min: -18, max: 18, step: .1 };
    expect(knobKeyValue("ArrowUp", 0, bounds)).toBe(1);
    expect(knobKeyValue("ArrowDown", 0, bounds)).toBe(-1);
    expect(knobKeyValue("PageUp", 0, bounds)).toBe(10);
    expect(knobKeyValue("ArrowUp", 0, bounds, true)).toBe(.1);
    expect(knobKeyValue("Home", 10, bounds)).toBe(-18);
    expect(knobKeyValue("End", -10, bounds)).toBe(18);
    expect(knobKeyValue("ArrowRight", 0, { min: 0, max: 1, step: .001 })).toBe(.01);
    expect(knobKeyValue("ArrowRight", 0, { min: 0, max: 1, step: .001 }, true)).toBe(.001);
    expect(knobKeyValue("a", 0, bounds)).toBeNull();
  });
  it("rejects incomplete, nonfinite and out-of-range numeric drafts without silently clamping", () => {
    for (const text of ["", " ", "-", "1e", "Infinity", "NaN", "21", "0"]) {
      expect(knobParseNumber(text, .1, 20)).toBeNull();
    }
    expect(knobParseNumber("1.25", .1, 20)).toBe(1.25);
    expect(knobParseNumber("1e1", .1, 20)).toBe(10);
  });
  it("draws a bounded 270 degree arc without crossing the zero-position gap", () => {
    expect(knobArc(0, 0)).toBe("");
    expect(knobArc(0, 1)).toContain("A 21 21 0 1 1");
    expect(knobArc(.75, .25)).toContain("A 21 21 0 0 0");
    expect(knobArc(-1, 2)).toBe(knobArc(0, 1));
  });
});

describe("knob modulation range", () => {
  it("composes scheduled automation before calculating current route contributions", () => {
    const track=createTrack();track.pan=-.5;
    track.automation=[{parameter:"pan",points:[{tick:0,value:-.8},{tick:1920,value:.8}]}];
    expect(knobModulationBase(track,"track.pan",.5,120)).toBeCloseTo(0);
    expect(knobModulationBase(track,"track.pan",1,120)).toBe(.8);
    expect(knobModulationBase(track,"track.mid",1,120)).toBe(track.mid);
  });
  it("shows a bipolar LFO's possible octaves separately from current output", () => {
    const patch = emptyPatch(); patch.sources.push(makeSource("lfo","motion"));
    patch.routes.push({id:"route",sourceId:"motion",target:"track.cutoff",amount:1,curve:"linear",slew:0,enabled:true});
    expect(knobModulationBounds(patch,"track.cutoff",1000)).toEqual([500,2000]);
    patch.sources[0].amplitude=.5;
    const range=knobModulationBounds(patch,"track.cutoff",1000)!;
    expect(range[0]).toBeCloseTo(1000/Math.SQRT2); expect(range[1]).toBeCloseTo(1000*Math.SQRT2);
  });
  it("honors signed macro depths, curve bounds and destination clamping", () => {
    const patch=emptyPatch();
    patch.routes.push({id:"route",sourceId:"M1",target:"track.pan",amount:-2,curve:"exponential",slew:0,enabled:true});
    expect(knobModulationBounds(patch,"track.pan",.5)).toEqual([-1,.5]);
    const source=makeSource("reference","ref"); source.curve=[-.5,0,.5]; patch.sources.push(source);
    patch.routes.push({id:"second",sourceId:"ref",target:"track.pan",amount:1,curve:"exponential",slew:0,enabled:true});
    expect(knobModulationBounds(patch,"track.pan",.5)).toEqual([-1,.75]);
  });
  it("omits disabled patches, routes and sources rather than advertising inactive motion", () => {
    const patch=emptyPatch(),source=makeSource("lfo","motion"); patch.sources.push(source);
    patch.routes.push({id:"route",sourceId:"motion",target:"track.cutoff",amount:1,curve:"linear",slew:0,enabled:true});
    patch.enabled=false; expect(knobModulationBounds(patch,"track.cutoff",1000)).toBeUndefined();
    patch.enabled=true;source.enabled=false;expect(knobModulationBounds(patch,"track.cutoff",1000)).toBeUndefined();
    source.enabled=true;patch.routes[0].enabled=false;expect(knobModulationBounds(patch,"track.cutoff",1000)).toBeUndefined();
  });
});
