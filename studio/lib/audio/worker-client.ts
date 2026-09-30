export class AudioProcessor {
  private worker: Worker | null = null;
  private next = 0;
  private jobs = new Map<
    number,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
    }
  >();
  private getWorker() {
    if (!this.worker) {
      this.worker = new Worker("/audio/processor.worker.js", {
        type: "module",
      });
      this.worker.onmessage = (event) => {
        const job = this.jobs.get(event.data.id);
        if (!job) return;
        this.jobs.delete(event.data.id);
        if (event.data.type === "error")
          job.reject(new Error(event.data.error));
        else job.resolve(event.data);
      };
      this.worker.onerror = () => {
        for (const job of this.jobs.values())
          job.reject(
            new Error(
              "The audio processing worker stopped. Try the export again.",
            ),
          );
        this.jobs.clear();
        this.worker?.terminate();
        this.worker = null;
      };
    }
    return this.worker;
  }
  async run(message: Record<string, unknown>, transfer: Transferable[] = []) {
    const id = ++this.next;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      this.jobs.set(id, { resolve, reject });
      try {
        this.getWorker().postMessage({ ...message, id }, transfer);
      } catch (error) {
        this.jobs.delete(id);
        reject(error);
      }
    });
  }
  send(message: Record<string, unknown>, transfer: Transferable[] = []) {
    this.getWorker().postMessage(message, transfer);
  }
  async encode(buffer: AudioBuffer, bitDepth: 16 | 24 = 24) {
    const channels = Array.from(
      { length: buffer.numberOfChannels },
      (_, i) => buffer.getChannelData(i).slice().buffer,
    );
    const result = await this.run(
      { type: "encode", sampleRate: buffer.sampleRate, bitDepth, channels },
      channels,
    );
    return new Blob([result.wav as ArrayBuffer], { type: "audio/wav" });
  }
  async peaks(buffer: AudioBuffer, bins = 200) {
    const channel = buffer.getChannelData(0).slice().buffer;
    const result = await this.run(
      { type: "peaks", channels: [channel], bins },
      [channel],
    );
    return result.peaks as number[];
  }
  dispose() {
    this.worker?.terminate();
    this.worker = null;
    for (const job of this.jobs.values())
      job.reject(new Error("Audio processing was closed."));
    this.jobs.clear();
  }
}
