import { describe, expect, it } from "vitest";
import { ReferenceAnalyzer } from "../lib/audio/reference-analysis";
import { referenceProposal } from "../lib/audio/reference-analysis-recipes";
import { createProject } from "../lib/music/project";
import { compileModulation, emptyPatch, makeSource, ModulationEvaluator } from "../lib/audio/modulation";
import { projectSchema } from "../lib/music/schema";
const options = { seed: 17, phraseBeats: 32 };
function profile() {
  const metadata = { name: "Reference", fingerprint: "private-hash", byteLength: 1, sampleRate: 12000, channels: 1, duration: 6 }, analyzer = new ReferenceAnalyzer(metadata, { startSec: 0, endSec: 6 });
  analyzer.push([Float32Array.from({ length: 72000 }, (_, i) => .3 * Math.sin(2 * Math.PI * 440 * i / 12000))]);
  return analyzer.finish();
}
describe("reference recipes", () => {
  it("creates valid bounded proposals, keeps existing routes and leaves the source song unchanged", () => {
    const project = createProject("Song"), track = project.tracks[0], reference = profile();
    track.modulation = { ...emptyPatch(), sources: [makeSource("lfo", "custom")], routes: [{ id: "custom-pan", sourceId: "custom", target: "track.pan", amount: .2, curve: "linear", slew: .1, enabled: true }] };
    const before = structuredClone(track), proposed = referenceProposal(track, reference, "both", options);
    expect(track).toEqual(before); expect(proposed.modulation!.routes).toContainEqual(track.modulation.routes[0]);
    expect(proposed.modulation!.sources.every(s => s.curve.length <= 256 && s.curve.every(v => v >= -1 && v <= 1))).toBe(true);
    expect(proposed.modulation!.sources[1].division).toBe(32); expect(proposed.chordMovement?.liveEnabled).toBe(true);
    expect(projectSchema.safeParse({ ...project, tracks: [{ ...track, ...proposed }, ...project.tracks.slice(1)] }).success).toBe(true);
    expect(proposed.modulation!.reference?.fingerprint).toBe("private-hash");
  });
  it("replacing a previous reference is bounded and movement-only preserves the sound patch", () => {
    const track = createProject("Song").tracks[0], reference = profile();
    const first = referenceProposal(track, reference, "sound", options), second = referenceProposal({ ...track, ...first }, reference, "sound", options);
    expect(second.modulation!.sources).toHaveLength(3); expect(second.modulation!.routes).toHaveLength(3);
    const movement = referenceProposal({ ...track, ...first }, reference, "movement", options);
    expect(movement.modulation).toBeUndefined(); expect(movement.chordMovement?.seed).toBe(17);
    expect(() => referenceProposal({ ...track, kind: "audio" }, reference, "movement", options)).toThrow("instrument track");
  });
  it("does not destroy a full custom matrix to make room for a proposal", () => {
    const track = createProject("Song").tracks[0]; track.modulation = { ...emptyPatch(), sources: Array.from({ length: 6 }, (_, i) => makeSource("lfo", "custom" + i)) };
    const before = structuredClone(track);
    expect(() => referenceProposal(track, profile(), "sound", options)).toThrow("Make room"); expect(track).toEqual(before);
  });
  it("anchors a measured curve to the selected section's start when seeking", () => {
    const track = createProject("Song").tracks[0], measured = profile(); measured.curve[0].energy = 0; measured.curve.at(-1)!.energy = 1;
    const patch = referenceProposal(track, measured, "sound", { ...options, startBeat: 8 }).modulation!;
    const evaluator = new ModulationEvaluator(compileModulation(patch, track.id, 120));
    expect(evaluator.sample(4).sources.reference_energy).toBeCloseTo(-1, 4);
  });
});
