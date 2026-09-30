import { applyModTarget, trackModulationBase } from "../audio/modulation";
import { automationValue } from "../audio/compile";
import { PPQ, type Track } from "../music/types";
import type { ModTarget, ModulationPatch } from "../music/modulation-types";

/** Mirrors the scheduler's automated track bases; EQ/resonance have static bases. */
export function knobModulationBase(track: Track, target: ModTarget, seconds: number, tempo: number): number {
  const base = trackModulationBase(track, target);
  const parameter = ({ "track.cutoff": "cutoff", "track.pan": "pan", "track.reverb": "reverb", "track.delay": "delay" } as Record<string,string>)[target];
  return parameter ? automationValue(track, parameter, seconds * tempo / 60 * PPQ, base) : base;
}

/** Possible contribution range of enabled routes, separate from their current output. */
export function knobModulationBounds(patch: ModulationPatch | undefined, target: ModTarget, base: number): readonly [number, number] | undefined {
  if (!patch?.enabled) return;
  let lower = 0, upper = 0, count = 0;
  for (const route of patch.routes) {
    if (!route.enabled || route.target !== target) continue;
    const source = patch.sources.find(item => item.id === route.sourceId);
    if (source && !source.enabled) continue;
    let min = route.sourceId === "pitchBend" ? -1 : 0, max = 1;
    if (source) {
      const values = source.kind === "step" ? source.steps : source.kind === "reference" ? source.curve : undefined;
      if (values) { min = values.length ? Math.min(...values) : 0; max = values.length ? Math.max(...values) : 0; }
      else { min = source.kind === "envelope" ? 0 : -1; max = 1; }
      // An incoming amplitude route can reach the source's complete [0,1] range.
      const amplitude = patch.routes.some(item => item.enabled && item.target === `source:${source.id}:amplitude`) ? 1 : source.amplitude;
      min *= amplitude; max *= amplitude;
    }
    const curve = (n: number) => route.curve === "exponential" ? Math.sign(n) * n * n : n;
    const a = curve(min) * route.amount, b = curve(max) * route.amount;
    lower += Math.min(a, b); upper += Math.max(a, b); count++;
  }
  if (!count) return;
  if (target.startsWith("source:")) {
    const rate = target.endsWith(":rate"), bound = (n: number) => rate ? Math.max(.01, Math.min(40, base * Math.pow(2, n))) : Math.max(0, Math.min(1, base + n));
    return [bound(lower), bound(upper)];
  }
  return [applyModTarget(target, base, lower), applyModTarget(target, base, upper)];
}
