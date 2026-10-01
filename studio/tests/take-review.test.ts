import { describe, expect, it } from "vitest";
import { buildTakePreview, audioRegionsOverlap } from "../lib/music/take-review";
import { createProject, createTrack, emptyClip } from "../lib/music/project";
import { projectSchema } from "../lib/music/schema";
import { compileSong } from "../lib/audio/compile";

function fixture() {
  const project = createProject("Compare attempts");
  const track = createTrack("piano", "Voice", undefined, "audio");
  const clip = { ...emptyClip(7680, 1920, "Second attempt"), id: "second_attempt",
    audio: { assetId: "recorded_audio", offsetSec: .75, gain: .7, fadeInSec: .02, fadeOutSec: .12 } };
  track.volume = -8; track.pan = .2; track.mute = true; track.solo = true;
  track.automation = [{ parameter: "volume", points: [{ tick: 7680, value: -35 }] }];
  track.clips = [emptyClip(0, 3840, "Musical phrase"), clip,
    { ...structuredClone(clip), id: "first_attempt", startTick: 7680, name: "First attempt" }];
  project.tracks = [track, createTrack("lead", "Backing")];
  project.assets = [{ id: "recorded_audio", name: "Recorded.wav", mime: "audio/wav", byteLength: 100, duration: 4, sampleRate: 48000, channels: 1 },
    { id: "unrelated_audio", name: "Unrelated.wav", mime: "audio/wav", byteLength: 200, duration: 8, sampleRate: 48000, channels: 1 }];
  return { project, track, clip };
}

describe("audio take comparison", () => {
  it("auditions only the selected region at zero with its original source and mix", () => {
    const { project, track, clip } = fixture();
    const before = structuredClone(project);
    const preview = buildTakePreview(project, track.id, clip.id);
    expect(project).toEqual(before);
    expect(preview.tracks).toHaveLength(1);
    expect(preview.tracks[0]).toEqual({ ...track, mute: false, solo: false, automation: [], clips: [{ ...clip, startTick: 0 }] });
    expect(preview.assets).toEqual([project.assets[0]]);
    expect(preview.sections).toEqual([{ ...project.sections[0], name: "Region audition", startTick: 0, lengthTick: clip.lengthTick, lyrics: "" }]);
    expect(preview.chords).toEqual([]);
    expect(preview.master).toEqual(project.master);
    expect(preview.tempo).toBe(project.tempo);
    expect(projectSchema.safeParse(preview).success).toBe(true);
    const compiled = compileSong(preview);
    expect(compiled.audio).toHaveLength(1);
    expect(compiled.audio[0]).toMatchObject({ tick: 0, duration: clip.lengthTick, region: clip.audio });
    expect(compiled.notes).toEqual([]);
    expect(compiled.events).toEqual([]);
  });

  it("keeps the preview independent of song and other attempt edits", () => {
    const { project, track, clip } = fixture();
    const before = structuredClone(project);
    const preview = buildTakePreview(project, track.id, clip.id);
    preview.tracks[0].clips[0].audio!.offsetSec = 3;
    preview.tracks[0].sound.cutoff = 500;
    preview.assets[0].name = "Changed";
    preview.master.volume = -50;
    expect(project.tracks[0].clips[1].audio!.offsetSec).toBe(.75);
    expect(project.tracks[0].sound.cutoff).toBe(before.tracks[0].sound.cutoff);
    expect(project.assets[0].name).toBe("Recorded.wav");
    expect(project.master.volume).not.toBe(-50);
  });

  it("rejects missing or non-audio destinations without returning another region", () => {
    const { project, track, clip } = fixture();
    expect(() => buildTakePreview(project, "missing", clip.id)).toThrow(/track/i);
    expect(() => buildTakePreview(project, track.id, "missing")).toThrow(/region/i);
    expect(() => buildTakePreview(project, track.id, track.clips[0].id)).toThrow(/audio/i);
    project.assets = [];
    expect(() => buildTakePreview(project, track.id, clip.id)).toThrow(/audio|asset/i);
  });

  it("does not carry unused sampled-instrument dependencies into an audio region preview", () => {
    const { project, track, clip } = fixture();
    project.userInstruments = [{ id: "unrelated_sampler", name: "Sampler", family: "Private", description: "Unused",
      kind: "sample", zones: [{ assetId: "unrelated_audio", root: 60, low: 0, high: 127, velocityLow: 0, velocityHigh: 1, roundRobin: 0, articulation: "sustain" }],
      articulations: ["sustain"], license: "User supplied", source: "Private", defaults: {} }];
    const preview = buildTakePreview(project, track.id, clip.id);
    expect(preview.userInstruments).toEqual([]);
    expect(projectSchema.safeParse(preview).success).toBe(true);
  });

  it("warns only for actual half-open audio-region overlaps without treating phrase notes as takes", () => {
    const { track } = fixture();
    expect(audioRegionsOverlap(track)).toBe(true);
    track.clips[2].startTick = track.clips[1].startTick + track.clips[1].lengthTick;
    expect(audioRegionsOverlap(track)).toBe(false);
    track.clips[0].startTick = track.clips[1].startTick;
    expect(audioRegionsOverlap(track)).toBe(false);
    track.clips[2].startTick--;
    expect(audioRegionsOverlap(track)).toBe(true);
  });
});
