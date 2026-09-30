export const REFERENCE_LIMITS = { bytes: 100 * 1024 * 1024, seconds: 600, pcmBytes: 256 * 1024 * 1024 };
export const REFERENCE_ALGORITHM = "chordz-reference-1";
export type AnalysisConfidence = "supported" | "tentative" | "unavailable";
export interface ReferenceMetadata {
  name: string; fingerprint: string; byteLength: number; sampleRate: number; channels: number; duration: number;
  sourceSampleRate?: number; bitrate?: number; title?: string;
}
export interface ReferenceCurvePoint { timeSec: number; rmsDbfs: number; peakDbfs: number; energy: number; brightness: number; onsetDensity: number }
export interface ReferenceProfile {
  version: 1; algorithmVersion: string; source: ReferenceMetadata;
  coverage: { startSec: number; endSec: number; fullSong: boolean };
  dynamics: { rmsDbfs: number; samplePeakDbfs: number; crestDb: number; p10Dbfs: number; p50Dbfs: number; p90Dbfs: number };
  stereo: { correlation: number; sideToMidDb: number };
  tempo: { candidates: { bpm: number; periodicity: number }[]; confidence: AnalysisConfidence; reason: string };
  tonal: { candidates: { key: string; mode: "major" | "minor"; correlation: number }[]; chroma: number[]; confidence: AnalysisConfidence; reason: string };
  curve: ReferenceCurvePoint[]; waveform: number[]; transitions: { timeSec: number; changeDb: number }[];
  quality: { activeSeconds: number; analysisChannel: "mono mix" | "higher-energy channel"; warnings: string[] };
}
export interface ReferenceRange { startSec: number; endSec: number }
/** Reject corrupt local cache entries and malformed worker replies before they reach the editor. */
export function isReferenceProfile(value: unknown): value is ReferenceProfile {
  try {
    const p = value as ReferenceProfile, finite = (v: unknown) => typeof v === "number" && Number.isFinite(v), bounded = (v: unknown, min: number, max: number) => finite(v) && (v as number) >= min && (v as number) <= max;
    const confidence = (v: unknown) => ["supported", "tentative", "unavailable"].includes(v as string);
    return p?.version === 1 && p.algorithmVersion === REFERENCE_ALGORITHM && JSON.stringify(p).length <= 200_000
      && typeof p.source?.name === "string" && p.source.name.length <= 200 && typeof p.source.fingerprint === "string" && p.source.fingerprint.length <= 128
      && bounded(p.source.byteLength, 1, REFERENCE_LIMITS.bytes) && bounded(p.source.duration, .000001, 600) && bounded(p.source.sampleRate, 8000, 192000) && [1, 2].includes(p.source.channels)
      && bounded(p.coverage?.startSec, 0, 600) && bounded(p.coverage.endSec, 0, p.source.duration + .001) && p.coverage.endSec > p.coverage.startSec && typeof p.coverage.fullSong === "boolean"
      && ["rmsDbfs", "samplePeakDbfs", "crestDb", "p10Dbfs", "p50Dbfs", "p90Dbfs"].every(k => finite(p.dynamics?.[k as keyof ReferenceProfile["dynamics"]]))
      && bounded(p.stereo?.correlation, -1, 1) && bounded(p.stereo.sideToMidDb, -120, 120)
      && confidence(p.tempo?.confidence) && typeof p.tempo.reason === "string" && Array.isArray(p.tempo.candidates) && p.tempo.candidates.length <= 4 && p.tempo.candidates.every(c => bounded(c.bpm, 55, 205) && bounded(c.periodicity, 0, 1))
      && confidence(p.tonal?.confidence) && typeof p.tonal.reason === "string" && Array.isArray(p.tonal.chroma) && p.tonal.chroma.length === 12 && p.tonal.chroma.every(v => bounded(v, 0, 1)) && Array.isArray(p.tonal.candidates) && p.tonal.candidates.length <= 4 && p.tonal.candidates.every(c => ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"].includes(c.key) && ["major", "minor"].includes(c.mode) && bounded(c.correlation, -1, 1))
      && Array.isArray(p.curve) && p.curve.length > 0 && p.curve.length <= 601 && p.curve.every(c => bounded(c.timeSec, 0, 600) && finite(c.rmsDbfs) && finite(c.peakDbfs) && bounded(c.energy, 0, 1) && bounded(c.brightness, 0, 1) && bounded(c.onsetDensity, 0, 1))
      && Array.isArray(p.waveform) && p.waveform.length <= 601 && p.waveform.every(v => bounded(v, 0, 1)) && Array.isArray(p.transitions) && p.transitions.length <= 128 && p.transitions.every(t => bounded(t.timeSec, 0, 600) && finite(t.changeDb))
      && bounded(p.quality?.activeSeconds, 0, 600) && ["mono mix", "higher-energy channel"].includes(p.quality.analysisChannel) && Array.isArray(p.quality.warnings) && p.quality.warnings.length <= 16 && p.quality.warnings.every(v => typeof v === "string" && v.length <= 300);
  } catch { return false; }
}

export function validateReferenceBuffer(buffer: Pick<AudioBuffer, "duration" | "sampleRate" | "length" | "numberOfChannels">) {
  if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > REFERENCE_LIMITS.seconds) throw new Error("Choose a reference no longer than 10 minutes.");
  if (![1, 2].includes(buffer.numberOfChannels)) throw new Error("Choose mono or stereo audio.");
  if (!Number.isFinite(buffer.sampleRate) || buffer.sampleRate < 8000 || buffer.sampleRate > 192000) throw new Error("Unsupported reference sample rate.");
  if (buffer.length * buffer.numberOfChannels * 4 > REFERENCE_LIMITS.pcmBytes) throw new Error("This reference exceeds the 256 MiB decoded audio limit.");
}

/** Content inspection prevents an arbitrary extension or MIME type from bypassing preflight. */
export function inspectReferenceFile(bytes: Uint8Array): { format: "mp3" | "wav"; sourceSampleRate: number; channels: number; duration: number; bitrate?: number; title?: string } {
  if (bytes.length > REFERENCE_LIMITS.bytes) throw new Error("Choose a reference smaller than 100 MiB.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), ascii = (a: number, b: number) => String.fromCharCode(...bytes.subarray(a, b));
  if (bytes.length >= 44 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") {
    let rate = 0, channels = 0, byteRate = 0, blockAlign = 0, data = 0;
    for (let p = 12; p + 8 <= bytes.length;) {
      const length = view.getUint32(p + 4, true), id = ascii(p, p + 4);
      if (p + 8 + length > bytes.length) throw new Error("The WAV reference is incomplete.");
      if (id === "fmt " && length >= 16) { channels = view.getUint16(p + 10, true); rate = view.getUint32(p + 12, true); byteRate = view.getUint32(p + 16, true); blockAlign = view.getUint16(p + 20, true); }
      if (id === "data") data += length;
      p += 8 + length + length % 2;
    }
    if (!rate || !channels || !byteRate || !blockAlign || byteRate !== rate * blockAlign || !data) throw new Error("The WAV header is incomplete or inconsistent.");
    return { format: "wav", sourceSampleRate: rate, channels, duration: data / byteRate };
  }
  let p = 0, title: string | undefined;
  if (ascii(0, 3) === "ID3" && bytes.length >= 10) {
    const sync = (at: number) => ((bytes[at] & 127) << 21) | ((bytes[at + 1] & 127) << 14) | ((bytes[at + 2] & 127) << 7) | (bytes[at + 3] & 127);
    p = 10 + sync(6);
    if (p > bytes.length) throw new Error("The MP3 tag is incomplete.");
    if (!(bytes[5] & 64) && [3, 4].includes(bytes[3])) for (let at = 10; at + 10 <= p;) {
      const id = ascii(at, at + 4); if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const size = bytes[3] === 4 ? sync(at + 4) : view.getUint32(at + 4);
      if (at + 10 + size > p) break;
      if (id === "TIT2" && size > 1) {
        const encoding = bytes[at + 10], text = bytes.subarray(at + 11, Math.min(at + 10 + size, at + 410));
        title = new TextDecoder(encoding === 1 ? "utf-16le" : encoding === 0 ? "windows-1252" : "utf-8").decode(text).replace(/\0/g, "").slice(0, 200);
      }
      at += 10 + size;
    }
  }
  let frames = 0, seconds = 0, rate = 0, channels = 0, totalBitrate = 0, skipped = 0;
  while (p + 4 <= bytes.length) {
    const h = view.getUint32(p), version = (h >>> 19) & 3, layer = (h >>> 17) & 3, bitrateIndex = (h >>> 12) & 15, sampleIndex = (h >>> 10) & 3;
    if (h >>> 21 !== 2047 || version === 1 || layer !== 1 || !bitrateIndex || bitrateIndex === 15 || sampleIndex === 3) { p++; if (++skipped > 16384 && !frames) break; continue; }
    const sampleRate = [44100, 48000, 32000][sampleIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const bitrate = (version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[bitrateIndex];
    const length = Math.floor((version === 3 ? 144 : 72) * bitrate * 1000 / sampleRate) + ((h >>> 9) & 1);
    if (p + length > bytes.length) break;
    const frameChannels = ((h >>> 6) & 3) === 3 ? 1 : 2;
    if (frames && (rate !== sampleRate || channels !== frameChannels)) throw new Error("The MP3 reference changes sample rate or channel layout.");
    rate = sampleRate; channels = frameChannels; frames++; seconds += (version === 3 ? 1152 : 576) / sampleRate; totalBitrate += bitrate; p += length;
  }
  if (frames < 2) throw new Error("Choose a complete MP3 or WAV reference.");
  return { format: "mp3", sourceSampleRate: rate, channels, duration: seconds, bitrate: Math.round(totalBitrate / frames), ...(title ? { title } : {}) };
}
