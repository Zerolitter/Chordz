import { describe, expect, it } from "vitest";
import { createTrack } from "../lib/music/project";
import { emptyPatch, makeSource } from "../lib/audio/modulation";
import { DEFAULT_CHORD_MOVEMENT } from "../lib/music/chord-movement";
import { clipboardTrackPatchSchema, storedSoundPresetSchema, trackPatchSchema } from "../lib/music/track-patch";

const patch = () => ({ sound: createTrack("pad", "Patch").sound, modulation: emptyPatch(), chordMovement: { ...DEFAULT_CHORD_MOVEMENT } });
describe("sound patch input validation", () => {
  it("accepts complete clipboard/device patches and rejects incomplete nested settings", () => {
    const complete = patch();
    expect(trackPatchSchema.parse(complete)).toEqual(complete);
    expect(storedSoundPresetSchema.parse({ name: "Slow bloom", patch: complete }).patch).toEqual(complete);
    expect(clipboardTrackPatchSchema.parse({ chordzPatch: 1, ...complete }).chordzPatch).toBe(1);
    for (const next of [null, {}, { sound: {}, modulation: { sources: [], routes: [] }, chordMovement: {} }, { ...complete, sound: {} }, { ...complete, chordMovement: {} }, { ...complete, modulation: { sources: [], routes: [] } }]) expect(trackPatchSchema.safeParse(next).success).toBe(false);
  });
  it("validates ranges, source graph, versions and preset names before staging", () => {
    const complete = patch();
    expect(trackPatchSchema.safeParse({ ...complete, sound: { ...complete.sound, cutoff: 30000 } }).success).toBe(false);
    expect(trackPatchSchema.safeParse({ ...complete, chordMovement: { ...complete.chordMovement, gate: 0 } }).success).toBe(false);
    complete.modulation.sources = [makeSource("lfo", "a")];
    complete.modulation.routes = [{ id: "loop", sourceId: "a", target: "source:a:rate", amount: 1, curve: "linear", slew: 0, enabled: true }];
    expect(trackPatchSchema.safeParse(complete).success).toBe(false);
    expect(clipboardTrackPatchSchema.safeParse({ chordzPatch: 2, ...patch() }).success).toBe(false);
    expect(storedSoundPresetSchema.safeParse({ name: "", patch: patch() }).success).toBe(false);
  });
});
