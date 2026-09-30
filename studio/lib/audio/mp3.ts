import { createEncoder } from "wasm-media-encoders";

const CHUNK_SAMPLES = 16384;

/** Encode the same stereo 48 kHz mix used by WAV export. Runs in its own worker. */
export async function encodeMp3(
  channels: Float32Array[],
  sampleRate: number,
  onProgress?: (percent: number) => void,
  wasm: string | Uint8Array = "/audio/mp3.wasm",
): Promise<ArrayBuffer> {
  if (sampleRate !== 48000)
    throw new Error("MP3 export requires a 48 kHz mix.");
  if (channels.length !== 2)
    throw new Error("MP3 export requires a stereo mix.");
  if (channels[0].length !== channels[1].length)
    throw new Error("MP3 channels must have the same length.");
  const length = channels[0].length;
  if (!length) throw new Error("The rendered mix is empty.");
  const encoder = await createEncoder("audio/mpeg", wasm);
  encoder.configure({
    channels: 2,
    sampleRate: 48000,
    outputSampleRate: 48000,
    bitrate: 320, // kbit/s; no vbrQuality means constant bitrate.
  });
  const chunks: Uint8Array[] = [];
  let byteLength = 0,
    previousPercent = -1;
  const report = (percent: number) => {
    if (percent !== previousPercent) {
      previousPercent = percent;
      onProgress?.(percent);
    }
  };
  const retain = (bytes: Uint8Array) => {
    // LAME owns this memory and reuses it for the next encode/flush call.
    if (bytes.length) {
      const copy = bytes.slice();
      chunks.push(copy);
      byteLength += copy.byteLength;
    }
  };
  report(0);
  for (let offset = 0; offset < length; offset += CHUNK_SAMPLES) {
    const end = Math.min(offset + CHUNK_SAMPLES, length);
    const pcm = channels.map((channel) => {
      const chunk = channel.slice(offset, end);
      for (let index = 0; index < chunk.length; index++)
        chunk[index] = Number.isFinite(chunk[index])
          ? Math.max(-1, Math.min(1, chunk[index]))
          : 0;
      return chunk;
    });
    retain(encoder.encode(pcm));
    report(Math.min(99, Math.floor((end / length) * 100)));
  }
  retain(encoder.finalize());
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  report(100);
  return result.buffer;
}
