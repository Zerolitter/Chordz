import { describe, expect, it } from "vitest";
import { comparisonGains, contextFor, qualityWarnings, refineSample, residualSample, sampleMetrics, SimilarityAnalyzer, slicePCM, validatePCM, validateSampleRange, type PCM } from "../lib/audio/sample-refinement";
import { createRefinedSampleEntry } from "../lib/music/refined-sample";
import { sampleProvenanceSchema, type SampleProvenance } from "../lib/music/sample-provenance";
import { applyLibraryEntry, libraryEntrySchema, materializeLibraryEntry } from "../lib/music/reusable-library";
import { createProject } from "../lib/music/project";
import { projectSchema } from "../lib/music/schema";

const rate = 12000;
function tone(seconds = 1, stereo = true): PCM {
  const left = Float32Array.from({ length: rate * seconds }, (_, i) => .4 * Math.sin(2 * Math.PI * 440 * i / rate));
  return { sampleRate: rate, channels: stereo ? [left, Float32Array.from(left, value => -value * .5)] : [left] };
}
function provenance(change: Partial<SampleProvenance> = {}): SampleProvenance {
  return { version: 1, sourceName: "private-source.wav", sourceFingerprint: "a".repeat(64), sourceRange: { startSec: 0, endSec: 1 }, contextRange: { startSec: 0, endSec: 1 }, method: "separated", target: "piano", model: "htdemucs_6s", algorithm: "chordz-refine-1", reductionDb: 0, status: "approved", warnings: [], ...change };
}

describe("bounded stereo refinement", () => {
  it("rejects invalid ranges, oversized buffers, channel mismatches and non-finite samples", () => {
    for (const range of [{ startSec: NaN, endSec: 1 }, { startSec: -.1, endSec: 1 }, { startSec: 0, endSec: 21 }, { startSec: 1, endSec: 1 }, { startSec: 0, endSec: 4 }]) expect(() => validateSampleRange(range, 3)).toThrow();
    expect(() => validatePCM({ sampleRate: 48000, channels: [] })).toThrow();
    expect(() => validatePCM({ sampleRate: 12000, channels: [new Float32Array(300001)] })).toThrow();
    expect(() => validatePCM({ sampleRate: rate, channels: [new Float32Array(2), new Float32Array(3)] })).toThrow();
    const invalid = tone(); invalid.channels[0][30] = NaN; expect(() => refineSample(invalid, 3)).toThrow(/invalid audio/);
    expect(() => refineSample(tone(), 7)).toThrow();
  });
  it("retains context without exceeding the source or the 24-second work bound", () => {
    expect(contextFor({ startSec: .1, endSec: 2 }, 3)).toEqual({ startSec: 0, endSec: 3 });
    expect(contextFor({ startSec: 15, endSec: 35 }, 60)).toEqual({ startSec: 13, endSec: 37 });
    expect(slicePCM(tone(3), { startSec: .5, endSec: 1.5 }).channels[0].length).toBe(rate);
  });
  it("does not mutate, brighten, amplify or collapse antiphase stereo", () => {
    const source = tone(), before = source.channels.map(channel => channel.slice()), out = refineSample(source, 6);
    expect(source.channels).toEqual(before); expect(out.channels).toHaveLength(2);
    for (let i = 0; i < rate; i++) {
      expect(Math.abs(out.channels[0][i])).toBeLessThanOrEqual(Math.abs(before[0][i]) + 1e-7);
      expect(out.channels[1][i]).toBeCloseTo(-out.channels[0][i] * .5, 7);
    }
    expect(out.channels[0][0]).toBe(0); expect(Math.abs(out.channels[0].at(-1)!)).toBe(0);
    expect(sampleMetrics(out).rms).toBeGreaterThan(.15);
  });
  it("keeps an attack while limiting attenuation to six dB away from edge fades", () => {
    const source = tone(2), out = refineSample(source, 6);
    for (let i = 100; i < rate * 2 - 100; i += 13) if (Math.abs(source.channels[0][i]) > .001)
      expect(Math.abs(out.channels[0][i] / source.channels[0][i])).toBeGreaterThanOrEqual(.5);
  });
  it("protects both channels with one gain and does not silently bless silent output", () => {
    const source = tone(); source.channels.forEach(channel => { for (let i = 0; i < channel.length; i++) channel[i] *= 5; });
    expect(sampleMetrics(refineSample(source, 0)).peak).toBeLessThanOrEqual(.980001);
    const silence = { sampleRate: rate, channels: [new Float32Array(rate), new Float32Array(rate)] };
    expect(qualityWarnings(source, silence).some(value => value.includes("silent"))).toBe(true);
    expect(qualityWarnings(source, refineSample(source, 0)).some(value => value.includes("cannot certify"))).toBe(true);
  });
  it("constructs a same-length residual and rejects changed channel layouts or offsets", () => {
    const source = tone(), isolated = { sampleRate: rate, channels: source.channels.map(channel => Float32Array.from(channel, value => value * .6)) };
    const residual = residualSample(source, isolated);
    for (let i = 0; i < rate; i += 127) expect(residual.channels[0][i] + isolated.channels[0][i]).toBeCloseTo(source.channels[0][i], 6);
    expect(() => residualSample(source, tone(1, false))).toThrow(/aligned/);
    expect(() => residualSample(source, tone(2))).toThrow(/aligned/);
  });
  it("level-matches audible comparisons without clipping or amplifying silence", () => {
    const a = tone(), b = { sampleRate: rate, channels: a.channels.map(channel => Float32Array.from(channel, v => v * .3)) };
    const gains = comparisonGains([a, b]);
    expect(sampleMetrics(a).rms * gains[0]).toBeCloseTo(sampleMetrics(b).rms * gains[1], 6);
    expect(sampleMetrics(a).peak * gains[0]).toBeLessThanOrEqual(.8);
    expect(comparisonGains([{ sampleRate: rate, channels: [new Float32Array(rate)] }])).toEqual([1]);
  });
});

describe("similar-moment search", () => {
  function fixture() {
    const pcm = tone(9); pcm.channels.forEach(channel => channel.fill(0));
    const note = tone(1);
    for (const offset of [rate, rate * 5]) for (let c = 0; c < 2; c++) pcm.channels[c].set(note.channels[c], offset);
    return pcm;
  }
  it("finds a repeated antiphase-stereo occurrence without including the original or overlapping alternatives", () => {
    const pcm = fixture(), analyzer = new SimilarityAnalyzer(rate, 2, pcm.channels[0].length);
    for (let i = 0; i < pcm.channels[0].length; i += 17001) analyzer.push(pcm.channels.map(channel => channel.slice(i, i + 17001)));
    const matches = analyzer.finish({ startSec: 1, endSec: 2 });
    expect(matches.some(match => Math.abs(match.startSec - 5) <= .2)).toBe(true); expect(matches.length).toBeLessThanOrEqual(5);
    expect(matches.every(match => match.endSec <= .9 || match.startSec >= 2.1)).toBe(true);
    for (const match of matches) expect(match.similarity).toBeGreaterThanOrEqual(.88);
  });
  it("returns no matches for silence and rejects incomplete streams and too-short patterns", () => {
    const silent = new SimilarityAnalyzer(rate, 1, rate); silent.push([new Float32Array(rate)]); expect(silent.finish({ startSec: 0, endSec: .5 })).toEqual([]);
    expect(() => new SimilarityAnalyzer(rate, 1, rate).finish({ startSec: 0, endSec: .5 })).toThrow(/incomplete/);
    const analyzer = new SimilarityAnalyzer(rate, 1, rate); analyzer.push([new Float32Array(rate)]); expect(() => analyzer.finish({ startSec: 0, endSec: .1 })).toThrow(/0.3/);
  });
});

describe("honest, independent library assets", () => {
  it("rejects clean approvals for trimmed mixtures, other instruments and forged context", () => {
    expect(sampleProvenanceSchema.safeParse(provenance({ method: "trimmed" })).success).toBe(false);
    expect(sampleProvenanceSchema.safeParse(provenance({ target: "other" })).success).toBe(false);
    expect(sampleProvenanceSchema.safeParse(provenance({ contextRange: { startSec: .5, endSec: 1 } })).success).toBe(false);
    expect(sampleProvenanceSchema.safeParse(provenance({ sourceFingerprint: "not-a-fingerprint" })).success).toBe(false);
  });
  it("requires explicit review and a valid root for sampled instruments, rejecting silence", () => {
    const base = { name: "Note", output: tone(), original: tone(), provenance: provenance(), kind: "sound" as const };
    expect(() => createRefinedSampleEntry(base)).toThrow(/root/);
    expect(() => createRefinedSampleEntry({ ...base, root: 60, provenance: provenance({ status: "needs-review" }) })).toThrow(/Review/);
    expect(() => createRefinedSampleEntry({ ...base, root: 128 })).toThrow();
    expect(() => createRefinedSampleEntry({ ...base, root: 60, output: { sampleRate: rate, channels: [new Float32Array(rate)] } })).toThrow(/silent/);
  });
  it("retains a separate original and exact processing recipe, remapping both identities", () => {
    const { entry, blobs } = createRefinedSampleEntry({ name: "My phrase", output: refineSample(tone(), 3), original: tone(), provenance: provenance(), kind: "audio" });
    expect(entry.assets).toHaveLength(2); expect(blobs.size).toBe(2); expect(entry.clip?.audio?.assetId).not.toBe(entry.refinement?.originalAssetId);
    const remapped = materializeLibraryEntry(entry).entry;
    expect(remapped.refinement?.originalAssetId).not.toBe(entry.refinement?.originalAssetId);
    expect(remapped.assets.some(asset => asset.id === remapped.refinement?.originalAssetId)).toBe(true);
    expect(libraryEntrySchema.safeParse(remapped).success).toBe(true);
    expect(entry.assets.find(asset => asset.id === entry.clip?.audio?.assetId)?.provenance).toEqual(provenance());
  });
  it("does not fade an already auditioned result again when saving", async () => {
    const output = refineSample(tone(), 3), { entry, blobs } = createRefinedSampleEntry({ name: "Edge", output, original: tone(), provenance: provenance(), kind: "audio" });
    const bytes = new DataView(await blobs.get(entry.clip!.audio!.assetId)!.arrayBuffer());
    const frame = 4, offset = 44 + frame * 2 * 3;
    let integer = bytes.getUint8(offset) | bytes.getUint8(offset + 1) << 8 | bytes.getUint8(offset + 2) << 16;
    if (integer & 0x800000) integer -= 0x1000000;
    expect(integer / (integer < 0 ? 8388608 : 8388607)).toBeCloseTo(output.channels[0][frame], 6);
  });
  it("inserts independently on a new track, retaining output provenance without adding the private original to the song", () => {
    const document = createProject(), snapshot = structuredClone(document);
    const { entry } = createRefinedSampleEntry({ name: "Mapped note", output: tone(), original: tone(), provenance: provenance(), kind: "sound", root: 47 });
    expect(entry.sound.instrument.zones[0]).toMatchObject({ root: 47, low: 40, high: 54 });
    const result = applyLibraryEntry(document, entry, { trackId: document.tracks[0].id, sectionId: document.sections[0].id }, "alternative");
    expect(result.ok).toBe(true); expect(document).toEqual(snapshot);
    if (!result.ok) throw Error(result.error);
    expect(result.document.assets).toHaveLength(1); expect(result.document.assets[0].provenance).toEqual(provenance());
    expect(result.document.assets[0].id).not.toBe(entry.refinement?.originalAssetId);
    expect(projectSchema.safeParse(result.document).success).toBe(true);
  });
  it("keeps cropped mixtures as audio textures and prevents original/output identity aliasing", () => {
    const { entry } = createRefinedSampleEntry({ name: "Texture", output: tone(), original: tone(), provenance: provenance({ method: "trimmed", target: "texture", model: "none", status: "mixed-texture" }), kind: "audio" });
    expect(entry.kind).toBe("audio"); expect(entry.sound.instrument.family).toBe("Mixed texture");
    const song = createProject(), inserted = applyLibraryEntry(song, entry, { trackId: song.tracks[0].id, sectionId: song.sections[0].id }, "alternative");
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) throw Error(inserted.error);
    expect(inserted.document.userInstruments).toEqual(song.userInstruments);
    expect(inserted.document.tracks.at(-1)?.kind).toBe("audio");
    entry.refinement!.originalAssetId = entry.clip!.audio!.assetId;
    expect(libraryEntrySchema.safeParse(entry).success).toBe(false);
  });
});
