import { describe, expect, it } from "vitest";
import {
  configureModulation,
  makeGraph,
  makeVoice,
  modulationEvent,
  scheduleModulation,
} from "../lib/audio/graph";
import { instrumentFor } from "../lib/audio/catalog";
import { emptyPatch, makeSource } from "../lib/audio/modulation";
import { createProject, createTrack } from "../lib/music/project";
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
  disconnect() {
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
    expect(param(motion.filter!.frequency).at(.005)).toBeCloseTo(3000 * (1 - .8 * .85 / 2), 9);
    expect(param(motion.filter!.frequency).at(.01)).toBe(3000);
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
