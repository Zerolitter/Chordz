export const PPQ = 960;
import type { ChordMovementSettings, MacroId, ModulationPatch } from "./modulation-types";
export type { ChordMovementSettings, MacroId, ModulationPatch, ModSource, ModRoute, ModTarget } from "./modulation-types";
export type Mode =
  | "major"
  | "minor"
  | "dorian"
  | "mixolydian"
  | "harmonic-minor"
  | "pentatonic";
export type Wave = "sine" | "triangle" | "sawtooth" | "square";
export type ExpressionType =
  | "noteOn"
  | "noteOff"
  | "sustain"
  | "pitchBend"
  | "modulation"
  | "expression"
  | "pressure"
  | "macro"
  | "controlChange";
export interface PerformanceEvent {
  tick: number;
  type: ExpressionType;
  value: number;
  note?: number;
  macroId?: MacroId;
  cc?: number;
  channel?: number;
}
export interface NoteEvent {
  id: string;
  pitch: number;
  tick: number;
  duration: number;
  velocity: number;
  articulation?: string;
}
export interface AudioRegion {
  assetId: string;
  offsetSec: number;
  gain: number;
  fadeInSec: number;
  fadeOutSec: number;
}
export interface Clip {
  id: string;
  name: string;
  startTick: number;
  lengthTick: number;
  sourceLengthTick: number;
  loop: boolean;
  transpose: number;
  notes: NoteEvent[];
  events: PerformanceEvent[];
  audio?: AudioRegion;
}
export interface SoundSettings {
  algorithm: "subtractive" | "fm";
  wave: Wave;
  detune: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  cutoff: number;
  resonance: number;
  filterEnvelope: number;
  lfoRate: number;
  lfoDepth: number;
  fmRatio: number;
  fmIndex: number;
  articulation: string;
}
export type AutomationParameter =
  | "volume"
  | "pan"
  | "cutoff"
  | "expression"
  | "modulation"
  | "pitchBend"
  | "reverb"
  | "delay"
  | "M1" | "M2" | "M3" | "M4";
export interface AutomationLane {
  parameter: AutomationParameter;
  points: { tick: number; value: number }[];
}
export interface Track {
  id: string;
  name: string;
  kind: "instrument" | "audio";
  instrumentId: string;
  color: string;
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  reverb: number;
  delay: number;
  low: number;
  mid: number;
  high: number;
  drive: number;
  sound: SoundSettings;
  clips: Clip[];
  automation: AutomationLane[];
  modulation?: ModulationPatch;
  chordMovement?: ChordMovementSettings;
}
export interface Section {
  id: string;
  name: string;
  startTick: number;
  lengthTick: number;
  lyrics: string;
}
export interface ChordEvent {
  id: string;
  sectionId: string;
  tick: number;
  duration: number;
  symbol: string;
  notes: number[];
}
export interface AssetReference {
  id: string;
  name: string;
  mime: string;
  byteLength: number;
  duration: number;
  sampleRate: number;
  channels: number;
}
export interface SampleZone {
  url?: string;
  assetId?: string;
  root: number;
  low: number;
  high: number;
  velocityLow: number;
  velocityHigh: number;
  roundRobin: number;
  articulation: string;
  loopStart?: number;
  loopEnd?: number;
}
export interface InstrumentManifest {
  id: string;
  name: string;
  family: string;
  description: string;
  kind: "sample" | "synth" | "drums";
  zones: SampleZone[];
  articulations: string[];
  license: string;
  source: string;
  defaults: Partial<SoundSettings>;
}
export interface ProjectDocument {
  schemaVersion: 1;
  id: string;
  title: string;
  key: string;
  mode: Mode;
  tempo: number;
  timeSignature: [number, number];
  seed: number;
  notes: string;
  sections: Section[];
  chords: ChordEvent[];
  tracks: Track[];
  assets: AssetReference[];
  userInstruments: InstrumentManifest[];
  master: { volume: number; limiter: boolean; reverbDecay: number };
}
export interface ProjectSummary {
  id: string;
  title: string;
  tempo: number;
  key: string;
  mode: Mode;
  trackCount: number;
  updatedAt: string;
  revision: number;
}
export interface CloudProject {
  document: ProjectDocument;
  revision: number;
  updatedAt: string;
}
export interface GenerationOptions {
  role: "melody" | "bass" | "chords" | "arpeggio" | "drums" | "strings";
  energy: number;
  density: number;
  register: number;
  tension: number;
  seed: number;
  chordMovement?: ChordMovementSettings;
}
export const uid = () => crypto.randomUUID();
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
