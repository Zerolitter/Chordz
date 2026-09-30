export function encodeWav(
  channels: Float32Array[],
  sampleRate: number,
  bitDepth: 16 | 24 = 24,
): ArrayBuffer {
  if (
    !channels.length ||
    channels.length > 2 ||
    channels.some((c) => c.length !== channels[0].length)
  )
    throw new Error("WAV export requires one or two equally sized channels.");
  const frames = channels[0].length,
    bytes = bitDepth / 8,
    dataLength = frames * channels.length * bytes;
  if (dataLength > 0xffffffff - 44)
    throw new Error("This export is too long for a standard WAV file.");
  const buffer = new ArrayBuffer(44 + dataLength),
    view = new DataView(buffer);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++)
      view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels.length * bytes, true);
  view.setUint16(32, channels.length * bytes, true);
  view.setUint16(34, bitDepth, true);
  text(36, "data");
  view.setUint32(40, dataLength, true);
  let offset = 44;
  for (let frame = 0; frame < frames; frame++)
    for (const channel of channels) {
      const value = Math.max(
        -1,
        Math.min(1, Number.isFinite(channel[frame]) ? channel[frame] : 0),
      );
      if (bitDepth === 16) {
        view.setInt16(
          offset,
          Math.round(value * (value < 0 ? 32768 : 32767)),
          true,
        );
        offset += 2;
      } else {
        const n = Math.round(value * (value < 0 ? 8388608 : 8388607));
        view.setUint8(offset, n & 255);
        view.setUint8(offset + 1, (n >> 8) & 255);
        view.setUint8(offset + 2, (n >> 16) & 255);
        offset += 3;
      }
    }
  return buffer;
}
export function waveformPeaks(channels: Float32Array[], bins = 160): number[] {
  const length = channels[0]?.length ?? 0;
  if (!length) return [];
  const hop = Math.max(1, Math.ceil(length / bins));
  return Array.from({ length: Math.min(bins, length) }, (_, i) => {
    let peak = 0;
    for (const ch of channels)
      for (let n = i * hop; n < Math.min((i + 1) * hop, length); n++)
        peak = Math.max(peak, Math.abs(ch[n]));
    return peak;
  });
}
