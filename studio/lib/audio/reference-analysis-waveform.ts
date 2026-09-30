/** Native-rate stereo peaks with a fixed output bound and no retained PCM. */
export class ReferenceWaveform {
  private offset = 0;
  private peaks = new Float32Array(320);
  constructor(private length: number, private channels: number) {
    if (!Number.isSafeInteger(length) || length < 1 || length * channels * 4 > 256 * 1024 * 1024 || ![1, 2].includes(channels)) throw new Error("Invalid waveform size.");
  }
  push(channels: Float32Array[]) {
    if (channels.length !== this.channels || channels.some(c => c.length !== channels[0].length) || this.offset + channels[0].length > this.length) throw new Error("Invalid waveform chunk.");
    for (let i = 0; i < channels[0].length; i++) {
      const bin = Math.min(319, Math.floor((this.offset + i) * 320 / this.length));
      for (const pcm of channels) {
        if (!Number.isFinite(pcm[i])) throw new Error("The reference contains nonfinite PCM samples.");
        this.peaks[bin] = Math.max(this.peaks[bin], Math.min(1, Math.abs(pcm[i])));
      }
    }
    this.offset += channels[0].length;
  }
  finish() { if (this.offset !== this.length) throw new Error("The reference waveform is incomplete."); return Array.from(this.peaks); }
}
