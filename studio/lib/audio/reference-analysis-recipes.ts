import { emptyPatch, makeSource } from "./modulation";
import { modulationIssues, type ModRoute, type ModSource } from "../music/modulation-types";
import { type Track } from "../music/types";
import type { ReferenceProfile } from "./reference-analysis-data";
export type ReferenceProposalKind = "sound" | "movement" | "both";
function curve(profile: ReferenceProfile, feature: "energy" | "brightness") {
  const points = profile.curve, size = Math.min(256, Math.max(2, points.length));
  return Array.from({ length: size }, (_, i) => {
    const position = i * (points.length - 1) / (size - 1), index = Math.floor(position), a = points[index]?.[feature] ?? 0, b = points[index + 1]?.[feature] ?? a;
    return Math.max(-1, Math.min(1, (a + (b - a) * (position - index)) * 2 - 1));
  });
}
/** A measured trajectory suggests a new editable patch; it never claims to reconstruct the reference. */
export function referenceProposal(track: Track, profile: ReferenceProfile, kind: ReferenceProposalKind, options: { seed: number; phraseBeats: number; startBeat?: number }): Partial<Track> {
  if (profile.quality.activeSeconds < 5) throw new Error("Analyze at least five active seconds before proposing motion.");
  const result: Partial<Track> = {};
  if (kind !== "movement") {
    const existing = track.modulation ?? emptyPatch(options.seed), owned = new Set(["reference_energy", "reference_brightness", "reference_pulse"]);
    const division = Math.max(.03125, Math.min(128, options.phraseBeats)), phase = ((-(options.startBeat ?? 0) / division) % 1 + 1) % 1;
    const sources: ModSource[] = [
      { ...makeSource("reference", "reference_energy"), name: "Reference energy", division, phase, curve: curve(profile, "energy") },
      { ...makeSource("reference", "reference_brightness"), name: "Reference tone", division, phase, curve: curve(profile, "brightness") },
      { ...makeSource("lfo", "reference_pulse"), name: "Reference pulse", division: .5, shape: "sine", amplitude: .5 },
    ];
    const routes: ModRoute[] = [
      { id: "reference_energy_gain", sourceId: "reference_energy", target: "track.gain", amount: 3, curve: "linear", slew: .12, enabled: true },
      { id: "reference_tone_filter", sourceId: "reference_brightness", target: "track.cutoff", amount: 1.5, curve: "linear", slew: .15, enabled: true },
      { id: "reference_pulse_gain", sourceId: "reference_pulse", target: "track.gain", amount: 2, curve: "linear", slew: .02, enabled: true },
    ];
    const patch = { ...existing, enabled: true, sources: [...existing.sources.filter(s => !owned.has(s.id)), ...sources], routes: [...existing.routes.filter(r => !owned.has(r.sourceId) && !routes.some(x => x.id === r.id)), ...routes], reference: { name: profile.source.name.slice(0, 200), fingerprint: profile.source.fingerprint, startSec: profile.coverage.startSec, endSec: profile.coverage.endSec, ...(profile.tempo.candidates[0] ? { tempo: profile.tempo.candidates[0].bpm } : {}), ...(profile.tonal.candidates[0] ? { key: profile.tonal.candidates[0].key, mode: profile.tonal.candidates[0].mode } : {}) } };
    if (patch.sources.length > 8 || patch.routes.length > 32) throw new Error("Make room for three reference sources and routes in the modulation matrix first.");
    const issues = modulationIssues(patch); if (issues.length) throw new Error(issues.join(" "));
    result.modulation = patch;
  }
  if (kind !== "sound") {
    if (track.kind !== "instrument") throw new Error("Choose an instrument track for chord movement.");
    const pulseDensity = profile.curve.reduce((sum, point) => sum + point.onsetDensity, 0) / Math.max(1, profile.curve.length), variation = profile.dynamics.p90Dbfs - profile.dynamics.p10Dbfs;
    result.chordMovement = { version: 1, enabled: true, liveEnabled: true, hold: false, inversion: 0, spread: variation > 8 ? 2 : 1, strum: 35, gate: variation > 8 ? .65 : .85, octaves: 1, swing: 0, division: pulseDensity > .2 ? 480 : 960, pattern: pulseDensity > .2 ? "upDown" : "chord", seed: options.seed };
  }
  return result;
}
