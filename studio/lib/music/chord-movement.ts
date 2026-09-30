import { clamp, uid, type NoteEvent } from "./types";
import type { ChordMovementSettings } from "./modulation-types";

export const DEFAULT_CHORD_MOVEMENT: ChordMovementSettings = {
  version: 1, enabled: false, liveEnabled: false, hold: false,
  inversion: 0, spread: 0, strum: 0, gate: .8, octaves: 1,
  swing: 0, division: 480, pattern: "chord", seed: 0,
};
export const MAX_GENERATED_NOTES = 32000;
export const MOVEMENT_LIMIT_MESSAGE = "This phrase exceeds 32,000 notes. Reduce octaves, choose a slower movement rate, or shorten the section.";

function randomAt(seed: number, index: number) {
  let value = Math.imul((seed | 0) ^ Math.imul(index + 1, 0x9e3779b1), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 16), 0xc2b2ae35);
  return ((value ^ (value >>> 13)) >>> 0) / 4294967296;
}

/** The same voicing is used by the live arpeggiator and editable generation. */
export function movementVoicing(pitches: readonly number[], settings: ChordMovementSettings): number[] {
  const notes = [...new Set(pitches.filter(Number.isFinite).map(p => clamp(Math.round(p), 0, 127)))].sort((a, b) => a - b);
  if (!notes.length) return [];
  const inversion = clamp(Math.round(settings.inversion), -4, 4);
  for (let i = 0; i < Math.abs(inversion); i++) {
    if (inversion > 0) notes.push(notes.shift()! + 12);
    else notes.unshift(notes.pop()! - 12);
  }
  const spread = clamp(Math.round(settings.spread), 0, 3);
  const voiced = notes.map((pitch, i) => pitch + Math.floor(i / 2) * spread * 12);
  return [...new Set(Array.from({ length: clamp(Math.round(settings.octaves), 1, 4) }, (_, octave) => voiced.map(p => clamp(p + octave * 12, 0, 127))).flat())].sort((a, b) => a - b);
}

export interface MovementSpan {
  startTick: number;
  lengthTick: number;
  velocity: number;
  seed?: number;
  maxNotes?: number;
}

export interface MovementStep {
  step: number;
  originTick: number;
  velocity: number;
  seed?: number;
}

/** Evaluates one step directly; the live scheduler never needs earlier steps. */
export function evaluateMovementStep(pitches: readonly number[], settings: ChordMovementSettings, span: MovementStep): NoteEvent[] {
  const voicing = movementVoicing(pitches, settings);
  if (!voicing.length || !Number.isFinite(span.originTick) || !Number.isFinite(span.step) || span.step < 0) return [];
  const index = Math.floor(span.step), division = clamp(Math.round(settings.division), 60, 3840);
  const swing = clamp(settings.swing, 0, .75), gate = clamp(settings.gate, .05, 1);
  const tick = Math.round(span.originTick + index * division + (index % 2 ? division * swing : 0));
  const next = Math.round(span.originTick + (index + 1) * division + ((index + 1) % 2 ? division * swing : 0));
  const sequence = settings.pattern === "down" ? [...voicing].reverse()
    : settings.pattern === "upDown" && voicing.length > 1 ? [...voicing, ...voicing.slice(1, -1).reverse()] : voicing;
  const seed = (span.seed ?? settings.seed) | 0;
  const chosen = settings.pattern === "chord" ? voicing : [sequence[settings.pattern === "random" ? Math.floor(randomAt(seed, index) * sequence.length) : index % sequence.length]];
  const strum = Math.min(clamp(settings.strum, 0, 480), Math.max(0, next - tick - 1));
  return chosen.map((pitch, voice) => ({ id: uid(), pitch, tick: tick + Math.round(chosen.length > 1 ? strum * voice / (chosen.length - 1) : 0), duration: Math.max(1, Math.round((next - tick) * gate)), velocity: clamp(span.velocity, .01, 1) }));
}

/** Emits absolute ticks in the supplied span, never crossing its end. */
export function evaluateMovement(pitches: readonly number[], settings: ChordMovementSettings, span: MovementSpan): NoteEvent[] {
  const start = Math.max(0, Math.round(span.startTick));
  const length = Math.max(0, Math.round(span.lengthTick));
  if (!Number.isFinite(start) || !Number.isFinite(length) || length < 1) return [];
  if (!movementVoicing(pitches, settings).length) return [];
  const end = start + length, division = clamp(Math.round(settings.division), 60, 3840);
  const requestedBudget = span.maxNotes ?? MAX_GENERATED_NOTES;
  const budget = Number.isFinite(requestedBudget) ? Math.max(0, Math.min(MAX_GENERATED_NOTES, Math.floor(requestedBudget))) : MAX_GENERATED_NOTES;
  const result: NoteEvent[] = [];
  for (let index = 0; start + index * division < end; index++) {
    for (const note of evaluateMovementStep(pitches, settings, { step: index, originTick: start, velocity: span.velocity, seed: span.seed }))
      if (note.tick < end) { if (result.length >= budget) throw new RangeError(MOVEMENT_LIMIT_MESSAGE); result.push({ ...note, duration: Math.min(note.duration, end - note.tick) }); }
  }
  return result.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
}
