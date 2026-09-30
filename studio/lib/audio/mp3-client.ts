/** A fresh, lazy worker per export keeps MP3 failures separate from recording. */
export async function encodeMp3Buffer(
  buffer: AudioBuffer,
  onProgress?: (percent: number) => void,
): Promise<Blob> {
  const worker = new Worker("/audio/mp3.worker.js", { type: "module" });
  return new Promise<Blob>((resolve, reject) => {
    const cleanup = () => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    };
    const fail = (error: unknown) => {
      cleanup();
      reject(error instanceof Error ? error : new Error("MP3 encoding failed."));
    };
    worker.onmessage = (event: MessageEvent) => {
      const message = event.data;
      try {
        if (message?.type === "progress" && Number.isFinite(message.percent)) {
          onProgress?.(Math.max(0, Math.min(100, message.percent)));
        } else if (
          message?.type === "result" && message.mp3 instanceof ArrayBuffer
        ) {
          const blob = new Blob([message.mp3], { type: "audio/mpeg" });
          cleanup();
          resolve(blob);
        } else if (message?.type === "error") {
          fail(new Error(message.error || "MP3 encoding failed."));
        } else fail(new Error("The MP3 worker returned an invalid response."));
      } catch (error) {
        fail(error);
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail(new Error("The MP3 encoder stopped. Try the export again."));
    };
    worker.onmessageerror = () =>
      fail(new Error("The MP3 worker could not return its audio. Try again."));
    try {
      const channels = Array.from(
        { length: buffer.numberOfChannels },
        (_, channel) => buffer.getChannelData(channel).slice().buffer,
      );
      worker.postMessage(
        { type: "encode", sampleRate: buffer.sampleRate, channels },
        channels,
      );
    } catch (error) {
      fail(error);
    }
  });
}
