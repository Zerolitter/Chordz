import { describe, expect, it } from "vitest";
import { defaultWorkspaceLayouts, effectiveWorkspaceLayout, isWorkspaceLayouts, workspaceLayoutKey } from "../lib/client/workspace-layout";

describe("workspace focus layouts", () => {
  it("keeps selection outside profiles and gives Mix its own optional mixer", () => {
    const profiles = defaultWorkspaceLayouts();
    expect(profiles.arrange.browserOpen).toBe(true);
    expect(profiles.arrange.detailRatio).toBe(.4);
    expect(profiles.mix.browserOpen).toBe(false);
    expect(profiles.mix.detailOpen).toBe(false);
    expect(profiles.mix.mixerOpen).toBe(true);
    expect(isWorkspaceLayouts(profiles)).toBe(true);
    expect(isWorkspaceLayouts({ ...profiles, trackId: "private-track" })).toBe(false);
  });

  it("preserves a useful canvas before allocating extra mixer space", () => {
    const requested = { ...defaultWorkspaceLayouts().mix, detailOpen: true };
    const effective = effectiveWorkspaceLayout(requested, 1366, 560, true);
    expect(effective.canvasHeight).toBeGreaterThanOrEqual(220);
    expect(effective.detailHeight).toBeGreaterThanOrEqual(220);
    expect(effective.mixerHeight).toBe(0);
    expect(requested.mixerOpen).toBe(true);
  });

  it("clamps a narrow viewport without changing the requested desktop geometry", () => {
    const requested = defaultWorkspaceLayouts().sound;
    const effective = effectiveWorkspaceLayout(requested, 390, 500, true);
    expect(effective.browserWidth).toBe(0);
    expect(effective.canvasHeight).toBeGreaterThanOrEqual(160);
    expect(effective.detailHeight).toBeGreaterThan(200);
    expect(requested.browserWidth).toBe(236);
    expect(requested.detailRatio).toBe(.4);
  });

  it("rejects malformed geometry and separates owners and projects", () => {
    const profiles = defaultWorkspaceLayouts();
    expect(isWorkspaceLayouts({ ...profiles, sound: { ...profiles.sound, detailRatio: NaN } })).toBe(false);
    expect(workspaceLayoutKey("a:b", "song/c")).toBe("chordz-layout-v1:a%3Ab:song%2Fc");
    expect(workspaceLayoutKey("guest", "song")).not.toBe(workspaceLayoutKey("artist", "song"));
  });

  it("fits note controls before an optional mixer and keeps requested geometry intact", () => {
    const requested = { ...defaultWorkspaceLayouts().mix, detailOpen:true, detailRatio:.2 };
    const before = {...requested};
    const desktop = effectiveWorkspaceLayout(requested,1366,650,true,320);
    expect(desktop.detailHeight).toBeGreaterThanOrEqual(320);
    expect(desktop.mixerHeight).toBe(0);
    const narrow = effectiveWorkspaceLayout(requested,390,500,true,320);
    expect(narrow.browserWidth).toBe(0);
    expect(narrow.detailHeight).toBeLessThanOrEqual(500-72-160);
    expect(requested).toEqual(before);
  });
});
