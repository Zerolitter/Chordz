import { describe, expect, it } from "vitest";
import { createMp3Encoder } from "wasm-media-encoders";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { encodeMp3 as encode } from "../lib/audio/mp3";

const wasm = new Uint8Array(readFileSync(createRequire(import.meta.url).resolve("wasm-media-encoders/wasm/mp3")));
const encodeMp3 = (channels: Float32Array[], sampleRate: number, progress?: (percent: number) => void) =>
  encode(channels, sampleRate, progress, wasm);

function stereoTone(length = 48000) {
  return [440, 660].map((frequency) =>
    Float32Array.from(
      { length },
      (_, index) => 0.3 * Math.sin((2 * Math.PI * frequency * index) / 48000),
    ),
  );
}

describe("MP3 mix encoding", () => {
  it("writes every frame as MPEG-1 stereo, 48 kHz, 320 kbps CBR", async () => {
    const progress: number[] = [];
    const bytes = new Uint8Array(
      await encodeMp3(stereoTone(), 48000, (value) => progress.push(value)),
    );
    // At this rate every MPEG-1 Layer III frame is 960 bytes long.
    expect(bytes.byteLength).toBeGreaterThanOrEqual(40000);
    expect(bytes.byteLength).toBeLessThan(43000);
    expect(bytes.byteLength % 960).toBe(0);
    for (let offset = 0; offset < bytes.length; offset += 960) {
      const header = new DataView(bytes.buffer).getUint32(offset);
      expect(header >>> 21).toBe(0x7ff);
      expect((header >>> 19) & 3).toBe(3);
      expect((header >>> 17) & 3).toBe(1);
      expect((header >>> 12) & 15).toBe(14);
      expect((header >>> 10) & 3).toBe(1);
      expect((header >>> 6) & 3).not.toBe(3);
    }
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(100);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it("does not mutate PCM while handling out-of-range and nonfinite samples", async () => {
    const channels = stereoTone(18000);
    channels[0].set([2, -2, NaN, Infinity, -Infinity]);
    const original = channels.map((channel) => channel.slice());
    const bytes = await encodeMp3(channels, 48000);
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(channels).toEqual(original);
  });

  it("preserves encoded frame payloads across chunk boundaries and flushing", async () => {
    const channels = stereoTone();
    const reference = await createMp3Encoder();
    reference.configure({ channels: 2, sampleRate: 48000, outputSampleRate: 48000, bitrate: 320 });
    const body = reference.encode(channels).slice();
    const tail = reference.finalize().slice();
    const expected = new Uint8Array(body.length + tail.length);
    expected.set(body);
    expected.set(tail, body.length);
    expect(new Uint8Array(await encodeMp3(channels, 48000))).toEqual(expected);
  });

  it("rejects unsupported render settings and unequal or empty channels", async () => {
    await expect(encodeMp3(stereoTone(), 44100)).rejects.toThrow("48 kHz");
    await expect(encodeMp3([new Float32Array(10)], 48000)).rejects.toThrow("stereo");
    await expect(
      encodeMp3([new Float32Array(10), new Float32Array(9)], 48000),
    ).rejects.toThrow("same length");
    await expect(
      encodeMp3([new Float32Array(), new Float32Array()], 48000),
    ).rejects.toThrow("empty");
  });
});
