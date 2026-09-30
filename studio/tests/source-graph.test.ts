import { describe, expect, it } from "vitest";
import { compileModulation, emptyPatch, makeSource, ModulationEvaluator } from "../lib/audio/modulation";
import { editSourceHandle, sourceGraphLayout, sourceGraphPoints, sourceGraphValue, sourceHandlePosition } from "../components/studio/source-graph-math";

describe("modulation graph math", () => {
  it("uses the audio source function for every LFO shape and fixed-grid source", () => {
    for (const kind of ["lfo", "step", "reference", "random"] as const) for (const shape of ["sine", "triangle", "saw", "square"] as const) {
      const source = { ...makeSource(kind, "source"), shape, amplitude: .6 }, patch = emptyPatch(42);
      patch.sources = [source];
      const state = new ModulationEvaluator(compileModulation(patch, "track", 120)).sample(.578).sourceStates!.source;
      const layout = sourceGraphLayout(source, state), x = (state.phase - layout.originCycle) / layout.cycles;
      expect(sourceGraphValue(source, x, layout, state.key, state.seed, state.amplitude)).toBeCloseTo(state.value, 12);
    }
  });
  it("matches an actual voice's age and early envelope release", () => {
    const source = makeSource("envelope", "env", "voice"), patch = emptyPatch(7);
    patch.sources = [source];
    const state = new ModulationEvaluator(compileModulation(patch, "track", 120)).sample(1.35, { key: "note", pitch: 60, velocity: .7, start: 1, release: 1.3 }).sourceStates!.env;
    const layout = sourceGraphLayout(source, state);
    expect(layout.releaseAt).toBeCloseTo(.3);
    expect(sourceGraphValue(source, state.elapsed / layout.duration, layout, state.key, state.seed, state.amplitude)).toBeCloseTo(state.value, 12);
    expect(sourceHandlePosition(source, "release", layout).x).toBeLessThan(1);
  });
  it("draws exact step jumps and retains every reference point", () => {
    const step = makeSource("step", "step"), stepLayout = sourceGraphLayout(step);
    const atQuarter = sourceGraphPoints(step, stepLayout, "track:step:track", 0).filter(point => point.x === .25);
    expect(atQuarter.map(point => point.value)).toEqual([1, 0]);
    const reference = { ...makeSource("reference", "ref"), curve: Array.from({ length: 256 }, (_, index) => index % 2 ? -1 : 1) };
    const points = sourceGraphPoints(reference, sourceGraphLayout(reference), "track:ref:track", 0);
    expect(points).toHaveLength(256);
    expect(points[127].value).toBeCloseTo(-1, 10);
  });
  it("edits step/reference heights without changing their time positions or source arrays", () => {
    for (const kind of ["step", "reference"] as const) {
      const source = makeSource(kind, kind), property = kind === "step" ? "steps" : "curve", values = [...source[property]], layout = sourceGraphLayout(source);
      const edited = editSourceHandle(source, 1, .98, -.68, layout);
      expect(source[property]).toEqual(values);
      expect(edited[property]).toHaveLength(values.length);
      expect(edited[property][1]).toBe(-.68);
      expect(sourceHandlePosition(edited, 1, layout).x).toBe(sourceHandlePosition(source, 1, layout).x);
      expect(edited[property].filter((_, index) => index !== 1)).toEqual(values.filter((_, index) => index !== 1));
    }
  });
  it("clamps all graphical edits to saved parameter boundaries and ignores invalid coordinates", () => {
    const source = makeSource("envelope", "env"), layout = sourceGraphLayout(source);
    expect(editSourceHandle(source, "attack", -1, 0, layout).attack).toBe(.001);
    expect(editSourceHandle(source, "decay", -1, 4, layout)).toMatchObject({ decay: .001, sustain: 1 });
    expect(editSourceHandle(source, "release", 0, 0, layout).release).toBe(.01);
    expect(editSourceHandle(source, "phase", 3, 0, layout).phase).toBe(1);
    expect(editSourceHandle(source, "amplitude", 0, -3, layout).amplitude).toBe(0);
    expect(editSourceHandle(source, "attack", NaN, 0, layout)).toBe(source);
  });
});
