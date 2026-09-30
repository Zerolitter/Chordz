import { encodeMp3 } from "./mp3";

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
worker.onmessage = async (event: MessageEvent) => {
  try {
    if (event.data?.type !== "encode") throw new Error("Unknown MP3 request.");
    const channels = event.data.channels.map(
      (buffer: ArrayBuffer) => new Float32Array(buffer),
    );
    const mp3 = await encodeMp3(channels, event.data.sampleRate, (percent) =>
      worker.postMessage({ type: "progress", percent }),
    );
    worker.postMessage({ type: "result", mp3 }, [mp3]);
  } catch (error) {
    worker.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : "MP3 encoding failed.",
    });
  }
};
