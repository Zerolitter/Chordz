import FFT from "fft.js";
import { REFERENCE_ALGORITHM, validateReferenceBuffer, type ReferenceMetadata, type ReferenceProfile, type ReferenceRange } from "./reference-analysis-data";
export * from "./reference-analysis-data";
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const db = (amplitude: number) => Math.max(-120, 20 * Math.log10(Math.max(1e-6, amplitude)));
const round = (v: number, digits = 3) => Number(v.toFixed(digits));
const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const minor = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function correlation(a: number[], b: number[]) {
  const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
  let xy = 0, xx = 0, yy = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; xy += x * y; xx += x * x; yy += y * y; }
  return xy / Math.sqrt(xx * yy || 1);
}
function keyCandidates(chroma: number[]) {
  const result: ReferenceProfile["tonal"]["candidates"] = [];
  for (let tonic = 0; tonic < 12; tonic++) for (const mode of ["major", "minor"] as const) {
    const profile = mode === "major" ? major : minor;
    result.push({ key: names[tonic], mode, correlation: round(correlation(chroma, Array.from({ length: 12 }, (_, i) => profile[(i - tonic + 12) % 12]))) });
  }
  return result.sort((a, b) => b.correlation - a.correlation).slice(0, 4);
}
function tempoCandidates(input: number[], fps: number) {
  if (input.length < fps * 10) return [];
  const mean = input.reduce((s, v) => s + v, 0) / input.length, series = input.map(v => v < .12 ? 0 : Math.max(0, v - mean * .6));
  const results: { lag: number; periodicity: number }[] = [];
  for (let lag = Math.ceil(fps * 60 / 205); lag <= Math.floor(fps * 60 / 55); lag++) {
    let xy = 0, xx = 0, yy = 0;
    for (let i = lag; i < series.length; i++) { xy += series[i] * series[i - lag]; xx += series[i] ** 2; yy += series[i - lag] ** 2; }
    results.push({ lag, periodicity: xy / Math.sqrt(xx * yy || 1) });
  }
  return results.flatMap((v, i) => {
    if (!i || i === results.length - 1 || v.periodicity < .1 || v.periodicity <= results[i - 1].periodicity || v.periodicity < results[i + 1].periodicity) return [];
    const a = results[i - 1].periodicity, b = v.periodicity, c = results[i + 1].periodicity, delta = clamp(.5 * (a - c) / (a - 2 * b + c || 1), -.5, .5);
    return [{ bpm: round(60 * fps / (v.lag + delta), 2), periodicity: round(v.periodicity) }];
  }).sort((a, b) => b.periodicity - a.periodicity).slice(0, 4);
}

/** Streaming native-rate statistics and a bounded, canonical-rate analysis copy. */
export class ReferenceAnalyzer {
  private count = 0; private downCount = 0; private tail: Float32Array[] = []; private down: Float32Array[];
  private low = [0, 0]; private slow = [0, 0]; private envelope: number[] = []; private bass: number[] = [];
  private hopEnergy = 0; private hopBass = 0; private hopCount = 0;
  private smoothEnergy = 0; private smoothBass = 0;
  private seconds: { energy: number; peak: number; count: number }[] = [];
  private leftEnergy = 0; private rightEnergy = 0; private cross = 0; private midEnergy = 0; private sideEnergy = 0;
  private taps: Float64Array[]; private inputEnd = 0;
  constructor(private metadata: ReferenceMetadata, private range: ReferenceRange) {
    if (!Number.isFinite(metadata.byteLength) || metadata.byteLength < 1 || metadata.byteLength > 100 * 1024 * 1024) throw new Error("Choose a reference smaller than 100 MiB.");
    validateReferenceBuffer({ duration: metadata.duration, sampleRate: metadata.sampleRate, numberOfChannels: metadata.channels, length: Math.ceil(metadata.duration * metadata.sampleRate) });
    if (!Number.isFinite(range.startSec) || !Number.isFinite(range.endSec) || range.startSec < 0 || range.endSec > metadata.duration + .001 || range.endSec <= range.startSec) throw new Error("Select a valid reference range.");
    this.down = Array.from({ length: metadata.channels }, () => new Float32Array(Math.ceil((range.endSec - range.startSec) * 12000) + 2));
    const cutoff = Math.min(.45, 5400 / metadata.sampleRate);
    this.taps = Array.from({ length: 128 }, (_, phase) => {
      const taps = new Float64Array(64); let sum = 0;
      for (let k = -31; k <= 32; k++) { const t = k - phase / 128, sinc = t === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * t) / (Math.PI * t), window = .5 + .5 * Math.cos(Math.PI * t / 33); taps[k + 31] = sinc * window; sum += taps[k + 31]; }
      return taps.map(v => v / sum);
    });
  }
  push(channels: Float32Array[]) {
    if (channels.length !== this.metadata.channels || channels.some(c => c.length !== channels[0].length)) throw new Error("Invalid reference PCM channels.");
    const sr = this.metadata.sampleRate, hop = Math.round(sr * .01), alpha = 1 - Math.exp(-2 * Math.PI * 180 / sr), slowAlpha = 1 - Math.exp(-2 * Math.PI * 30 / sr);
    if (this.count + channels[0].length > Math.ceil((this.range.endSec - this.range.startSec) * sr) + 1) throw new Error("Reference PCM exceeds the selected range.");
    for (let i = 0; i < channels[0].length; i++) {
      const l = channels[0][i], r = channels[1]?.[i] ?? l;
      if (!Number.isFinite(l) || !Number.isFinite(r)) throw new Error("The reference contains nonfinite PCM samples.");
      const e = (l * l + r * r) / 2, index = Math.floor(this.count / sr), sec = this.seconds[index] ?? (this.seconds[index] = { energy: 0, peak: 0, count: 0 });
      sec.energy += e; sec.peak = Math.max(sec.peak, Math.abs(l), Math.abs(r)); sec.count++;
      this.leftEnergy += l * l; this.rightEnergy += r * r; this.cross += l * r; this.midEnergy += ((l + r) / 2) ** 2; this.sideEnergy += ((l - r) / 2) ** 2;
      let bassEnergy = 0;
      for (let ch = 0; ch < 2; ch++) { const v = ch ? r : l; this.low[ch] += alpha * (v - this.low[ch]); this.slow[ch] += slowAlpha * (v - this.slow[ch]); bassEnergy += (this.low[ch] - this.slow[ch]) ** 2 / 2; }
      this.hopEnergy += e; this.hopBass += bassEnergy; this.hopCount++; this.count++;
      if (this.hopCount === hop) { this.smoothEnergy += .2 * (this.hopEnergy / hop - this.smoothEnergy); this.smoothBass += .2 * (this.hopBass / hop - this.smoothBass); this.envelope.push(Math.log(1e-6 + this.smoothEnergy)); this.bass.push(Math.log(1e-6 + this.smoothBass)); this.hopCount = this.hopEnergy = this.hopBass = 0; }
    }
    const oldEnd = this.inputEnd, tailLength = this.tail[0]?.length ?? 0, start = oldEnd - tailLength;
    const input = channels.map((c, ch) => { const array = new Float32Array(tailLength + c.length); if (this.tail[ch]) array.set(this.tail[ch]); array.set(c, tailLength); return array; });
    this.inputEnd += channels[0].length;
    while (this.downCount < this.down[0].length) {
      const position = this.downCount * sr / 12000, center = Math.floor(position);
      if (center + 32 >= this.inputEnd) break;
      const taps = this.taps[Math.min(127, Math.floor((position - center) * 128))];
      for (let ch = 0; ch < channels.length; ch++) { let v = 0; for (let k = -31; k <= 32; k++) v += (input[ch][center + k - start] ?? 0) * taps[k + 31]; this.down[ch][this.downCount] = v; }
      this.downCount++;
    }
    this.tail = input.map(c => c.slice(Math.max(0, c.length - 64)));
  }
  finish(onProgress?: (percent: number) => void): ReferenceProfile {
    if (!this.count) throw new Error("The selected reference is empty.");
    const sr = this.metadata.sampleRate, rms = Math.sqrt((this.leftEnergy + this.rightEnergy) / (2 * this.count)), peak = Math.max(...this.seconds.map(s => s.peak));
    const correlationValue = this.cross / Math.sqrt(this.leftEnergy * this.rightEnergy || 1), fallback = correlationValue < -.25;
    const mono = new Float32Array(this.downCount);
    for (let i = 0; i < mono.length; i++) mono[i] = this.down.length === 1 ? this.down[0][i] : fallback ? this.down[this.leftEnergy >= this.rightEnergy ? 0 : 1][i] : (this.down[0][i] + this.down[1][i]) / 2;
    const N = 4096, hop = 512, fft = new FFT(N), output = fft.createComplexArray(), input = new Float64Array(N), mags = new Float64Array(N / 2), chroma = new Array<number>(12).fill(0), upperChroma = new Array<number>(12).fill(0), local = new Map<number, number[]>(), brightness = new Map<number, number[]>();
    const window = Float64Array.from({ length: N }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / (N - 1)));
    const history: Float64Array[] = [], temporal = new Float64Array(7), percussive = new Float64Array(17);
    let tonalFrames = 0;
    for (let start = 0; start + N <= mono.length; start += hop) {
      let energy = 0; for (let i = 0; i < N; i++) { input[i] = mono[start + i] * window[i]; energy += mono[start + i] ** 2; }
      if (energy / N < 1e-7) continue;
      fft.realTransform(output, input);
      let power = 0, weighted = 0; for (let b = 1; b < N / 2; b++) { const mag = Math.hypot(output[b * 2], output[b * 2 + 1]); mags[b] = mag; power += mag * mag; weighted += mag * mag * b * 12000 / N; }
      if (!history.length) for (let i = 0; i < 6; i++) history.push(mags.slice());
      history.push(mags.slice()); if (history.length > 7) history.shift();
      const frameChroma = new Array<number>(12).fill(0), upper = new Array<number>(12).fill(0);
      for (let b = 23; b < Math.floor(2500 * N / 12000); b++) {
        if (mags[b] < mags[b - 1] || mags[b] <= mags[b + 1]) continue;
        // A temporal/frequency median mask suppresses transient broadband energy.
        for (let i = 0; i < 7; i++) temporal[i] = history[i][b]; temporal.sort();
        for (let i = 0; i < 17; i++) percussive[i] = mags[b + i - 8]; percussive.sort();
        const h = temporal[3], p = percussive[8], mask = h * h / (h * h + p * p + 1e-12);
        const a = Math.log(Math.max(1e-12, mags[b - 1])), c = Math.log(Math.max(1e-12, mags[b + 1])), middle = Math.log(Math.max(1e-12, mags[b]));
        const shift = clamp(.5 * (a - c) / (a - 2 * middle + c || 1), -.5, .5);
        const frequency = (b + shift) * 12000 / N, midi = 69 + 12 * Math.log2(frequency / 440), nearest = Math.round(midi), distance = Math.abs(midi - nearest);
        if (distance > .4) continue;
        const pc = (nearest % 12 + 12) % 12, weight = Math.sqrt(mags[b] * mask) * (1 - distance / .4);
        frameChroma[pc] += weight; if (frequency >= 200) upper[pc] += weight;
      }
      const sum = frameChroma.reduce((a, b) => a + b, 0), upperSum = upper.reduce((a, b) => a + b, 0), sec = Math.floor(start / 12000), group = Math.floor(sec / 20), accumulated = local.get(group) ?? new Array<number>(12).fill(0);
      if (sum) { tonalFrames++; for (let i = 0; i < 12; i++) { chroma[i] += frameChroma[i] / sum; accumulated[i] += frameChroma[i] / sum; if (upperSum) upperChroma[i] += upper[i] / upperSum; } local.set(group, accumulated); }
      const values = brightness.get(sec) ?? []; values.push(power ? weighted / power : 0); brightness.set(sec, values);
      if (Math.floor(start / hop) % 64 === 0) onProgress?.(20 + 65 * start / Math.max(1, mono.length - N));
    }
    const dbValues = this.seconds.map(s => db(Math.sqrt(s.energy / s.count))), active = dbValues.filter(v => v > -70).sort((a, b) => a - b), quantile = (p: number) => active[Math.floor((active.length - 1) * p)] ?? -120;
    const novelty = (values: number[]) => values.map((v, i) => i ? Math.max(0, v - values[Math.max(0, i - 3)]) : 0), fps = sr / Math.round(sr * .01), fullNovelty = novelty(this.envelope), bassNovelty = novelty(this.bass);
    const tempos = active.length >= 20 ? tempoCandidates(fullNovelty, fps) : [], bassTempos = active.length >= 20 ? tempoCandidates(bassNovelty, fps) : [];
    let windows = 0, matches = 0;
    const equivalent = (a: number, b: number) => [a, a * 2, a / 2].some(v => Math.abs(v - b) / b < .03);
    if (tempos.length) for (let start = 0; start + fps * 20 <= fullNovelty.length; start += Math.round(fps * 15)) { const candidates = tempoCandidates(fullNovelty.slice(start, start + Math.round(fps * 30)), fps); if (candidates[0]) { windows++; if (equivalent(candidates[0].bpm, tempos[0].bpm)) matches++; } }
    const tempoSupported = tempos[0]?.periodicity >= .35 && bassTempos.some(t => equivalent(t.bpm, tempos[0].bpm)) && windows >= 3 && matches / windows >= .7;
    const normalizedChroma = chroma.map(v => round(v / Math.max(1, tonalFrames))), keys = tonalFrames >= 4 ? keyCandidates(normalizedChroma) : [], upperKeys = keyCandidates(upperChroma), localKeys = [...local.values()].map(keyCandidates);
    const sameKey = keys[0] && upperKeys[0].key === keys[0].key && upperKeys[0].mode === keys[0].mode;
    const keySupported = active.length >= 20 && sameKey && keys[0].correlation >= .65 && keys[0].correlation - keys[1].correlation >= .15 && localKeys.filter(k => k[0].key === keys[0].key && k[0].mode === keys[0].mode).length / Math.max(1, localKeys.length) >= .6;
    const centroids = this.seconds.map((_, i) => { const values = brightness.get(i) ?? []; return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length); }), sorted = [...centroids].sort((a, b) => a - b), brightLow = sorted[Math.floor(sorted.length * .1)] ?? 0, brightHigh = sorted[Math.floor(sorted.length * .9)] ?? 1;
    const curve = this.seconds.map((s, i) => ({ timeSec: round(this.range.startSec + i), rmsDbfs: round(dbValues[i], 1), peakDbfs: round(db(s.peak), 1), energy: round(clamp((dbValues[i] - quantile(.1)) / Math.max(3, quantile(.9) - quantile(.1)), 0, 1)), brightness: round(clamp((centroids[i] - brightLow) / Math.max(100, brightHigh - brightLow), 0, 1)), onsetDensity: round(fullNovelty.slice(Math.floor(i * fps), Math.floor((i + 1) * fps)).filter(v => v > .5).length / fps) }));
    const transitions: ReferenceProfile["transitions"] = [];
    for (let i = 2; i < curve.length - 2; i++) { const before = (dbValues[i - 2] + dbValues[i - 1]) / 2, after = (dbValues[i] + dbValues[i + 1]) / 2, difference = after - before; if (Math.abs(difference) >= 6 && (!transitions.length || curve[i].timeSec - transitions.at(-1)!.timeSec > 3)) transitions.push({ timeSec: curve[i].timeSec, changeDb: round(difference, 1) }); }
    onProgress?.(100);
    return { version: 1, algorithmVersion: REFERENCE_ALGORITHM, source: this.metadata, coverage: { ...this.range, fullSong: this.range.startSec === 0 && Math.abs(this.range.endSec - this.metadata.duration) < .05 }, dynamics: { rmsDbfs: round(db(rms), 1), samplePeakDbfs: round(db(peak), 1), crestDb: round(db(peak) - db(rms), 1), p10Dbfs: round(quantile(.1), 1), p50Dbfs: round(quantile(.5), 1), p90Dbfs: round(quantile(.9), 1) }, stereo: { correlation: round(correlationValue), sideToMidDb: round(clamp(db(Math.sqrt(this.sideEnergy / Math.max(1e-12, this.midEnergy))), -120, 120), 1) }, tempo: { candidates: tempos, confidence: tempoSupported ? "supported" : tempos.length ? "tentative" : "unavailable", reason: tempoSupported ? "Rhythmic periodicity agrees across bands and time windows; half/double interpretation remains editable." : tempos.length ? "A repeating pulse is present, but its beat interpretation or time-window support is uncertain." : "At least 20 active seconds and a repeating pulse are needed." }, tonal: { candidates: keys, chroma: normalizedChroma, confidence: keySupported ? "supported" : keys.length ? "tentative" : "unavailable", reason: keySupported ? "Pitch profiles agree across frequency bands and time windows; this is a tonal suggestion, not chord transcription." : keys.length ? "These suggestions are not chord transcription. Mixed instruments and percussion make the precise tonic or mode ambiguous; audition the alternatives." : "No sufficiently stable pitched material was found." }, curve, waveform: this.seconds.map(s => round(Math.min(1, s.peak))), transitions: transitions.slice(0, 128), quality: { activeSeconds: active.length, analysisChannel: fallback ? "higher-energy channel" : "mono mix", warnings: [...(peak > 1 ? ["Decoded samples exceed 0 dBFS. This measurement does not establish clipping in the original master."] : []), ...(fallback ? ["Stereo cancellation detected; pitch analysis uses the higher-energy channel."] : []), "RMS is measured in dBFS, not LUFS. Timbre measurements cover frequencies below 6 kHz."] } };
  }
}
