import { encodeWav } from "../audio/wav";
import { sampleMetrics, type PCM } from "../audio/sample-refinement";
import { DEFAULT_SOUND, emptyClip, secondsToTick } from "./project";
import { libraryEntrySchema, type LibraryEntry } from "./reusable-library";
import { sampleProvenanceSchema, type SampleProvenance } from "./sample-provenance";
import { uid, type AssetReference, type InstrumentManifest } from "./types";

export function createRefinedSampleEntry(options: { name: string; output: PCM; original: PCM; provenance: SampleProvenance; kind: "audio" | "sound"; root?: number }): { entry: LibraryEntry; blobs: Map<string, Blob> } {
  const provenance = sampleProvenanceSchema.parse(options.provenance), name = options.name.trim();
  if (!name || name.length > 120) throw Error("Choose a sample name of 1 to 120 characters.");
  if (sampleMetrics(options.output).silent) throw Error("A silent extraction cannot be saved as a reusable sound.");
  if (options.kind === "sound" && (provenance.status !== "approved" || !Number.isInteger(options.root) || options.root! < 0 || options.root! > 127))
    throw Error("Review a single isolated note or hit and choose its MIDI root before making an instrument.");
  if (Math.abs(options.original.channels[0].length / options.original.sampleRate - (provenance.contextRange.endSec - provenance.contextRange.startSec)) > .002
    || Math.abs(options.output.channels[0].length / options.output.sampleRate - (provenance.sourceRange.endSec - provenance.sourceRange.startSec)) > .002)
    throw Error("Sample provenance does not match the retained audio boundaries.");
  const blobs = new Map<string, Blob>();
  function asset(pcm: PCM, filename: string, recipe?: SampleProvenance): AssetReference {
    const id = uid(), blob = new Blob([encodeWav(pcm.channels, pcm.sampleRate)], { type: "audio/wav" }); blobs.set(id, blob);
    return { id, name: filename.slice(0, 200), mime: "audio/wav", byteLength: blob.size, duration: pcm.channels[0].length / pcm.sampleRate, sampleRate: pcm.sampleRate, channels: pcm.channels.length, ...(recipe ? { provenance: recipe } : {}) };
  }
  // Preserve the auditioned samples: do not apply a second edge fade at save time.
  const peakGain = Math.min(1, .98 / Math.max(1e-9, sampleMetrics(options.output).peak));
  const protectedOutput = { sampleRate: options.output.sampleRate, channels: options.output.channels.map(channel => Float32Array.from(channel, value => value * peakGain)) };
  const output = asset(protectedOutput, name + ".wav", provenance);
  const original = asset(options.original, "Original excerpt - " + provenance.sourceName + ".wav");
  const root = options.root ?? 60;
  const instrument: InstrumentManifest = {
    id: uid(), name, family: options.kind === "sound" ? "Sampled instrument" : provenance.status === "mixed-texture" ? "Mixed texture" : "Extracted audio",
    description: `${provenance.method} · ${provenance.target} · ${provenance.status}. ${options.kind === "sound" ? "One manually mapped sample, not a synthesized recreation." : "Audio phrase; no note transcription."}`,
    kind: options.kind === "sound" ? "sample" : "synth",
    zones: options.kind === "sound" ? [{ assetId: output.id, root, low: Math.max(0, root - 7), high: Math.min(127, root + 7), velocityLow: 0, velocityHigh: 1, roundRobin: 0, articulation: "sustain" }] : [],
    articulations: ["sustain"], license: "User supplied; original rights still apply", source: provenance.sourceName,
    defaults: {},
  };
  const duration = output.duration, clip = emptyClip(0, Math.max(1, secondsToTick(duration, 120)), name);
  clip.audio = { assetId: output.id, offsetSec: 0, gain: 1, fadeInSec: 0, fadeOutSec: 0 };
  const entry = libraryEntrySchema.parse({ version: 1, id: uid(), name, kind: options.kind, createdAt: new Date().toISOString(),
    sound: { instrument, sound: { ...DEFAULT_SOUND, detune: 0, attack: .001, decay: .001, sustain: 1, release: .01, cutoff: 20000, resonance: 0, filterEnvelope: 0, lfoDepth: 0 }, low: 0, mid: 0, high: 0, drive: 0, reverb: 0, delay: 0 },
    ...(options.kind === "audio" ? { clip, visibleDurationSec: duration } : {}), assets: [output, original], refinement: { originalAssetId: original.id, provenance } });
  return { entry, blobs };
}
export function entrySampleProvenance(entry: LibraryEntry): SampleProvenance | undefined {
  return entry.refinement?.provenance ?? entry.assets.find(asset => asset.provenance)?.provenance;
}
