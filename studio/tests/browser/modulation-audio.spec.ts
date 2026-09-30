import { expect, test, type Page } from "@playwright/test";
import type { ModRoute, ModulationPatch } from "../../lib/music/modulation-types";
import type { PerformanceEvent, ProjectDocument, Track } from "../../lib/music/types";
import type { Voice } from "../../lib/audio/graph";
import type { ScheduledNote } from "../../lib/audio/compile";
import type { ModControlEvent } from "../../lib/audio/modulation";
import type { SongGraph } from "../../lib/audio/graph";

type Report = { kind: string; error?: number; peak?: number; baseHz?: number; movedHz?: number; ratio?: number; preserved?: boolean };

async function pcmReports(page: Page, scenario: "windows" | "bindings"): Promise<Report[]> {
  await page.goto("/");
  return page.evaluate(async scenario => {
    const { makeGraph, makeVoice, configureModulation, scheduleModulation } = await import("/lib/audio/graph.ts" as string);
    const { emptyPatch, makeSource } = await import("/lib/audio/modulation.ts" as string);
    const { instrumentFor } = await import("/lib/audio/catalog.ts" as string);
    const { createProject, createTrack } = await import("/lib/music/project.ts" as string);
    const sampleRate = 48000, duration = 1.25;
    const route = (id: string, target: ModRoute["target"], amount: number, sourceId = "M1", slew = 0): ModRoute =>
      ({ id, target, amount, sourceId, curve: "linear", slew, enabled: true });
    function fixture(): { project: ProjectDocument; track: Track } {
      const project: ProjectDocument = createProject(), track: Track = createTrack("lead");
      project.seed = 907; project.tempo = 120; project.tracks = [track];
      project.master = { ...project.master, volume: 0, limiter: false, reverbDecay: .05 };
      track.id = "pcm-track"; track.volume = 0; track.reverb = 0; track.delay = 0; track.drive = 0;
      track.sound = { ...track.sound, algorithm: "subtractive", wave: "sine", detune: 0,
        cutoff: 18000, resonance: 0, filterEnvelope: 0, lfoDepth: 0,
        attack: .005, decay: .01, sustain: 1, release: .03, fmRatio: 2, fmIndex: 0 };
      return { project, track };
    }
    function stats(buffer: AudioBuffer) {
      const data = buffer.getChannelData(0), start = Math.round(.15 * sampleRate), end = Math.round(.35 * sampleRate);
      let squares = 0, crossings = 0, peak = 0;
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
      for (let i = start; i < end; i++) {
        squares += data[i] ** 2;
        if (data[i] <= 0 && data[i + 1] > 0) crossings++;
      }
      return { rms: Math.sqrt(squares / (end - start)), hz: crossings / ((end - start) / sampleRate), peak };
    }
    function error(a: AudioBuffer, b: AudioBuffer) {
      let maximum = 0;
      for (let ch = 0; ch < a.numberOfChannels; ch++) {
        const left = a.getChannelData(ch), right = b.getChannelData(ch);
        for (let i = 0; i < left.length; i++) maximum = Math.max(maximum, Math.abs(left[i] - right[i]));
      }
      return maximum;
    }
    async function render(project: ProjectDocument, windows: number[] = [duration], events: (ModControlEvent & { trackId: string })[] = []) {
      const context = new OfflineAudioContext(2, duration * sampleRate, sampleRate);
      const graph = makeGraph(context, project, undefined, context.destination, false, true);
      configureModulation(graph, project, events, 0);
      const voices: Voice[] = [];
      for (const track of project.tracks) {
        const note: ScheduledNote = { id: "held", trackId: track.id, pitch: 69, tick: 71, duration: 1728, velocity: 1, index: 9 };
        const buffers = new Map<string, AudioBuffer>();
        if (track.instrumentId === "fixture") {
          const pcm = context.createBuffer(1, sampleRate * 2, sampleRate), data = pcm.getChannelData(0);
          for (let i = 0; i < data.length; i++) data[i] = .25 * Math.sin(i / sampleRate * 2 * Math.PI * 440);
          buffers.set("pcm", pcm);
        }
        voices.push(makeVoice(graph, track, instrumentFor(project, track), note, .037, .9, buffers));
      }
      let from = 0;
      for (const to of windows) { scheduleModulation(graph, from, to, voices, true); from = to; }
      const result = await context.startRendering();
      graph.dispose();
      return result;
    }
    if (scenario === "windows") {
      const { project, track } = fixture();
      const patch: ModulationPatch = emptyPatch(173);
      patch.macros = [0, .3, 0, 0];
      patch.sources = [
        { ...makeSource("lfo", "driver"), sync: false, rate: .7, phase: .13 },
        { ...makeSource("lfo", "pitch"), sync: false, rate: 2.375, phase: .23 },
        { ...makeSource("random", "random", "voice"), sync: false, rate: 5.25 },
        { ...makeSource("envelope", "envelope", "voice"), attack: .14, decay: .17, sustain: .6, release: .07 },
      ];
      patch.routes = [
        route("rate", "source:pitch:rate", 1.5, "driver"), route("pitch", "voice.pitch", 80, "pitch"),
        route("random", "voice.gain", 3, "random", .06), route("pan", "track.pan", .6, "pitch"),
        route("cutoff", "track.cutoff", 1, "M2"), route("cc", "voice.gain", -6, "cc:all:1"),
        route("envelope", "voice.fmIndex", 2, "envelope"),
      ];
      track.modulation = patch;
      track.sound.algorithm = "fm"; track.sound.fmIndex = 1; track.sound.cutoff = 6000;
      track.automation = [{ parameter: "cutoff", points: [{ tick: 0, value: 2000 }, { tick: 1920, value: 7000 }] }];
      const events: (ModControlEvent & { trackId: string })[] = [
        { trackId: track.id, seconds: .413, type: "macro", macroId: "M2", value: .75 },
        { trackId: track.id, seconds: .713, type: "controlChange", cc: 1, channel: 2, value: .2 },
      ];
      const complete = await render(project, [duration], events);
      const windowed = await render(project, [.137, .391, .573, .731, 1.037, duration], events);
      const repeated = await render(project, [duration], events);
      return [
        { kind: "arbitrary windows", error: error(complete, windowed), peak: stats(complete).peak },
        { kind: "seeded repeat", error: error(complete, repeated), peak: stats(repeated).peak },
      ];
    }
    const reports: Report[] = [];
    for (const kind of ["subtractive", "fm", "sample"] as const) {
      const { project, track } = fixture();
      if (kind === "fm") track.sound.algorithm = "fm";
      if (kind === "sample") {
        track.instrumentId = "fixture";
        project.userInstruments = [{ id: "fixture", name: "PCM fixture", family: "test", description: "test", kind: "sample",
          zones: [{ assetId: "pcm", root: 69, low: 0, high: 127, velocityLow: 0, velocityHigh: 1, roundRobin: 0, articulation: "sustain" }],
          articulations: ["sustain"], defaults: {}, license: "test", source: "test" }];
      }
      const baseline = await render(project), base = stats(baseline);
      track.modulation = { ...emptyPatch(42), macros: [1, 0, 0, 0], routes: [
        route("pitch", "voice.pitch", 1200), route("gain", "voice.gain", -6),
        ...(kind === "sample" ? [route("unsupported", "voice.fmIndex", 4)] : []),
      ] };
      const authored = JSON.stringify(track.modulation), moved = await render(project), active = stats(moved);
      reports.push({ kind, baseHz: base.hz, movedHz: active.hz, ratio: active.rms / base.rms,
        peak: active.peak, error: error(baseline, moved), preserved: authored === JSON.stringify(track.modulation) });
    }
    const { project, track } = fixture();
    track.sound.algorithm = "fm";
    const baseline = await render(project);
    track.modulation = { ...emptyPatch(42), macros: [1, 0, 0, 0], routes: [
      route("ratio", "voice.fmRatio", 1), route("index", "voice.fmIndex", 2),
    ] };
    const moved = await render(project);
    reports.push({ kind: "FM timbre", error: error(baseline, moved), peak: stats(moved).peak });
    return reports;
  }, scenario);
}

test("real PCM is identical across arbitrary modulation scheduling windows and seeded replay", async ({ page }) => {
  const reports = await pcmReports(page, "windows");
  for (const result of reports) {
    expect(result.peak, result.kind).toBeGreaterThan(.005);
    expect(result.error, result.kind).toBeLessThan(1e-6);
  }
});

test("real synth and sample PCM follows voice pitch/gain and FM ratio/index routes", async ({ page }) => {
  const reports = await pcmReports(page, "bindings");
  for (const result of reports.slice(0, 3)) {
    expect(result.baseHz, result.kind).toBeCloseTo(440, -1);
    expect(result.movedHz, result.kind).toBeCloseTo(880, -1);
    expect(result.ratio, result.kind).toBeGreaterThan(.45);
    expect(result.ratio, result.kind).toBeLessThan(.55);
    expect(result.error, result.kind).toBeGreaterThan(.005);
    expect(result.preserved, result.kind).toBe(true);
  }
  expect(reports[3].error, "FM timbre").toBeGreaterThan(.005);
  expect(reports[3].peak, "FM timbre").toBeGreaterThan(.005);
});

test("offline engine windows and individual stems preserve the complete modulation PCM", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { StudioEngine } = await import("/lib/audio/engine.ts" as string);
    const { makeGraph, makeVoice, configureModulation, scheduleModulation, scheduleAutomation } = await import("/lib/audio/graph.ts" as string);
    const { compileSong } = await import("/lib/audio/compile.ts" as string);
    const { instrumentFor } = await import("/lib/audio/catalog.ts" as string);
    const { emptyPatch, makeSource } = await import("/lib/audio/modulation.ts" as string);
    const { createProject, createTrack, emptyClip, tickToSeconds } = await import("/lib/music/project.ts" as string);
    const project: ProjectDocument = createProject(), duration = 5.2, sampleRate = 48000;
    project.seed = 818; project.tempo = 120; project.master.volume = 0; project.master.limiter = false; project.master.reverbDecay = .05;
    project.sections[0].lengthTick = 9600;
    project.tracks = [createTrack("lead"), createTrack("bass")];
    for (const [index, track] of project.tracks.entries()) {
      track.id = "stem-" + index; track.volume = -12; track.reverb = 0; track.delay = 0; track.drive = 0;
      track.sound = { ...track.sound, detune: 0, attack: .01, decay: .04, sustain: .8, release: .05, filterEnvelope: 0, lfoDepth: 0, cutoff: 6000 };
      track.modulation = { ...emptyPatch(218), macros: [.2, .3, 0, 0], sources: [
        { ...makeSource("lfo", "rate"), sync: false, rate: .71, phase: .2 },
        { ...makeSource("lfo", "pan"), sync: false, rate: 1.375, phase: .3 },
        { ...makeSource("random", "voice-random", "voice"), sync: false, rate: 3.25 },
      ], routes: [
        { id: "rate", sourceId: "rate", target: "source:pan:rate", amount: .8, curve: "linear", slew: 0, enabled: true },
        { id: "pan", sourceId: "pan", target: "track.pan", amount: .4, curve: "linear", slew: 0, enabled: true },
        { id: "random", sourceId: "voice-random", target: "voice.pitch", amount: 40, curve: "linear", slew: .07, enabled: true },
        { id: "macro", sourceId: "M1", target: "voice.gain", amount: -6, curve: "linear", slew: 0, enabled: true },
        { id: "cc", sourceId: "cc:all:7", target: "voice.gain", amount: -3, curve: "linear", slew: 0, enabled: true },
      ] };
      const clip = emptyClip(0, 9600);
      clip.notes = [
        { id: "early-" + index, pitch: 57 + index * 12, tick: 211 + index * 401, duration: 1344, velocity: .8 },
        { id: "boundary-" + index, pitch: 60 + index * 12, tick: 7488 + index * 336, duration: 768, velocity: .7 },
      ];
      clip.events = [{ tick: 768, type: "macro", macroId: "M1", value: .9 }, { tick: 7824, type: "controlChange", cc: 7, channel: 1, value: .5 }];
      track.clips = [clip];
      track.automation = [{ parameter: "M1", points: [{ tick: 0, value: .2 }, { tick: 8640, value: .7 }] }];
    }
    const native = new OfflineAudioContext(2, duration * sampleRate, sampleRate), graph: SongGraph = makeGraph(native, project);
    const song = compileSong(project) as { notes: ScheduledNote[]; events: (ModControlEvent & { trackId: string; tick: number })[] };
    configureModulation(graph, project, song.events.map(e => ({ ...e, seconds: tickToSeconds(e.tick, project.tempo) })), 0);
    const voices: Voice[] = song.notes.map(note => {
      const track = project.tracks.find(t => t.id === note.trackId)!;
      return makeVoice(graph, track, instrumentFor(project, track), note, tickToSeconds(note.tick, project.tempo), tickToSeconds(note.duration, project.tempo), new Map());
    });
    for (const track of project.tracks) scheduleAutomation(graph.tracks.get(track.id)!, track, project, 0, 0);
    scheduleModulation(graph, 0, duration, voices, true);
    const direct = await native.startRendering(); graph.dispose();
    const engine = new StudioEngine(project, async () => { throw Error("No sample assets in this fixture"); });
    const mix: AudioBuffer = await engine.render(project, undefined, duration);
    const stems: AudioBuffer[] = [];
    for (const track of project.tracks) stems.push(await engine.render(project, track.id, duration));
    engine.dispose();
    let windowError = 0, stemError = 0, peak = 0;
    for (let ch = 0; ch < 2; ch++) {
      const reference = direct.getChannelData(ch), full = mix.getChannelData(ch), channels = stems.map(s => s.getChannelData(ch));
      for (let i = 0; i < full.length; i++) {
        peak = Math.max(peak, Math.abs(full[i]));
        windowError = Math.max(windowError, Math.abs(reference[i] - full[i]));
        stemError = Math.max(stemError, Math.abs(full[i] - channels.reduce((sum, data) => sum + data[i], 0)));
      }
    }
    return { windowError, stemError, peak };
  });
  expect(result.peak).toBeGreaterThan(.005);
  expect(result.windowError).toBeLessThan(1e-6);
  expect(result.stemError).toBeLessThan(1e-6);
});

test("an eight-source, thirty-two-route patch stays finite and cleans matrix nodes after release", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { makeGraph, makeVoice, configureModulation, scheduleModulation } = await import("/lib/audio/graph.ts" as string);
    const { emptyPatch, makeSource } = await import("/lib/audio/modulation.ts" as string);
    const { instrumentFor } = await import("/lib/audio/catalog.ts" as string);
    const { createProject, createTrack } = await import("/lib/music/project.ts" as string);
    const project: ProjectDocument = createProject(), track: Track = createTrack("lead");
    project.tracks = [track]; project.master.limiter = false; project.master.reverbDecay = .05;
    track.reverb = 0; track.delay = 0; track.sound = { ...track.sound, attack: .01, decay: .02, release: .03, lfoDepth: 0, filterEnvelope: 0 };
    const patch: ModulationPatch = emptyPatch(913);
    patch.sources = ["lfo", "random", "step", "reference", "lfo", "random", "step", "envelope"].map((kind, index) =>
      ({ ...makeSource(kind, "source-" + index, index < 4 ? "track" : "voice"), sync: false, rate: 1.3 + index * .1 }));
    patch.routes = Array.from({ length: 32 }, (_, index): ModRoute => ({ id: "route-" + index,
      sourceId: "source-" + index % 8, target: index < 16 ? "voice.pitch" : "voice.gain",
      amount: index < 16 ? 5 : .15, curve: index % 2 ? "linear" : "exponential", slew: .02, enabled: true }));
    track.modulation = patch;
    const context = new OfflineAudioContext(2, 48000, 48000), graph: SongGraph = makeGraph(context, project, undefined, context.destination, false, true);
    configureModulation(graph, project, [], 0);
    const voice: Voice = makeVoice(graph, track, instrumentFor(project, track),
      { id: "stress", trackId: track.id, pitch: 69, tick: 0, duration: 960, velocity: 1, index: 1 }, 0, .5, new Map());
    let stops = 0, pitchDisconnected = 0, levelDisconnected = 0;
    const motion = voice.modulation!, stop = motion.pitch.stop.bind(motion.pitch);
    const disconnectPitch = motion.pitch.disconnect.bind(motion.pitch), disconnectLevel = motion.level.disconnect.bind(motion.level);
    motion.pitch.stop = time => { stops++; stop(time); };
    motion.pitch.disconnect = () => { pitchDisconnected++; disconnectPitch(); };
    motion.level.disconnect = () => { levelDisconnected++; disconnectLevel(); };
    scheduleModulation(graph, 0, 1, [voice], true);
    const rendered = await context.startRendering();
    await new Promise(resolve => setTimeout(resolve, 0));
    let peak = 0, tail = 0, finite = true;
    for (let ch = 0; ch < 2; ch++) {
      const data = rendered.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        finite &&= Number.isFinite(data[i]); peak = Math.max(peak, Math.abs(data[i]));
        if (i > .8 * 48000) tail = Math.max(tail, Math.abs(data[i]));
      }
    }
    graph.dispose();
    return { finite, peak, tail, stops, pitchDisconnected, levelDisconnected, sources: patch.sources.length, routes: patch.routes.length };
  });
  expect(result.sources).toBe(8); expect(result.routes).toBe(32);
  expect(result.finite).toBe(true); expect(result.peak).toBeGreaterThan(.005); expect(result.tail).toBeLessThan(1e-5);
  expect(result.stops).toBe(1); expect(result.pitchDisconnected).toBe(1); expect(result.levelDisconnected).toBe(1);
});

for (const insertion of ["none", "future", "immediate"] as const) test(`live native audio and offline PCM agree with ${insertion} inserted controls`, async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async insertion => {
    const { makeGraph, makeVoice, configureModulation, modulationEvent, scheduleModulation } = await import("/lib/audio/graph.ts" as string);
    const { emptyPatch, makeSource, effectiveControlTime } = await import("/lib/audio/modulation.ts" as string);
    const { instrumentFor } = await import("/lib/audio/catalog.ts" as string);
    const { createProject, createTrack } = await import("/lib/music/project.ts" as string);
    const project: ProjectDocument = createProject(), track: Track = createTrack("lead"), sampleRate = 48000, duration = 1.1;
    project.tracks = [track]; project.master.limiter = false; project.master.reverbDecay = .05;
    track.id = "live-pcm"; track.volume = -6; track.reverb = 0; track.delay = 0;
    track.sound = { ...track.sound, detune: 0, filterEnvelope: 0, lfoDepth: 0, attack: .01, decay: .04, sustain: .8, release: .03, cutoff: 9000 };
    track.modulation = { ...emptyPatch(410), macros: [.25, .1, 0, 0], sources: [
      { ...makeSource("lfo", "pan"), sync: false, rate: 2.15, phase: .07 },
      { ...makeSource("random", "drift", "voice"), sync: false, rate: 4.5 },
    ], routes: [
      { id: "rate", sourceId: "M2", target: "source:pan:rate", amount: 2, curve: "linear", slew: 0, enabled: true },
      { id: "pan", sourceId: "pan", target: "track.pan", amount: .4, curve: "linear", slew: 0, enabled: true },
      { id: "pitch", sourceId: "M1", target: "voice.pitch", amount: 300, curve: "linear", slew: 0, enabled: true },
      { id: "drift", sourceId: "drift", target: "voice.pitch", amount: 3, curve: "linear", slew: .03, enabled: true },
      { id: "gain", sourceId: "cc:all:1", target: "voice.gain", amount: -6, curve: "linear", slew: .02, enabled: true },
      { id: "fm", sourceId: "pan", target: "voice.fmIndex", amount: 1, curve: "linear", slew: 0, enabled: true },
    ] };
    const events: (ModControlEvent & { trackId: string })[] = [
      { trackId: track.id, seconds: .4, type: "macro", macroId: "M1", value: .75 },
      { trackId: track.id, seconds: .63, type: "controlChange", cc: 1, channel: 3, value: .7 },
    ];
    const note: ScheduledNote = { id: "same-note", trackId: track.id, pitch: 69, tick: 71, duration: 1536, velocity: .9, index: 3 };
    async function renderOffline(events: (ModControlEvent & { trackId: string })[]) {
      const offline = new OfflineAudioContext(2, duration * sampleRate, sampleRate);
      const offlineGraph: SongGraph = makeGraph(offline, project, undefined, offline.destination, false, true);
      configureModulation(offlineGraph, project, events, 0);
      const offlineVoice: Voice = makeVoice(offlineGraph, track, instrumentFor(project, track), note, .037, .8, new Map());
      scheduleModulation(offlineGraph, 0, duration, [offlineVoice], true);
      const pcm = await offline.startRendering(); offlineGraph.dispose(); return pcm;
    }
    const expected = insertion === "immediate" ? undefined : await renderOffline(insertion === "none" ? [] : events);
    const capturedEvents: (ModControlEvent & { trackId: string })[] = [];
    const timings: { arrival: number; effective: number; afterInsert: number; afterSchedule: number; wallMs: number }[] = [];
    const context = new AudioContext({ sampleRate, latencyHint: "interactive" });
    const worklet = `class PCMProbe extends AudioWorkletProcessor {
      constructor(options){super();this.start=options.processorOptions.start;this.end=options.processorOptions.end;}
      process(inputs){if(currentFrame+128>this.start&&currentFrame<this.end){
        const channels=inputs[0];this.port.postMessage({frame:currentFrame,left:channels[0]??new Float32Array(128),right:channels[1]??new Float32Array(128)});
      }if(currentFrame+128>=this.end){this.port.postMessage({done:true});return false;}return true;}
    }registerProcessor('modulation-pcm-probe',PCMProbe);`;
    const url = URL.createObjectURL(new Blob([worklet], { type: "text/javascript" }));
    await context.audioWorklet.addModule(url); URL.revokeObjectURL(url);
    const startFrame = Math.ceil((context.currentTime + .2) * sampleRate / 128) * 128, origin = startFrame / sampleRate;
    const length = Math.round(duration * sampleRate), captured = [new Float32Array(length), new Float32Array(length)];
    const probe = new AudioWorkletNode(context, "modulation-pcm-probe", { processorOptions: { start: startFrame, end: startFrame + length } });
    const silent = context.createGain(); silent.gain.value = 0; probe.connect(silent); silent.connect(context.destination);
    const complete = new Promise<void>(resolve => {
      probe.port.onmessage = e => {
        const block = e.data as { done?: boolean; frame: number; left: Float32Array; right: Float32Array };
        if (block.done) { resolve(); return; }
        const offset = block.frame - startFrame;
        for (const [ch, data] of [block.left, block.right].entries())
          for (let i = 0; i < data.length; i++) if (offset + i >= 0 && offset + i < length) captured[ch][offset + i] = data[i];
      };
    });
    const liveGraph: SongGraph = makeGraph(context, project, undefined, probe, false, true);
    configureModulation(liveGraph, project, [], origin);
    const liveVoice: Voice = makeVoice(liveGraph, track, instrumentFor(project, track), note, origin + .037, .8, new Map());
    scheduleModulation(liveGraph, origin, origin + duration, [liveVoice], true);
    const waitUntil = async (at: number) => {
      while (context.currentTime < at) await new Promise(resolve => setTimeout(resolve, 10));
    };
    try {
      await context.resume();
      if (insertion !== "none") {
        await waitUntil(origin + .35);
        const macroArrival = context.currentTime;
        const macroWall = performance.now();
        const macroAt = insertion === "future" ? origin + .4 : effectiveControlTime(macroArrival, macroArrival, sampleRate);
        const macro = { type: "macro", macroId: "M1", value: .75 } as const;
        capturedEvents.push({ ...macro, trackId: track.id, seconds: macroAt - origin });
        modulationEvent(liveGraph, track.id, macro, macroAt);
        const macroInserted = context.currentTime;
        scheduleModulation(liveGraph, macroAt, origin + duration, [liveVoice], true);
        timings.push({ arrival: macroArrival - origin, effective: macroAt - origin, afterInsert: macroInserted - origin,
          afterSchedule: context.currentTime - origin, wallMs: performance.now() - macroWall });
        await waitUntil(origin + .58);
        const ccArrival = context.currentTime;
        const ccWall = performance.now();
        const ccAt = insertion === "future" ? origin + .63 : effectiveControlTime(ccArrival, ccArrival, sampleRate);
        const cc = { type: "controlChange", cc: 1, channel: 3, value: .7 } as const;
        capturedEvents.push({ ...cc, trackId: track.id, seconds: ccAt - origin });
        modulationEvent(liveGraph, track.id, cc, ccAt);
        const ccInserted = context.currentTime;
        scheduleModulation(liveGraph, ccAt, origin + duration, [liveVoice], true);
        timings.push({ arrival: ccArrival - origin, effective: ccAt - origin, afterInsert: ccInserted - origin,
          afterSchedule: context.currentTime - origin, wallMs: performance.now() - ccWall });
      }
      await complete;
      const replay = expected ?? await renderOffline(capturedEvents);
      let error = 0, peak = 0, settledError = 0, beforeControlError = 0, afterMacroError = 0, afterCCError = 0;
      for (let ch = 0; ch < 2; ch++) {
        const reference = replay.getChannelData(ch);
        for (let i = 0; i < length; i++) {
          peak = Math.max(peak, Math.abs(captured[ch][i]));
          const difference = Math.abs(captured[ch][i] - reference[i]);
          error = Math.max(error, difference);
          if (i >= .3 * sampleRate) settledError = Math.max(settledError, difference);
          if (i < .3 * sampleRate) beforeControlError = Math.max(beforeControlError, difference);
          if (i >= .5 * sampleRate && i < .55 * sampleRate) afterMacroError = Math.max(afterMacroError, difference);
          if (i >= .7 * sampleRate && i < .8 * sampleRate) afterCCError = Math.max(afterCCError, difference);
        }
      }
      let bestLag = 0, alignedBeforeError = Infinity;
      const reference = replay.getChannelData(0);
      for (let lag = -256; lag <= 256; lag++) {
        let maximum = 0;
        for (let i = .1 * sampleRate; i < .3 * sampleRate; i++) maximum = Math.max(maximum, Math.abs(captured[0][i] - reference[i + lag]));
        if (maximum < alignedBeforeError) { alignedBeforeError = maximum; bestLag = lag; }
      }
      return { error, peak, settledError, beforeControlError, afterMacroError, afterCCError, bestLag, alignedBeforeError,
        sampleRate: context.sampleRate, timings, events: capturedEvents.map(e => ({ seconds: e.seconds, type: e.type })) };
    } finally {
      liveGraph.dispose(); probe.disconnect(); silent.disconnect(); await context.close();
    }
  }, insertion);
  expect(result.sampleRate).toBe(48000);
  expect(result.peak).toBeGreaterThan(.005);
  // Graph startup differs between native live/offline contexts even with no controls; compare after that baseline settles.
  expect(result.settledError, JSON.stringify(result)).toBeLessThan(1e-5);
});

test("seeking a looping constant sample preserves the track and voice matrix gain clocks", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { makeGraph, makeVoice, configureModulation, scheduleModulation } = await import("/lib/audio/graph.ts" as string);
    const { emptyPatch, makeSource } = await import("/lib/audio/modulation.ts" as string);
    const { instrumentFor } = await import("/lib/audio/catalog.ts" as string);
    const { createProject, createTrack } = await import("/lib/music/project.ts" as string);
    const project: ProjectDocument = createProject(), track: Track = createTrack("fixture"), sampleRate = 48000;
    project.tracks = [track]; project.master.limiter = false; project.master.reverbDecay = .05;
    project.userInstruments = [{ id: "fixture", name: "Constant sample", family: "test", description: "test", kind: "sample",
      zones: [{ assetId: "pcm", root: 69, low: 0, high: 127, velocityLow: 0, velocityHigh: 1,
        roundRobin: 0, articulation: "sustain", loopStart: 0, loopEnd: 1 }],
      articulations: ["sustain"], defaults: {}, license: "test", source: "test" }];
    track.id = "seek-gain"; track.volume = -12; track.reverb = 0; track.delay = 0;
    track.sound = { ...track.sound, algorithm: "subtractive", wave: "sine", detune: 0,
      attack: .001, decay: .002, sustain: 1, release: .03, filterEnvelope: 0, lfoDepth: 0, cutoff: 18000, resonance: 0 };
    track.modulation = { ...emptyPatch(38), sources: [
      { ...makeSource("lfo", "driver"), sync: false, rate: .71, phase: .21, shape: "triangle" },
      { ...makeSource("lfo", "track-gain"), sync: false, rate: 2.17, phase: .13 },
      { ...makeSource("lfo", "voice-gain", "voice"), sync: false, rate: 1.33, phase: .07 },
    ], routes: [
      { id: "track-rate", sourceId: "driver", target: "source:track-gain:rate", amount: 1, curve: "linear", slew: 0, enabled: true },
      { id: "voice-rate", sourceId: "driver", target: "source:voice-gain:rate", amount: 1, curve: "linear", slew: 0, enabled: true },
      { id: "track-gain", sourceId: "track-gain", target: "track.gain", amount: -9, curve: "linear", slew: .03, enabled: true },
      { id: "voice-gain", sourceId: "voice-gain", target: "voice.gain", amount: -6, curve: "linear", slew: .02, enabled: true },
    ] };
    const note: ScheduledNote = { id: "held", trackId: track.id, pitch: 69, tick: 0, duration: 1920, velocity: 1, index: 1 };
    async function render(seek: number) {
      const duration = 1.1 - seek, context = new OfflineAudioContext(2, Math.round(duration * sampleRate), sampleRate);
      const graph: SongGraph = makeGraph(context, project, undefined, context.destination, false, true);
      configureModulation(graph, project, [], 0, seek);
      const buffer = context.createBuffer(1, sampleRate, sampleRate); buffer.getChannelData(0).fill(.25);
      const voice: Voice = makeVoice(graph, track, instrumentFor(project, track), note, 0, 1 - seek,
        new Map([["pcm", buffer]]), seek, { songStart: 0, key: "held:0" });
      // Tap the two native matrix gain bindings directly, excluding legacy bus and envelope state.
      const level = voice.modulation?.level ?? context.createGain(), trackGain = graph.tracks.get(track.id)!.matrixGain ?? context.createGain();
      voice.gain.disconnect(); level.disconnect(); trackGain.disconnect(); graph.output.disconnect();
      const constant = context.createConstantSource(); constant.offset.value = .125;
      constant.connect(level); level.connect(trackGain); trackGain.connect(context.destination); constant.start(0); constant.stop(duration);
      scheduleModulation(graph, 0, duration, [voice], true);
      const pcm = await context.startRendering(); graph.dispose(); return pcm;
    }
    const complete = await render(0), sought = await render(.5);
    let error = 0, peak = 0, errorAt = 0;
    // A constant looping sample removes oscillator phase; ignore only native filter and ADSR settling.
    for (let ch = 0; ch < 2; ch++) {
      const full = complete.getChannelData(ch), seek = sought.getChannelData(ch);
      for (let i = Math.round(.03 * sampleRate); i < Math.round(.45 * sampleRate); i++) {
        peak = Math.max(peak, Math.abs(seek[i]));
        const difference = Math.abs(full[i + sampleRate / 2] - seek[i]);
        if (difference > error) { error = difference; errorAt = i / sampleRate; }
      }
    }
    track.modulation!.enabled = false;
    const baselineFull = await render(0), baselineSeek = await render(.5);
    let baselineError = 0;
    for (let ch = 0; ch < 2; ch++) {
      const full = baselineFull.getChannelData(ch), seek = baselineSeek.getChannelData(ch);
      for (let i = Math.round(.03 * sampleRate); i < Math.round(.45 * sampleRate); i++)
        baselineError = Math.max(baselineError, Math.abs(full[i + sampleRate / 2] - seek[i]));
    }
    return { error, peak, errorAt, baselineError, relativeError: error / peak };
  });
  expect(result.peak).toBeGreaterThan(.005);
  expect(result.baselineError, JSON.stringify(result)).toBeLessThan(1e-6);
  expect(result.error, JSON.stringify(result)).toBeLessThan(1e-6);
  expect(result.relativeError, JSON.stringify(result)).toBeLessThan(1e-6);
});

test("releasing one MIDI input restores surviving CC owners without changing earlier control history", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { StudioEngine } = await import("/lib/audio/engine.ts" as string);
    const { emptyPatch } = await import("/lib/audio/modulation.ts" as string);
    const { createProject, createTrack } = await import("/lib/music/project.ts" as string);
    const project: ProjectDocument = createProject(), track: Track = createTrack("lead");
    project.tracks = [track]; track.reverb = 0; track.delay = 0;
    track.modulation = { ...emptyPatch(), routes: ["cc:all:1", "cc:1:1", "cc:2:1"].map((sourceId, index): ModRoute =>
      ({ id: "cc-" + index, sourceId, target: "track.pan", amount: .1, curve: "linear", slew: 0, enabled: true })) };
    const engine = new StudioEngine(project, async () => { throw Error("No assets"); });
    const context: AudioContext = await engine.unlock();
    const wait = () => new Promise(resolve => setTimeout(resolve, 35));
    try {
      await engine.noteOn(track.id, 69, .8, "keyboard:69");
      engine.expression(track.id, { tick: 0, type: "controlChange", cc: 1, channel: 1, value: .2 }, context.currentTime, false, "midi:A");
      engine.expression(track.id, { tick: 0, type: "controlChange", cc: 1, channel: 1, value: .8 }, context.currentTime, false, "midi:B");
      engine.expression(track.id, { tick: 0, type: "controlChange", cc: 1, channel: 2, value: .6 }, context.currentTime, false, "midi:C");
      await wait();
      const graph: SongGraph = engine.liveGraph, mod = graph.modulation!, evaluator = mod.tracks.get(track.id)!.evaluator;
      const seconds = () => context.currentTime - mod.audioOrigin + mod.songOrigin;
      const read = () => {
        const state = evaluator.sample(seconds()).sources;
        return { all: state["cc:all:1"], channel1: state["cc:1:1"], channel2: state["cc:2:1"] };
      };
      const initial = read(), prior = seconds(), releasedAt = context.currentTime;
      const releasedC = engine.releaseSource("midi:C") as { trackId: string; event: PerformanceEvent; at: number }[];
      await wait(); const afterC = read();
      engine.releaseSource("midi:B"); await wait(); const afterB = read();
      engine.releaseSource("midi:A"); await wait(); const afterA = read();
      const history = evaluator.sample(prior).sources;
      return { initial, afterC, afterB, afterA, oldAll: history["cc:all:1"], keyboardStillHeld: engine.live.has("keyboard:69"),
        resets: releasedC.map(r => ({ cc: r.event.cc, channel: r.event.channel, value: r.event.value })),
        guardedReset: releasedC.every(r => r.trackId === track.id && r.at >= releasedAt + 256 / context.sampleRate) };
    } finally { engine.dispose(); }
  });
  expect(result.initial).toEqual({ all: .6, channel1: .8, channel2: .6 });
  expect(result.afterC).toEqual({ all: .8, channel1: .8, channel2: 0 });
  expect(result.afterB).toEqual({ all: .2, channel1: .2, channel2: 0 });
  expect(result.afterA).toEqual({ all: 0, channel1: 0, channel2: 0 });
  expect(result.resets).toEqual([{ cc: 1, channel: 2, value: 0 }, { cc: 1, channel: 1, value: .8 }]);
  expect(result.guardedReset).toBe(true);
  expect(result.oldAll).toBe(.6); expect(result.keyboardStillHeld).toBe(true);
});

test("a native suspended source-rate edit preserves past PCM and the held voice's integrated gain phase", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { makeGraph, makeVoice, configureModulation, scheduleModulation } = await import("/lib/audio/graph.ts" as string);
    const { emptyPatch, makeSource } = await import("/lib/audio/modulation.ts" as string);
    const { instrumentFor } = await import("/lib/audio/catalog.ts" as string);
    const { createProject, createTrack } = await import("/lib/music/project.ts" as string);
    const sampleRate = 48000, duration = .8, oldRate = .75, newRate = 2.25, phaseOffset = .125;
    const project: ProjectDocument = createProject(), track: Track = createTrack("lead");
    project.tracks = [track]; project.master.limiter = false; project.master.reverbDecay = .05;
    track.reverb = 0; track.delay = 0;
    track.sound = { ...track.sound, attack: .001, decay: .002, sustain: 1, release: .05, filterEnvelope: 0, lfoDepth: 0 };
    track.modulation = { ...emptyPatch(), sources: [{ ...makeSource("lfo", "motion"), sync: false, rate: oldRate, phase: phaseOffset }],
      routes: [{ id: "gain", sourceId: "motion", target: "voice.gain", amount: -9, curve: "linear", slew: 0, enabled: true }] };
    const note: ScheduledNote = { trackId: track.id, pitch: 69, tick: 0, duration: 1920, velocity: 1, index: 1 };
    async function render(edit: boolean) {
      const context = new OfflineAudioContext(1, Math.round(duration * sampleRate), sampleRate);
      const graph: SongGraph = makeGraph(context, project, undefined, context.destination, false, true);
      configureModulation(graph, project, [], 0);
      const voice: Voice = makeVoice(graph, track, instrumentFor(project, track), note, 0, undefined, new Map());
      const motion = voice.modulation!, evaluator = graph.modulation!.tracks.get(track.id)!.evaluator;
      const nodes = [...graph.nodes], sources = [...voice.sources];
      // Probe the actual native matrix gain; exclude unrelated synth, ADSR and bus histories.
      voice.gain.disconnect(); motion.level.disconnect(); graph.output.disconnect();
      const constant = context.createConstantSource(); constant.offset.value = .125;
      constant.connect(motion.level); motion.level.connect(context.destination); constant.start(0); constant.stop(duration);
      scheduleModulation(graph, 0, duration, [voice], true);
      const suspended = edit ? context.suspend(.25) : null;
      const rendering = context.startRendering();
      let editAt = 0, cutover = 0, identities = true;
      if (suspended) {
        await suspended; editAt = context.currentTime; cutover = Math.ceil(editAt * 128 - 1e-8) / 128;
        const changed: Track = { ...track, modulation: { ...track.modulation!, sources: [{ ...track.modulation!.sources[0], rate: newRate }] } };
        configureModulation(graph, { ...project, tracks: [changed] }, [], 0);
        scheduleModulation(graph, editAt, duration, [voice], true);
        identities = voice.modulation === motion && graph.modulation!.tracks.get(track.id)!.evaluator === evaluator &&
          voice.end === Infinity && graph.nodes.length === nodes.length && graph.nodes.every((node, index) => node === nodes[index]) &&
          voice.sources.every((source, index) => source === sources[index]);
        await context.resume();
      }
      const buffer = await rendering; graph.dispose();
      return { pcm: buffer.getChannelData(0), editAt, cutover, identities };
    }
    const baseline = await render(false), edited = await render(true);
    const reference = new OfflineAudioContext(1, Math.round(duration * sampleRate), sampleRate);
    const constant = reference.createConstantSource(), gain = reference.createGain();
    constant.offset.value = .125; constant.connect(gain); gain.connect(reference.destination);
    const canonicalValue = (at: number) => {
      const controlAt = Math.max(0, at - 1 / 128);
      const phase = phaseOffset + Math.min(controlAt, edited.cutover) * oldRate + Math.max(0, controlAt - edited.cutover) * newRate;
      return Math.pow(10, -9 * Math.sin(phase * Math.PI * 2) / 20);
    };
    const nativeValue = (at: number) => {
      const left = Math.floor(at * 128 + 1e-8) / 128, right = left + 1 / 128;
      return canonicalValue(left) + (canonicalValue(right) - canonicalValue(left)) * (at - left) / (right - left);
    };
    gain.gain.setValueAtTime(nativeValue(0), 0);
    for (let frame = 1; frame / 128 < duration; frame++) gain.gain.linearRampToValueAtTime(nativeValue(frame / 128), frame / 128);
    gain.gain.linearRampToValueAtTime(nativeValue(duration), duration);
    constant.start(0); constant.stop(duration);
    const expected = (await reference.startRendering()).getChannelData(0);
    let beforeError = 0, integratedError = 0, peak = 0, finite = true;
    for (let index = 0; index < edited.pcm.length; index++) {
      const value = edited.pcm[index]; finite &&= Number.isFinite(value); peak = Math.max(peak, Math.abs(value));
      if (index / sampleRate < edited.editAt) beforeError = Math.max(beforeError, Math.abs(value - baseline.pcm[index]));
      integratedError = Math.max(integratedError, Math.abs(value - expected[index]));
    }
    return { beforeError, integratedError, peak, finite, identities: edited.identities, editAt: edited.editAt, cutover: edited.cutover };
  });
  expect(result.finite).toBe(true); expect(result.identities).toBe(true); expect(result.peak).toBeGreaterThan(.02);
  expect(result.beforeError, JSON.stringify(result)).toBeLessThan(1e-6);
  expect(result.integratedError, JSON.stringify(result)).toBeLessThan(1e-6);
});

test("editing pan preserves unrelated native volume automation and modulated filter PCM", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { makeGraph, applyTrack, configureModulation, scheduleModulation, scheduleAutomation } = await import("/lib/audio/graph.ts" as string);
    const { emptyPatch } = await import("/lib/audio/modulation.ts" as string);
    const { createProject, createTrack, secondsToTick } = await import("/lib/music/project.ts" as string);
    const duration = .8, sampleRate = 48000;
    const project: ProjectDocument = createProject(), track: Track = createTrack("lead");
    project.tracks = [track]; project.tempo = 120; project.master.limiter = false; project.master.reverbDecay = .05;
    track.volume = -18; track.reverb = 0; track.delay = 0;
    track.sound = { ...track.sound, cutoff: 1000, resonance: .7, lfoDepth: 0 };
    track.automation = [
      { parameter: "volume", points: [{ tick: 0, value: -18 }, { tick: 1920, value: -3 }] },
      { parameter: "cutoff", points: [{ tick: 0, value: 1000 }, { tick: 1920, value: 7000 }] },
    ];
    track.modulation = { ...emptyPatch(), macros: [.5, 0, 0, 0],
      routes: [{ id: "cutoff", sourceId: "M1", target: "track.cutoff", amount: .5, curve: "linear", slew: 0, enabled: true }] };
    async function render(edit: boolean) {
      const context = new OfflineAudioContext(2, duration * sampleRate, sampleRate), detached = context.createGain();
      const graph: SongGraph = makeGraph(context, project, undefined, detached, false, true), strip = graph.tracks.get(track.id)!;
      scheduleAutomation(strip, track, project, 0, 0); configureModulation(graph, project, [], 0);
      // Preserve the real volume and filter nodes, and probe before the pan whose edit intentionally changes the stereo field.
      strip.filter.disconnect(); strip.volume.disconnect(); strip.pan.disconnect();
      const merger=context.createChannelMerger(2),splitter=context.createChannelSplitter(2),panProbe=context.createConstantSource();
      merger.connect(context.destination);panProbe.offset.value=.125;panProbe.connect(strip.pan);strip.pan.connect(splitter);splitter.connect(merger,0,1);
      panProbe.start(0);panProbe.stop(duration);
      const oscillator = context.createOscillator(); oscillator.frequency.value = 4000;
      oscillator.connect(strip.filter); strip.filter.connect(strip.volume); strip.volume.connect(merger,0,0);
      oscillator.start(0); oscillator.stop(duration);
      scheduleModulation(graph, 0, duration, [], true);
      const nodes = [...graph.nodes], suspended = edit ? context.suspend(.25) : null, rendering = context.startRendering();
      let editAt = 0, identities = true;
      if (suspended) {
        await suspended; editAt = context.currentTime;
        const nextTrack: Track = { ...track, pan: .4 }, nextProject = { ...project, tracks: [nextTrack] };
        const tick = secondsToTick(editAt, project.tempo);
        applyTrack(strip, nextTrack, nextProject, editAt, tick, undefined, false, track, project);
        scheduleAutomation(strip, nextTrack, nextProject, editAt, tick, track, project);
        configureModulation(graph, nextProject, [], 0); scheduleModulation(graph, editAt, duration, [], true);
        identities = graph.tracks.get(track.id) === strip && graph.nodes.length === nodes.length && graph.nodes.every((node, index) => node === nodes[index]);
        await context.resume();
      }
      const buffer=await rendering,pcm=buffer.getChannelData(0),panPcm=buffer.getChannelData(1);
      const pan=Math.acos(panPcm[panPcm.length-1]/.125)*4/Math.PI-1;
      graph.dispose(); return { pcm, pan, editAt, identities };
    }
    const baseline = await render(false), edited = await render(true);
    let beforeError = 0, afterError = 0, peak = 0, finite = true;
    for (let index = 0; index < baseline.pcm.length; index++) {
      const difference = Math.abs(baseline.pcm[index] - edited.pcm[index]);
      finite &&= Number.isFinite(edited.pcm[index]); peak = Math.max(peak, Math.abs(edited.pcm[index]));
      if (index / sampleRate < edited.editAt) beforeError = Math.max(beforeError, difference);
      else afterError = Math.max(afterError, difference);
    }
    return { beforeError, afterError, peak, finite, pan: edited.pan, identities: edited.identities, editAt: edited.editAt };
  });
  expect(result.finite).toBe(true); expect(result.identities).toBe(true); expect(result.peak).toBeGreaterThan(.005);
  expect(result.pan).toBeCloseTo(.4, 6);
  expect(result.beforeError, JSON.stringify(result)).toBeLessThan(1e-6);
  expect(result.afterError, JSON.stringify(result)).toBeLessThan(1e-6);
});
