import { sampleProvenanceSchema, type SampleProvenance } from "./sample-provenance";
import { z } from "zod";
import { instrumentFor, isDrumInstrument } from "../audio/catalog";
import type { ModulationPatch } from "./modulation-types";
import { modulationTargetReason } from "./automation-bindings";
import { chordMovementSchema, modulationSchema } from "./modulation-schema";
import { createTrack, secondsToTick, tickToSeconds } from "./project";
import { assetSchema, clipSchema, idSchema, instrumentSchema, projectSchema, soundSchema } from "./schema";
import { uid, type AssetReference, type Clip, type InstrumentManifest, type PerformanceEvent, type ProjectDocument, type Track } from "./types";

export interface SavedSound {
  instrument: InstrumentManifest;
  sound: Track["sound"];
  modulation?: Track["modulation"];
  chordMovement?: Track["chordMovement"];
  low: number; mid: number; high: number; drive: number; reverb: number; delay: number;
}
export interface LibraryEntry {
  refinement?: { originalAssetId: string; provenance: SampleProvenance };
  version: 1;
  id: string;
  name: string;
  kind: "sound" | "phrase" | "audio";
  createdAt: string;
  sound: SavedSound;
  clip?: Clip;
  visibleDurationSec?: number;
  assets: AssetReference[];
}
const unit = z.number().finite().min(0).max(1);
export const savedSoundSchema: z.ZodType<SavedSound> = z.object({
  instrument: instrumentSchema, sound: soundSchema,
  modulation: modulationSchema.optional(), chordMovement: chordMovementSchema.optional(),
  low: z.number().min(-18).max(18), mid: z.number().min(-18).max(18), high: z.number().min(-18).max(18),
  drive: unit, reverb: unit, delay: unit,
}).strict();
export const libraryEntrySchema: z.ZodType<LibraryEntry> = z.object({
  refinement: z.object({ originalAssetId: idSchema, provenance: sampleProvenanceSchema }).strict().optional(),
  version: z.literal(1), id: idSchema, name: z.string().trim().min(1).max(120),
  kind: z.enum(["sound", "phrase", "audio"]), createdAt: z.string().datetime(),
  sound: savedSoundSchema, clip: clipSchema.optional(),
  visibleDurationSec: z.number().finite().positive().max(86400).optional(),
  assets: z.array(assetSchema).max(1000),
}).strict().superRefine((entry, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (entry.kind === "sound" && (entry.clip || entry.visibleDurationSec !== undefined)) issue("A saved sound cannot contain a phrase.");
  if (entry.kind !== "sound" && !entry.clip) issue("A saved phrase needs a clip.");
  if (entry.kind === "phrase" && (entry.clip?.audio || entry.visibleDurationSec !== undefined)) issue("MIDI phrases cannot contain audio timing.");
  if (entry.kind === "audio" && (!entry.clip?.audio || !entry.visibleDurationSec)) issue("Audio phrases need audio and a saved visible duration in seconds.");
  if (entry.clip?.audio && (entry.clip.notes.length || entry.clip.events.length)) issue("An audio phrase cannot contain MIDI performance data.");
  const ids = new Set(entry.assets.map(asset => asset.id));
  if (ids.size !== entry.assets.length) issue("Duplicate library asset identifiers.");
  if (entry.clip && new Set(entry.clip.notes.map(note => note.id)).size !== entry.clip.notes.length) issue("Duplicate library note identifiers.");
  const referenced = new Set(entry.sound.instrument.zones.flatMap(zone => zone.assetId ? [zone.assetId] : []));
  if (entry.clip?.audio) referenced.add(entry.clip.audio.assetId);
  if (entry.refinement) {
    referenced.add(entry.refinement.originalAssetId);
    if (entry.kind === "phrase") issue("Sample refinement cannot describe a MIDI phrase.");
    if (entry.kind === "sound" && entry.refinement.provenance.status !== "approved") issue("A sampled instrument requires explicit review.");
    if (entry.clip?.audio?.assetId === entry.refinement.originalAssetId || entry.sound.instrument.zones.some(zone => zone.assetId === entry.refinement?.originalAssetId)) issue("Retained original audio must remain separate from the reusable output.");
    const outputs = entry.assets.filter(asset => asset.id !== entry.refinement!.originalAssetId);
    if (outputs.length !== 1 || JSON.stringify(outputs[0].provenance) !== JSON.stringify(entry.refinement.provenance)) issue("Sample provenance must match its output asset.");
  }
  if ([...referenced].some(id => !ids.has(id))) issue("A library entry refers to an undeclared asset.");
  if ([...ids].some(id => !referenced.has(id))) issue("A library asset is not used by its entry.");
});

function captureSound(project: ProjectDocument, track: Track): SavedSound {
  return structuredClone({ instrument: instrumentFor(project, track), sound: track.sound,
    ...(track.modulation ? { modulation: track.modulation } : {}),
    ...(track.chordMovement ? { chordMovement: track.chordMovement } : {}),
    low: track.low, mid: track.mid, high: track.high, drive: track.drive, reverb: track.reverb, delay: track.delay });
}
function captureAssets(project: ProjectDocument, sound: SavedSound, clip?: Clip): AssetReference[] {
  const ids = new Set(sound.instrument.zones.flatMap(zone => zone.assetId ? [zone.assetId] : []));
  if (clip?.audio) ids.add(clip.audio.assetId);
  return [...ids].map(id => {
    const asset = project.assets.find(asset => asset.id === id);
    if (!asset) throw Error(`Missing source asset ${id}.`);
    return structuredClone(asset);
  });
}
export function createSoundEntry(project: ProjectDocument, track: Track, name: string, id = uid()): LibraryEntry {
  const sound = captureSound(project, track);
  return libraryEntrySchema.parse({ version: 1, id, name: name.trim(), kind: "sound", createdAt: new Date().toISOString(), sound, assets: captureAssets(project, sound) });
}
export function createPhraseEntry(project: ProjectDocument, track: Track, clip: Clip, name: string, id = uid()): LibraryEntry {
  const sound = captureSound(project, track), snapshot = { ...structuredClone(clip), startTick: 0 };
  return libraryEntrySchema.parse({ version: 1, id, name: name.trim(), kind: clip.audio ? "audio" : "phrase", createdAt: new Date().toISOString(), sound, clip: snapshot,
    ...(clip.audio ? { visibleDurationSec: tickToSeconds(clip.lengthTick, project.tempo) } : {}), assets: captureAssets(project, sound, clip) });
}
/** Asset copying is external; preserve the provided destination IDs at commit. */
export function remapEntry(entry: LibraryEntry, assetMap: Record<string, string>, freshIdentity = true): LibraryEntry {
  const next = structuredClone(libraryEntrySchema.parse(entry));
  const remap = (id: string) => assetMap[id] ?? id;
  next.assets.forEach(asset => { asset.id = remap(asset.id); });
  if (next.refinement) next.refinement.originalAssetId = remap(next.refinement.originalAssetId);
  next.sound.instrument.zones.forEach(zone => { if (zone.assetId) zone.assetId = remap(zone.assetId); });
  if (next.clip?.audio) next.clip.audio.assetId = remap(next.clip.audio.assetId);
  if (freshIdentity) {
    next.id = uid(); next.sound.instrument.id = next.sound.instrument.id === "percussion" || next.sound.instrument.id.startsWith("percussion_") ? `percussion_${uid()}` : uid();
    if (next.clip) { next.clip.id = uid(); next.clip.notes.forEach(note => { note.id = uid(); }); }
  }
  return libraryEntrySchema.parse(next);
}
export function materializeLibraryEntry(entry: LibraryEntry): { entry: LibraryEntry; assetIds: Record<string, string> } {
  const assetIds = Object.fromEntries(entry.assets.map(asset => [asset.id, uid()]));
  return { entry: remapEntry(entry, assetIds), assetIds };
}

function controlRoots(event: PerformanceEvent): string[] {
  if (event.type === "macro") return event.macroId ? [event.macroId] : [];
  if (event.type === "controlChange") return [`cc:${event.channel}:${event.cc}`, `cc:all:${event.cc}`];
  return ["sustain", "pitchBend", "modulation", "expression", "pressure"].includes(event.type) ? [event.type] : [];
}
/** Capture only carried roots, their downstream routes and every input to a reached source. */
function bindingSignature(patch: ModulationPatch | undefined, roots: string[], instrument: InstrumentManifest, track: Pick<Track, "sound">, carriedRoots = roots): string {
  const forward = new Set(roots), carried = new Set(carriedRoots), sources = new Set<string>(), macroInputs = new Set<string>(), routes = new Set<ModulationPatch["routes"][number]>();
  let changed = true;
  // Only a carried control or a source it changes makes all of its outlets relevant.
  while (changed) {
    changed = false;
    for (const route of patch?.routes ?? []) {
      if (!forward.has(route.sourceId)) continue;
      routes.add(route);
      const destination = /^source:([^:]+):(rate|amplitude)$/.exec(route.target)?.[1];
      if (destination && !forward.has(destination)) { forward.add(destination); sources.add(destination); changed = true; }
    }
  }
  // Include upstream inputs to those sources without following their unrelated outlets.
  changed = true;
  while (changed) {
    changed = false;
    for (const route of patch?.routes ?? []) {
      const destination = /^source:([^:]+):(rate|amplitude)$/.exec(route.target)?.[1];
      if (!destination || !sources.has(destination)) continue;
      routes.add(route);
      if (patch?.sources.some(source => source.id === route.sourceId) && !sources.has(route.sourceId)) { sources.add(route.sourceId); changed = true; }
      if (/^M[1-4]$/.test(route.sourceId) && !carried.has(route.sourceId)) macroInputs.add(route.sourceId);
    }
  }
  const mapped = [...routes].map(route => ({ sourceId: route.sourceId, target: route.target, amount: route.amount,
    curve: route.curve, slew: route.slew, enabled: route.enabled, support: modulationTargetReason({ kind: "instrument", sound: track.sound, modulation: patch }, instrument, route.target, patch) })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const dependencies = (patch?.sources ?? []).filter(source => sources.has(source.id)).map(source => ({ ...source, name: undefined })).sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({ roots: [...roots].sort(), enabled: routes.size ? patch?.enabled : undefined,
    routes: mapped, sources: dependencies, macroInputs: [...macroInputs].sort().map(id => [id, patch?.macros[Number(id[1]) - 1]]), seed: dependencies.length ? patch?.seed : undefined,
    reference: dependencies.some(source => source.kind === "reference") ? patch?.reference : undefined });
}
function carriedEvents(clip: Clip): PerformanceEvent[] {
  return [...new Map(clip.events.filter(event => controlRoots(event).length).map(event => [controlRoots(event).join("/"), event])).values()];
}
export function phraseCompatibility(entry: LibraryEntry, destinationTrack: Track, destinationInstrument: InstrumentManifest): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (entry.kind !== "phrase" || !entry.clip || entry.clip.audio || destinationTrack.kind !== "instrument") return { ok: false, reasons: ["Choose an instrumental phrase and destination."] };
  if (isDrumInstrument(entry.sound.instrument) !== isDrumInstrument(destinationInstrument)) reasons.push("Drum and pitched phrases need matching instrument families.");
  const notes = entry.clip.notes;
  if (destinationInstrument.kind === "sample" && !isDrumInstrument(destinationInstrument) && notes.some(note => !destinationInstrument.zones.some(zone => note.pitch + entry.clip!.transpose >= zone.low && note.pitch + entry.clip!.transpose <= zone.high && note.velocity >= zone.velocityLow && note.velocity <= zone.velocityHigh && (!note.articulation || zone.articulation === note.articulation)))) reasons.push("The destination has no sample mapping for one or more phrase notes or articulations.");
  const events = carriedEvents(entry.clip), carriedRoots = events.flatMap(controlRoots);
  for (const event of events) {
    const roots = controlRoots(event);
    if (bindingSignature(entry.sound.modulation, roots, entry.sound.instrument, entry.sound, carriedRoots) !== bindingSignature(destinationTrack.modulation, roots, destinationInstrument, destinationTrack, carriedRoots)) reasons.push(`${roots.join(" / ")}: controller bindings or their dependencies differ.`);
  }
  return { ok: !reasons.length, reasons };
}
export function soundConflicts(existingTrack: Track, sound: SavedSound): string[] {
  const roots = new Map<string, string[]>();
  for (const clip of existingTrack.clips) for (const event of carriedEvents(clip)) roots.set(controlRoots(event).join(" / "), controlRoots(event));
  for (const lane of existingTrack.automation) if (lane.points.length && /^(M[1-4]|expression|modulation|pitchBend)$/.test(lane.parameter)) roots.set(lane.parameter, [lane.parameter]);
  const carriedRoots = [...roots.values()].flat();
  // Native controls have stable meanings; use incoming capabilities on both sides so
  // unavailable old targets remain inactive data rather than being silently rebound.
  return [...roots].flatMap(([label, ids]) => bindingSignature(existingTrack.modulation, ids, sound.instrument, sound, carriedRoots) !== bindingSignature(sound.modulation, ids, sound.instrument, sound, carriedRoots)
    ? [`${label}: replacing this sound would change recorded or automated controller bindings.`] : []);
}

export interface LibraryDestination { trackId: string; sectionId: string; clipId?: string }
export type LibraryAction = "insert" | "replace" | "alternative" | "keep-modulation";
export type LibraryPlacementResult = { ok: true; document: ProjectDocument; trackId: string; clipId?: string } |
  { ok: false; error: string; reasons?: string[]; overlap?: boolean; soundConflict?: boolean };
export function applyLibraryEntry(project: ProjectDocument, entry: LibraryEntry, destination: LibraryDestination, action: LibraryAction): LibraryPlacementResult {
  const valid = libraryEntrySchema.safeParse(entry);
  if (!valid.success) return { ok: false, error: "This library entry is invalid. Existing music is preserved.", reasons: valid.error.issues.map(issue => issue.message) };
  const existing = project.tracks.find(track => track.id === destination.trackId), section = project.sections.find(section => section.id === destination.sectionId);
  const createsTrack = action === "alternative" || valid.data.kind === "sound" && action === "insert";
  if (!section || !existing && (destination.trackId || !createsTrack)) return { ok: false, error: "Choose an existing destination track and section, or insert on a new track.", ...(!destination.trackId && valid.data.kind !== "sound" ? { overlap: true } : {}) };
  const next = remapEntry(valid.data, {}), document = structuredClone(project), sound = next.sound;
  let track = existing ? document.tracks.find(track => track.id === existing.id)! : createTrack();
  const audioOnlyRefinement = next.kind === "audio" && next.assets.some(asset => asset.provenance);
  const newTrack = (kind: Track["kind"]) => {
    // An audio texture must not create a pretend synthesizer in the Sounds browser.
    const fresh = createTrack(audioOnlyRefinement ? "piano" : sound.instrument.id, next.name, existing?.color ?? track.color, kind);
    Object.assign(fresh, { sound: sound.sound, modulation: sound.modulation, chordMovement: sound.chordMovement,
      low: sound.low, mid: sound.mid, high: sound.high, drive: sound.drive, reverb: sound.reverb, delay: sound.delay });
    document.tracks.push(fresh); return fresh;
  };
  let usesSound = false;
  if (next.kind === "sound") {
    if (action === "insert" || action === "alternative") track = newTrack("instrument");
    else {
      if (track.kind !== "instrument") return { ok: false, error: "Choose an instrument track to replace its sound." };
      const conflicts = soundConflicts(existing!, sound);
      if (conflicts.length && action !== "keep-modulation") return { ok: false, error: "This sound changes existing performance bindings. Keep current modulation or insert the complete sound on a new track.", reasons: conflicts, soundConflict: true };
      Object.assign(track, { instrumentId: sound.instrument.id, sound: sound.sound, low: sound.low, mid: sound.mid, high: sound.high, drive: sound.drive, reverb: sound.reverb, delay: sound.delay });
      if (action !== "keep-modulation") Object.assign(track, { modulation: sound.modulation, chordMovement: sound.chordMovement });
    }
    usesSound = true;
  } else {
    if (action === "keep-modulation" || next.kind === "audio" && action === "replace") return { ok: false, error: "Audio phrases are Insert-only; select an explicit MIDI or drum phrase for Replace." };
    const clip = next.clip!, target = action === "replace" ? track.clips.find(clip => clip.id === destination.clipId && !clip.audio) : undefined;
    if (action === "replace" && !target) return { ok: false, error: "Select the exact instrumental phrase to replace." };
    clip.startTick = target?.startTick ?? section.startTick;
    clip.lengthTick = target?.lengthTick ?? (next.kind === "audio" ? Math.max(1, secondsToTick(next.visibleDurationSec!, document.tempo)) : clip.lengthTick);
    if (next.kind === "audio") clip.sourceLengthTick = Math.max(1, secondsToTick(next.visibleDurationSec!, document.tempo));
    if (action === "alternative") { track = newTrack(next.kind === "audio" ? "audio" : "instrument"); usesSound = !audioOnlyRefinement; }
    else if (next.kind === "audio" && track.kind !== "audio") return { ok: false, error: "Choose an audio track or insert this phrase on a new audio track.", overlap: true };
    else if (next.kind === "phrase") {
      const compatibility = phraseCompatibility(next, track, instrumentFor(document, track));
      if (!compatibility.ok) return { ok: false, error: "This phrase is incompatible with the selected instrument. Its events are preserved.", reasons: compatibility.reasons };
    }
    if (track.clips.some(other => other.id !== target?.id && other.startTick < clip.startTick + clip.lengthTick && other.startTick + other.lengthTick > clip.startTick)) return { ok: false, error: "This phrase overlaps existing material. Insert on a new track or explicitly select a phrase to replace.", overlap: true };
    track.clips = [...track.clips.filter(other => other.id !== target?.id), clip];
  }
  if (usesSound) document.userInstruments.push(sound.instrument);
  const usedAssets = new Set([...(usesSound ? sound.instrument.zones.flatMap(zone => zone.assetId ? [zone.assetId] : []) : []), ...(next.clip?.audio ? [next.clip.audio.assetId] : [])]);
  for (const asset of next.assets.filter(asset => usedAssets.has(asset.id))) {
    const prior = document.assets.find(previous => previous.id === asset.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(asset)) return { ok: false, error: "A destination asset identity conflicts with existing material." };
    if (!prior) document.assets.push(asset);
  }
  const checked = projectSchema.safeParse(document);
  if (!checked.success) return { ok: false, error: "This insertion exceeds project limits or has invalid references. Existing music is preserved.", reasons: checked.error.issues.map(issue => issue.message) };
  return { ok: true, document: checked.data, trackId: track.id, ...(next.clip ? { clipId: next.clip.id } : {}) };
}
