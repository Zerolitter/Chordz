import { describe, expect, it } from "vitest";
import {
  applyModTarget,
  changedMacroEvents,
  compileModulation,
  effectiveControlTime,
  emptyPatch,
  makeSource,
  ModulationEvaluator,
} from "../lib/audio/modulation";
import type {
  ModRoute,
  ModScope,
  ModSource,
  ModTarget,
  ModulationPatch,
} from "../lib/music/modulation-types";
import { createTrack } from "../lib/music/project";

function source(kind: ModSource["kind"], id: string, scope: ModScope = "track"): ModSource {
  return { ...makeSource(kind, id, scope), enabled: true, sync: false, rate: 1,
    phase: 0, amplitude: 1, shape: "sine" };
}

function route(id: string, sourceId: string, target: ModTarget, amount = 1): ModRoute {
  return { id, sourceId, target, amount, curve: "linear", slew: 0, enabled: true };
}

function patch(sources: ModSource[], routes: ModRoute[], seed = 0): ModulationPatch {
  return { ...emptyPatch(seed), enabled: true, sources, routes };
}

function evaluator(value: ModulationPatch, trackId = "track", tempo = 120) {
  return new ModulationEvaluator(compileModulation(value, trackId, tempo));
}

describe("live control timing and authored macro changes", () => {
  it("guards newly arrived controls by two native render quanta while preserving future timestamps", () => {
    expect(effectiveControlTime(1, 1, 48000)).toBeCloseTo(1 + 256 / 48000, 12);
    expect(effectiveControlTime(.5, 1, 48000)).toBeCloseTo(1 + 256 / 48000, 12);
    expect(effectiveControlTime(1, 1, 44100)).toBeCloseTo(1 + 256 / 44100, 12);
    expect(effectiveControlTime(2, 1, 48000)).toBe(2);
  });

  it("resets all four controls when creating or removing a patch, including zero defaults", () => {
    const before = createTrack("lead"), after = { ...before, modulation: emptyPatch() };
    expect(changedMacroEvents([before], [before])).toEqual([]);
    const created = changedMacroEvents([before], [after]);
    expect(created.map(c => c.event.macroId)).toEqual(["M1", "M2", "M3", "M4"]);
    expect(created.every(c => c.trackId === before.id && c.event.value === 0)).toBe(true);
    expect(changedMacroEvents([after], [before])).toEqual(created);
    expect(changedMacroEvents([after], [after])).toEqual([]);
  });

  it("emits only changed authored macros and overrides earlier transient events without rewriting history", () => {
    const before = { ...createTrack("lead"), modulation: { ...emptyPatch(), macros: [.2, 0, 0, 0] as [number, number, number, number] } };
    const after = { ...before, modulation: { ...before.modulation, macros: [.3, 0, 0, 0] as [number, number, number, number] } };
    const changes = changedMacroEvents([before], [after]);
    expect(changes).toEqual([{ trackId: before.id, event: { tick: 0, type: "macro", macroId: "M1", value: .3 } }]);
    const runtime = new ModulationEvaluator(compileModulation(after.modulation, before.id, 120,
      [{ seconds: .125, type: "macro", macroId: "M1", value: .9 }]));
    expect(runtime.sample(.1875).sources.M1).toBe(.9);
    for (const change of changes) runtime.addEvent({ ...change.event, seconds: .25 });
    expect(runtime.sample(.25).sources.M1).toBe(.3);
    expect(runtime.sample(.1875).sources.M1).toBe(.9);
  });
});

describe("modulation patch boundaries", () => {
  it("makes independent versioned empty patches with the requested seed", () => {
    const first = emptyPatch(), second = emptyPatch(4294967295);
    expect(first.version).toBe(1);
    expect(first.seed).toBe(0);
    expect(second.seed).toBe(4294967295);
    expect(first.sources).toEqual([]);
    expect(first.routes).toEqual([]);
    first.macros[0] = .9;
    expect(second.macros[0]).not.toBe(.9);
  });

  it("contributes zero when the patch, source or route is disabled", () => {
    const active = patch([source("lfo", "motion")], [route("filter", "motion", "track.cutoff", 2)]);
    expect(evaluator(active).sample(.25).targets["track.cutoff"]).toBeCloseTo(2, 10);
    for (const value of [
      { ...active, enabled: false },
      { ...active, sources: active.sources.map(s => ({ ...s, enabled: false })) },
      { ...active, routes: active.routes.map(r => ({ ...r, enabled: false })) },
    ]) expect(evaluator(value).sample(.25).targets["track.cutoff"] ?? 0).toBe(0);
  });

  it("rejects feedback, missing references and voice-to-track dependencies", () => {
    const a = source("lfo", "a"), b = source("lfo", "b");
    expect(() => compileModulation(patch([a], [route("self", "a", "source:a:rate")]), "t", 120)).toThrow(/loop|cycle|feedback/i);
    expect(() => compileModulation(patch([a, b], [route("ab", "a", "source:b:rate"), route("ba", "b", "source:a:amplitude")]), "t", 120)).toThrow(/loop|cycle|feedback/i);
    expect(() => compileModulation(patch([a], [route("missing", "absent", "track.pan")]), "t", 120)).toThrow();
    expect(() => compileModulation(patch([a], [route("missing", "a", "source:absent:rate")]), "t", 120)).toThrow();
    expect(() => compileModulation(patch([source("lfo", "voice", "voice"), a], [route("wrong", "voice", "source:a:rate")]), "t", 120)).toThrow(/voice|scope/i);
    expect(() => compileModulation(patch([source("lfo", "voice", "voice")], [route("wrong", "voice", "track.pan")]), "t", 120)).toThrow(/voice|scope/i);
  });

  it("accepts the limits and rejects a ninth source or thirty-third route", () => {
    const sources = Array.from({ length: 8 }, (_, i) => source("lfo", "s" + i));
    const routes = Array.from({ length: 32 }, (_, i) => route("r" + i, sources[i % 8].id, "track.pan", .1));
    expect(() => compileModulation(patch(sources, routes), "t", 120)).not.toThrow();
    expect(() => compileModulation(patch([...sources, source("lfo", "ninth")], routes), "t", 120)).toThrow();
    expect(() => compileModulation(patch(sources, [...routes, route("thirty-third", "s0", "track.pan", .1)]), "t", 120)).toThrow();
  });

  it("does not mutate authored sources, routes, macros or events", () => {
    const value = patch([source("lfo", "motion")], [route("pan", "motion", "track.pan")]);
    const events = [{ seconds: .5, type: "macro" as const, macroId: "M1" as const, value: .7 }];
    const before = JSON.stringify({ value, events });
    new ModulationEvaluator(compileModulation(value, "t", 120, events)).sample(3);
    expect(JSON.stringify({ value, events })).toBe(before);
  });
});

describe("source clocks and rate integration", () => {
  it("keeps a track clock shared and starts each voice clock at its note onset", () => {
    const value = patch([source("lfo", "shared"), source("lfo", "local", "voice")], []);
    const motion = evaluator(value);
    const a = { key: "a", pitch: 60, velocity: .6, start: .25 };
    const b = { key: "b", pitch: 67, velocity: .8, start: .5 };
    const first = motion.sample(.5, a), second = motion.sample(.5, b);
    expect(first.sources.shared).toBeCloseTo(0, 10);
    expect(second.sources.shared).toBeCloseTo(first.sources.shared, 10);
    expect(first.sources.local).toBeCloseTo(1, 10);
    expect(second.sources.local).toBeCloseTo(0, 10);
    expect(motion.sample(.125, a).sources.local).toBe(0);
  });

  it("keeps track motion identical for voices whose onsets fall between control frames", () => {
    const value = patch([source("lfo", "shared"), source("lfo", "local", "voice")], [route("pan", "shared", "track.pan")]);
    const motion = evaluator(value);
    const voice = { key: "off-grid", pitch: 60, velocity: .8, start: .13 };
    for (const seconds of [.05, .79, 4.01]) {
      const track = motion.sample(seconds), sounding = motion.sample(seconds, voice);
      expect(sounding.sources.shared).toBe(track.sources.shared);
      expect(sounding.targets["track.pan"]).toBe(track.targets["track.pan"]);
    }
  });

  it("uses tempo and division for synchronized sources", () => {
    const synced = { ...source("lfo", "beat"), sync: true, division: 1 };
    const value = patch([synced], []);
    expect(evaluator(value, "t", 120).sample(.125).sources.beat).toBeCloseTo(1, 10);
    expect(evaluator(value, "t", 60).sample(.25).sources.beat).toBeCloseTo(1, 10);
    expect(evaluator(value, "t", 120).sample(.25).sources.beat).toBeCloseTo(0, 10);
  });

  it("integrates changing rate without resetting phase or using time times current rate", () => {
    const value = patch([source("lfo", "carrier")], [route("faster", "M1", "source:carrier:rate")]);
    value.macros[0] = 0;
    const events = [{ seconds: .25, type: "macro" as const, macroId: "M1" as const, value: 1 }];
    const motion = new ModulationEvaluator(compileModulation(value, "t", 120, events));
    // One cycle/second until .25s, then two: phase is .25 + 2 * (t - .25).
    expect(motion.sample(.25).sources.carrier).toBeCloseTo(1, 10);
    expect(motion.sample(.375).sources.carrier).toBeCloseTo(0, 10);
    expect(motion.sample(.5).sources.carrier).toBeCloseTo(-1, 10);
  });

  it("evaluates one-way source routing in dependency order regardless of stored order", () => {
    const driver = { ...source("lfo", "driver"), shape: "square" as const };
    const carrier = source("lfo", "carrier");
    const value = patch([carrier, driver], [route("rate", "driver", "source:carrier:rate"), route("pan", "carrier", "track.pan")]);
    const reversed = { ...value, sources: [...value.sources].reverse(), routes: [...value.routes].reverse() };
    expect(evaluator(value).sample(.125).sources.carrier).toBeCloseTo(1, 10);
    expect(evaluator(value).sample(.125)).toEqual(evaluator(reversed).sample(.125));
  });

  it("reconstructs exact samples after backward seeks and across scheduling windows", () => {
    const value = patch([source("lfo", "carrier"), { ...source("random", "wander"), rate: 3.25 }], [
      route("rate", "wander", "source:carrier:rate", .5),
      { ...route("pan", "carrier", "track.pan", .5), slew: .08 },
    ], 42);
    const moving = evaluator(value);
    const times = [0, .03125, .79, 3.99, 4, 4.01, 7.999, 8, 8.001, 12.5];
    for (const seconds of times) expect(moving.sample(seconds)).toEqual(evaluator(value).sample(seconds));
    for (const seconds of [...times].reverse()) expect(moving.sample(seconds)).toEqual(evaluator(value).sample(seconds));
  });

  it("replays timed live control insertion after cached future windows", () => {
    const value = patch([source("lfo", "carrier")], [route("rate", "M1", "source:carrier:rate")]);
    value.macros[0] = 0;
    const event = { seconds: .25, type: "macro" as const, macroId: "M1" as const, value: 1 };
    const live = evaluator(value);
    const before = live.sample(.125);
    live.sample(8);
    live.addEvent(event);
    const recorded = new ModulationEvaluator(compileModulation(value, "track", 120, [event]));
    expect(live.sample(.125)).toEqual(before);
    for (const seconds of [.25, .5, 4, 8]) expect(live.sample(seconds)).toEqual(recorded.sample(seconds));
  });
});

describe("deterministic random and voice envelopes", () => {
  it("holds seeded random per cycle without sharing a mutable sequence", () => {
    const value = patch([{ ...source("random", "wander"), rate: 4 }], [], 4294967295);
    const first = evaluator(value), other = evaluator(value);
    const initial = first.sample(.03125).sources.wander;
    expect(initial).toBeGreaterThanOrEqual(-1);
    expect(initial).toBeLessThanOrEqual(1);
    expect(first.sample(.2).sources.wander).toBe(initial);
    const sequence = [.03125, .28125, .53125, .78125].map(t => first.sample(t).sources.wander);
    expect(new Set(sequence).size).toBeGreaterThan(1);
    other.sample(10);
    expect(other.sample(.03125).sources.wander).toBe(initial);
    expect(evaluator({ ...value, seed: 0 }).sample(.03125).sources.wander).not.toBe(initial);
    expect(evaluator(value, "another-track").sample(.03125).sources.wander).not.toBe(initial);
    const unrelated = { ...value, sources: [source("random", "unrelated"), ...value.sources] };
    expect(evaluator(unrelated).sample(.03125).sources.wander).toBe(initial);
  });

  it("shares track random across voices while seeding voice random by voice identity", () => {
    const value = patch([source("random", "shared"), source("random", "local", "voice")], [], 42);
    const a = { key: "a", pitch: 60, velocity: .7, start: 1 };
    const b = { ...a, key: "b" };
    const motion = evaluator(value);
    const first = motion.sample(1.25, a), second = motion.sample(1.25, b);
    expect(first.sources.shared).toBe(second.sources.shared);
    expect(first.sources.local).not.toBe(second.sources.local);
    expect(motion.sample(3.25, { ...a, start: 3 }).sources.local).toBe(first.sources.local);
    expect(evaluator(value).sample(1.25, a)).toEqual(first);
  });

  it("keeps a voice envelope continuous into release and finishes after its release time", () => {
    const envelope = { ...source("envelope", "shape", "voice"), attack: .125, decay: .125, sustain: .4, release: .5 };
    const motion = evaluator(patch([envelope], [route("level", "shape", "voice.gain", -12)]));
    const voice = { key: "held", pitch: 60, velocity: .8, start: 2, release: 3 };
    expect(motion.sample(1.5, voice).sources.shape).toBe(0);
    expect(motion.sample(2, voice).sources.shape).toBe(0);
    expect(motion.sample(2.125, voice).sources.shape).toBeCloseTo(1, 10);
    expect(motion.sample(2.25, voice).sources.shape).toBeCloseTo(.4, 10);
    expect(motion.sample(3, voice).sources.shape).toBeCloseTo(.4, 10);
    expect(motion.sample(3.125, voice).sources.shape).toBeGreaterThan(0);
    expect(motion.sample(3.125, voice).sources.shape).toBeLessThan(.4);
    expect(motion.sample(3.5, voice).sources.shape).toBeCloseTo(0, 10);
    expect(motion.sample(4, voice).targets["voice.gain"] ?? 0).toBe(0);
  });
});

describe("controller state and route deltas", () => {
  it("uses the latest timed macro and channel CC state without reading future events", () => {
    const value = patch([], [route("macro", "M1", "track.pan", .5), route("cc", "cc:3:74", "track.reverb")]);
    value.macros[0] = .2;
    const events = [
      { seconds: .25, type: "macro" as const, macroId: "M1" as const, value: .8 },
      { seconds: .5, type: "controlChange" as const, cc: 74, channel: 3, value: .7 },
      { seconds: .75, type: "controlChange" as const, cc: 74, channel: 4, value: .1 },
    ];
    const motion = new ModulationEvaluator(compileModulation(value, "t", 120, events));
    expect(motion.sample(.125).sources.M1).toBe(.2);
    expect(motion.sample(.25).sources.M1).toBe(.8);
    expect(motion.sample(.49).targets["track.reverb"] ?? 0).toBe(0);
    expect(motion.sample(.5).sources["cc:3:74"]).toBe(.7);
    expect(motion.sample(1).targets["track.reverb"]).toBe(.7);
    expect(motion.sample(.25).targets["track.pan"]).toBeCloseTo(.4, 10);
  });

  it("gives interpolated macro and legacy automation lanes precedence over events", () => {
    const value = patch([], [route("macro", "M1", "track.pan"), route("expression", "expression", "track.reverb")]);
    value.macros[0] = .2;
    const events = [
      { seconds: .5, type: "macro" as const, macroId: "M1" as const, value: .99 },
      { seconds: .5, type: "expression" as const, value: .99 },
    ];
    const lanes = [
      { id: "M1", points: [{ seconds: 0, value: .1 }, { seconds: 1, value: .9 }] },
      { id: "expression", points: [{ seconds: 0, value: .8 }, { seconds: 1, value: .2 }] },
    ];
    const motion = new ModulationEvaluator(compileModulation(value, "t", 120, events, lanes));
    expect(motion.sample(.5).sources.M1).toBeCloseTo(.5, 10);
    expect(motion.sample(.5).sources.expression).toBeCloseTo(.5, 10);
    expect(motion.sample(.75).sources.M1).toBeCloseTo(.7, 10);
    expect(motion.sample(2).sources.M1).toBeCloseTo(.9, 10);
    expect(motion.sample(.25).targets["track.reverb"]).toBeCloseTo(.65, 10);
  });

  it("sums destination deltas and preserves negative signs in exponential curves", () => {
    const value = patch([source("lfo", "motion")], [
      route("first", "motion", "track.pan", .8),
      route("second", "motion", "track.pan", -.3),
      { ...route("curve", "motion", "track.reverb"), curve: "exponential" },
    ]);
    const motion = evaluator(value);
    expect(motion.sample(.25).targets["track.pan"]).toBeCloseTo(.5, 10);
    expect(motion.sample(.125).targets["track.reverb"]).toBeCloseTo(.5, 10);
    expect(motion.sample(.625).targets["track.reverb"]).toBeCloseTo(-.5, 10);
  });

  it("slews a control jump gradually and reconstructs it independently of sample order", () => {
    const value = patch([], [{ ...route("pan", "M1", "track.pan"), slew: .1 }]);
    value.macros[0] = 0;
    const events = [{ seconds: .5, type: "macro" as const, macroId: "M1" as const, value: 1 }];
    const compiled = compileModulation(value, "t", 120, events);
    const motion = new ModulationEvaluator(compiled);
    expect(motion.sample(.49).targets["track.pan"] ?? 0).toBe(0);
    const early = motion.sample(.51).targets["track.pan"];
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(1);
    expect(motion.sample(.6).targets["track.pan"]).toBeCloseTo(1 - Math.exp(-1), 1);
    expect(motion.sample(1).targets["track.pan"]).toBeGreaterThan(.98);
    expect(motion.sample(.6)).toEqual(new ModulationEvaluator(compiled).sample(.6));
  });

  it("applies target units and clamps the final value after adding modulation", () => {
    expect(applyModTarget("track.cutoff", 1000, 1)).toBe(2000);
    expect(applyModTarget("track.cutoff", 15000, 2)).toBe(20000);
    expect(applyModTarget("voice.cutoff", 100, -8)).toBe(20);
    expect(applyModTarget("track.pan", .8, .5)).toBe(1);
    expect(applyModTarget("track.pan", -.8, -.5)).toBe(-1);
    expect(applyModTarget("track.gain", -12, 6)).toBe(-6);
    expect(applyModTarget("voice.gain", -40, -40)).toBe(-60);
    expect(applyModTarget("track.reverb", .8, .5)).toBe(1);
    expect(applyModTarget("voice.fmRatio", 1, -2)).toBe(.1);
    expect(applyModTarget("voice.fmIndex", 25, 10)).toBe(30);
    expect(applyModTarget("voice.pitch", 2000, 1000)).toBe(2400);
  });
});
