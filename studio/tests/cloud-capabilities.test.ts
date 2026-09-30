import { afterEach, describe, expect, it, vi } from "vitest";
import { createCloudProject, loadProject, loadVersions, saveCloudProject } from "../lib/client/cloud";
import { createProject, emptyClip } from "../lib/music/project";
import { emptyPatch } from "../lib/audio/modulation";
import { DEFAULT_CHORD_MOVEMENT } from "../lib/music/chord-movement";
import { hasStudioExtensions, STUDIO_FEATURE_HEADER, STUDIO_MODULATION_FEATURE, supportsStudioExtensions } from "../lib/music/performance";

afterEach(() => vi.unstubAllGlobals());
describe("Studio client capability", () => {
  it("recognizes only the advertised extension feature and accepts additive feature lists", () => {
    expect(supportsStudioExtensions(new Headers())).toBe(false);
    expect(supportsStudioExtensions(new Headers({ [STUDIO_FEATURE_HEADER]: "modulation-v0" }))).toBe(false);
    expect(supportsStudioExtensions(new Headers({ [STUDIO_FEATURE_HEADER]: `future-feature, ${STUDIO_MODULATION_FEATURE}` }))).toBe(true);
  });
  it("detects every saved extension while leaving legacy documents readable", () => {
    const document = createProject();
    expect(hasStudioExtensions(document)).toBe(false);
    document.tracks[0].modulation = emptyPatch();
    expect(hasStudioExtensions(document)).toBe(true);
    delete document.tracks[0].modulation;
    document.tracks[0].chordMovement = { ...DEFAULT_CHORD_MOVEMENT };
    expect(hasStudioExtensions(document)).toBe(true);
    delete document.tracks[0].chordMovement;
    const clip = emptyClip(0, 960, "Controller take");
    document.tracks[0].clips.push(clip);
    for (const event of [{ tick: 0, type: "macro" as const, macroId: "M1" as const, value: .5 }, { tick: 0, type: "controlChange" as const, cc: 74, channel: 0, value: .5 }]) {
      clip.events = [event];
      expect(hasStudioExtensions(document)).toBe(true);
    }
    clip.events = [{ tick: 0, type: "expression", value: .5 }];
    expect(hasStudioExtensions(document)).toBe(false);
  });
  it("advertises enhanced writes without changing their document or revision body", async () => {
    const document = createProject();
    const fetch = vi.fn().mockImplementation(async () => Response.json({ document, revision: 2, updatedAt: "2026-09-30T00:00:00.000Z" }));
    vi.stubGlobal("fetch", fetch);
    await createCloudProject(document);
    await saveCloudProject(document, 1);
    for (const [, init] of fetch.mock.calls) {
      const headers = new Headers(init.headers);
      expect(headers.get(STUDIO_FEATURE_HEADER)).toBe(STUDIO_MODULATION_FEATURE);
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(init.credentials).toBe("same-origin");
    }
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(document);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ document, expectedRevision: 1 });
  });
  it("advertises capability on document and version reads", async () => {
    const document = createProject();
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ document, revision: 1, updatedAt: "2026-09-30T00:00:00.000Z" })).mockResolvedValueOnce(Response.json([]));
    vi.stubGlobal("fetch", fetch);
    expect((await loadProject(document.id)).document).toEqual(document);
    expect(await loadVersions(document.id)).toEqual([]);
    for (const [, init] of fetch.mock.calls) {
      expect(new Headers(init.headers).get(STUDIO_FEATURE_HEADER)).toBe(STUDIO_MODULATION_FEATURE);
      expect(init.credentials).toBe("same-origin");
      expect(init.body).toBeUndefined();
    }
  });
});
