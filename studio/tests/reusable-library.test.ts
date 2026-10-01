import { describe, expect, it } from "vitest";
import { emptyPatch, makeSource } from "../lib/audio/modulation";
import { instrumentFor, isDrumInstrument } from "../lib/audio/catalog";
import { createProject, createTrack, emptyClip } from "../lib/music/project";
import {
  applyLibraryEntry, createPhraseEntry, createSoundEntry, libraryEntrySchema,
  materializeLibraryEntry, phraseCompatibility, remapEntry, soundConflicts,
} from "../lib/music/reusable-library";
import type { ModRoute, ModTarget } from "../lib/music/modulation-types";

const route = (sourceId: string, target: ModTarget, id = "route"): ModRoute =>
  ({ id, sourceId, target, amount: 1, curve: "linear", slew: 0, enabled: true });
function phrase() {
  const project = createProject(), track = project.tracks[0];
  track.instrumentId = "lead";
  const clip = emptyClip(3840, 3840);
  clip.notes = [{ id: "note", pitch: 60, tick: 0, duration: 960, velocity: .7 }];
  track.clips = [clip];
  return { project, track, clip };
}

describe("independent reusable library snapshots", () => {
  it("snapshots full sounds without copying destination mixer identity", () => {
    const { project, track } = phrase();
    track.modulation = { ...emptyPatch(42), sources: [makeSource("random", "motion")] };
    track.low = 4; track.drive = .3; track.pan = .5;
    const entry = createSoundEntry(project, track, "My sound");
    track.modulation.sources[0].steps[0] = .25;
    expect(entry.sound.modulation!.sources[0].steps[0]).toBe(1);
    expect(entry.sound).toMatchObject({ low: 4, drive: .3 });
    expect("pan" in entry.sound).toBe(false);
    expect(libraryEntrySchema.safeParse(entry).success).toBe(true);
  });

  it("allocates independent project identities while retaining patch-local links and seeds", () => {
    const { project, track, clip } = phrase();
    track.modulation = { ...emptyPatch(42), sources: [makeSource("random", "motion")], routes: [route("M1", "source:motion:amplitude")] };
    const entry = createPhraseEntry(project, track, clip, "Idea");
    const first = materializeLibraryEntry(entry).entry, second = materializeLibraryEntry(entry).entry;
    expect(new Set([entry.id, first.id, second.id]).size).toBe(3);
    expect(first.clip!.id).not.toBe(second.clip!.id);
    expect(first.clip!.notes[0].id).not.toBe(second.clip!.notes[0].id);
    expect(first.sound.instrument.id).not.toBe(second.sound.instrument.id);
    expect(first.sound.modulation).toEqual(entry.sound.modulation);
    first.clip!.notes[0].pitch = 72;
    first.sound.modulation!.sources[0].steps[0] = 0;
    expect(second.clip!.notes[0].pitch).toBe(60);
    expect(second.sound.modulation!.sources[0].steps[0]).toBe(1);
  });
  it("keeps sampled orchestral percussion a drum kit after fresh manifest identities", () => {
    const project = createProject(), track = createTrack("percussion");
    const entry = createSoundEntry(project, track, "Sampled kit");
    const first = materializeLibraryEntry(entry).entry, second = materializeLibraryEntry(first).entry;
    expect(isDrumInstrument(first.sound.instrument)).toBe(true);
    expect(isDrumInstrument(second.sound.instrument)).toBe(true);
    expect(first.sound.instrument.kind).toBe("sample");
    expect(first.sound.instrument.zones).toEqual(entry.sound.instrument.zones);
    expect(first.sound.instrument.id).not.toBe(second.sound.instrument.id);
    expect(isDrumInstrument(instrumentFor(project, createTrack("glock")))).toBe(false);
  });
  it("remaps independent audio and sample references without changing timing, fades or original metadata", () => {
    const { project, track, clip } = phrase();
    const asset = { id: "original", name: "Take.wav", mime: "audio/wav", byteLength: 1000, duration: 3, sampleRate: 48000, channels: 1 };
    project.assets = [asset];
    clip.notes = []; clip.audio = { assetId: asset.id, offsetSec: 1.25, gain: .8, fadeInSec: .1, fadeOutSec: .3 };
    const entry = createPhraseEntry(project, track, clip, "Take");
    const copied = materializeLibraryEntry(entry);
    expect(copied.entry.visibleDurationSec).toBe(2);
    expect(copied.entry.clip!.audio).toEqual({ ...clip.audio, assetId: copied.assetIds.original });
    expect(copied.entry.assets[0]).toEqual({ ...asset, id: copied.assetIds.original });
    expect(remapEntry(entry, { original: "destination" }, false).clip!.id).toBe(entry.clip!.id);
    expect(entry.assets[0].id).toBe("original");
    expect(copied.entry.assets[0].id).not.toBe(materializeLibraryEntry(entry).entry.assets[0].id);
  });
});

describe("carried phrase controller compatibility", () => {
  it("reuses note-only melodic phrases across instruments without comparing unused controls", () => {
    const { project, track, clip } = phrase();
    track.modulation = { ...emptyPatch(), routes: [route("M1", "track.pan")] };
    const entry = createPhraseEntry(project, track, clip, "Notes");
    const destination = createTrack("piano");
    expect(phraseCompatibility(entry, destination, instrumentFor(project, destination))).toEqual({ ok: true, reasons: [] });
  });
  it("preserves intentionally unmapped carried events and rejects new channel or omni mappings", () => {
    const { project, track, clip } = phrase();
    clip.events = [{ tick: 0, type: "controlChange", channel: 2, cc: 74, value: .5 }];
    const entry = createPhraseEntry(project, track, clip, "Unmapped CC");
    const destination = structuredClone(track);
    destination.modulation = { ...emptyPatch(), routes: [route("cc:1:74", "track.pan")] };
    expect(phraseCompatibility(entry, destination, instrumentFor(project, destination)).ok).toBe(true);
    destination.modulation.routes = [route("cc:all:74", "track.pan")];
    expect(phraseCompatibility(entry, destination, instrumentFor(project, destination)).ok).toBe(false);
    expect(entry.clip!.events).toEqual(clip.events);
  });
  it("compares transitive dependencies while ignoring unrelated controllers", () => {
    const { project, track, clip } = phrase();
    clip.events = [{ tick: 0, type: "macro", macroId: "M1", value: .5 }];
    track.modulation = { ...emptyPatch(9), sources: [makeSource("lfo", "motion")], routes: [route("M1", "source:motion:amplitude", "a"), route("motion", "track.pan", "b"), route("M2", "track.low", "c")] };
    const entry = createPhraseEntry(project, track, clip, "Motion");
    const destination = structuredClone(track);
    destination.modulation!.routes[2].target = "track.high";
    expect(phraseCompatibility(entry, destination, instrumentFor(project, destination)).ok).toBe(true);
    destination.modulation!.sources[0].shape = "square";
    expect(phraseCompatibility(entry, destination, instrumentFor(project, destination)).ok).toBe(false);
  });
  it("compares incoming transitive routes, channel identity and instrument target capability", () => {
    const { project, track, clip } = phrase();
    clip.events = [{ tick: 0, type: "controlChange", cc: 74, channel: 2, value: .5 }];
    track.modulation = { ...emptyPatch(9), sources: [makeSource("lfo", "motion"), makeSource("random", "jitter")], routes: [route("cc:2:74", "source:motion:amplitude", "a"), route("motion", "voice.fmIndex", "b"), route("jitter", "source:motion:rate", "c")] };
    const entry = createPhraseEntry(project, track, clip, "Deep dependency");
    const destination = structuredClone(track);
    expect(phraseCompatibility(entry, destination, instrumentFor(project, destination)).ok).toBe(true);
    destination.modulation!.sources[1].steps[0] = .25;
    expect(phraseCompatibility(entry, destination, instrumentFor(project, destination)).ok).toBe(false);
    destination.modulation = structuredClone(track.modulation);
    destination.instrumentId = "piano";
    expect(phraseCompatibility(entry, destination, instrumentFor(project, destination)).ok).toBe(false);
    destination.instrumentId = "lead";
    destination.modulation!.routes[0].sourceId = "cc:3:74";
    expect(phraseCompatibility(entry, destination, instrumentFor(project, destination)).ok).toBe(false);
  });
  it("ignores unrelated outlets from upstream controls used by a carried-controller dependency", () => {
    const { project, track, clip } = phrase();
    clip.events = [{ tick: 0, type: "macro", macroId: "M1", value: .5 }];
    track.modulation = { ...emptyPatch(9), sources: [makeSource("lfo", "motion")], routes: [
      route("M1", "source:motion:rate", "carried"), route("motion", "track.pan", "output"),
      route("M2", "source:motion:amplitude", "dependency"), route("M2", "track.low", "unrelated"),
    ] };
    const entry = createPhraseEntry(project, track, clip, "Focused binding"), destination = structuredClone(track);
    destination.modulation!.routes[3].target = "track.high";
    expect(phraseCompatibility(entry, destination, instrumentFor(project, destination)).ok).toBe(true);
    destination.modulation!.routes[2].amount = .25;
    expect(phraseCompatibility(entry, destination, instrumentFor(project, destination)).ok).toBe(false);
  });
  it("compares authored macro defaults only when they feed a carried-controller dependency", () => {
    const { project, track, clip } = phrase();
    clip.events = [{ tick: 0, type: "macro", macroId: "M1", value: .5 }];
    track.modulation = { ...emptyPatch(9), sources: [makeSource("lfo", "motion"), makeSource("random", "jitter")], routes: [
      route("M1", "source:motion:rate", "carried"), route("motion", "track.pan", "output"),
      route("M2", "source:jitter:amplitude", "upstream"), route("jitter", "source:motion:amplitude", "dependency"),
    ] };
    const entry = createPhraseEntry(project, track, clip, "Upstream values"), destination = structuredClone(track);
    destination.modulation!.macros[1] = .7;
    expect(phraseCompatibility(entry, destination, instrumentFor(project, destination)).ok).toBe(false);
    destination.modulation!.macros[1] = 0;destination.modulation!.macros[2] = .9;destination.modulation!.macros[0] = .9;
    expect(phraseCompatibility(entry, destination, instrumentFor(project, destination)).ok).toBe(true);
    destination.modulation!.routes[3].enabled = false;
    expect(phraseCompatibility(entry, destination, instrumentFor(project, destination)).ok).toBe(false);
  });
  it("lets every carried controller own its values when another carried binding depends on it", () => {
    const { project, track, clip } = phrase();
    clip.events = [{ tick: 0, type: "macro", macroId: "M1", value: .5 }, { tick: 0, type: "macro", macroId: "M2", value: .7 }];
    track.modulation = { ...emptyPatch(), sources: [makeSource("lfo", "motion")], routes: [route("M1", "source:motion:rate", "rate"), route("M2", "source:motion:amplitude", "amount"), route("motion", "track.pan", "pan")] };
    const entry = createPhraseEntry(project, track, clip, "Two controllers"), destination = structuredClone(track);
    destination.modulation!.macros[1] = .9;
    expect(phraseCompatibility(entry, destination, instrumentFor(project, destination)).ok).toBe(true);
    destination.modulation!.routes[1].amount = .5;
    expect(phraseCompatibility(entry, destination, instrumentFor(project, destination)).ok).toBe(false);
  });
  it("rejects pitched/drum family changes and notes outside mapped sample ranges", () => {
    const { project, track, clip } = phrase();
    const entry = createPhraseEntry(project, track, clip, "Notes");
    const drums = createTrack("drums");
    expect(phraseCompatibility(entry, drums, instrumentFor(project, drums)).ok).toBe(false);
    const narrow = structuredClone(instrumentFor(project, createTrack("piano")));
    narrow.zones.forEach(zone => { zone.low = 70; zone.high = 90; });
    expect(phraseCompatibility(entry, track, narrow).ok).toBe(false);
  });
});

describe("explicit checked library placement", () => {
  it("populates an empty song through an explicit new-track action", () => {
    const { project, track, clip } = phrase();
    const sound = createSoundEntry(project, track, "Starter"), idea = createPhraseEntry(project, track, clip, "Starter idea");
    project.tracks = [];
    const destination = { trackId: "", sectionId: project.sections[0].id };
    const result = applyLibraryEntry(project, sound, destination, "insert");
    if (!result.ok) throw Error(result.error);
    expect(result.document.tracks).toHaveLength(1);
    expect(result.document.tracks[0].sound).toEqual(sound.sound.sound);
    const placed = applyLibraryEntry(project, idea, destination, "alternative");
    if (!placed.ok) throw Error(placed.error);
    expect(placed.document.tracks[0].clips).toHaveLength(1);
    expect(applyLibraryEntry(project, idea, destination, "insert")).toMatchObject({ ok: false, overlap: true });
    expect(applyLibraryEntry(project, sound, { ...destination, trackId: "deleted" }, "insert").ok).toBe(false);
  });
  it("inserts at section start with independent notes and refuses overlap", () => {
    const { project, track, clip } = phrase();
    const entry = createPhraseEntry(project, track, clip, "Idea");
    const destination = { trackId: track.id, sectionId: project.sections[0].id };
    project.sections[0].startTick = 7680;
    const inserted = applyLibraryEntry(project, entry, destination, "insert");
    if (!inserted.ok) throw Error(inserted.error);
    const placed = inserted.document.tracks[0].clips[1];
    expect(placed.startTick).toBe(7680);
    expect(placed.id).not.toBe(clip.id);
    expect(placed.notes[0].id).not.toBe(clip.notes[0].id);
    expect(applyLibraryEntry(inserted.document, entry, destination, "insert")).toMatchObject({ ok: false, overlap: true });
    expect(project.tracks[0].clips).toHaveLength(1);
  });
  it("replaces only the explicitly selected phrase and retains its position and duration", () => {
    const { project, track, clip } = phrase();
    const entry = createPhraseEntry(project, track, clip, "Idea");
    track.clips[0].lengthTick = 7680;
    const destination = { trackId: track.id, sectionId: project.sections[0].id };
    expect(applyLibraryEntry(project, entry, destination, "replace").ok).toBe(false);
    const result = applyLibraryEntry(project, entry, { ...destination, clipId: clip.id }, "replace");
    if (!result.ok) throw Error(result.error);
    expect(result.document.tracks[0].clips[0]).toMatchObject({ startTick: 3840, lengthTick: 7680 });
  });
  it("protects automated and recorded mapping identities and offers keep-current-modulation", () => {
    const { project, track, clip } = phrase();
    track.modulation = { ...emptyPatch(), routes: [route("M1", "track.pan")] };
    track.automation = [{ parameter: "M1", points: [{ tick: 0, value: .5 }] }];
    clip.events = [{ tick: 0, type: "macro", macroId: "M1", value: .5 }];
    track.volume = -8; track.pan = .3; track.mute = true;
    const incoming = createSoundEntry(project, track, "Change");
    incoming.sound.sound.cutoff = 1234;
    incoming.sound.modulation!.routes[0].target = "track.low";
    expect(soundConflicts(track, incoming.sound)[0]).toMatch(/M1/);
    const destination = { trackId: track.id, sectionId: project.sections[0].id };
    expect(applyLibraryEntry(project, incoming, destination, "replace")).toMatchObject({ ok: false, soundConflict: true });
    const result = applyLibraryEntry(project, incoming, destination, "keep-modulation");
    if (!result.ok) throw Error(result.error);
    const changed = result.document.tracks[0];
    expect(changed).toMatchObject({ id: track.id, volume: -8, pan: .3, mute: true });
    expect(changed.clips).toEqual(track.clips);
    expect(changed.automation).toEqual(track.automation);
    expect(changed.modulation).toEqual(track.modulation);
    expect(changed.sound.cutoff).toBe(1234);
    expect(result.document.master).toEqual(project.master);
  });
  it("protects the union of recorded and automated bindings without treating their authored defaults as identities", () => {
    const { project, track, clip } = phrase();
    clip.events = [{ tick: 0, type: "macro", macroId: "M1", value: .5 }];
    track.automation = [{ parameter: "M2", points: [{ tick: 0, value: .7 }] }];
    track.modulation = { ...emptyPatch(), sources: [makeSource("lfo", "motion")], routes: [route("M1", "source:motion:rate", "rate"), route("M2", "source:motion:amplitude", "amount"), route("motion", "track.pan", "pan")] };
    const entry = createSoundEntry(project, track, "Same bindings");
    entry.sound.modulation!.macros[1] = .9;
    expect(soundConflicts(track, entry.sound)).toEqual([]);
    entry.sound.modulation!.routes[1].amount = .5;
    expect(soundConflicts(track, entry.sound).some(reason => reason.includes("M1"))).toBe(true);
    expect(soundConflicts(track, entry.sound).some(reason => reason.includes("M2"))).toBe(true);
  });
  it("preserves unsupported route data on replacement and exact existing automation", () => {
    const { project, track } = phrase();
    track.modulation = { ...emptyPatch(), routes: [route("M1", "voice.fmIndex")] };
    track.automation = [{ parameter: "M1", points: [{ tick: 0, value: .5 }] }];
    const entry = createSoundEntry(project, track, "Sample patch");
    entry.sound.instrument = structuredClone(instrumentFor(project, createTrack("piano")));
    const destination = { trackId: track.id, sectionId: project.sections[0].id };
    const result = applyLibraryEntry(project, entry, destination, "replace");
    if (!result.ok) throw Error(result.error);
    expect(result.document.tracks[0].modulation!.routes).toEqual(track.modulation.routes);
    expect(result.document.tracks[0].automation).toEqual(track.automation);
    entry.sound.instrument = structuredClone(instrumentFor(project, track));
    entry.sound.sound.algorithm = "subtractive";
    const algorithm = applyLibraryEntry(project, entry, destination, "replace");
    if (!algorithm.ok) throw Error(algorithm.error);
    expect(algorithm.document.tracks[0].modulation!.routes).toEqual(track.modulation.routes);
  });
  it("converts audio visible seconds to destination ticks, inserts independently and retains Insert-only semantics", () => {
    const { project, track, clip } = phrase();
    project.assets = [{ id: "asset", name: "Take.wav", mime: "audio/wav", byteLength: 1000, duration: 8, sampleRate: 48000, channels: 1 }];
    clip.notes = []; clip.audio = { assetId: "asset", offsetSec: 1, gain: .7, fadeInSec: .1, fadeOutSec: .2 };
    const entry = materializeLibraryEntry(createPhraseEntry(project, track, clip, "Audio")).entry;
    project.tempo = 60;
    const destination = { trackId: track.id, sectionId: project.sections[0].id };
    expect(applyLibraryEntry(project, entry, destination, "replace").ok).toBe(false);
    expect(applyLibraryEntry(project, entry, destination, "insert")).toMatchObject({ ok: false, overlap: true });
    const result = applyLibraryEntry(project, entry, destination, "alternative");
    if (!result.ok) throw Error(result.error);
    const audio = result.document.tracks.at(-1)!;
    expect(audio.kind).toBe("audio");
    expect(audio.clips[0].lengthTick).toBe(1920);
    expect(audio.clips[0].audio).toEqual(entry.clip!.audio);
    expect(result.document.assets).toContainEqual(entry.assets[0]);
    const again = applyLibraryEntry(result.document, entry, { ...destination, trackId: audio.id }, "insert");
    expect(again).toMatchObject({ ok: false, overlap: true });
  });
  it("retains proposals and original projects on deleted destinations and project limits", () => {
    const { project, track, clip } = phrase();
    const entry = createPhraseEntry(project, track, clip, "Keep");
    const before = structuredClone(project), source = structuredClone(entry);
    expect(applyLibraryEntry(project, entry, { trackId: "deleted", sectionId: project.sections[0].id }, "insert").ok).toBe(false);
    expect(applyLibraryEntry(project, entry, { trackId: track.id, sectionId: "deleted" }, "insert").ok).toBe(false);
    project.tracks.push(...Array.from({ length: 63 }, () => createTrack("lead")));
    expect(applyLibraryEntry(project, entry, { trackId: track.id, sectionId: project.sections[0].id }, "alternative").ok).toBe(false);
    expect(project.tracks[0]).toEqual(before.tracks[0]);
    expect(entry).toEqual(source);
  });
  it("rejects malformed entry shapes and missing or undeclared blobs before placement", () => {
    const { project, track, clip } = phrase();
    const entry = createPhraseEntry(project, track, clip, "Keep");
    expect(libraryEntrySchema.safeParse({ ...entry, version: 2 }).success).toBe(false);
    expect(libraryEntrySchema.safeParse({ ...entry, extra: true }).success).toBe(false);
    expect(libraryEntrySchema.safeParse({ ...entry, kind: "audio" }).success).toBe(false);
    entry.sound.instrument.zones = [{ assetId: "missing", root: 60, low: 0, high: 127, velocityLow: 0, velocityHigh: 1, roundRobin: 0, articulation: "sustain" }];
    expect(libraryEntrySchema.safeParse(entry).success).toBe(false);
    expect(applyLibraryEntry(project, entry, { trackId: track.id, sectionId: project.sections[0].id }, "insert").ok).toBe(false);
  });
});
