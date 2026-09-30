import * as Tone from "tone";
import {
  PPQ,
  clamp,
  type PerformanceEvent,
  type ProjectDocument,
  type Track,
} from "../music/types";
import {
  projectEnd,
  secondsToTick,
  tickToSeconds,
  ticksPerBar,
} from "../music/project";
import {
  audibleTracks,
  automationValue,
  compileSong,
  type ScheduledNote,
} from "./compile";
import { instrumentFor } from "./catalog";
import {
  applyTrack,
  makeGraph,
  makeVoice,
  scheduleAudio,
  scheduleAutomation,
  type SongGraph,
  type Voice,
} from "./graph";

export interface TransportState {
  playing: boolean;
  tick: number;
  countIn: boolean;
  loading: boolean;
  activity: "idle" | "song-loading" | "song" | "audition-loading" | "audition" | "tail";
  previewId: string | null;
}
type AssetResolver = (id: string) => Promise<Blob>;
export class StudioEngine {
  private project: ProjectDocument;
  private context: AudioContext | null = null;
  private toneContext: Tone.Context | null = null;
  private graph: SongGraph | null = null;
  private liveGraph: SongGraph | null = null;
  private output: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private epoch = 0;
  private previewId: string | null = null;
  private previewTrackId: string | null = null;
  private previewInstrument: string | null = null;
  private previewVoices = new Map<Voice,{note:ScheduledNote;at:number;duration:number;settings:string}>();
  private voiceSettings = new WeakMap<Voice,string>();
  private activity: TransportState["activity"] = "idle";
  private previewTimer: ReturnType<typeof setInterval> | null = null;
  private liveOwners = new Map<string, { trackId: string; pitch: number; token: symbol }>();
  private pedals = new Map<string, { trackId: string; down: boolean }>();
  private clicks = new Set<OscillatorNode>();
  private buffers = new Map<string, AudioBuffer>();
  private bufferJobs = new Map<string, Promise<void>>();
  private bufferErrors=new Map<string,string>();
  private voices: Voice[] = [];
  private live = new Map<string, Voice[]>();
  private heldPedal = new Map<string, boolean>();
  private heldKeys = new Set<string>();
  private controls = new Map<
    string,
    { bend: number; expression: number; modulation: number }
  >();
  private compiled: ReturnType<typeof compileSong>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private noteCursor = 0;
  private eventCursor = 0;
  private audioCursor = 0;
  private baseTime = 0;
  private startTick = 0;
  private pausedTick = 0;
  private playing = false;
  private looping = false;
  private loopStart = 0;
  private loopEnd = 0;
  private metronome = false;
  private nextClick = 0;
  private loadCount = 0;
  private countInUntil = 0;
  private loopPrimed = false;
  private previewIndex = 0;
  private listeners = new Set<(state: TransportState) => void>();
  onStatus: (message: string) => void = () => {};
  constructor(
    project: ProjectDocument,
    private asset: AssetResolver,
  ) {
    this.project = project;
    this.compiled = compileSong(project);
    this.loopEnd = projectEnd(project);
  }
  subscribe(listener: (state: TransportState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }
  get rawContext() {
    return this.context;
  }
  get outputNode() { return this.analyser; }
  get monitorDestination() { return this.output; }
  instrumentReadiness(trackId:string):{state:"unloaded"|"loading"|"ready"|"failed";error?:string}{
    const track=this.project.tracks.find(t=>t.id===trackId);if(!track)return {state:"unloaded"};
    const keys=instrumentFor(this.project,track).zones.map(z=>z.assetId??z.url!).filter(Boolean);
    if(keys.some(k=>this.bufferJobs.has(k)))return {state:"loading"};
    const error=keys.map(k=>this.bufferErrors.get(k)).find(Boolean);if(error)return {state:"failed",error};
    return {state:keys.every(k=>this.buffers.has(k))?"ready":"unloaded"};
  }
  get recordingStartTime() {
    return this.baseTime;
  }
  get state(): TransportState {
    const current = this.context?.currentTime ?? 0;
    let tick =
      this.startTick +
      secondsToTick(current - this.baseTime, this.project.tempo);
    if (this.looping && this.loopPrimed && tick < this.loopStart)
      tick += this.loopEnd - this.loopStart;
    return {
      playing: this.playing,
      tick: this.playing ? Math.max(0, tick) : this.pausedTick,
      countIn: this.playing && current < this.countInUntil,
      loading: this.activity.endsWith("loading"),
      activity: this.activity,
      previewId: this.previewId,
    };
  }
  private emit() {
    const state = this.state;
    for (const listener of this.listeners) listener(state);
  }
  async unlock() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: "interactive" });
      this.toneContext = new Tone.Context({ context: this.context });
      Tone.setContext(this.toneContext);
      this.output = this.context.createGain();
      this.analyser = this.context.createAnalyser();
      this.limiter = this.context.createDynamicsCompressor();
      this.limiter.knee.value = 2; this.limiter.attack.value = 0.003; this.limiter.release.value = 0.12;
      this.output.gain.value = Math.pow(10,this.project.master.volume/20);
      this.limiter.threshold.value = this.project.master.limiter ? -2 : 0;
      this.limiter.ratio.value = this.project.master.limiter ? 18 : 1;
      this.output.connect(this.limiter); this.limiter.connect(this.analyser);
      this.analyser.connect(this.context.destination);
    }
    await this.toneContext!.resume();
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }
  async decode(blob: Blob) {
    const context = await this.unlock();
    return context.decodeAudioData(await blob.arrayBuffer());
  }
  async ensureBuffers(project = this.project, trackIds?: string[]) {
    const context = await this.unlock(),
      jobs: Promise<void>[] = [];
    for (const track of project.tracks.filter(
      (t) => !trackIds || trackIds.includes(t.id),
    )) {
      const instrument = instrumentFor(project, track);
      for (const zone of track.kind === "audio" ? [] : instrument.zones) {
        const key = zone.assetId ?? zone.url!;
        if (this.buffers.has(key)) continue;
        if (!this.bufferJobs.has(key)) {
          this.bufferErrors.delete(key);
          this.loadCount++;
          this.bufferJobs.set(
            key,
            (async () => {
              try {
                this.onStatus("Loading " + instrument.name + "…");
                const data = zone.assetId
                  ? await (await this.asset(zone.assetId)).arrayBuffer()
                  : await fetch(zone.url!, {
                      signal: AbortSignal.timeout(30000),
                    }).then((r) => {
                      if (!r.ok)
                        throw new Error(
                          "The " +
                            instrument.name +
                            " sound download failed. Retry from the sound panel.",
                        );
                      return r.arrayBuffer();
                    });
                const buffer = await context.decodeAudioData(data);
                if (
                  zone.loopStart !== undefined &&
                  zone.loopEnd !== undefined
                ) {
                  const end = Math.floor(
                      Math.min(zone.loopEnd, buffer.duration) *
                        buffer.sampleRate,
                    ),
                    start = Math.floor(zone.loopStart * buffer.sampleRate),
                    blend = Math.min(
                      Math.floor(buffer.sampleRate * 0.08),
                      start,
                      Math.floor((end - start) / 4),
                    );
                  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
                    const values = buffer.getChannelData(ch);
                    for (let i = 0; i < blend; i++) {
                      const weight = i / Math.max(1, blend - 1);
                      values[end - blend + i] =
                        values[end - blend + i] * (1 - weight) +
                        values[start - blend + i] * weight;
                    }
                  }
                }
                this.buffers.set(key, buffer);
              } catch(error){this.bufferErrors.set(key,error instanceof Error?error.message:"The sample could not be loaded. Retry.");throw error;
              } finally {
                this.loadCount--;
                this.bufferJobs.delete(key);
                this.emit();
              }
            })(),
          );
        }
        this.emit();
        jobs.push(this.bufferJobs.get(key)!);
      }
      for (const clip of track.clips)
        if (clip.audio) {
          const key = clip.audio.assetId;
          if (this.buffers.has(key)) continue;
          if (!this.bufferJobs.has(key)) {
            this.loadCount++;
            this.bufferJobs.set(
              key,
              (async () => {
                try {
                  this.buffers.set(
                    key,
                    await context.decodeAudioData(
                      await (await this.asset(key)).arrayBuffer(),
                    ),
                  );
                } finally {
                  this.loadCount--;
                  this.bufferJobs.delete(key);
                  this.emit();
                }
              })(),
            );
          }
          jobs.push(this.bufferJobs.get(key)!);
        }
    }
    await Promise.all(jobs);
    this.onStatus("Sounds ready");
    this.emit();
  }
  private makeLiveGraph() {
    if (!this.context) throw new Error("Enable audio first.");
    this.graph?.dispose();
    this.graph = makeGraph(this.context, this.project, undefined, this.output!, false);
  }
  private previewProject(){return {...this.project,tracks:this.project.tracks.map(t=>({...t,automation:[]}))};}
  private tunePreviewVoices(){
    if(!this.context||!this.graph||!this.previewTrackId)return;
    const track=this.project.tracks.find(t=>t.id===this.previewTrackId);if(!track)return;
    const now=this.context.currentTime,settings=JSON.stringify(track.sound);
    for(const [voice,binding]of this.previewVoices){
      if(binding.settings===settings)continue;
      const old=JSON.parse(binding.settings) as Track["sound"];
      if(voice.start>now+.04&&(old.algorithm!==track.sound.algorithm||old.articulation!==track.sound.articulation)){
        voice.cancel(now);
        const replacement=makeVoice(this.graph,track,instrumentFor(this.project,track),binding.note,binding.at,binding.duration,this.buffers);
        this.applyBend(replacement,track,binding.at);
        this.voices=this.voices.map(v=>v===voice?replacement:v);this.previewVoices.delete(voice);this.previewVoices.set(replacement,{...binding,settings});
      }else{voice.updateSound?.(track,now);this.applyBend(voice,track,Math.max(now,voice.start));binding.settings=settings;}
    }
  }
  updateProject(project: ProjectDocument) {
    const busesChanged =
      this.project.master.reverbDecay !== project.master.reverbDecay;
    const tempoChanged = this.project.tempo !== project.tempo;
    const tick = this.state.tick;
    this.project = project;
    if(this.previewId){const track=project.tracks.find(t=>t.id===this.previewTrackId);if(!track||JSON.stringify(instrumentFor(project,track))!==this.previewInstrument)this.pause();}
    if(this.context && this.output && this.limiter) {
      this.output.gain.setTargetAtTime(Math.pow(10,project.master.volume/20),this.context.currentTime,0.015);
      this.limiter.threshold.value=project.master.limiter?-2:0; this.limiter.ratio.value=project.master.limiter?18:1;
    }

    this.compiled = compileSong(project);
    this.loopEnd = Math.max(
      this.loopStart + PPQ,
      this.loopEnd || projectEnd(project),
    );
    if (this.liveGraph && this.context && (busesChanged || this.liveGraph.tracks.size !== project.tracks.length || project.tracks.some(t=>!this.liveGraph!.tracks.has(t.id)))) {
      const old=this.liveGraph;
      this.liveGraph=makeGraph(this.context,project,undefined,this.output!,false,true);
      for(const track of project.tracks){const strip=this.liveGraph.tracks.get(track.id);if(strip)applyTrack(strip,track,project,this.context.currentTime,tick,undefined,true);}
      for(const [id,voices] of this.live) {
        for(const voice of voices) {
          const target=this.liveGraph.tracks.get(voice.trackId);
          if(target) { voice.gain.disconnect(); voice.gain.connect(target.input); }
          else { voice.cancel(this.context.currentTime); this.live.delete(id); this.liveOwners.delete(id); this.heldKeys.delete(id); }
        }
      }
      this.retireGraph(old);
    }
    if (this.liveGraph && this.context) {
      for (const track of project.tracks) {
        const tg = this.liveGraph.tracks.get(track.id);
        if (tg) applyTrack(tg, track, project, this.context.currentTime, tick);
      }
      for(const voices of this.live.values())for(const voice of voices){const track=project.tracks.find(t=>t.id===voice.trackId);if(track){const settings=JSON.stringify(track.sound);if(this.voiceSettings.get(voice)!==settings){voice.updateSound?.(track,this.context.currentTime);this.applyBend(voice,track,Math.max(this.context.currentTime,voice.start));this.voiceSettings.set(voice,settings);}}}
    }
    this.applyLiveControls();
    this.emit();
    if (!this.graph || !this.context) return;
    const changedTracks =
      project.tracks.some((t) => !this.graph!.tracks.has(t.id)) ||
      this.graph.tracks.size !== project.tracks.length;
    if (changedTracks || busesChanged) {
      if(this.previewId){
        const old=this.graph;this.graph=makeGraph(this.context,this.previewProject(),undefined,this.output!,false,true);
        for(const voice of this.voices){const target=this.graph.tracks.get(voice.trackId);if(target){voice.gain.disconnect();voice.gain.connect(target.input);}}
        this.retireGraph(old);this.tunePreviewVoices();this.applyLiveControls();return;
      }
      const wasPlaying = this.playing;
      this.pause();
      this.makeLiveGraph();
      this.pausedTick = tick;
      if (wasPlaying)
        void this.play(tick).catch((e) => this.onStatus(e.message));
      return;
    }
    for (const track of project.tracks) {
      const tg = this.graph.tracks.get(track.id)!;
      applyTrack(tg, this.previewId?{...track,automation:[]}:track, project, this.context.currentTime, tick);
      if (this.playing)
        scheduleAutomation(tg, track, project, this.context.currentTime, tick);
    }
    this.graph.master.gain.setTargetAtTime(
      1,
      this.context.currentTime,
      0.015,
    );
    if(this.previewId){this.tunePreviewVoices();this.applyLiveControls();}
    if (tempoChanged && this.playing) {
      this.pause();
      void this.play(tick).catch((e) => this.onStatus(e.message));
    } else if (this.playing) {
      const now = this.context.currentTime;
      this.voices = this.voices.filter((v) => {
        if (v.start > now + 0.01) {
          v.release(now);
          return false;
        }
        return true;
      });
      this.resetCursors(tick + secondsToTick(0.025, project.tempo), false);
    }
  }
  setLoop(enabled: boolean, start = 0, end = projectEnd(this.project)) {
    this.looping = enabled;
    this.loopStart = Math.max(0, start);
    this.loopEnd = Math.max(start + PPQ, end);
  }
  setMetronome(enabled: boolean) {
    this.metronome = enabled;
  }
  async play(tick = this.pausedTick, countInBars = 0) {
    this.pause();
    const token = this.epoch;
    this.activity = "song-loading"; this.emit();
    try { await this.ensureBuffers(
      this.project,
      audibleTracks(this.project).map((t) => t.id),
    ); } catch(error) { if(token===this.epoch) { this.pause(); throw error; } return; }
    if (token !== this.epoch) return;
    this.makeLiveGraph();
    this.activity = "song";
    const context = this.context!;
    this.startTick = clamp(tick, 0, projectEnd(this.project) - 1);
    this.pausedTick = this.startTick;
    const countIn = tickToSeconds(
      countInBars * ticksPerBar(this.project),
      this.project.tempo,
    );
    this.baseTime = context.currentTime + 0.075 + countIn;
    this.countInUntil = this.baseTime;
    this.loopPrimed = false;

    this.playing = true;
    this.nextClick = context.currentTime + 0.075;
    this.resetCursors(this.startTick, true);
    for (const track of this.project.tracks)
      scheduleAutomation(
        this.graph!.tracks.get(track.id)!,
        track,
        this.project,
        this.baseTime,
        this.startTick,
      );
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
    this.emit();
  }
  private resetCursors(tick: number, includeHeld: boolean) {
    this.noteCursor = this.compiled.notes.findIndex((n) =>
      includeHeld ? n.tick + n.duration > tick : n.tick >= tick,
    );
    if (this.noteCursor < 0) this.noteCursor = this.compiled.notes.length;
    this.eventCursor = this.compiled.events.findIndex((e) => e.tick >= tick);
    if (this.eventCursor < 0) this.eventCursor = this.compiled.events.length;
    this.audioCursor = this.compiled.audio.findIndex((a) =>
      includeHeld ? a.tick + a.duration > tick : a.tick >= tick,
    );
    if (this.audioCursor < 0) this.audioCursor = this.compiled.audio.length;
    if (includeHeld)
      for (const event of this.compiled.events.filter((e) => e.tick < tick))
        this.expression(event.trackId, event, this.baseTime, true);
  }
  private schedule() {
    if (!this.playing || !this.graph || !this.context) return;
    const context = this.context,
      now = context.currentTime,
      horizon = now + 0.16,
      end = this.looping ? this.loopEnd : projectEnd(this.project);
    const endTime =
      this.baseTime + tickToSeconds(end - this.startTick, this.project.tempo);
    try {
      while (this.eventCursor < this.compiled.events.length) {
        const event = this.compiled.events[this.eventCursor],
          at =
            this.baseTime +
            tickToSeconds(event.tick - this.startTick, this.project.tempo);
        if (at > horizon || event.tick >= end) break;
        this.expression(event.trackId, event, Math.max(now, at), true);
        this.eventCursor++;
      }
      while (this.noteCursor < this.compiled.notes.length) {
        const note = this.compiled.notes[this.noteCursor],
          at =
            this.baseTime +
            tickToSeconds(note.tick - this.startTick, this.project.tempo);
        if (at > horizon || note.tick >= end) break;
        this.noteCursor++;
        if (note.tick + note.duration <= this.startTick) continue;
        const track = this.project.tracks.find((t) => t.id === note.trackId);
        if (!track) continue;
        const start = Math.max(this.startTick, note.tick),
          duration = tickToSeconds(
            Math.min(note.tick + note.duration, end) - start,
            this.project.tempo,
          );
        if (duration <= 0) continue;
        const time = Math.max(
          now,
          this.baseTime +
            tickToSeconds(start - this.startTick, this.project.tempo),
        );
        const voice = makeVoice(
          this.graph,
          track,
          instrumentFor(this.project, track),
          note,
          time,
          duration,
          this.buffers,
          tickToSeconds(start - note.tick, this.project.tempo),
        );
        this.applyBend(voice, track, time, start);
        this.voices.push(voice);
      }
      while (this.audioCursor < this.compiled.audio.length) {
        const clip = this.compiled.audio[this.audioCursor],
          at =
            this.baseTime +
            tickToSeconds(clip.tick - this.startTick, this.project.tempo);
        if (at > horizon || clip.tick >= end) break;
        this.audioCursor++;
        if (clip.tick + clip.duration <= this.startTick) continue;
        const buffer = this.buffers.get(clip.region.assetId);
        if (!buffer) throw new Error("This audio take is not loaded.");
        const start = Math.max(this.startTick, clip.tick);
        this.voices.push(
          scheduleAudio(
            this.graph,
            clip.trackId,
            buffer,
            Math.max(
              now,
              this.baseTime +
                tickToSeconds(start - this.startTick, this.project.tempo),
            ),
            tickToSeconds(
              Math.min(clip.tick + clip.duration, end) - start,
              this.project.tempo,
            ),
            clip.region.offsetSec +
              tickToSeconds(start - clip.tick, this.project.tempo),
            clip.region.gain,
            start > clip.tick ? 0 : clip.region.fadeInSec,
            clip.region.fadeOutSec,
          ),
        );
      }
      const beat =
        ((60 / this.project.tempo) * 4) / this.project.timeSignature[1];
      while (this.nextClick < horizon && this.nextClick < endTime) {
        if (this.metronome || this.nextClick < this.baseTime) {
          const count = Math.round((this.nextClick - this.baseTime) / beat);
          this.click(
            this.nextClick,
            count % this.project.timeSignature[0] === 0,
          );
        }
        this.nextClick += beat;
      }
      this.voices = this.voices.filter((v) => v.end > now);
      if (this.looping && horizon >= endTime) {
        this.startTick = this.loopStart;
        this.baseTime = endTime;
        this.loopPrimed = true;
        this.nextClick = endTime;
        this.resetCursors(this.startTick, true);
        for (const track of this.project.tracks) {
          applyTrack(
            this.graph.tracks.get(track.id)!,
            track,
            this.project,
            endTime,
            this.startTick,
          );
          scheduleAutomation(
            this.graph.tracks.get(track.id)!,
            track,
            this.project,
            endTime,
            this.startTick,
          );
        }
      } else if (!this.looping && now >= endTime) {
        this.pausedTick = 0;
        this.playing = false;
        this.activity = "tail";
        const token = this.epoch;
        setTimeout(() => { if (token === this.epoch) this.pause(); }, Math.max(this.project.master.reverbDecay * 2, 4) * 1000);
        if (this.timer) {
          clearInterval(this.timer);
          this.timer = null;
        }
        this.emit();
        return;
      }
      this.emit();
    } catch (error) {
      this.pause();
      this.onStatus(
        error instanceof Error
          ? error.message
          : "Playback stopped. Retry the sound download.",
      );
    }
  }
  private click(at: number, accent: boolean) {
    const context = this.context!;
    const osc = context.createOscillator(),
      gain = context.createGain();
    osc.frequency.value = accent ? 1320 : 880;
    gain.gain.setValueAtTime(0.06, at);
    gain.gain.exponentialRampToValueAtTime(0.00001, at + 0.045);
    osc.connect(gain);
    gain.connect(this.graph?.output ?? this.output!);
    this.clicks.add(osc);
    osc.start(at);
    osc.stop(at + 0.05);
    osc.onended = () => {
      gain.disconnect();
      osc.disconnect();
      this.clicks.delete(osc);
    };
  }
  private retireGraph(graph: SongGraph | null) {
    if (!graph || !this.context) return;
    const at = this.context.currentTime;
    graph.output.gain.cancelAndHoldAtTime(at);
    graph.output.gain.linearRampToValueAtTime(0, at + 0.02);
    setTimeout(() => graph.dispose(), 40);
  }
  pause() {
    ++this.epoch;
    if (this.playing) this.pausedTick = Math.min(projectEnd(this.project), this.state.tick);
    this.playing = false;
    this.previewId = null;
    this.previewTrackId=null;this.previewInstrument=null;this.previewVoices.clear();
    this.activity = "idle";
    if (this.timer) clearInterval(this.timer);
    if (this.previewTimer) clearInterval(this.previewTimer);
    this.timer = this.previewTimer = null;
    const at = this.context?.currentTime ?? 0;
    for (const voice of this.voices) voice.cancel(at);
    this.voices = [];
    for (const click of this.clicks) { try { click.stop(at + 0.02); } catch {} }
    this.clicks.clear();
    this.retireGraph(this.graph); this.graph = null;
    this.emit();
  }
  cancelAudition() { if (this.previewId !== null) this.pause(); }
  stop(reset = true) {
    this.pause();
    const at = this.context?.currentTime ?? 0;
    for (const voices of this.live.values()) for (const voice of voices) voice.cancel(at);
    this.live.clear(); this.liveOwners.clear(); this.pedals.clear();
    this.heldKeys.clear(); this.controls.clear(); this.heldPedal.clear();
    this.retireGraph(this.liveGraph); this.liveGraph = null;
    if (reset) this.pausedTick = 0; this.emit();
  }
  async seek(tick: number) {
    const wasPlaying = this.playing;
    this.pause();
    this.pausedTick = clamp(tick, 0, projectEnd(this.project));
    if (wasPlaying) await this.play(this.pausedTick);
    else this.emit();
  }
  private releaseAll(at: number) {
    for (const voice of this.voices) voice.release(at);
    this.voices = [];
    for (const held of this.live.values())
      for (const voice of held) voice.release(at);
    this.live.clear();
    this.heldPedal.clear();
    this.heldKeys.clear();
  }
  private applyBend(voice: Voice, track: Track, at: number, tick?: number) {
    const events = this.compiled.events.filter(
      (e) => e.trackId === track.id && e.type === "pitchBend",
    );
    const bend =
      tick === undefined
        ? (this.controls.get(track.id)?.bend ?? 0)
        : ([...events].reverse().find((e) => e.tick <= tick)?.value ?? 0);
    const lane = track.automation.find(
      (a) => a.parameter === "pitchBend" && a.points.length,
    );
    const initial =
      tick === undefined
        ? bend
        : automationValue(track, "pitchBend", tick, bend);
    for (const param of voice.bend) {
      const base = voice.baseBend[voice.bend.indexOf(param)];
      param.cancelScheduledValues(at);
      param.setValueAtTime(base + clamp(initial, -1, 1) * 200, at);
    }
    if (lane && tick !== undefined)
      for (const point of [...lane.points].sort((a, b) => a.tick - b.tick))
        if (point.tick >= this.startTick) {
          const time =
            this.baseTime +
            tickToSeconds(point.tick - this.startTick, this.project.tempo);
          if (time > voice.end) {
            const finalTick =
              this.startTick +
              secondsToTick(voice.end - this.baseTime, this.project.tempo);
            const value = automationValue(
              track,
              "pitchBend",
              finalTick,
              initial,
            );
            voice.bend.forEach((param, i) =>
              param.linearRampToValueAtTime(
                voice.baseBend[i] + clamp(value, -1, 1) * 200,
                voice.end,
              ),
            );
            break;
          }
          if (time >= at)
            for (const param of voice.bend)
              param.linearRampToValueAtTime(
                voice.baseBend[voice.bend.indexOf(param)] +
                  clamp(point.value, -1, 1) * 200,
                time,
              );
        }
  }
  async noteOn(trackId: string, pitch: number, velocity = 0.75, inputId = trackId + ":" + pitch) {
    this.noteOff(trackId, pitch, inputId, true);
    const token = Symbol(inputId);
    this.liveOwners.set(inputId, { trackId, pitch, token });
    this.heldKeys.add(inputId);
    await this.ensureBuffers(this.project, [trackId]);
    if (this.liveOwners.get(inputId)?.token !== token) return;
    if (!this.liveGraph) this.liveGraph = makeGraph(this.context!, this.project, undefined, this.output!, false);
    const track = this.project.tracks.find(t => t.id === trackId);
    if (!track) return;
    const at = this.context!.currentTime;
    const voice = makeVoice(this.liveGraph, track, instrumentFor(this.project, track),
      { trackId, pitch, tick: 0, duration: 0, velocity, index: this.previewIndex++ }, at, undefined, this.buffers);
    this.applyBend(voice, track, at);
    this.applyLiveControls();
    this.live.set(inputId, [voice]);
    this.voiceSettings.set(voice,JSON.stringify(track.sound));
    return at;
  }
  noteOff(trackId: string, pitch: number, inputId = trackId + ":" + pitch, force = false) {
    this.heldKeys.delete(inputId);
    const owner = this.liveOwners.get(inputId);
    if (!force && owner && this.live.has(inputId) && [...this.pedals.values()].some(p => p.trackId === owner.trackId && p.down)) return;
    for (const voice of this.live.get(inputId) ?? []) voice.release(this.context?.currentTime ?? 0);
    this.live.delete(inputId); this.liveOwners.delete(inputId);
  }
  releaseSource(prefix: string) {
    for (const [id, owner] of this.liveOwners) if (id.startsWith(prefix)) this.noteOff(owner.trackId, owner.pitch, id, true);
    for (const id of this.pedals.keys()) if (id.startsWith(prefix)) this.pedals.delete(id);
    for (const [id, owner] of this.liveOwners) if (!this.heldKeys.has(id)) this.noteOff(owner.trackId, owner.pitch, id);
  }
  async preview(trackId: string, pitches: number[], duration = 0.9, identity = JSON.stringify([trackId,pitches,duration])) {
    return this.previewNotes(trackId, pitches.map((pitch,index) => ({ trackId,pitch,tick:0,duration:secondsToTick(duration,this.project.tempo),velocity:0.68,index })), identity);
  }
  async previewNotes(trackId: string, notes: ScheduledNote[], identity = JSON.stringify([trackId,notes.map(({pitch,tick,duration,velocity})=>({pitch,tick,duration,velocity}))])) {
    if (this.previewId === identity) { this.pause(); return; }
    this.pause();
    const token = this.epoch, project = this.project;
    this.previewId = identity; this.activity = "audition-loading"; this.emit();
    this.previewTrackId=trackId;
    const initialTrack=project.tracks.find(t=>t.id===trackId);if(!initialTrack){this.pause();return;}
    this.previewInstrument=JSON.stringify(instrumentFor(project,initialTrack));
    try {
      await this.ensureBuffers(project, [trackId]);
      if (token !== this.epoch) return;
      this.graph=makeGraph(this.context!,this.previewProject(),undefined,this.output!,false);
      const track = this.project.tracks.find(t => t.id === trackId);
      if (!track) { this.pause(); return; }
      this.activity = "audition";
      const start = this.context!.currentTime + 0.04;
      const ordered = [...notes].sort((a,b) => a.tick-b.tick);
      const end = start + tickToSeconds(Math.max(0,...notes.map(n=>n.tick+n.duration)),project.tempo);
      let cursor = 0;
      const schedule = () => {
        if (token !== this.epoch || !this.graph) return;
        const now = this.context!.currentTime;
        const currentTrack=this.project.tracks.find(t=>t.id===trackId);if(!currentTrack){this.pause();return;}
        while (cursor < ordered.length && start + tickToSeconds(ordered[cursor].tick,project.tempo) <= now + 0.16) {
          const note = ordered[cursor++];
          const at=Math.max(now,start+tickToSeconds(note.tick,project.tempo)),duration=tickToSeconds(note.duration,project.tempo);
          const voice=makeVoice(this.graph,currentTrack,instrumentFor(this.project,currentTrack),note,at,duration,this.buffers);
          this.applyBend(voice,currentTrack,at);this.voices.push(voice);this.previewVoices.set(voice,{note,at,duration,settings:JSON.stringify(currentTrack.sound)});
        }
        this.voices = this.voices.filter(v=>v.end>now);
        for(const voice of this.previewVoices.keys())if(voice.end<=now)this.previewVoices.delete(voice);
        this.applyLiveControls();
        if (now >= end) this.activity = "tail";
        if (now >= end + Math.max(this.project.master.reverbDecay*2,4)) { this.pause(); return; }
        this.emit();
      };
      this.previewTimer = setInterval(()=>{ try { schedule(); } catch(error) { if(token===this.epoch) { this.pause(); this.onStatus(error instanceof Error?error.message:"Preview failed. Retry the sound."); } } },25); schedule();
    } catch(error) { if(token===this.epoch) { this.pause(); throw error; } }
  }
  private applyLiveControls() {
    if(!this.context) return;
    for(const [id,control] of this.controls) {
      const track=this.project.tracks.find(t=>t.id===id);if(!track)continue;
      for(const graph of [this.liveGraph,this.previewId?this.graph:null]){const strip=graph?.tracks.get(id);if(strip){strip.expression.gain.setValueAtTime(control.expression,this.context.currentTime);strip.lfoGain.gain.setValueAtTime(track.sound.cutoff*.35*clamp(track.sound.lfoDepth+control.modulation,0,1),this.context.currentTime);}}
    }
  }
  expression(
    trackId: string,
    event: PerformanceEvent,
    at = this.context?.currentTime ?? 0,
    fromArrangement = false,
    source = "performance",
  ) {
    if (
      fromArrangement &&
      event.type === "pitchBend" &&
      this.project.tracks
        .find((t) => t.id === trackId)
        ?.automation.some((l) => l.parameter === "pitchBend" && l.points.length)
    )
      return;
    const control = this.controls.get(trackId) ?? {
      bend: 0,
      expression: 1,
      modulation: 0,
    };
    const graphs=(fromArrangement?[this.graph]:[this.liveGraph,this.previewId?this.graph:null]).flatMap(g=>g?.tracks.get(trackId)?[g.tracks.get(trackId)!]:[]);
    if (event.type === "pitchBend") {
      control.bend = clamp(event.value, -1, 1);
      for (const voice of (fromArrangement ? this.voices : [...this.live.values()].flat().concat(this.previewId?this.voices:[])).filter(
        (v) => v.trackId === trackId && v.end >= at,
      ))
        for (const param of voice.bend) {
          if(!fromArrangement)param.cancelAndHoldAtTime(at);
          param.setTargetAtTime(
            voice.baseBend[voice.bend.indexOf(param)] + control.bend * 200,
            at,
            0.008,
          );
        }
    }
    if (event.type === "expression") {
      control.expression = clamp(event.value, 0, 1);
      for(const graph of graphs)graph.expression.gain.setValueAtTime(control.expression, at);
    }
    if (event.type === "modulation" || event.type === "pressure") {
      control.modulation = clamp(event.value, 0, 1);
      const track = this.project.tracks.find((t) => t.id === trackId);
      if (track)for(const graph of graphs)graph.lfoGain.gain.setValueAtTime(
          track.sound.cutoff *
            0.35 *
            clamp(track.sound.lfoDepth + control.modulation, 0, 1),
          at,
        );
    }
    if (event.type === "sustain" && !fromArrangement) {
      this.pedals.set(source, { trackId, down: event.value >= 0.5 });
      for (const [id, owner] of this.liveOwners) if (owner.trackId === trackId && !this.heldKeys.has(id)) this.noteOff(trackId,owner.pitch,id);
    }
    if(!fromArrangement) this.controls.set(trackId, control);
  }
  meter() {
    if (!this.analyser) return { master: 0, tracks: {} as Record<string, number> };
    const read = (a: AnalyserNode) => {
      const data = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(data);
      let peak = 0;
      for (const sample of data) peak = Math.max(peak, Math.abs(sample));
      return peak;
    };
    return {
      master: read(this.analyser),
      tracks: Object.fromEntries(
        [...(this.graph ?? this.liveGraph)?.tracks ?? []].map(([id, g]) => [id, read(g.analyser)]),
      ),
    };
  }
  async render(
    project = this.project,
    onlyTrack?: string,
    durationOverride?: number,
  ): Promise<AudioBuffer> {
    this.pause();
    await this.ensureBuffers(
      project,
      onlyTrack ? [onlyTrack] : audibleTracks(project).map((t) => t.id),
    );
    const song = compileSong(project, onlyTrack),
      duration =
        durationOverride ??
        tickToSeconds(projectEnd(project), project.tempo) +
          Math.max(project.master.reverbDecay * 2, 4);
    const native = new OfflineAudioContext(
        2,
        Math.ceil(duration * 48000),
        48000,
      ),
      offline = new Tone.OfflineContext(native),
      graph = makeGraph(native, project, onlyTrack);
    const tracks = new Map(project.tracks.map((t) => [t.id, t]));
    let noteIndex = 0,
      audioIndex = 0;
    const title = onlyTrack ? tracks.get(onlyTrack)?.name : "your song";
    function bend(voice: Voice, track: Track, tick: number) {
      const events = song.events.filter(
          (e) => e.trackId === track.id && e.type === "pitchBend",
        ),
        lane = track.automation.find(
          (a) => a.parameter === "pitchBend" && a.points.length,
        );
      const initial = lane
        ? automationValue(track, "pitchBend", tick, 0)
        : (events.filter((e) => e.tick <= tick).at(-1)?.value ?? 0);
      voice.bend.forEach((param, i) =>
        param.setValueAtTime(
          voice.baseBend[i] + clamp(initial, -1, 1) * 200,
          voice.start,
        ),
      );
      if (lane) {
        for (const point of lane.points
          .filter((p) => p.tick > tick)
          .sort((a, b) => a.tick - b.tick)) {
          const at = tickToSeconds(point.tick, project.tempo);
          if (at > voice.end) {
            const value = automationValue(
              track,
              "pitchBend",
              secondsToTick(voice.end, project.tempo),
              initial,
            );
            voice.bend.forEach((param, i) =>
              param.linearRampToValueAtTime(
                voice.baseBend[i] + clamp(value, -1, 1) * 200,
                voice.end,
              ),
            );
            break;
          }
          voice.bend.forEach((param, i) =>
            param.linearRampToValueAtTime(
              voice.baseBend[i] + clamp(point.value, -1, 1) * 200,
              at,
            ),
          );
        }
      } else
        for (const event of events.filter((e) => e.tick > tick)) {
          const at = tickToSeconds(event.tick, project.tempo);
          if (at > voice.end) break;
          voice.bend.forEach((param, i) =>
            param.setTargetAtTime(
              voice.baseBend[i] + clamp(event.value, -1, 1) * 200,
              at,
              0.008,
            ),
          );
        }
    }
    const scheduleUntil = (limit: number) => {
      while (noteIndex < song.notes.length) {
        const note = song.notes[noteIndex],
          at = tickToSeconds(note.tick, project.tempo);
        if (at >= Math.min(limit, duration)) break;
        noteIndex++;
        const track = tracks.get(note.trackId)!;
        const voice = makeVoice(
          graph,
          track,
          instrumentFor(project, track),
          note,
          at,
          tickToSeconds(note.duration, project.tempo),
          this.buffers,
        );
        bend(voice, track, note.tick);
      }
      while (audioIndex < song.audio.length) {
        const clip = song.audio[audioIndex],
          at = tickToSeconds(clip.tick, project.tempo);
        if (at >= Math.min(limit, duration)) break;
        audioIndex++;
        const buffer = this.buffers.get(clip.region.assetId);
        if (!buffer)
          throw new Error("A recording is missing from this project.");
        scheduleAudio(
          graph,
          clip.trackId,
          buffer,
          at,
          tickToSeconds(clip.duration, project.tempo),
          clip.region.offsetSec,
          clip.region.gain,
          clip.region.fadeInSec,
          clip.region.fadeOutSec,
        );
      }
    };
    try {
      for (const track of project.tracks)
        if (graph.tracks.has(track.id))
          scheduleAutomation(graph.tracks.get(track.id)!, track, project, 0, 0);
      for (const event of song.events) {
        const at = tickToSeconds(event.tick, project.tempo),
          track = tracks.get(event.trackId)!,
          tg = graph.tracks.get(event.trackId)!;
        if (event.type === "expression")
          tg.expression.gain.setValueAtTime(clamp(event.value, 0, 1), at);
        if (event.type === "modulation" || event.type === "pressure")
          tg.lfoGain.gain.setValueAtTime(
            track.sound.cutoff *
              0.35 *
              clamp(track.sound.lfoDepth + event.value, 0, 1),
            at,
          );
      }
      // Suspend at short boundaries to create future voices only when needed.
      // Finished voices disconnect themselves, keeping dense long songs bounded.
      const window = 4;
      let boundary = window;
      scheduleUntil(window);
      let suspended = boundary < duration ? native.suspend(boundary) : null;
      const rendering = offline.render();
      while (suspended) {
        await Promise.race([suspended, rendering]);
        scheduleUntil(boundary + window);
        this.onStatus(
          "Rendering " +
            title +
            " · " +
            Math.round((boundary / duration) * 100) +
            "%",
        );
        boundary += window;
        suspended = boundary < duration ? native.suspend(boundary) : null;
        await native.resume();
      }
      const result = (await rendering).get();
      if (!result) throw new Error("This song could not be rendered.");
      this.onStatus("Render complete");
      return result as AudioBuffer;
    } finally {
      graph.dispose();
      offline.dispose();
    }
  }
  dispose() {
    this.stop();
    this.graph?.dispose();
    this.graph = null;
    this.listeners.clear();
    this.toneContext?.dispose();
    this.toneContext = null;
    this.context = null;
  }
}
