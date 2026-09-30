import { describe, expect, it } from "vitest";
import { ReferenceAnalyzer, inspectReferenceFile, isReferenceProfile, validateReferenceBuffer } from "../lib/audio/reference-analysis";
import { ReferenceWaveform } from "../lib/audio/reference-analysis-waveform";

function analyze(channels: Float32Array[], sampleRate = 12000) {
  const analyzer = new ReferenceAnalyzer({ name: "Test", fingerprint: "synthetic", byteLength: 1, sampleRate, channels: channels.length, duration: channels[0].length / sampleRate }, { startSec: 0, endSec: channels[0].length / sampleRate });
  for (let offset = 0; offset < channels[0].length; offset += sampleRate * 2)
    analyzer.push(channels.map(c => c.slice(offset, offset + sampleRate * 2)));
  return analyzer.finish();
}

describe("reference measurements", () => {
  it("measures unclipped stereo PCM and handles phase cancellation without losing pitch", () => {
    const left = Float32Array.from({ length: 12000 * 4 }, (_, i) => 1.2 * Math.sin(2 * Math.PI * 440 * i / 12000));
    const result = analyze([left, left.map(x => -x)]);
    expect(result.dynamics.rmsDbfs).toBeCloseTo(20 * Math.log10(1.2 / Math.sqrt(2)), 1);
    expect(result.dynamics.samplePeakDbfs).toBeGreaterThan(1);
    expect(result.stereo.correlation).toBeCloseTo(-1, 4);
    expect(result.quality.analysisChannel).toBe("higher-energy channel");
    expect(result.tonal.chroma[9]).toBeGreaterThan(result.tonal.chroma[1]);
    expect(left[3]).toBeGreaterThan(0);
  });

  it("reports silence without inventing rhythm or a key and emits finite bounded curves", () => {
    const result = analyze([new Float32Array(12000 * 3)]);
    expect(result.tempo.candidates).toEqual([]);
    expect(result.tonal.candidates).toEqual([]);
    expect(result.quality.activeSeconds).toBe(0);
    expect(result.curve).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain("null");
    expect(result.curve.every(p => Number.isFinite(p.rmsDbfs) && p.energy >= 0 && p.energy <= 1)).toBe(true);
  });

  it("finds a known pulse train with its half-time alternative and stable window support", () => {
    const rate = 12000, seconds = 65, pcm = new Float32Array(rate * seconds);
    for (let beat = 0; beat < seconds * 2; beat++)
      for (let i = 0; i < rate * .12; i++)
        pcm[beat * rate / 2 + i] = .6 * Math.sin(2 * Math.PI * 90 * i / rate) * Math.exp(-i / (rate * .03));
    const result = analyze([pcm], rate);
    expect(result.tempo.candidates.some(c => Math.abs(c.bpm - 120) < 1)).toBe(true);
    expect(result.tempo.candidates.some(c => Math.abs(c.bpm - 60) < 1)).toBe(true);
    expect(result.tempo.confidence).toBe("supported");
    expect(result.transitions.every(t => t.timeSec >= 0 && t.timeSec < seconds)).toBe(true);
  });

  it("makes matching profiles independent of input chunk boundaries", () => {
    const rate = 44100, pcm = Float32Array.from({ length: rate * 2 }, (_, i) => .2 * Math.sin(2 * Math.PI * 261.63 * i / rate));
    const metadata = { name: "C", fingerprint: "same", byteLength: 1, sampleRate: rate, channels: 1, duration: 2 };
    const a = new ReferenceAnalyzer(metadata, { startSec: 0, endSec: 2 }), b = new ReferenceAnalyzer(metadata, { startSec: 0, endSec: 2 });
    a.push([pcm]);
    for (let i = 0; i < pcm.length; i += 997) b.push([pcm.slice(i, i + 997)]);
    expect(b.finish()).toEqual(a.finish());
  });

  it("rejects nonfinite PCM and declared limits before analysis", () => {
    expect(() => validateReferenceBuffer({ duration: 601, sampleRate: 48000, length: 28848000, numberOfChannels: 2 } as AudioBuffer)).toThrow("10 minutes");
    expect(() => validateReferenceBuffer({ duration: 1, sampleRate: 48000, length: 48000, numberOfChannels: 3 } as AudioBuffer)).toThrow("mono or stereo");
    const a = new ReferenceAnalyzer({ name: "Broken", fingerprint: "x", byteLength: 1, sampleRate: 12000, channels: 1, duration: 1 }, { startSec: 0, endSec: 1 });
    expect(() => a.push([new Float32Array([NaN])])).toThrow("nonfinite");
  });

  it("extracts actual WAV sample rate/channels/duration without decoding or trusting extensions", () => {
    const bytes = new Uint8Array(44 + 48000 * 2 * 2), view = new DataView(bytes.buffer);
    for (const [offset, text] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const)
      [...text].forEach((char, i) => bytes[offset + i] = char.charCodeAt(0));
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, 48000, true); view.setUint32(28, 192000, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); view.setUint32(40, bytes.length - 44, true);
    expect(inspectReferenceFile(bytes)).toMatchObject({ format: "wav", sourceSampleRate: 48000, channels: 2, duration: 1 });
    expect(() => inspectReferenceFile(new Uint8Array([1, 2, 3]))).toThrow("MP3 or WAV");
  });

  it("keeps peaks from both stereo channels across chunk boundaries without retaining raw PCM", () => {
    const wave = new ReferenceWaveform(640, 2), left = new Float32Array(640), right = new Float32Array(640); left[12] = .4; right[600] = -1.2;
    wave.push([left.slice(0, 123), right.slice(0, 123)]); wave.push([left.slice(123), right.slice(123)]);
    const peaks = wave.finish(); expect(peaks).toHaveLength(320); expect(peaks[6]).toBeCloseTo(.4); expect(peaks[300]).toBe(1); expect(peaks[299]).toBe(0); expect(right[600]).toBeCloseTo(-1.2);
  });

  it("recognizes a sustained major triad without reporting its exact chord sequence", () => {
    const rate = 12000, tones = [261.6256, 329.6276, 391.9954], pcm = Float32Array.from({ length: rate * 24 }, (_, i) => tones.reduce((sum, f) => sum + .1 * Math.sin(2 * Math.PI * f * i / rate), 0));
    const result = analyze([pcm], rate);
    expect(result.tonal.candidates[0]).toMatchObject({ key: "C", mode: "major" });
    expect(result.tonal.reason).toContain("not chord transcription");
    expect(result.tempo.confidence).toBe("unavailable");
  });
  it("rejects corrupt cache/worker profiles and unbounded metadata or ranges", () => {
    const result = analyze([new Float32Array(12000)]); expect(isReferenceProfile(result)).toBe(true);
    expect(isReferenceProfile({ ...result, curve: [{ ...result.curve[0], energy: Infinity }] })).toBe(false);
    expect(isReferenceProfile({ ...result, source: { ...result.source, fingerprint: "x".repeat(129) } })).toBe(false);
    expect(isReferenceProfile({ ...result, tonal: { ...result.tonal, chroma: [] } })).toBe(false);
    expect(() => new ReferenceAnalyzer({ ...result.source, byteLength: 100 * 1024 * 1024 + 1 }, { startSec: 0, endSec: 1 })).toThrow("100 MiB");
    expect(() => new ReferenceAnalyzer(result.source, { startSec: NaN, endSec: 1 })).toThrow("valid reference range");
  });
});
