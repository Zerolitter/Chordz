import { describe, expect, it } from "vitest";
import { createProject, createTrack } from "../lib/music/project";
import { DEFAULT_APPEARANCE, isAppearance, trackDisplayColor } from "../lib/client/appearance";

describe("device appearance preferences", () => {
  it("accepts the supplied presets and rejects invalid stored preferences", () => {
    expect(isAppearance(DEFAULT_APPEARANCE)).toBe(true);
    expect(isAppearance({ ...DEFAULT_APPEARANCE, accent: "#e5a95c", railWidth: 10, density: "compact" })).toBe(true);
    for (const update of [{ accent: "red" }, { railWidth: 1 }, { railWidth: 3.5 }, { railWidth: Infinity }, { density: "tiny" }]) {
      expect(isAppearance({ ...DEFAULT_APPEARANCE, ...update })).toBe(false);
    }
    expect(isAppearance(null)).toBe(false);
  });
  it("uses instrument families consistently without changing saved track colours", () => {
    const project = createProject();
    const track = createTrack("strings", "Strings", "#123456");
    expect(trackDisplayColor(project, track)).toBe("#c8788f");
    expect(track.color).toBe("#123456");
    expect(trackDisplayColor(project, { ...track, kind: "audio" })).toBe("#123456");
  });
});
