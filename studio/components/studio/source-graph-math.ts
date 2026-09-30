import { modulationSourceValue, type ModSourceState } from "../../lib/audio/modulation";
import { clamp } from "../../lib/music/types";
import type { ModSource } from "../../lib/music/modulation-types";

export type SourceHandle = "attack" | "decay" | "release" | "phase" | "amplitude" | number;
export interface SourceGraphLayout { duration: number; releaseAt: number; cycles: number; originCycle: number }
export function sourceGraphLayout(source: ModSource, state?: ModSourceState): SourceGraphLayout {
  const hold = Math.max(.25, (source.attack + source.decay) * .5);
  const releaseAt = state?.release !== undefined && state.voiceStart !== undefined ? Math.max(0, state.release - state.voiceStart) : source.attack + source.decay + hold;
  return { duration: Math.max(.1, (releaseAt + source.release) * 1.15), releaseAt, cycles: source.kind === "random" ? 4 : 1, originCycle: source.kind === "random" ? Math.floor(state?.phase ?? source.phase) : 0 };
}
export function sourceGraphValue(source: ModSource, x: number, layout: SourceGraphLayout, key: string, seed: number, amplitude = source.amplitude): number {
  const elapsed = x * layout.duration, phase = layout.originCycle + x * layout.cycles;
  return clamp(modulationSourceValue(source, phase, elapsed, source.kind === "envelope" ? { key, pitch: 60, velocity: .75, start: 0, release: layout.releaseAt } : undefined, elapsed, key, seed) * amplitude, -1, 1);
}
/** Discontinuous sources retain their exact jumps; reference curves retain every point. */
export function sourceGraphPoints(source: ModSource, layout: SourceGraphLayout, key: string, seed: number, amplitude = source.amplitude) {
  const discontinuous = source.kind === "step" || source.kind === "random" || source.kind === "lfo" && source.shape === "square";
  const segments = source.kind === "step" ? Math.max(1, source.steps.length) : source.kind === "random" ? layout.cycles : source.kind === "lfo" && source.shape === "square" ? 2 : source.kind === "reference" ? Math.max(1, source.curve.length - 1) : 128;
  const points: { x: number; value: number }[] = [];
  for (let index = 0; index <= segments; index++) {
    const x = index / segments;
    if (discontinuous && index > 0) points.push({ x, value: sourceGraphValue(source, Math.max(0, x - 1e-9), layout, key, seed, amplitude) });
    points.push({ x, value: sourceGraphValue(source, x, layout, key, seed, amplitude) });
  }
  return points;
}
export function editSourceHandle(source: ModSource, handle: SourceHandle, x: number, value: number, layout: SourceGraphLayout): ModSource {
  if (!Number.isFinite(x) || !Number.isFinite(value)) return source;
  x = clamp(x, 0, 1); value = clamp(value, -1, 1);
  if (typeof handle === "number") {
    const property = source.kind === "step" ? "steps" : "curve", points = [...source[property]];
    if (handle >= 0 && handle < points.length) points[handle] = Math.round(value * 100) / 100;
    return { ...source, [property]: points };
  }
  if (handle === "phase") return { ...source, phase: Math.round(x * 100) / 100 };
  if (handle === "amplitude") return { ...source, amplitude: Math.round(clamp(value, 0, 1) * 100) / 100 };
  const seconds = x * layout.duration;
  if (handle === "attack") return { ...source, attack: Math.max(.001, Math.min(10, Math.round(seconds * 1000) / 1000)) };
  if (handle === "decay") return { ...source, decay: Math.max(.001, Math.min(10, Math.round((seconds - source.attack) * 1000) / 1000)), sustain: Math.round(clamp(value, 0, 1) * 100) / 100 };
  return { ...source, release: Math.max(.01, Math.min(15, Math.round((seconds - layout.releaseAt) * 1000) / 1000)) };
}
export function sourceHandlePosition(source: ModSource, handle: SourceHandle, layout: SourceGraphLayout) {
  if (typeof handle === "number") { const points = source.kind === "step" ? source.steps : source.curve; return { x: source.kind === "step" ? (handle + .5) / points.length : handle / Math.max(1, points.length - 1), value: points[handle] ?? 0 }; }
  if (handle === "attack") return { x: source.attack / layout.duration, value: source.amplitude };
  if (handle === "decay") return { x: (source.attack + source.decay) / layout.duration, value: source.sustain * source.amplitude };
  if (handle === "release") return { x: (layout.releaseAt + source.release) / layout.duration, value: 0 };
  if (handle === "phase") return { x: source.phase, value: modulationSourceValue(source, source.phase, 0) * source.amplitude };
  return { x: source.shape === "triangle" ? .5 : source.shape === "saw" ? .99 : source.shape === "square" ? .125 : .25, value: source.amplitude };
}
