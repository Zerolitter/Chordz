import FFT from "fft.js";

export interface PCM { channels: Float32Array[]; sampleRate: number }
export interface SampleRange { startSec: number; endSec: number }
export interface SampleMetrics { peak: number; rms: number; rmsDb: number; silent: boolean; clippedSamples: number }
export interface SimilarMoment extends SampleRange { similarity: number; activity: number }
export const SAMPLE_LIMITS = { selectionSeconds: 20, contextSeconds: 2, sourceSeconds: 600, pcmBytes: 256 * 1024 * 1024 };

export function validatePCM(pcm: PCM, maxSeconds = 24) {
  const { channels, sampleRate } = pcm;
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || ![1, 2].includes(channels.length)
    || !channels[0].length || channels.some(channel => !(channel instanceof Float32Array) || channel.length !== channels[0].length)
    || channels[0].length / sampleRate > maxSeconds + .001 || channels[0].length * channels.length * 4 > SAMPLE_LIMITS.pcmBytes)
    throw Error("Unsupported or oversized sample audio.");
}
export function validateSampleRange(range: SampleRange, duration: number) {
  if (!Number.isFinite(range.startSec) || !Number.isFinite(range.endSec) || range.startSec < 0 || range.endSec > duration + .00001
    || range.endSec - range.startSec < .05 || range.endSec - range.startSec > SAMPLE_LIMITS.selectionSeconds)
    throw Error("Select 0.05 to 20 seconds inside the source.");
}
export function contextFor(range: SampleRange, duration: number): SampleRange {
  validateSampleRange(range, duration);
  return { startSec: Math.max(0, range.startSec - SAMPLE_LIMITS.contextSeconds), endSec: Math.min(duration, range.endSec + SAMPLE_LIMITS.contextSeconds) };
}
export function slicePCM(pcm: PCM, range: SampleRange): PCM {
  validatePCM(pcm, 600);
  if (![range.startSec, range.endSec].every(Number.isFinite) || range.startSec < 0 || range.endSec <= range.startSec || range.endSec > pcm.channels[0].length / pcm.sampleRate + .001)
    throw Error("Invalid sample boundaries.");
  const start = Math.round(range.startSec * pcm.sampleRate), end = Math.min(pcm.channels[0].length, Math.round(range.endSec * pcm.sampleRate));
  return { sampleRate: pcm.sampleRate, channels: pcm.channels.map(channel => channel.slice(start, end)) };
}
export function sampleMetrics(pcm: PCM): SampleMetrics {
  validatePCM(pcm);
  let peak = 0, squares = 0, clippedSamples = 0;
  for (const channel of pcm.channels) for (const value of channel) {
    if (!Number.isFinite(value)) throw Error("The sample contains invalid audio values.");
    peak = Math.max(peak, Math.abs(value)); squares += value * value; if (Math.abs(value) >= .9999) clippedSamples++;
  }
  const rms = Math.sqrt(squares / (pcm.channels.length * pcm.channels[0].length));
  return { peak, rms, rmsDb: 20 * Math.log10(Math.max(1e-9, rms)), silent: rms < .0001, clippedSamples };
}
/** Conservative, stereo-linked low-level attenuation. This is NOT source separation. */
export function refineSample(pcm: PCM, reductionDb: number): PCM {
  validatePCM(pcm);
  if (!Number.isFinite(reductionDb) || reductionDb < 0 || reductionDb > 6) throw Error("Reduction must be between 0 and 6 dB.");
  const metrics = sampleMetrics(pcm), channels = pcm.channels.map(channel => channel.slice()), length = channels[0].length;
  const hop = Math.max(1, Math.round(pcm.sampleRate * .005)), levels: number[] = [];
  for (let start = 0; start < length; start += hop) {
    let sum = 0, count = 0;
    for (const channel of channels) for (let i = start; i < Math.min(start + hop, length); i++) { sum += channel[i] ** 2; count++; }
    levels.push(Math.sqrt(sum / count));
  }
  const threshold = Math.max(.00001, metrics.rms * .12), floor = 10 ** (-reductionDb / 20);
  const release = Math.exp(-1 / (pcm.sampleRate * .12)), peakGain = Math.min(1, .98 / Math.max(.000001, metrics.peak));
  const fade = Math.max(1, Math.min(Math.round(pcm.sampleRate * .002), Math.floor(length / 4)));
  let gain = 1;
  for (let i = 0; i < length; i++) {
    const frame = Math.floor(i / hop), lookAhead = Math.max(levels[frame] ?? 0, levels[frame + 1] ?? 0, levels[frame + 2] ?? 0);
    const target = floor + (1 - floor) * Math.min(1, lookAhead / threshold);
    gain = target >= gain ? target : target + release * (gain - target);
    const edge = Math.min(1, i / fade, (length - 1 - i) / fade);
    for (const channel of channels) channel[i] *= gain * edge * peakGain;
  }
  return { channels, sampleRate: pcm.sampleRate };
}
export function residualSample(source: PCM, extracted: PCM): PCM {
  validatePCM(source); validatePCM(extracted);
  if (source.sampleRate !== extracted.sampleRate || source.channels.length !== extracted.channels.length || source.channels[0].length !== extracted.channels[0].length)
    throw Error("Separator output is not aligned with its source. Residual comparison is unavailable.");
  return { sampleRate: source.sampleRate, channels: source.channels.map((channel, c) => Float32Array.from(channel, (value, i) => value - extracted.channels[c][i])) };
}
/** Apply these gains only while auditioning; never bake them into stored audio. */
export function comparisonGains(samples: PCM[]): number[] {
  const metrics = samples.map(sampleMetrics), active = metrics.filter(value => !value.silent);
  if (!active.length) return metrics.map(() => 1);
  const target = Math.min(.1, ...active.map(value => value.rms));
  return metrics.map(value => value.silent ? 1 : Math.min(4, target / value.rms, .8 / Math.max(value.peak, 1e-9)));
}
export function qualityWarnings(source: PCM, output: PCM): string[] {
  const before = sampleMetrics(source), after = sampleMetrics(output), warnings: string[] = [];
  if (after.silent) warnings.push("Extraction is silent or near-silent. Choose another occurrence or target.");
  if (after.clippedSamples) warnings.push("The output reaches full scale. Audition for clipping; saved audio receives linked peak protection.");
  if (after.rms < before.rms * .05) warnings.push("Very little source energy remains. Check that the wanted sound was retained.");
  warnings.push("Signal checks cannot certify isolation. Listen for remaining instruments and damaged attacks or tails.");
  return warnings;
}

interface Feature { spectrum: number[]; energy: number; activity: number }
/** Streaming descriptors: retain small spectral features, never a second full-song PCM copy. */
export class SimilarityAnalyzer {
  private features: Feature[] = [];
  private pending: number[][];
  private received = 0;
  private fft = new FFT(1024);
  constructor(private sampleRate: number, private channels: number, private length: number) {
    validatePCM({ sampleRate, channels: Array.from({ length: channels }, () => new Float32Array(1)) });
    if (!Number.isSafeInteger(length) || length < 1 || length / sampleRate > 600 || length * channels * 4 > SAMPLE_LIMITS.pcmBytes) throw Error("Search source exceeds its limit.");
    this.pending = Array.from({ length: channels }, () => []);
  }
  push(channels: Float32Array[]) {
    if (channels.length !== this.channels || channels.some(channel => channel.length !== channels[0].length) || this.received + channels[0].length > this.length) throw Error("Invalid search audio chunk.");
    const hop = Math.round(this.sampleRate / 10);
    for (let i = 0; i < channels[0].length; i++) {
      for (let c = 0; c < channels.length; c++) {
        if (!Number.isFinite(channels[c][i])) throw Error("Search audio contains invalid values.");
        this.pending[c].push(channels[c][i]);
      }
      if (this.pending[0].length === hop) this.flush();
    }
    this.received += channels[0].length;
  }
  private flush() {
    const spectrum = Array<number>(24).fill(0); let energy = 0;
    for (const channel of this.pending) {
      const input = Array<number>(1024).fill(0), size = channel.length;
      // Analyze contiguous samples, not decimated samples without an anti-alias filter.
      const offset = Math.max(0, Math.floor((size - 1024) / 2));
      for (let i = 0; i < 1024; i++) input[i] = (channel[offset + i] ?? 0) * (.5 - .5 * Math.cos(2 * Math.PI * i / 1023));
      for (const value of channel) energy += value * value / (size * this.channels);
      const output = this.fft.createComplexArray(); this.fft.realTransform(output, input);
      for (let bin = 1; bin < 512; bin++) {
        const band = Math.min(23, Math.floor(Math.log2(bin + 1) / 9 * 24));
        spectrum[band] += output[bin * 2] ** 2 + output[bin * 2 + 1] ** 2;
      }
    }
    const power = spectrum.reduce((sum, value) => sum + value, 0);
    const normalized = spectrum.map(value => Math.sqrt(value / Math.max(power, 1e-20)));
    const activity = normalized.filter(value => value > .12).length / normalized.length;
    this.features.push({ spectrum: normalized, energy: Math.sqrt(energy), activity });
    this.pending = Array.from({ length: this.channels }, () => []);
  }
  finish(range: SampleRange): SimilarMoment[] {
    if (this.received !== this.length) throw Error("Search audio is incomplete.");
    if (this.pending[0].length) this.flush();
    validateSampleRange(range, this.length / this.sampleRate);
    if (range.endSec - range.startSec < .3) throw Error("Select at least 0.3 seconds to find similar moments.");
    const count = Math.max(3, Math.round((range.endSec - range.startSec) * 10)), start = Math.round(range.startSec * 10);
    const describe = (at: number) => {
      const values = Array<number>(32).fill(0); let activity = 0, energy = 0;
      for (let i = 0; i < count; i++) {
        const f = this.features[at + i]; if (!f) continue;
        f.spectrum.forEach((value, band) => { values[band] += value / count; });
        values[24 + Math.min(7, Math.floor(i / count * 8))] += f.energy;
        activity += f.activity / count; energy += f.energy / count;
      }
      for (const [from, to] of [[0, 24], [24, 32]]) {
        const norm = Math.sqrt(values.slice(from, to).reduce((sum, v) => sum + v * v, 0));
        for (let i = from; i < to; i++) values[i] /= Math.max(norm, 1e-12);
      }
      return { values, activity, energy };
    };
    const target = describe(start); if (target.energy < .0001) return [];
    const matches: SimilarMoment[] = [], duration = range.endSec - range.startSec;
    for (let at = 0; at + count <= this.features.length; at++) {
      const time = at / 10;
      if (time < range.endSec + .1 && time + duration > range.startSec - .1 || time + duration > this.length / this.sampleRate) continue;
      const candidate = describe(at); if (candidate.energy < .0001) continue;
      const spectral = candidate.values.slice(0, 24).reduce((sum, v, i) => sum + v * target.values[i], 0);
      const envelope = candidate.values.slice(24).reduce((sum, v, i) => sum + v * target.values[24 + i], 0);
      const similarity = Math.min(1, .85 * spectral + .15 * envelope);
      if (similarity >= .88) matches.push({ startSec: time, endSec: time + duration, similarity, activity: candidate.activity });
    }
    matches.sort((a, b) => (b.similarity - b.activity * .025) - (a.similarity - a.activity * .025));
    const chosen: SimilarMoment[] = [];
    for (const match of matches) {
      if (!chosen.some(previous => match.startSec < previous.endSec + .1 && match.endSec > previous.startSec - .1)) chosen.push(match);
      if (chosen.length === 5) break;
    }
    return chosen;
  }
}
