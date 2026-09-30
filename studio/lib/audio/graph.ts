import {isDrumInstrument} from "./catalog";
import {
  clamp,
  type InstrumentManifest,
  type ProjectDocument,
  type SampleZone,
  type Track,
} from "../music/types";
import { randomGenerator } from "../music/generate";
import { tickToSeconds } from "../music/project";
import { automationValue, type ScheduledNote } from "./compile";

export interface Voice {
  start: number;
  end: number;
  trackId: string;
  pitch: number;
  bend: AudioParam[];
  baseBend: number[];
  gain: GainNode;
  sources: (AudioBufferSourceNode | OscillatorNode)[];
  release: (time: number) => void;
  cancel: (time: number) => void;
  updateSound?: (track: Track, time: number) => void;
}
export interface TrackGraph {
  input: GainNode;
  volume: GainNode;
  expression: GainNode;
  pan: StereoPannerNode;
  filter: BiquadFilterNode;
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  reverb: GainNode;
  delay: GainNode;
  drive: WaveShaperNode;
  analyser: AnalyserNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
  nodes: AudioNode[];
}
export interface SongGraph {
  context: BaseAudioContext;
  tracks: Map<string, TrackGraph>;
  master: GainNode;
  output: GainNode;
  analyser: AnalyserNode;
  noise: AudioBuffer;
  nodes: AudioNode[];
  dispose: () => void;
}
const dbGain = (db: number) => Math.pow(10, db / 20);
export function makeGraph(
  context: BaseAudioContext,
  project: ProjectDocument,
  onlyTrack?: string,
  destination: AudioNode = context.destination,
  mastering = true,
  initializeImmediately = false,
): SongGraph {
  const master = context.createGain();
  master.gain.value = dbGain(!mastering || onlyTrack ? 0 : project.master.volume);
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = mastering && project.master.limiter && !onlyTrack ? -2 : 0;
  limiter.knee.value = mastering && project.master.limiter && !onlyTrack ? 2 : 0;
  limiter.ratio.value = mastering && project.master.limiter && !onlyTrack ? 18 : 1;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  master.connect(limiter);
  limiter.connect(analyser);
  const output = context.createGain();
  analyser.connect(output);
  output.connect(destination);
  const reverb = context.createConvolver(),
    impulse = context.createBuffer(
      2,
      Math.ceil(context.sampleRate * project.master.reverbDecay),
      context.sampleRate,
    ),
    random = randomGenerator(project.seed + 47);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < data.length; i++)
      data[i] = (random() * 2 - 1) * Math.pow(1 - i / data.length, 2.5) * 0.28;
  }
  reverb.buffer = impulse;
  reverb.connect(master);
  const delay = context.createDelay(3);
  delay.delayTime.value = (60 / project.tempo) * 0.75;
  const feedback = context.createGain();
  feedback.gain.value = 0.34;
  const delayFilter = context.createBiquadFilter();
  delayFilter.type = "lowpass";
  delayFilter.frequency.value = 4200;
  delay.connect(delayFilter);
  delayFilter.connect(feedback);
  feedback.connect(delay);
  delayFilter.connect(master);
  const noise = context.createBuffer(
    1,
    context.sampleRate * 2,
    context.sampleRate,
  );
  const nd = noise.getChannelData(0),
    nr = randomGenerator(project.seed);
  for (let i = 0; i < nd.length; i++) nd[i] = nr() * 2 - 1;
  const tracks = new Map<string, TrackGraph>(),
    nodes: AudioNode[] = [
      master,
      limiter,
      analyser,
      reverb,
      delay,
      feedback,
      delayFilter,
    ];
  for (const track of project.tracks) {
    if (onlyTrack && track.id !== onlyTrack) continue;
    const input = context.createGain(),
      expression = context.createGain(),
      filter = context.createBiquadFilter(),
      low = context.createBiquadFilter(),
      mid = context.createBiquadFilter(),
      high = context.createBiquadFilter(),
      drive = context.createWaveShaper(),
      volume = context.createGain(),
      pan = context.createStereoPanner(),
      rv = context.createGain(),
      dl = context.createGain(),
      meter = context.createAnalyser(),
      lfo = context.createOscillator(),
      lfoGain = context.createGain();
    filter.type = "lowpass";
    low.type = "lowshelf";
    low.frequency.value = 180;
    mid.type = "peaking";
    mid.frequency.value = 1400;
    mid.Q.value = 0.7;
    high.type = "highshelf";
    high.frequency.value = 6000;
    meter.fftSize = 512;
    input.connect(filter);
    filter.connect(low);
    low.connect(mid);
    mid.connect(high);
    high.connect(drive);
    drive.connect(expression);
    expression.connect(volume);
    volume.connect(pan);
    pan.connect(meter);
    meter.connect(master);
    pan.connect(rv);
    rv.connect(reverb);
    pan.connect(dl);
    dl.connect(delay);
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();
    const graph = {
      input,
      expression,
      filter,
      low,
      mid,
      high,
      drive,
      volume,
      pan,
      reverb: rv,
      delay: dl,
      analyser: meter,
      lfo,
      lfoGain,
      nodes: [
        input,
        expression,
        filter,
        low,
        mid,
        high,
        drive,
        volume,
        pan,
        rv,
        dl,
        meter,
        lfo,
        lfoGain,
      ],
    };
    tracks.set(track.id, graph);
    nodes.push(...graph.nodes);
    applyTrack(graph, track, project, context.currentTime, 0, onlyTrack, initializeImmediately);
  }
  return {
    context,
    tracks,
    master,
    output,
    analyser,
    noise,
    nodes,
    dispose: () => {
      output.disconnect();
      for (const t of tracks.values()) {
        try {
          t.lfo.stop();
        } catch {}
      }
      for (const n of nodes) n.disconnect();
    },
  };
}
export function applyTrack(
  graph: TrackGraph,
  track: Track,
  project: ProjectDocument,
  time: number,
  tick: number,
  onlyTrack?: string,
  immediately = false,
) {
  const solo = project.tracks.some((t) => t.solo && !t.mute);
  const muted = track.mute || (!onlyTrack && solo && !track.solo);
  const set = (param: AudioParam, value: number) => {
    param.cancelScheduledValues(time);
    if(immediately)param.setValueAtTime(value,time);
    else param.setTargetAtTime(value, time, 0.012);
  };
  set(
    graph.volume.gain,
    muted ? 0 : dbGain(automationValue(track, "volume", tick, track.volume)),
  );
  set(
    graph.pan.pan,
    clamp(automationValue(track, "pan", tick, track.pan), -1, 1),
  );
  set(
    graph.filter.frequency,
    clamp(
      automationValue(track, "cutoff", tick, track.sound.cutoff),
      20,
      20000,
    ),
  );
  set(graph.filter.Q, track.sound.resonance);
  set(
    graph.expression.gain,
    clamp(automationValue(track, "expression", tick, 1), 0, 1),
  );
  set(graph.low.gain, track.low);
  set(graph.mid.gain, track.mid);
  set(graph.high.gain, track.high);
  set(
    graph.reverb.gain,
    clamp(automationValue(track, "reverb", tick, track.reverb), 0, 1),
  );
  set(
    graph.delay.gain,
    clamp(automationValue(track, "delay", tick, track.delay), 0, 1),
  );
  set(graph.lfo.frequency, track.sound.lfoRate);
  set(
    graph.lfoGain.gain,
    track.sound.cutoff *
      0.35 *
      clamp(
        track.sound.lfoDepth + automationValue(track, "modulation", tick, 0),
        0,
        1,
      ),
  );
  if (track.drive > 0) {
    const curve = new Float32Array(2048);
    const amount = 1 + track.drive * 20;
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
    }
    graph.drive.curve = curve;
    graph.drive.oversample = "2x";
  } else graph.drive.curve = null;
}
export function scheduleAutomation(
  graph: TrackGraph,
  track: Track,
  project: ProjectDocument,
  audioStart: number,
  startTick: number,
) {
  for (const lane of track.automation) {
    if (!lane.points.length) continue;
    if (
      lane.parameter === "volume" &&
      (track.mute ||
        (project.tracks.some((t) => t.solo && !t.mute) && !track.solo))
    )
      continue;
    const params: Partial<
      Record<string, { param: AudioParam; convert: (n: number) => number }>
    > = {
      volume: { param: graph.volume.gain, convert: dbGain },
      pan: { param: graph.pan.pan, convert: (n) => clamp(n, -1, 1) },
      cutoff: {
        param: graph.filter.frequency,
        convert: (n) => clamp(n, 20, 20000),
      },
      expression: {
        param: graph.expression.gain,
        convert: (n) => clamp(n, 0, 1),
      },
      reverb: { param: graph.reverb.gain, convert: (n) => clamp(n, 0, 1) },
      delay: { param: graph.delay.gain, convert: (n) => clamp(n, 0, 1) },
      modulation: {
        param: graph.lfoGain.gain,
        convert: (n) =>
          track.sound.cutoff * 0.35 * clamp(track.sound.lfoDepth + n, 0, 1),
      },
    };
    const mapping = params[lane.parameter];
    if (!mapping) continue;
    const { param, convert } = mapping;
    const defaultValue =
      lane.parameter === "volume"
        ? track.volume
        : lane.parameter === "pan"
          ? track.pan
          : lane.parameter === "cutoff"
            ? track.sound.cutoff
            : lane.parameter === "expression"
              ? 1
              : 0;
    param.cancelScheduledValues(audioStart);
    param.setValueAtTime(
      convert(automationValue(track, lane.parameter, startTick, defaultValue)),
      audioStart,
    );
    for (const point of [...lane.points].sort((a, b) => a.tick - b.tick))
      if (point.tick > startTick)
        param.linearRampToValueAtTime(
          convert(point.value),
          audioStart + tickToSeconds(point.tick - startTick, project.tempo),
        );
  }
}
export function selectZone(
  instrument: InstrumentManifest,
  pitch: number,
  velocity: number,
  articulation: string,
  variation: number,
): SampleZone | undefined {
  const actual = instrument.articulations.includes(articulation)
    ? articulation
    : instrument.articulations[0];
  const matching = instrument.zones.filter(
    (z) =>
      z.articulation === actual &&
      pitch >= z.low &&
      pitch <= z.high &&
      velocity >= z.velocityLow &&
      velocity <= z.velocityHigh,
  );
  if (!matching.length) return undefined;
  const closest = Math.min(...matching.map((z) => Math.abs(z.root - pitch)));
  const group = matching
    .filter((z) => Math.abs(z.root - pitch) === closest)
    .sort((a, b) => a.roundRobin - b.roundRobin);
  return group[Math.abs(variation) % group.length];
}
function envelope(
  param: AudioParam,
  start: number,
  duration: number | undefined,
  peak: number,
  track: Track,
) {
  const sound = track.sound;
  const attack = duration
    ? Math.min(sound.attack, duration * 0.45)
    : sound.attack;
  const decay = duration ? Math.min(sound.decay, duration * 0.4) : sound.decay;
  param.setValueAtTime(0.00001, start);
  param.linearRampToValueAtTime(peak, start + attack);
  param.linearRampToValueAtTime(peak * sound.sustain, start + attack + decay);
  if (duration !== undefined) {
    param.setValueAtTime(peak * sound.sustain, start + duration);
    param.exponentialRampToValueAtTime(
      0.00001,
      start + duration + sound.release,
    );
  }
}
export function makeVoice(
  graph: SongGraph,
  track: Track,
  instrument: InstrumentManifest,
  note: ScheduledNote,
  time: number,
  duration: number | undefined,
  buffers: Map<string, AudioBuffer>,
  offset = 0,
): Voice {
  const context = graph.context,
    tg = graph.tracks.get(track.id);
  if (!tg) throw new Error("This track is unavailable.");
  const gain = context.createGain(),
    sources: (AudioBufferSourceNode | OscillatorNode)[] = [],
    bend: AudioParam[] = [];
  gain.connect(tg.input);
  const sound = track.sound;
  let release = sound.release;
  let synthFilter: BiquadFilterNode | undefined;
  let fmMod: OscillatorNode | undefined, fmAmount: GainNode | undefined;
  const waveformOscillators: OscillatorNode[] = [];
  let peak = note.velocity * 0.75;
  let actualDuration = duration;
  const percussion =
    isDrumInstrument(instrument);
  const zone =
    instrument.kind === "sample"
      ? selectZone(
          instrument,
          note.pitch,
          note.velocity,
          note.articulation ?? sound.articulation,
          note.index,
        )
      : undefined;
  if (zone) {
    const buffer = buffers.get(zone.assetId ?? zone.url!);
    if (!buffer) throw new Error(instrument.name + " samples are not loaded.");
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.pow(2, (note.pitch - zone.root) / 12);
    source.detune.value = sound.detune;
    if (
      zone.loopStart !== undefined &&
      zone.loopEnd !== undefined &&
      zone.loopEnd > zone.loopStart
    ) {
      source.loop = true;
      source.loopStart = zone.loopStart;
      source.loopEnd = Math.min(zone.loopEnd, buffer.duration);
    }
    source.connect(gain);
    bend.push(source.detune);
    sources.push(source);
    let seekOffset = offset * source.playbackRate.value;
    if (source.loop && seekOffset > source.loopEnd)
      seekOffset =
        source.loopStart +
        ((seekOffset - source.loopStart) % (source.loopEnd - source.loopStart));
    source.start(
      time,
      Math.min(seekOffset, Math.max(0, buffer.duration - 0.002)),
    );
    if (percussion) {
      actualDuration = Math.min(buffer.duration, duration ?? buffer.duration);
      gain.gain.setValueAtTime(peak, time);
    }
  } else if (percussion) {
    const pitch = note.pitch;
    actualDuration =
      pitch === 36
        ? 0.4
        : pitch === 38
          ? 0.22
          : pitch === 46
            ? 0.3
            : pitch === 49
              ? 1.4
              : 0.07;
    peak = note.velocity * 0.5;
    if (pitch === 36) {
      const osc = context.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(155, time);
      osc.frequency.exponentialRampToValueAtTime(42, time + 0.15);
      osc.connect(gain);
      osc.start(time);
      sources.push(osc);
    } else {
      const noise = context.createBufferSource();
      noise.buffer = graph.noise;
      const filter = context.createBiquadFilter();
      filter.type = pitch === 38 ? "bandpass" : "highpass";
      filter.frequency.value = pitch === 38 ? 1800 : pitch === 39 ? 2200 : 6500;
      filter.Q.value = 0.7;
      noise.connect(filter);
      filter.connect(gain);
      noise.start(time, (note.index % 50) * 0.02);
      sources.push(noise);
      if (pitch === 38) {
        const osc = context.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = 180;
        const body = context.createGain();
        body.gain.value = 0.3;
        osc.connect(body);
        body.connect(gain);
        osc.start(time);
        sources.push(osc);
      }
    }
    gain.gain.setValueAtTime(peak, time);
    gain.gain.exponentialRampToValueAtTime(0.00001, time + actualDuration);
  } else {
    if (instrument.kind === "sample")
      throw new Error("No sample zone is mapped for this note.");
    const filter = context.createBiquadFilter();
    synthFilter = filter;
    filter.type = "lowpass";
    filter.Q.value = sound.resonance;
    filter.frequency.setValueAtTime(
      Math.max(20, sound.cutoff * (1 - sound.filterEnvelope * 0.85)),
      time,
    );
    filter.frequency.linearRampToValueAtTime(sound.cutoff, time + sound.attack);
    filter.frequency.linearRampToValueAtTime(
      Math.max(20, sound.cutoff * (1 - sound.filterEnvelope * 0.65)),
      time + sound.attack + sound.decay,
    );
    filter.connect(gain);
    const frequency = 440 * Math.pow(2, (note.pitch - 69) / 12);
    if (sound.algorithm === "fm") {
      const carrier = context.createOscillator(),
        mod = context.createOscillator(),
        index = context.createGain();
      fmMod = mod; fmAmount = index;
      carrier.type = "sine";
      carrier.frequency.value = frequency;
      carrier.detune.value = sound.detune;
      mod.frequency.value = frequency * sound.fmRatio;
      index.gain.value = frequency * sound.fmIndex;
      mod.connect(index);
      index.connect(carrier.frequency);
      carrier.connect(filter);
      carrier.start(time);
      mod.start(time);
      sources.push(carrier, mod);
      bend.push(carrier.detune, mod.detune);
      peak *= 0.45;
    } else
      for (const detune of [-sound.detune, 0, sound.detune]) {
        const osc = context.createOscillator();
        waveformOscillators.push(osc);
        osc.type = sound.wave;
        osc.frequency.value = frequency;
        osc.detune.value = detune;
        const level = context.createGain();
        level.gain.value = 0.16;
        osc.connect(level);
        level.connect(filter);
        osc.start(time);
        sources.push(osc);
        bend.push(osc.detune);
      }
  }
  if (!percussion) envelope(gain.gain, time, actualDuration, peak, track);
  if (actualDuration !== undefined)
    for (const source of sources)
      source.stop(
        time + actualDuration + (percussion ? 0.05 : release) + 0.025,
      );
  let ended = 0;
  for (const source of sources)
    source.onended = () => {
      source.disconnect();
      if (++ended === sources.length) gain.disconnect();
    };
  const voice: Voice = {
    start: time,
    end:
      actualDuration === undefined
        ? Infinity
        : time + actualDuration + release + 0.1,
    trackId: track.id,
    pitch: note.pitch,
    gain,
    sources,
    bend,
    baseBend: bend.map((p) => p.value),
    updateSound: (next, at) => {
      if (percussion || at >= voice.end) return;
      const settings=next.sound, when=Math.max(at,time), elapsed=Math.max(0,when-time);
      release=settings.release;
      for(let i=0;i<bend.length;i++){
        const base=waveformOscillators.length?(i-1)*settings.detune:fmMod&&i===1?0:settings.detune;
        const expressionBend=bend[i].value-voice.baseBend[i];
        voice.baseBend[i]=base;bend[i].setTargetAtTime(base+expressionBend,when,.008);
      }
      if(settings.algorithm===sound.algorithm)for(const osc of waveformOscillators)osc.type=settings.wave;
      if(fmMod&&fmAmount){const frequency=440*Math.pow(2,(note.pitch-69)/12);fmMod.frequency.setTargetAtTime(frequency*settings.fmRatio,when,.012);fmAmount.gain.setTargetAtTime(frequency*settings.fmIndex,when,.012);}
      if(synthFilter){
        const attack=Math.max(.0001,settings.attack),decay=Math.max(.0001,settings.decay);
        const initial=1-settings.filterEnvelope*.85,settled=1-settings.filterEnvelope*.65;
        const phase=elapsed<attack?initial+(1-initial)*elapsed/attack:elapsed<attack+decay?1+(settled-1)*(elapsed-attack)/decay:settled;
        synthFilter.Q.setTargetAtTime(settings.resonance,when,.012);
        synthFilter.frequency.cancelAndHoldAtTime(when);synthFilter.frequency.setTargetAtTime(Math.max(20,settings.cutoff*phase),when,.012);
        if(time+attack>when+.015)synthFilter.frequency.linearRampToValueAtTime(settings.cutoff,time+attack);
        if(time+attack+decay>when+.015)synthFilter.frequency.linearRampToValueAtTime(Math.max(20,settings.cutoff*settled),time+attack+decay);
      }
      if(time>at){gain.gain.cancelScheduledValues(time);envelope(gain.gain,time,actualDuration,peak,next);}
      else if(elapsed>=settings.attack+settings.decay&&(actualDuration===undefined||when<time+actualDuration)){
        gain.gain.cancelAndHoldAtTime(when);gain.gain.setTargetAtTime(Math.max(.00001,peak*settings.sustain),when,.012);
      }
      if(actualDuration!==undefined&&when<time+actualDuration){
        // Keep the current attack/decay, but replace its future release as one envelope.
        gain.gain.cancelAndHoldAtTime(time+actualDuration);
        gain.gain.exponentialRampToValueAtTime(.00001,time+actualDuration+release);
        for(const source of sources){try{source.stop(time+actualDuration+release+.025);}catch{}}voice.end=time+actualDuration+release+.1;
      }
    },
    cancel: (at) => {
      gain.gain.cancelAndHoldAtTime(at);
      gain.gain.linearRampToValueAtTime(0, at + 0.02);
      for (const source of sources) { try { source.stop(at + 0.02); } catch {} }
      voice.end = at + 0.02;
    },
    release: (at: number) => {
      const t = Math.max(at, context.currentTime);
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(0.00001, t, Math.max(0.008, release / 4));
      for (const source of sources) {
        try {
          source.stop(t + release + 0.04);
        } catch {}
      }
      voice.end = t + release + 0.05;
    },
  };
  return voice;
}
export function scheduleAudio(
  graph: SongGraph,
  trackId: string,
  buffer: AudioBuffer,
  time: number,
  duration: number,
  offset: number,
  gain: number,
  fadeIn: number,
  fadeOut: number,
): Voice {
  const context = graph.context,
    input = graph.tracks.get(trackId)?.input;
  if (!input) throw new Error("This audio track is unavailable.");
  const source = context.createBufferSource(),
    level = context.createGain();
  source.buffer = buffer;
  source.connect(level);
  level.connect(input);
  const length = Math.min(duration, buffer.duration - offset);
  if (length <= 0)
    throw new Error("The audio trim is past the end of this take.");
  const fi = Math.min(fadeIn, length / 2),
    fo = Math.min(fadeOut, length / 2);
  level.gain.setValueAtTime(fi > 0 ? 0 : gain, time);
  if (fi) level.gain.linearRampToValueAtTime(gain, time + fi);
  if (fo) {
    level.gain.setValueAtTime(gain, time + length - fo);
    level.gain.linearRampToValueAtTime(0, time + length);
  }
  source.start(time, Math.max(0, offset), length);
  source.onended = () => {
    source.disconnect();
    level.disconnect();
  };
  const voice: Voice = {
    start: time,
    end: time + length,
    trackId,
    pitch: -1,
    gain: level,
    sources: [source],
    bend: [],
    baseBend: [],
    cancel: (at) => {
      level.gain.cancelAndHoldAtTime(at);
      level.gain.linearRampToValueAtTime(0, at + 0.02);
      try { source.stop(at + 0.02); } catch {}
      voice.end = at + 0.02;
    },
    release: (at) => {
      level.gain.cancelScheduledValues(at);
      level.gain.setTargetAtTime(0, at, 0.008);
      source.stop(at + 0.04);
      voice.end = at + 0.05;
    },
  };
  return voice;
}
