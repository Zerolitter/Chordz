import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureModulation,
  applyTrack,
  makeGraph,
  makeVoice,
  modulationEvent,
  scheduleModulation,
  scheduleAutomation,
  updateReverbDecay,
  modulationEffectiveTargets,
  type SongGraph,
  type Voice,
} from "../lib/audio/graph";
import { StudioEngine } from "../lib/audio/engine";
import type { ScheduledNote } from "../lib/audio/compile";
import type { ProjectDocument, Track } from "../lib/music/types";
import { instrumentFor } from "../lib/audio/catalog";
import { emptyPatch, makeSource } from "../lib/audio/modulation";
import { createProject, createTrack, emptyClip } from "../lib/music/project";
import type { ModRoute, ModTarget, ModulationPatch } from "../lib/music/modulation-types";

type ParamEvent = { kind: "set" | "linear" | "exponential" | "target"; time: number; value: number; tau?: number; order: number };

/** Models scheduled parameter values and graph ownership, without rendering audio. */
class FakeParam {
  events: ParamEvent[] = [];
  cancelLog: { kind: "cancel" | "hold"; time: number }[] = [];
  inputs = new Set<FakeNode>();
  private initial: number;
  private sequence = 0;
  constructor(private context: FakeContext, value: number) { this.initial = value; }
  get value() { return this.at(this.context.currentTime); }
  set value(value: number) { this.initial = value; }
  private add(kind: ParamEvent["kind"], value: number, time: number, tau?: number) {
    this.events.push({ kind, value, time, tau, order: this.sequence++ });
    return this;
  }
  setValueAtTime(value: number, time: number) { return this.add("set", value, time); }
  linearRampToValueAtTime(value: number, time: number) { return this.add("linear", value, time); }
  exponentialRampToValueAtTime(value: number, time: number) { return this.add("exponential", value, time); }
  setTargetAtTime(value: number, time: number, tau: number) { return this.add("target", value, time, tau); }
  cancelScheduledValues(time: number) {
    this.cancelLog.push({ kind: "cancel", time });
    this.events = this.events.filter(e => e.time < time); return this;
  }
  cancelAndHoldAtTime(time: number) {
    this.cancelLog.push({ kind: "hold", time });
    const held = this.at(time);
    this.cancelScheduledValues(time);
    return this.setValueAtTime(held, time);
  }
  at(time: number) {
    let value = this.initial, previousTime = 0;
    let target: ParamEvent | undefined;
    const settle = (at: number) => target
      ? target.value + (value - target.value) * Math.exp(-(at - previousTime) / target.tau!)
      : value;
    for (const event of [...this.events].sort((a, b) => a.time - b.time || a.order - b.order)) {
      if (event.time > time) {
        if ((event.kind === "linear" || event.kind === "exponential") && event.time > previousTime) {
          const fraction = Math.max(0, (time - previousTime) / (event.time - previousTime));
          return event.kind === "exponential" && value > 0
            ? value * Math.pow(event.value / value, fraction)
            : value + (event.value - value) * fraction;
        }
        return settle(time);
      }
      value = settle(event.time);
      previousTime = event.time;
      target = event.kind === "target" ? event : undefined;
      if (!target) value = event.value;
    }
    return settle(time);
  }
}

class FakeBuffer {
  readonly duration: number;
  readonly data: Float32Array[];
  constructor(channels: number, readonly length: number, readonly sampleRate: number) {
    this.duration = length / sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(channel: number) { return this.data[channel]; }
}

class FakeNode {
  readonly connections = new Set<FakeNode | FakeParam>();
  readonly gain: FakeParam; readonly frequency: FakeParam; readonly detune: FakeParam;
  readonly Q: FakeParam; readonly pan: FakeParam; readonly offset: FakeParam;
  readonly delayTime: FakeParam; readonly threshold: FakeParam; readonly knee: FakeParam;
  readonly ratio: FakeParam; readonly attack: FakeParam; readonly release: FakeParam;
  readonly playbackRate: FakeParam;
  type = "sine"; curve: Float32Array | null = null; oversample = "none"; fftSize = 512;
  buffer: FakeBuffer | null = null; loop = false; loopStart = 0; loopEnd = 0;
  startedAt: number | undefined; stoppedAt: number | undefined; ended = false;
  onended: ((event: Event) => void) | null = null;
  constructor(readonly context: FakeContext, readonly kind: string) {
    this.gain = context.param(1); this.frequency = context.param(440); this.detune = context.param(0);
    this.Q = context.param(1); this.pan = context.param(0); this.offset = context.param(1);
    this.delayTime = context.param(0); this.threshold = context.param(0); this.knee = context.param(0);
    this.ratio = context.param(1); this.attack = context.param(.003); this.release = context.param(.25);
    this.playbackRate = context.param(1);
  }
  connect(destination: FakeNode | FakeParam) {
    this.connections.add(destination);
    if (destination instanceof FakeParam) destination.inputs.add(this);
    return destination;
  }
  disconnect(destination?: FakeNode | FakeParam) {
    if (destination) {
      this.connections.delete(destination);
      if (destination instanceof FakeParam) destination.inputs.delete(this);
      return;
    }
    for (const destination of this.connections) if (destination instanceof FakeParam) destination.inputs.delete(this);
    this.connections.clear();
  }
  start(time = 0) { this.startedAt = time; }
  stop(time = this.context.currentTime) { this.stoppedAt = time; }
  finish() {
    if (this.ended) return;
    this.ended = true;
    this.onended?.(new Event("ended"));
  }
}

class FakeContext {
  currentTime = 0;
  sampleRate = 8000;
  readonly nodes: FakeNode[] = [];
  readonly params: FakeParam[] = [];
  readonly destination = this.node("destination");
  param(value: number) { const param = new FakeParam(this, value); this.params.push(param); return param; }
  private node(kind: string) { const node = new FakeNode(this, kind); this.nodes.push(node); return node; }
  createGain() { return this.node("gain"); }
  createOscillator() { return this.node("oscillator"); }
  createConstantSource() { return this.node("constant"); }
  createBufferSource() { return this.node("buffer"); }
  createBiquadFilter() { return this.node("filter"); }
  createStereoPanner() { return this.node("pan"); }
  createWaveShaper() { return this.node("drive"); }
  createAnalyser() { return this.node("analyser"); }
  createDynamicsCompressor() { return this.node("compressor"); }
  createConvolver() { return this.node("convolver"); }
  createDelay() { return this.node("delay"); }
  createBuffer(channels: number, length: number, rate: number) { return new FakeBuffer(channels, length, rate); }
  async decodeAudioData() { return this.createBuffer(1, 8000, this.sampleRate); }
  advance(time: number) {
    this.currentTime = time;
    for (const node of this.nodes) if (node.stoppedAt !== undefined && node.stoppedAt <= time) node.finish();
  }
}

const param = (value: AudioParam) => value as unknown as FakeParam;
const node = (value: AudioNode) => value as unknown as FakeNode;
const route = (id: string, target: ModTarget, amount: number, sourceId = "M1"): ModRoute =>
  ({ id, target, amount, sourceId, curve: "linear", slew: 0, enabled: true });

function fixture(modulation?: ModulationPatch) {
  const project = createProject(), track = createTrack("lead"), context = new FakeContext();
  project.tracks = [track]; project.master.limiter = false;
  track.reverb = 0; track.delay = 0;
  track.sound = { ...track.sound, filterEnvelope: 0, lfoDepth: 0, attack: .01, decay: .02, sustain: .6, release: .1 };
  if (modulation) track.modulation = modulation;
  const graph = makeGraph(context as unknown as BaseAudioContext, project, undefined, undefined, false, true);
  const strip = graph.tracks.get(track.id)!;
  const note = { trackId: track.id, pitch: 69, tick: 0, duration: 1920, velocity: 1, index: 7 };
  const voice = (time = 0, duration: number | undefined = 1) =>
    makeVoice(graph, track, instrumentFor(project, track), note, time, duration, new Map());
  return { project, track, context, graph, strip, voice, note };
}

function activePatch(routes: ModRoute[]) {
  return { ...emptyPatch(42), macros: [1, .5, 0, 0] as [number, number, number, number], routes };
}

describe("modulation graph bindings", () => {
  it("leaves absent and bypassed matrices without new nodes or parameter rewrites", () => {
    for (const value of [undefined, { ...activePatch([route("pan", "track.pan", .5)]), enabled: false }]) {
      const f = fixture(value);
      const nodeCount = f.context.nodes.length;
      const scheduled = JSON.stringify(f.context.params.map(p => p.events));
      configureModulation(f.graph, f.project, [], 0);
      scheduleModulation(f.graph, 0, 1, [], true);
      expect(f.context.nodes).toHaveLength(nodeCount);
      expect(JSON.stringify(f.context.params.map(p => p.events))).toBe(scheduled);
      const voice = f.voice();
      expect(voice.modulation).toBeUndefined();
      expect(f.context.nodes.filter(n => n.kind === "constant")).toHaveLength(0);
      f.graph.dispose();
    }
  });

  it("combines filter automation with octaves and keeps pulse gain separate from track volume", () => {
    const f = fixture(activePatch([
      route("cutoff", "track.cutoff", 1), route("pan", "track.pan", 1),
      route("pulse", "track.gain", -12, "M2"), route("q", "track.resonance", 24),
    ]));
    f.track.pan = .4; f.track.sound.cutoff = 1000; f.track.sound.resonance = 5;
    f.track.automation = [{ parameter: "cutoff", points: [{ tick: 0, value: 1000 }, { tick: 1920, value: 2000 }] }];
    const volume = param(f.strip.volume.gain).value;
    configureModulation(f.graph, f.project, [], 10);
    scheduleModulation(f.graph, 10, 11, [], true);
    expect(param(f.strip.filter.frequency).at(10.5)).toBeCloseTo(3000, 9);
    expect(param(f.strip.pan.pan).at(10.5)).toBe(1);
    expect(param(f.strip.filter.Q).at(10.5)).toBe(24);
    expect(param(f.strip.matrixGain!.gain).at(10.5)).toBeCloseTo(Math.pow(10, -6 / 20), 10);
    expect(param(f.strip.volume.gain).value).toBe(volume);
    expect(node(f.strip.volume).connections.has(node(f.strip.matrixGain!))).toBe(true);
    f.graph.dispose();
  });

  it("binds FM ratio/index, pitch cents and voice gain while retaining base detune", () => {
    const f = fixture(activePatch([
      route("pitch", "voice.pitch", 100), route("level", "voice.gain", -6),
      route("ratio", "voice.fmRatio", 1), route("index", "voice.fmIndex", 2),
      route("filter", "voice.cutoff", 1),
    ]));
    f.track.sound.detune = 31; f.track.sound.fmRatio = 2; f.track.sound.fmIndex = 3; f.track.sound.cutoff = 3000;
    configureModulation(f.graph, f.project, [], 0);
    const voice = f.voice();
    scheduleModulation(f.graph, 0, .5, [voice], true);
    const motion = voice.modulation!;
    expect(param(motion.pitch.offset).at(.25)).toBe(100);
    expect(param(motion.level.gain).at(.25)).toBeCloseTo(Math.pow(10, -6 / 20), 10);
    expect(param(motion.fmMod!.frequency).at(.25)).toBe(440 * 3);
    expect(param(motion.fmAmount!.gain).at(.25)).toBe(440 * 5);
    expect(param(motion.filter!.frequency).at(.25)).toBe(6000);
    expect(voice.baseBend).toEqual([31, 0]);
    for (const bend of voice.bend) expect(param(bend).inputs.has(node(motion.pitch))).toBe(true);
    f.graph.dispose();
  });

  it("keeps unsupported sample FM/filter routes while applying supported sample pitch and gain", () => {
    const f = fixture(activePatch([
      route("pitch", "voice.pitch", 100), route("level", "voice.gain", -6),
      route("ratio", "voice.fmRatio", 1), route("index", "voice.fmIndex", 2), route("filter", "voice.cutoff", 1),
    ]));
    f.track.instrumentId = "fixture";
    f.project.userInstruments = [{ id: "fixture", name: "Fixture sample", family: "test", description: "test", kind: "sample",
      zones: [{ assetId: "pcm", root: 69, low: 0, high: 127, velocityLow: 0, velocityHigh: 1, roundRobin: 0, articulation: "sustain" }],
      articulations: ["sustain"], defaults: {}, license: "test", source: "test" }];
    const authored = JSON.stringify(f.track.modulation);
    configureModulation(f.graph, f.project, [], 0);
    const buffer = f.context.createBuffer(1, 16000, 8000) as unknown as AudioBuffer;
    const voice = makeVoice(f.graph, f.track, instrumentFor(f.project, f.track), f.note, 0, 1, new Map([["pcm", buffer]]));
    expect(() => scheduleModulation(f.graph, 0, .5, [voice], true)).not.toThrow();
    expect(voice.modulation!.fmMod).toBeUndefined();
    expect(voice.modulation!.fmAmount).toBeUndefined();
    expect(voice.modulation!.filter).toBeUndefined();
    expect(param(voice.modulation!.pitch.offset).at(.25)).toBe(100);
    expect(param(voice.modulation!.level.gain).at(.25)).toBeCloseTo(Math.pow(10, -6 / 20), 10);
    expect(JSON.stringify(f.track.modulation)).toBe(authored);
    f.graph.dispose();
  });

  it("captures attack and release at note-on and applies later controls only to future notes", () => {
    const value = activePatch([route("attack", "voice.attack", .2), route("release", "voice.release", .4)]);
    value.macros[0] = .5;
    const f = fixture(value);
    configureModulation(f.graph, f.project, [], 0);
    const held = f.voice();
    const envelope = JSON.stringify(param(held.gain.gain).events);
    expect(held.modulation!.sound.attack).toBeCloseTo(.11, 10);
    expect(held.modulation!.sound.release).toBeCloseTo(.3, 10);
    for (const audioSource of held.sources) expect(node(audioSource).stoppedAt).toBeCloseTo(1.325, 10);
    modulationEvent(f.graph, f.track.id, { type: "macro", macroId: "M1", value: 1 }, .25);
    scheduleModulation(f.graph, .25, .75, [held], true);
    expect(JSON.stringify(param(held.gain.gain).events)).toBe(envelope);
    expect(held.modulation!.sound.attack).toBeCloseTo(.11, 10);
    const future = f.voice(.5);
    expect(future.modulation!.sound.attack).toBeCloseTo(.21, 10);
    expect(future.modulation!.sound.release).toBeCloseTo(.5, 10);
    f.graph.dispose();
  });

  it("resnapshots the attack of a queued voice after a patch edit while retaining a held voice's onset", () => {
    const value = activePatch([route("attack", "voice.attack", .5)]); value.macros[0] = 0;
    const f = fixture(value); f.track.sound.attack = .1;
    configureModulation(f.graph, f.project, [], 0);
    const held = makeVoice(f.graph, f.track, instrumentFor(f.project, f.track), f.note, 0, undefined, new Map());
    const future = makeVoice(f.graph, f.track, instrumentFor(f.project, f.track), { ...f.note, index: 8 }, .5, undefined, new Map());
    expect(held.modulation!.sound.attack).toBe(.1);
    expect(future.modulation!.sound.attack).toBe(.1);
    f.track.modulation = { ...value, macros: [1, .5, 0, 0] };
    configureModulation(f.graph, f.project, [], 0);
    held.updateSound!(f.track, 0); future.updateSound!(f.track, 0);
    expect(held.modulation!.sound.attack).toBe(.1);
    expect(future.modulation!.sound.attack).toBeCloseTo(.6, 10);
    expect(param(future.gain.gain).events.some(e => e.kind === "linear" && Math.abs(e.time - 1.1) < 1e-9)).toBe(true);
    f.graph.dispose();
  });

  it("retains a held attack, decay and filter envelope when those settings are edited for future notes", () => {
    const f = fixture(activePatch([route("pan", "track.pan", .2)]));
    f.track.sound = { ...f.track.sound, attack: .2, decay: .3, filterEnvelope: .6, cutoff: 1000 };
    configureModulation(f.graph, f.project, [], 0);
    const held = makeVoice(f.graph, f.track, instrumentFor(f.project, f.track), f.note, 0, undefined, new Map());
    const queued = makeVoice(f.graph, f.track, instrumentFor(f.project, f.track), { ...f.note, index: 8 }, 1, undefined, new Map());
    const parameters = [param(held.gain.gain), param(held.modulation!.filter!.frequency)];
    const curves = parameters.map(parameter => ({ events: JSON.stringify(parameter.events), cancels: JSON.stringify(parameter.cancelLog),
      values: [.1, .2, .35, .5, .75].map(at => parameter.at(at)) }));
    const sources = [...held.sources], nodes = [...f.context.nodes];
    f.context.currentTime = .0625;
    const next = { ...f.track, sound: { ...f.track.sound, attack: .8, decay: .9, filterEnvelope: .95 } };
    held.updateSound!(next, .0625); queued.updateSound!(next, .0625);
    expect(held.modulation!.sound.attack).toBe(.2); expect(held.modulation!.sound.decay).toBe(.3);
    expect(held.modulation!.sound.filterEnvelope).toBe(.6);
    expect(queued.modulation!.sound.attack).toBe(.8); expect(queued.modulation!.sound.decay).toBe(.9);
    expect(queued.modulation!.sound.filterEnvelope).toBe(.95);
    for (const [index, parameter] of parameters.entries()) {
      expect(JSON.stringify(parameter.events)).toBe(curves[index].events); expect(JSON.stringify(parameter.cancelLog)).toBe(curves[index].cancels);
      expect([.1, .2, .35, .5, .75].map(at => parameter.at(at))).toEqual(curves[index].values);
    }
    expect(param(queued.gain.gain).events.some(event => event.kind === "linear" && event.time === 1.8)).toBe(true);
    expect(held.sources).toEqual(sources); expect(f.context.nodes).toEqual(nodes);
    expect(held.end).toBe(Infinity); expect(held.sources.every(source => node(source).stoppedAt === undefined)).toBe(true);
    f.graph.dispose();
  });

  it("reports native destination values with automation, FM units and held onset settings", () => {
    const f = fixture(activePatch([route("track-cutoff", "track.cutoff", 1), route("pulse", "track.gain", -3),
      route("pitch", "voice.pitch", 100), route("gain", "voice.gain", -6), route("filter", "voice.cutoff", 1),
      route("ratio", "voice.fmRatio", 1), route("index", "voice.fmIndex", 2), route("attack", "voice.attack", .2)]));
    f.track.sound = { ...f.track.sound, algorithm: "fm", cutoff: 3000, filterEnvelope: .5, fmRatio: 2, fmIndex: 3 };
    f.track.automation = [{ parameter: "cutoff", points: [{ tick: 0, value: 1000 }, { tick: 1920, value: 2000 }] }];
    configureModulation(f.graph, f.project, [], 0);
    const voice = makeVoice(f.graph, f.track, instrumentFor(f.project, f.track), f.note, 0, undefined, new Map());
    scheduleModulation(f.graph, 0, 1, [voice], true);
    const at = .375, target = modulationEffectiveTargets(f.graph, f.track.id, at, voice);
    expect(target["track.cutoff"]).toBeCloseTo(2750, 10); expect(target["track.gain"]).toBeCloseTo(-3, 10);
    expect(target["voice.pitch"]).toBe(100); expect(target["voice.gain"]).toBeCloseTo(-6, 10);
    expect(target["voice.fmRatio"]).toBe(3); expect(target["voice.fmIndex"]).toBe(5);
    expect(target["voice.cutoff"]).toBeCloseTo(4050, 10); expect(target["voice.attack"]).toBeCloseTo(.21, 10);
    expect(target["voice.decay"]).toBe(.02); expect(target["voice.sustain"]).toBe(.6); expect(target["voice.release"]).toBe(.1);
    expect(target["voice.cutoff"]).toBeCloseTo(param(voice.modulation!.filter!.frequency).at(at), 10);
    expect(Object.isFrozen(target)).toBe(true); f.graph.dispose();
  });

  it("reschedules a live macro from its audio time without changing the preceding timeline", () => {
    const value = activePatch([route("pan", "track.pan", 1)]); value.macros[0] = 0;
    const f = fixture(value);
    configureModulation(f.graph, f.project, [], 3);
    scheduleModulation(f.graph, 3, 4, [], true);
    expect(param(f.strip.pan.pan).at(3.75)).toBe(0);
    modulationEvent(f.graph, f.track.id, { type: "macro", macroId: "M1", value: .8 }, 3.25);
    scheduleModulation(f.graph, 3.25, 4, [], true);
    expect(param(f.strip.pan.pan).at(3.125)).toBe(0);
    expect(param(f.strip.pan.pan).at(3.25)).toBe(0);
    expect(param(f.strip.pan.pan).at(3.25 + 1 / 256)).toBeCloseTo(.4, 10);
    expect(param(f.strip.pan.pan).at(3.25 + 1 / 128)).toBe(.8);
    expect(param(f.strip.pan.pan).at(3.75)).toBe(.8);
    f.graph.dispose();
  });

  it.each([.5, .5813333333333333])("inserting a CC gain event after %s seconds leaves unrelated pitch and pan curves untouched", arrival => {
    const value = activePatch([
      { ...route("pitch", "voice.pitch", 3, "drift"), slew: .03 },
      route("pan", "track.pan", .4, "pan"), route("gain", "voice.gain", -6, "cc:all:1"),
    ]);
    value.sources = [
      { ...makeSource("random", "drift", "voice"), sync: false, rate: 4.5 },
      { ...makeSource("lfo", "pan"), sync: false, rate: 2.15, phase: .07 },
    ];
    const f = fixture(value);
    configureModulation(f.graph, f.project, [], 0);
    const voice = f.voice(.037, .8), pitch = param(voice.modulation!.pitch.offset), pan = param(f.strip.pan.pan), gain = param(voice.modulation!.level.gain);
    scheduleModulation(f.graph, 0, 1.1, [voice], true);
    const untouched = [pitch, pan].map(p => ({ events: JSON.stringify(p.events), cancels: JSON.stringify(p.cancelLog) }));
    const times = [.1, .4, arrival - .0001, arrival, .5866666666666667, .59375, .6015625, .75, 1];
    const curves = [pitch, pan].map(p => times.map(t => p.at(t)));
    const gainHistory = JSON.stringify(gain.events.filter(e => e.time < arrival)), gainCancels = gain.cancelLog.length;
    f.context.currentTime = arrival;
    modulationEvent(f.graph, f.track.id, { type: "controlChange", cc: 1, channel: 3, value: .7 }, .5866666666666667);
    scheduleModulation(f.graph, arrival, 1.1, [voice], true);
    for (const [index, parameter] of [pitch, pan].entries()) {
      expect(JSON.stringify(parameter.events)).toBe(untouched[index].events);
      expect(JSON.stringify(parameter.cancelLog)).toBe(untouched[index].cancels);
      expect(times.map(t => parameter.at(t))).toEqual(curves[index]);
    }
    expect(JSON.stringify(gain.events.filter(e => e.time < arrival))).toBe(gainHistory);
    expect(gain.cancelLog.slice(gainCancels).every(e => e.time >= arrival)).toBe(true);
    expect(gain.at(arrival - .0001)).toBe(1);
    expect(gain.at(.75)).toBeCloseTo(Math.pow(10, -4.2 / 20), 10);
    f.graph.dispose();
  });

  it("retains the evaluator, held voice nodes and unrelated native curves through a source rate edit", () => {
    const value = activePatch([route("pitch", "voice.pitch", 80, "voice"), route("pan", "track.pan", .4, "shared")]);
    value.sources = [
      { ...makeSource("lfo", "voice", "voice"), sync: false, rate: 1 },
      { ...makeSource("lfo", "shared"), sync: false, rate: 1 },
    ];
    const f = fixture(value);
    configureModulation(f.graph, f.project, [], 0);
    const voice = makeVoice(f.graph, f.track, instrumentFor(f.project, f.track), f.note, .03125, undefined, new Map());
    scheduleModulation(f.graph, 0, 1, [voice], true);
    const evaluator = f.graph.modulation!.tracks.get(f.track.id)!.evaluator, motion = voice.modulation!;
    const audioNodes = [...f.context.nodes], voiceSources = [...voice.sources], pitch = param(motion.pitch.offset), pan = param(f.strip.pan.pan);
    const panEvents = JSON.stringify(pan.events), panCancels = JSON.stringify(pan.cancelLog), envelope = JSON.stringify(param(voice.gain.gain).events);
    const past = [.0625, .09375, .1171875].map(at => pitch.at(at));
    f.context.currentTime = .125;
    f.track.modulation = { ...value, sources: value.sources.map(source => source.id === "voice" ? { ...source, rate: 2 } : source) };
    configureModulation(f.graph, f.project, [], 0);
    scheduleModulation(f.graph, .125, 1, [voice], true);
    expect(f.graph.modulation!.tracks.get(f.track.id)!.evaluator).toBe(evaluator);
    expect(f.context.nodes).toEqual(audioNodes); expect(voice.sources).toEqual(voiceSources);
    expect(voice.modulation).toBe(motion); expect(voice.end).toBe(Infinity);
    expect(voice.sources.every(source => node(source).stoppedAt === undefined)).toBe(true);
    expect(JSON.stringify(param(voice.gain.gain).events)).toBe(envelope);
    expect(JSON.stringify(pan.events)).toBe(panEvents); expect(JSON.stringify(pan.cancelLog)).toBe(panCancels);
    expect([.0625, .09375, .1171875].map(at => pitch.at(at))).toEqual(past);
    const delayedPhase = .125 - .03125 + (.25 - 1 / 128 - .125) * 2;
    expect(pitch.at(.25)).toBeCloseTo(80 * Math.sin(delayedPhase * Math.PI * 2), 10);
    f.graph.dispose();
  });

  it("keeps accumulated phase and existing voice nodes when a gain route is added and removed", () => {
    const value = activePatch([route("pitch", "voice.pitch", 80, "voice")]);
    value.sources = [{ ...makeSource("lfo", "voice", "voice"), sync: false, rate: 1 }];
    const f = fixture(value);
    configureModulation(f.graph, f.project, [], 0);
    const voice = makeVoice(f.graph, f.track, instrumentFor(f.project, f.track), f.note, 0, undefined, new Map());
    scheduleModulation(f.graph, 0, 1, [voice], true);
    f.context.currentTime = .125;
    f.track.modulation = { ...value, sources: [{ ...value.sources[0], rate: 2 }] };
    configureModulation(f.graph, f.project, [], 0); scheduleModulation(f.graph, .125, 1, [voice], true);
    const motion = voice.modulation!, evaluator = f.graph.modulation!.tracks.get(f.track.id)!.evaluator;
    const audioNodes = [...f.context.nodes], pitch = param(motion.pitch.offset), pitchEvents = JSON.stringify(pitch.events), pitchCancels = JSON.stringify(pitch.cancelLog);
    f.context.currentTime = .25;
    f.track.modulation = { ...f.track.modulation, routes: [...value.routes, route("gain", "voice.gain", -6)] };
    configureModulation(f.graph, f.project, [], 0); scheduleModulation(f.graph, .25, 1, [voice], true);
    expect(param(motion.level.gain).at(.5)).toBeCloseTo(Math.pow(10, -6 / 20), 10);
    expect(JSON.stringify(pitch.events)).toBe(pitchEvents); expect(JSON.stringify(pitch.cancelLog)).toBe(pitchCancels);
    f.context.currentTime = .375;
    f.track.modulation = { ...f.track.modulation, routes: value.routes };
    configureModulation(f.graph, f.project, [], 0); scheduleModulation(f.graph, .375, 1, [voice], true);
    expect(f.graph.modulation!.tracks.get(f.track.id)!.evaluator).toBe(evaluator);
    expect(voice.modulation).toBe(motion); expect(f.context.nodes).toEqual(audioNodes);
    expect(JSON.stringify(pitch.events)).toBe(pitchEvents); expect(JSON.stringify(pitch.cancelLog)).toBe(pitchCancels);
    expect(param(motion.level.gain).at(.5)).toBe(1);
    expect(pitch.at(.5)).toBeCloseTo(80 * Math.sin((.125 + (.5 - 1 / 128 - .125) * 2) * Math.PI * 2), 10);
    expect(voice.sources.every(source => node(source).stoppedAt === undefined)).toBe(true);
    f.graph.dispose();
  });

  it("preserves native volume automation and modulated cutoff ramps when only pan is edited", () => {
    const f = fixture(activePatch([route("cutoff", "track.cutoff", 1)]));
    f.track.sound.cutoff = 1000;
    f.track.automation = [
      { parameter: "volume", points: [{ tick: 0, value: -12 }, { tick: 1920, value: -3 }] },
      { parameter: "cutoff", points: [{ tick: 0, value: 1000 }, { tick: 1920, value: 2000 }] },
    ];
    const previousTrack = structuredClone(f.track), previousProject = structuredClone(f.project);
    scheduleAutomation(f.strip, f.track, f.project, 0, 0); configureModulation(f.graph, f.project, [], 0);
    scheduleModulation(f.graph, 0, 1, [], true);
    const parameters = [param(f.strip.volume.gain), param(f.strip.filter.frequency)];
    const history = parameters.map(parameter => ({ events: JSON.stringify(parameter.events), cancels: JSON.stringify(parameter.cancelLog),
      values: [.1, .4, .8].map(at => parameter.at(at)) }));
    f.context.currentTime = .25; f.track = { ...f.track, pan: .4 }; f.project.tracks = [f.track];
    applyTrack(f.strip, f.track, f.project, .25, 480, undefined, false, previousTrack, previousProject);
    configureModulation(f.graph, f.project, [], 0); scheduleModulation(f.graph, .25, 1, [], true);
    for (const [index, parameter] of parameters.entries()) {
      expect(JSON.stringify(parameter.events)).toBe(history[index].events);
      expect(JSON.stringify(parameter.cancelLog)).toBe(history[index].cancels);
      expect([.1, .4, .8].map(at => parameter.at(at))).toEqual(history[index].values);
    }
    expect(param(f.strip.pan.pan).at(.75)).toBeCloseTo(.4, 10); f.graph.dispose();
  });

  it("reschedules only a changed automation lane and preserves the other native lane histories", () => {
    const f = fixture();
    f.track.automation = [
      { parameter: "volume", points: [{ tick: 0, value: -12 }, { tick: 1920, value: -3 }] },
      { parameter: "cutoff", points: [{ tick: 0, value: 1000 }, { tick: 1920, value: 2000 }] },
      { parameter: "pan", points: [{ tick: 0, value: 0 }, { tick: 1920, value: .5 }] },
    ];
    scheduleAutomation(f.strip, f.track, f.project, 0, 0);
    const previousTrack = structuredClone(f.track), parameters = [param(f.strip.volume.gain), param(f.strip.filter.frequency)];
    const history = parameters.map(parameter => ({ events: JSON.stringify(parameter.events), cancels: JSON.stringify(parameter.cancelLog) }));
    f.track.automation = f.track.automation.map(lane => lane.parameter === "pan" ? { ...lane, points: [{ tick: 0, value: 0 }, { tick: 1920, value: -.5 }] } : lane);
    f.context.currentTime = .25; scheduleAutomation(f.strip, f.track, f.project, .25, 480, previousTrack);
    for (const [index, parameter] of parameters.entries()) {
      expect(JSON.stringify(parameter.events)).toBe(history[index].events); expect(JSON.stringify(parameter.cancelLog)).toBe(history[index].cancels);
    }
    expect(param(f.strip.pan.pan).at(.75)).toBeCloseTo(-.375, 12); f.graph.dispose();
  });

  it.each(["routes removed", "matrix bypassed"])("restores bus targets and their cutoff automation when %s", mode => {
    const value = activePatch([route("cutoff", "track.cutoff", 1), route("q", "track.resonance", 2), route("pan", "track.pan", .4),
      route("low", "track.low", -1), route("mid", "track.mid", 2), route("high", "track.high", 2),
      route("reverb", "track.reverb", .3), route("delay", "track.delay", .4), route("pulse", "track.gain", -6)]);
    const f = fixture(value);
    f.track.sound.cutoff = 1000; f.track.sound.resonance = 3; f.track.pan = -.3;
    f.track.low = 2; f.track.mid = -1; f.track.high = 4; f.track.reverb = .2; f.track.delay = .15;
    f.track.automation = [{ parameter: "cutoff", points: [{ tick: 0, value: 1000 }, { tick: 1920, value: 2000 }] }];
    configureModulation(f.graph, f.project, [], 0); scheduleModulation(f.graph, 0, 1, [], true);
    const earlierCutoff = param(f.strip.filter.frequency).at(.125);
    f.context.currentTime = .25;
    f.track.modulation = mode === "matrix bypassed" ? { ...value, enabled: false } : { ...value, routes: [] };
    configureModulation(f.graph, f.project, [], 0); scheduleModulation(f.graph, .25, 1, [], true);
    expect(param(f.strip.filter.frequency).at(.125)).toBe(earlierCutoff);
    expect(param(f.strip.filter.frequency).at(.75)).toBeCloseTo(1750, 10);
    expect(param(f.strip.filter.Q).at(.75)).toBe(3); expect(param(f.strip.pan.pan).at(.75)).toBe(-.3);
    expect(param(f.strip.low.gain).at(.75)).toBe(2); expect(param(f.strip.mid.gain).at(.75)).toBe(-1); expect(param(f.strip.high.gain).at(.75)).toBe(4);
    expect(param(f.strip.reverb.gain).at(.75)).toBe(.2); expect(param(f.strip.delay.gain).at(.75)).toBe(.15);
    expect(param(f.strip.matrixGain!.gain).at(.75)).toBe(1); f.graph.dispose();
  });

  it.each(["routes disabled", "matrix bypassed"])("restores base pitch, level, FM and the native filter envelope when %s", mode => {
    const value = activePatch([
      route("pitch", "voice.pitch", 100), route("level", "voice.gain", -6),
      route("ratio", "voice.fmRatio", 1), route("index", "voice.fmIndex", 2),
      route("filter", "voice.cutoff", 1), route("q", "voice.resonance", 3),
      route("pulse", "track.gain", -6), route("pan", "track.pan", .2),
    ]);
    const f = fixture(value);
    f.track.sound = { ...f.track.sound, cutoff: 3000, resonance: 5, filterEnvelope: .8, fmRatio: 2, fmIndex: 3 };
    configureModulation(f.graph, f.project, [], 0);
    const voice = f.voice(), motion = voice.modulation!;
    scheduleModulation(f.graph, 0, .5, [voice], true);
    expect(param(motion.pitch.offset).at(.005)).toBe(100);
    expect(param(motion.fmMod!.frequency).at(.005)).toBe(440 * 3);
    const priorFilter = param(motion.filter!.frequency).at(.005);
    f.context.currentTime = .005;
    f.track.modulation = mode === "matrix bypassed"
      ? { ...value, enabled: false }
      : { ...value, routes: value.routes.map(r => r.id === "pan" ? r : { ...r, enabled: false }) };
    configureModulation(f.graph, f.project, [], 0);
    scheduleModulation(f.graph, .005, .5, [voice], true);
    expect(param(motion.pitch.offset).at(.1)).toBe(0);
    expect(param(motion.level.gain).at(.1)).toBe(1);
    expect(param(f.strip.matrixGain!.gain).at(.1)).toBe(1);
    expect(param(motion.fmMod!.frequency).at(.1)).toBe(440 * 2);
    expect(param(motion.fmAmount!.gain).at(.1)).toBe(440 * 3);
    expect(param(motion.filter!.Q).at(.1)).toBe(5);
    expect(param(motion.filter!.frequency).at(.005)).toBe(priorFilter);
    const transitioning = param(motion.filter!.frequency).at(.01);
    expect(Number.isFinite(transitioning)).toBe(true);
    expect(transitioning).toBeLessThan(priorFilter);
    expect(transitioning).toBeGreaterThan(3000 * (1 - .8 * .65));
    expect(param(motion.filter!.frequency).at(.03)).toBeCloseTo(3000 * (1 - .8 * .65), 9);
    expect(param(motion.filter!.frequency).at(.1)).toBeCloseTo(3000 * (1 - .8 * .65), 9);
    f.graph.dispose();
  });

  it.each(["natural", "release", "cancel"])("cleans matrix nodes after %s completion and uses song time for release", mode => {
    const f = fixture(activePatch([route("level", "voice.gain", -6), route("pitch", "voice.pitch", 100)]));
    configureModulation(f.graph, f.project, [], 5, 2);
    const voice = makeVoice(f.graph, f.track, instrumentFor(f.project, f.track), f.note, 5,
      mode === "natural" ? .25 : undefined, new Map()), motion = voice.modulation!;
    if (mode === "natural") {
      expect(motion.context.release).toBe(2.25);
      for (const audioSource of voice.sources) expect(node(audioSource).stoppedAt).toBeCloseTo(5.375, 10);
      f.context.advance(5.38);
    } else if (mode === "release") {
      expect(voice.end).toBe(Infinity);
      voice.release(5.5);
      expect(motion.context.release).toBe(2.5);
      for (const audioSource of voice.sources) expect(node(audioSource).stoppedAt).toBeCloseTo(5.64, 10);
      f.context.advance(5.65);
    } else {
      voice.cancel(5.5);
      expect(motion.context.release).toBe(2.5);
      expect(param(voice.gain.gain).at(5.52)).toBeCloseTo(0, 10);
      f.context.advance(5.53);
    }
    expect(node(motion.pitch).stoppedAt).toBeDefined();
    expect(node(motion.pitch).connections.size).toBe(0);
    expect(node(motion.level).connections.size).toBe(0);
    expect(node(voice.gain).connections.size).toBe(0);
    for (const audioSource of voice.sources) expect(node(audioSource).connections.size).toBe(0);
    f.graph.dispose();
    expect(node(f.strip.matrixGain!).connections.size).toBe(0);
  });
});

type EngineTestState = {
  context: AudioContext; graph: SongGraph; liveGraph: SongGraph | null; output: GainNode; limiter: DynamicsCompressorNode;
  voices: Voice[]; playing: boolean; activity: "song" | "audition"; previewId: string | null; previewTrackId: string | null;
  previewInstrument: string | null;
  live: Map<string, Voice[]>; liveModVoices: Set<Voice>; heldKeys: Set<string>;
  liveOwners: Map<string, { trackId: string; pitch: number; token: symbol }>;
  toneContext: { resume: () => Promise<void>; dispose: () => void };
  backendJobs: Map<string, { token: symbol; failed?: boolean }>;
  readyTrack: (track: Track) => Track;
  readyInstrument: (track: Track) => ReturnType<typeof instrumentFor>;
  buffers: Map<string, AudioBuffer>;
  schedule: () => void;
  resetCursors: (tick: number, includeHeld: boolean) => void;
  bindVoice: (voice: Voice, graph: SongGraph, track: Track, note: ScheduledNote, at: number, duration: number | undefined) => void;
};

function engineFixture(audition = false, asset: (id: string) => Promise<Blob> = async () => { throw Error("No sample assets in this fixture"); }, setup?: (project: ProjectDocument) => void) {
  const project = createProject(), context = new FakeContext();
  project.master.limiter = false; project.master.reverbDecay = .05;
  project.tracks = [createTrack("lead"), createTrack("bass")];
  for (const [index, track] of project.tracks.entries()) {
    track.id = "engine-" + index; track.reverb = 0; track.delay = 0;
    track.sound = { ...track.sound, algorithm: "fm", lfoDepth: 0, filterEnvelope: 0, attack: .2, decay: .3, sustain: .6, release: .1 };
    track.modulation = activePatch([route("pitch", "voice.pitch", 80, "clock")]);
    track.modulation.sources = [{ ...makeSource("lfo", "clock", "voice"), sync: false, rate: 1 }];
  }
  setup?.(project);
  const graph = makeGraph(context as unknown as BaseAudioContext, project, undefined, undefined, false, true);
  configureModulation(graph, project, [], 0);
  const engine = new StudioEngine(project, asset);
  // Inject only the native scheduling boundary; the engine's edit classification and voice bookkeeping run unchanged.
  const state = engine as unknown as EngineTestState;
  Object.assign(state, { context, graph, output: context.createGain(), limiter: context.createDynamicsCompressor(),
    toneContext: { resume: async () => {}, dispose: () => {} }, playing: !audition, activity: audition ? "audition" : "song",
    previewId: audition ? "preview-identity" : null, previewTrackId: audition ? project.tracks[0].id : null,
    previewInstrument: audition ? JSON.stringify(instrumentFor(project, project.tracks[0])) : null });
  const make = (track: Track, at: number, index: number, duration?: number) => {
    const note: ScheduledNote = { id: "note-" + index, trackId: track.id, pitch: 69, tick: Math.round(at * 1920), duration: 576, velocity: .8, index };
    const voice = makeVoice(graph, track, instrumentFor(project, track), note, at, duration, new Map());
    state.bindVoice(voice, graph, track, note, at, duration); return voice;
  };
  const held = make(project.tracks[0], 0, 1), queued = make(project.tracks[0], .75, 2, .3), other = make(project.tracks[1], .8, 3, .3);
  state.voices = [held, queued, other]; scheduleModulation(graph, 0, 1.5, state.voices, true); context.currentTime = .0625;
  return { project, context, graph, engine, state, held, queued, other };
}

describe("engine scalar and backend continuity", () => {
  it.each(["instrument ID", "resolved manifest"] as const)("cancels audition on %s replacement while preserving unrelated raw live owners and voices", async replacement => {
    const f = engineFixture(true, undefined, replacement === "resolved manifest" ? project => {
      const manifest = { ...structuredClone(instrumentFor(project, project.tracks[0])), id: "captured-instrument" };
      project.userInstruments.push(manifest); project.tracks[0].instrumentId = manifest.id;
    } : undefined);
    const input = "keyboard:unrelated", liveTrack = f.project.tracks[1];
    try {
      await f.engine.noteOn(liveTrack.id, 72, .7, input);
      const raw = f.state.live.get(input)![0], sources = [...raw.sources], liveGraph = f.state.liveGraph;
      const owner = f.state.liveOwners.get(input), envelope = JSON.stringify(param(raw.gain.gain).events);
      const next = structuredClone(f.project);
      if (replacement === "instrument ID") next.tracks[0].instrumentId = "bass";
      else next.userInstruments[0] = { ...next.userInstruments[0], defaults: { ...next.userInstruments[0].defaults, fmRatio: 7 } };
      f.engine.updateProject(next);
      expect(f.engine.state.previewId).toBeNull(); expect(f.engine.state.activity).toBe("idle");
      expect(f.state.voices).toEqual([]);
      expect([f.held, f.queued, f.other].every(voice => voice.sources.every(source => node(source).stoppedAt === f.context.currentTime + .02))).toBe(true);
      expect(f.state.liveGraph).toBe(liveGraph); expect(f.state.live.get(input)).toEqual([raw]);
      expect(f.state.liveOwners.get(input)).toBe(owner); expect(f.state.heldKeys.has(input)).toBe(true);
      expect(f.state.liveModVoices.has(raw)).toBe(true); expect(raw.end).toBe(Infinity); expect(raw.sources).toEqual(sources);
      expect(raw.sources.every(source => node(source).stoppedAt === undefined)).toBe(true);
      expect(JSON.stringify(param(raw.gain.gain).events)).toBe(envelope);
    } finally { f.engine.dispose(); }
  });

  it("rebuilds a same-object live track addition without losing existing raw held voices or owners", async () => {
    const f = engineFixture(false), input = "keyboard:existing";
    try {
      await f.engine.noteOn(f.project.tracks[0].id, 69, .8, input);
      const raw = f.state.live.get(input)![0], oldGraph = f.state.liveGraph!, oldStrip = oldGraph.tracks.get(raw.trackId)!;
      const owner = f.state.liveOwners.get(input), sources = [...raw.sources], envelope = JSON.stringify(param(raw.gain.gain).events);
      const added = createTrack("lead"); added.id = "same-object-added"; added.reverb = 0; added.delay = 0;
      f.project.tracks.push(added);
      f.engine.updateProject(f.project);
      const rebuilt = f.state.liveGraph!;
      expect(rebuilt === oldGraph).toBe(false); expect(rebuilt.tracks.has(added.id)).toBe(true);
      expect(f.state.live.get(input)).toEqual([raw]); expect(f.state.liveOwners.get(input)).toBe(owner);
      expect(f.state.heldKeys.has(input)).toBe(true); expect(f.state.liveModVoices.has(raw)).toBe(true);
      expect(raw.end).toBe(Infinity); expect(raw.sources).toEqual(sources);
      expect(raw.sources.every(source => node(source).stoppedAt === undefined)).toBe(true);
      expect(JSON.stringify(param(raw.gain.gain).events)).toBe(envelope);
      expect(node(raw.output ?? raw.gain).connections.has(node(oldStrip.input))).toBe(false);
      expect(node(raw.output ?? raw.gain).connections.has(node(rebuilt.tracks.get(raw.trackId)!.input))).toBe(true);
      await expect(f.engine.noteOn(added.id, 76, .7, "keyboard:new")).resolves.toBe(f.context.currentTime);
      expect(f.state.live.get("keyboard:new")![0].trackId).toBe(added.id);
      expect(f.state.live.get(input)).toEqual([raw]); expect(f.state.liveOwners.get(input)).toBe(owner);
    } finally { f.engine.dispose(); }
  });

  it.each([false, true])("preserves held and queued voice identities through source, sound and pan edits during audition: %s", audition => {
    const f = engineFixture(audition), voices = [...f.state.voices], nodes = [...f.context.nodes];
    const gainEvents = JSON.stringify(param(f.held.gain.gain).events), gainCancels = JSON.stringify(param(f.held.gain.gain).cancelLog);
    const unrelated = [param(f.other.modulation!.pitch.offset), param(f.other.modulation!.filter!.frequency)];
    const curves = unrelated.map(parameter => ({ events: JSON.stringify(parameter.events), cancels: JSON.stringify(parameter.cancelLog) }));
    const next = structuredClone(f.project), track = next.tracks[0];
    track.pan = .4; track.sound.wave = "square"; track.sound.attack = .8; track.sound.decay = .9; track.sound.filterEnvelope = .7;
    track.modulation!.sources[0].rate = 2;
    try {
      f.engine.updateProject(next);
      expect(f.engine.state.playing).toBe(!audition); expect(f.engine.state.activity).toBe(audition ? "audition" : "song");
      expect(f.engine.state.previewId).toBe(audition ? "preview-identity" : null);
      expect(f.state.graph).toBe(f.graph); expect(f.state.voices).toEqual(voices); expect(f.context.nodes).toEqual(nodes);
      expect(f.held.modulation!.sound.attack).toBe(.2); expect(f.held.modulation!.sound.decay).toBe(.3);
      expect(f.held.modulation!.sound.filterEnvelope).toBe(0); expect(f.queued.modulation!.sound.attack).toBe(.8);
      expect(f.queued.start).toBe(.75); expect(f.other.start).toBe(.8);
      expect(JSON.stringify(param(f.held.gain.gain).events)).toBe(gainEvents); expect(JSON.stringify(param(f.held.gain.gain).cancelLog)).toBe(gainCancels);
      expect(f.held.sources.every(source => node(source).stoppedAt === undefined)).toBe(true);
      for (const [index, parameter] of unrelated.entries()) {
        expect(JSON.stringify(parameter.events)).toBe(curves[index].events); expect(JSON.stringify(parameter.cancelLog)).toBe(curves[index].cancels);
      }
    } finally { f.engine.dispose(); }
  });

  it.each(["algorithm", "articulation"] as const)("replaces only an affected queued %s backend at its original onset while the held topology survives", async field => {
    const f = engineFixture(true), next = structuredClone(f.project), originalHeld = [...f.held.sources];
    const otherCurves = JSON.stringify(param(f.other.modulation!.pitch.offset).events);
    if (field === "algorithm") next.tracks[0].sound.algorithm = "subtractive";
    else next.tracks[0].sound.articulation = "staccato";
    try {
      f.engine.updateProject(next);
      // Synth loading has no assets but retains the real asynchronous readiness boundary.
      await f.engine.ensureBuffers(next, [next.tracks[0].id]); await Promise.resolve();
      const replacement = f.state.voices.find(voice => voice.trackId === f.queued.trackId && voice.start === .75)!;
      expect(replacement).not.toBe(f.queued); expect(replacement.pitch).toBe(f.queued.pitch);
      expect(replacement.modulation!.context.key).toBe(f.queued.modulation!.context.key);
      expect(replacement.modulation!.context.start).toBe(f.queued.modulation!.context.start);
      expect(replacement.sources).toHaveLength(field === "algorithm" ? 3 : 2); expect(replacement.sources.every(source => node(source).startedAt === .75)).toBe(true);
      expect(replacement.modulation!.sound[field]).toBe(next.tracks[0].sound[field]);
      expect(replacement.end).toBeCloseTo(1.25, 12);
      expect(f.queued.sources.every(source => node(source).stoppedAt === f.context.currentTime + .02)).toBe(true);
      expect(f.state.voices[0]).toBe(f.held); expect(f.held.sources).toEqual(originalHeld); expect(f.held.sources).toHaveLength(2);
      expect(f.held.modulation!.sound.algorithm).toBe("fm"); expect(f.held.end).toBe(Infinity);
      expect(f.held.modulation!.sound.articulation).toBe(f.project.tracks[0].sound.articulation);
      expect(f.held.sources.every(source => node(source).stoppedAt === undefined)).toBe(true);
      expect(f.state.voices[2]).toBe(f.other); expect(JSON.stringify(param(f.other.modulation!.pitch.offset).events)).toBe(otherCurves);
      expect(f.engine.state.previewId).toBe("preview-identity"); expect(f.engine.state.activity).toBe("audition");
    } finally { f.engine.dispose(); }
  });

  it("keeps a failed new backend on the previous instrument until a matching explicit retry succeeds", async () => {
    let rejectAsset!: (reason: Error) => void, attempted!: () => void, failed!: () => void, calls = 0;
    const request = new Promise<void>(resolve => { attempted = resolve; }), failure = new Promise<void>(resolve => { failed = resolve; });
    const f = engineFixture(false, async () => {
      if (++calls > 1) return new Blob([new Uint8Array([1])]);
      attempted(); return new Promise<Blob>((_, reject) => { rejectAsset = reject; });
    });
    const next = structuredClone(f.project), track = next.tracks[0];
    track.instrumentId = "replacement"; track.sound.attack = .4;
    next.userInstruments.push({ id: "replacement", name: "Replacement", family: "test", description: "test", kind: "sample",
      zones: [{ assetId: "replacement-pcm", root: 69, low: 0, high: 127, velocityLow: 0, velocityHigh: 1, roundRobin: 0, articulation: "sustain" }],
      articulations: ["sustain"], defaults: {}, license: "test", source: "test" });
    f.engine.onStatus = message => { if (message === "Fixture load failed") failed(); };
    try {
      f.engine.updateProject(next); await request;
      const pending = f.state.backendJobs.get(track.id)!;
      expect(f.state.readyTrack(track).instrumentId).toBe(f.project.tracks[0].instrumentId);
      expect(f.state.readyTrack(track).sound.attack).toBe(.4);
      expect(f.state.readyInstrument(f.state.readyTrack(track)).id).toBe(instrumentFor(f.project, f.project.tracks[0]).id);
      expect(f.state.voices[1]).toBe(f.queued);
      rejectAsset(Error("Fixture load failed")); await failure;
      expect(pending.failed).toBe(true); expect(f.engine.instrumentReadiness(track.id).state).toBe("failed");
      await f.engine.ensureBuffers(f.project, [track.id]);
      expect(f.state.backendJobs.get(track.id)).toBe(pending); expect(f.state.voices[1]).toBe(f.queued); expect(calls).toBe(1);
      await f.engine.ensureBuffers(next, [track.id]);
      expect(calls).toBe(2); expect(f.state.backendJobs.has(track.id)).toBe(false);
      expect(f.engine.instrumentReadiness(track.id).state).toBe("ready");
      const replacement = f.state.voices[1]; expect(replacement).not.toBe(f.queued); expect(replacement.start).toBe(.75);
      expect(replacement.sources).toHaveLength(1); expect(node(replacement.sources[0]).kind).toBe("buffer");
      expect(f.state.voices[0]).toBe(f.held); expect(f.state.voices[2]).toBe(f.other);
    } finally { f.engine.dispose(); }
  });

  it("schedules identical overlapping audio clip copies separately and avoids duplicates after cursor resets", () => {
    const project = createProject(), track = createTrack("lead"), context = new FakeContext();
    track.kind = "audio"; track.reverb = 0; track.delay = 0; project.tracks = [track]; project.master.reverbDecay = .05;
    const first = { ...emptyClip(192, 960), id: "copy-one", audio: { assetId: "pcm", offsetSec: 0, gain: .8, fadeInSec: 0, fadeOutSec: 0 } };
    track.clips = [first, { ...structuredClone(first), id: "copy-two" }];
    const graph = makeGraph(context as unknown as BaseAudioContext, project, undefined, undefined, false, true);
    const engine = new StudioEngine(project, async () => { throw Error("Already decoded audio fixture"); }), state = engine as unknown as EngineTestState;
    Object.assign(state, { context, graph, output: context.createGain(), limiter: context.createDynamicsCompressor(),
      toneContext: { resume: async () => {}, dispose: () => {} }, playing: true, activity: "song",
      voices: [], buffers: new Map([["pcm", context.createBuffer(1, 16000, 8000)]]) });
    try {
      state.schedule(); const originals = [...state.voices];
      expect(originals).toHaveLength(2); expect(originals.map(voice => voice.start)).toEqual([.1, .1]);
      expect(originals[0].sources[0]).not.toBe(originals[1].sources[0]);
      state.resetCursors(0, false); state.schedule(); expect(state.voices).toEqual(originals);
      const next = structuredClone(project);
      next.tracks[0].clips.push({ ...structuredClone(first), id: "copy-three", startTick: 240 });
      engine.updateProject(next); state.schedule();
      expect(state.voices).toHaveLength(3); expect(state.voices.slice(0, 2)).toEqual(originals);
      expect(state.voices[2].start).toBe(.125);
      state.resetCursors(0, false); state.schedule(); expect(state.voices).toHaveLength(3);
    } finally { engine.dispose(); }
  });

  it("does not let a successful retry of an older backend clear a newer pending replacement", async () => {
    type AssetRequest = { id: string; resolve: (blob: Blob) => void; reject: (error: Error) => void };
    const requests: AssetRequest[] = []; let requested: (() => void) | undefined, failed!: () => void;
    const failure = new Promise<void>(resolve => { failed = resolve; });
    const f = engineFixture(false, id => new Promise<Blob>((resolve, reject) => {
      requests.push({ id, resolve, reject }); requested?.(); requested = undefined;
    }));
    const request = async () => {
      if (!requests.length) await new Promise<void>(resolve => { requested = resolve; });
      return requests.shift()!;
    };
    const first = structuredClone(f.project), trackId = first.tracks[0].id;
    for (const id of ["replacement-a", "replacement-b"]) first.userInstruments.push({ id, name: id, family: "test", description: "test", kind: "sample",
      zones: [{ assetId: id, root: 69, low: 0, high: 127, velocityLow: 0, velocityHigh: 1, roundRobin: 0, articulation: "sustain" }],
      articulations: ["sustain"], defaults: {}, license: "test", source: "test" });
    first.tracks[0].instrumentId = "replacement-a";
    f.engine.onStatus = message => { if (message === "First replacement failed") failed(); };
    try {
      f.engine.updateProject(first); (await request()).reject(Error("First replacement failed")); await failure;
      const oldJob = f.state.backendJobs.get(trackId)!; expect(oldJob.failed).toBe(true);
      const retry = f.engine.ensureBuffers(first, [trackId]), retryAsset = await request();
      expect(retryAsset.id).toBe("replacement-a");
      const next = structuredClone(first); next.tracks[0].instrumentId = "replacement-b";
      f.engine.updateProject(next); const nextAsset = await request(), nextJob = f.state.backendJobs.get(trackId)!;
      expect(nextAsset.id).toBe("replacement-b"); expect(nextJob.token).not.toBe(oldJob.token);
      retryAsset.resolve(new Blob([new Uint8Array([1])])); await retry;
      expect(f.state.backendJobs.get(trackId)).toBe(nextJob); expect(f.state.voices[1]).toBe(f.queued);
      expect(f.state.readyTrack(next.tracks[0]).instrumentId).toBe(f.project.tracks[0].instrumentId);
      const complete = f.engine.ensureBuffers(next, [trackId]); nextAsset.resolve(new Blob([new Uint8Array([2])])); await complete; await Promise.resolve();
      expect(f.state.backendJobs.has(trackId)).toBe(false); expect(f.state.voices[1]).not.toBe(f.queued);
      expect(node(f.state.voices[1].sources[0]).buffer).toBe(f.state.buffers.get("replacement-b"));
      expect(f.state.voices[0]).toBe(f.held); expect(f.state.voices[2]).toBe(f.other);
    } finally { f.engine.dispose(); }
  });
});

describe("live reverb return changes", () => {
  afterEach(() => vi.useRealTimers());

  it("coalesces the latest decay and crossfades only the wet returns", () => {
    vi.useFakeTimers();
    const f = fixture(), wet = f.graph.reverbState!, initial = wet.current;
    const dry = [f.strip.input, f.strip.filter, f.strip.volume, f.strip.pan, f.strip.reverb, f.graph.master, f.graph.output];
    const dryConnections = dry.map(value => [...node(value).connections]);
    const advance = (ms: number) => { f.context.currentTime += ms / 1000; vi.advanceTimersByTime(ms); };
    updateReverbDecay(f.graph, 2, 7); advance(50); updateReverbDecay(f.graph, 3, 11);
    expect(wet.current).toBe(initial);
    advance(50);
    expect(wet.decay).toBe(3); expect(wet.seed).toBe(11); expect(wet.pending).toBeNull();
    expect(wet.current.convolver).not.toBe(initial.convolver);
    expect(node(wet.current.convolver).buffer!.duration).toBe(3);
    expect(node(wet.input).connections.has(node(initial.convolver))).toBe(true);
    expect(node(wet.input).connections.has(node(wet.current.convolver))).toBe(true);
    expect(param(initial.level.gain).at(.15) + param(wet.current.level.gain).at(.15)).toBeCloseTo(1, 12);
    expect(param(initial.level.gain).at(.2)).toBeCloseTo(0, 12);
    expect(param(wet.current.level.gain).at(.2)).toBeCloseTo(1, 12);
    advance(110);
    expect(wet.retired).toBeUndefined(); expect(node(initial.convolver).connections.size).toBe(0);
    expect(node(initial.level).connections.size).toBe(0);
    expect(node(wet.input).connections.has(node(initial.convolver))).toBe(false);
    for (const [index, value] of dry.entries()) expect([...node(value).connections]).toEqual(dryConnections[index]);
    f.graph.dispose(); expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds active convolvers during a long drag and keeps held voices and dry paths intact", () => {
    vi.useFakeTimers();
    const f = fixture(activePatch([route("pitch", "voice.pitch", 80)]));
    configureModulation(f.graph, f.project, [], 0);
    const voice = makeVoice(f.graph, f.track, instrumentFor(f.project, f.track), f.note, 0, undefined, new Map());
    const sources = [...voice.sources], matrix = voice.modulation!, dry = [f.strip.input, f.strip.filter, f.strip.volume, f.strip.pan, voice.gain, matrix.level];
    const connections = dry.map(value => [...node(value).connections]), envelope = JSON.stringify(param(voice.gain.gain).events);
    const advance = (ms: number) => { f.context.currentTime += ms / 1000; vi.advanceTimersByTime(ms); };
    for (let index = 0; index < 24; index++) {
      updateReverbDecay(f.graph, .5 + index * .1, index);
      advance(25);
      expect(f.graph.nodes.filter(value => node(value).kind === "convolver").length).toBeLessThanOrEqual(2);
      expect([...node(f.graph.reverbState!.input).connections].filter(value => value instanceof FakeNode && value.kind === "convolver").length).toBeLessThanOrEqual(2);
      expect(voice.sources).toEqual(sources); expect(voice.modulation).toBe(matrix); expect(voice.end).toBe(Infinity);
      expect(voice.sources.every(source => node(source).stoppedAt === undefined)).toBe(true);
      expect(JSON.stringify(param(voice.gain.gain).events)).toBe(envelope);
      for (const [offset, value] of dry.entries()) expect([...node(value).connections]).toEqual(connections[offset]);
    }
    advance(500);
    // A coalesced final build starts at the current native time; advance that clock through its own crossfade.
    advance(110);
    expect(f.graph.reverbState!.decay).toBeCloseTo(2.8, 12); expect(f.graph.reverbState!.seed).toBe(23);
    expect(f.graph.nodes.filter(value => node(value).kind === "convolver")).toHaveLength(1);
    expect(f.graph.reverbState!.pending).toBeNull(); expect(vi.getTimerCount()).toBe(0);
    f.graph.dispose();
  });

  it("retains the old wet return while native audio time is paused during a crossfade", () => {
    vi.useFakeTimers();
    const f = fixture(), wet = f.graph.reverbState!, old = wet.current;
    updateReverbDecay(f.graph, 2, 4); f.context.currentTime = .1; vi.advanceTimersByTime(100);
    expect(wet.current).not.toBe(old);
    vi.advanceTimersByTime(1000);
    expect(wet.retired).toBe(old); expect(node(old.convolver).connections.size).toBeGreaterThan(0);
    expect(node(wet.input).connections.has(node(old.convolver))).toBe(true);
    expect(param(old.level.gain).at(.1)).toBe(1);
    f.context.currentTime = .21; vi.advanceTimersByTime(100);
    expect(wet.retired).toBeUndefined(); expect(node(old.convolver).connections.size).toBe(0);
    expect(node(wet.input).connections.has(node(old.convolver))).toBe(false);
    f.graph.dispose(); expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])("disposal cancels a pending impulse build, including an active crossfade: %s", crossfading => {
    vi.useFakeTimers();
    const f = fixture();
    updateReverbDecay(f.graph, 2, 4);
    if (crossfading) { f.context.currentTime = .1; vi.advanceTimersByTime(100); updateReverbDecay(f.graph, 3, 5); }
    const nodes = f.context.nodes.length;
    f.graph.dispose(); f.context.currentTime = 1; vi.advanceTimersByTime(1000);
    expect(f.context.nodes).toHaveLength(nodes);
    expect(f.graph.reverbState!.pending).toBeNull(); expect(f.graph.reverbState!.disposed).toBe(true);
    expect(f.graph.nodes.every(value => node(value).connections.size === 0)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
