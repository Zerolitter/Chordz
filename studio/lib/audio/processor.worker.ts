import { encodeWav, waveformPeaks } from "./wav";

let recording: Float32Array[] = [];
let sampleRate = 48000;
const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
worker.onmessage = (event: MessageEvent) => {
  const message = event.data;
  try {
    if (message.type === "record-start") {
      recording = [];
      sampleRate = message.sampleRate;
    } else if (message.type === "record-chunk") {
      recording.push(new Float32Array(message.buffer));
    } else if (message.type === "record-stop") {
      const length = Math.min(message.length ?? Infinity, recording.reduce((sum, chunk) => sum + chunk.length, 0)),
        channel = new Float32Array(length);
      let offset = 0;
      for (const chunk of recording) {
        if (offset >= length) break;
        const slice = chunk.subarray(0, length-offset);
        channel.set(slice, offset);
        offset += slice.length;
      }
      const wav = encodeWav([channel], sampleRate, 24);
      worker.postMessage(
        {
          id: message.id,
          type: "result",
          wav,
          sampleRate,
          duration: length / sampleRate,
          peaks: waveformPeaks([channel], 240),
        },
        [wav],
      );
    } else if (message.type === "record-clear") {
      recording = [];
    } else if (message.type === "encode") {
      const channels = message.channels.map(
        (buffer: ArrayBuffer) => new Float32Array(buffer),
      );
      const wav = encodeWav(
        channels,
        message.sampleRate,
        message.bitDepth ?? 24,
      );
      worker.postMessage({ id: message.id, type: "result", wav }, [wav]);
    } else if (message.type === "peaks") {
      const channels = message.channels.map(
        (buffer: ArrayBuffer) => new Float32Array(buffer),
      );
      worker.postMessage({
        id: message.id,
        type: "result",
        peaks: waveformPeaks(channels, message.bins ?? 200),
      });
    }
  } catch (error) {
    worker.postMessage({
      id: message.id,
      type: "error",
      error:
        error instanceof Error ? error.message : "Audio processing failed.",
    });
  }
};
