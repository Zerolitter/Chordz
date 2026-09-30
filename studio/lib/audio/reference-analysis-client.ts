import { isReferenceProfile, validateReferenceBuffer, type ReferenceMetadata, type ReferenceProfile, type ReferenceRange } from "./reference-analysis-data";

/** One worker per job, one acknowledged chunk in flight, no recording/export worker reuse. */
interface JobOptions { signal?: AbortSignal; onProgress?: (percent: number) => void }
export async function analyzeReferenceBuffer(buffer: AudioBuffer, metadata: ReferenceMetadata, range: ReferenceRange, options: JobOptions = {}): Promise<ReferenceProfile> {
  if (metadata.sampleRate !== buffer.sampleRate || metadata.channels !== buffer.numberOfChannels || Math.abs(metadata.duration - buffer.duration) > .01) throw new Error("Reference metadata does not match the decoded audio.");
  return runReferenceWorker(buffer, range, { type: "start", metadata, range }, "result", options) as Promise<ReferenceProfile>;
}
export async function referenceWaveform(buffer: AudioBuffer, options: JobOptions = {}): Promise<number[]> {
  return runReferenceWorker(buffer, { startSec: 0, endSec: buffer.duration }, { type: "waveform-start", length: buffer.length, channels: buffer.numberOfChannels }, "waveform", options) as Promise<number[]>;
}
async function runReferenceWorker(buffer: AudioBuffer, range: ReferenceRange, startMessage: unknown, resultType: "result" | "waveform", options: JobOptions): Promise<ReferenceProfile | number[]> {
  validateReferenceBuffer(buffer);
  if (options.signal?.aborted) throw new DOMException("Reference analysis cancelled.", "AbortError");
  const start = Math.floor(range.startSec * buffer.sampleRate), end = range.endSec === buffer.duration ? buffer.length : Math.min(buffer.length, Math.floor(range.endSec * buffer.sampleRate));
  if (!Number.isFinite(range.startSec) || !Number.isFinite(range.endSec) || start < 0 || end <= start || range.endSec > buffer.duration + .001) throw new Error("Select a valid reference range.");
  const worker = new Worker("/audio/reference.worker.js", { type: "module" });
  return new Promise((resolve, reject) => {
    let offset = start, settled = false, waiting = false;
    const cleanup = () => { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); options.signal?.removeEventListener("abort", abort); };
    const fail = (error: unknown) => { if (settled) return; settled = true; cleanup(); reject(error instanceof Error ? error : new Error(String(error))); };
    const abort = () => fail(new DOMException("Reference analysis cancelled.", "AbortError"));
    const send = () => {
      if (offset >= end) { worker.postMessage({ type: "finish" }); return; }
      const next = Math.min(end, offset + Math.round(buffer.sampleRate * 2));
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, ch) => buffer.getChannelData(ch).slice(offset, next).buffer);
      offset = next; waiting = true; worker.postMessage({ type: "chunk", channels }, channels);
    };
    worker.onmessage = event => {
      try {
        const message = event.data;
        if (message?.type === "ready" && offset === start && !waiting) send();
        else if (message?.type === "ack" && waiting && Number.isFinite(message.percent)) { waiting = false; options.onProgress?.(message.percent); send(); }
        else if (message?.type === "progress" && Number.isFinite(message.percent)) options.onProgress?.(Math.max(0, Math.min(100, message.percent)));
        else if (resultType === "waveform" && message?.type === "waveform" && Array.isArray(message.peaks) && message.peaks.length === 320 && message.peaks.every((v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1)) { settled = true; cleanup(); resolve(message.peaks); }
        else if (resultType === "result" && message?.type === "result" && isReferenceProfile(message.profile)) { settled = true; cleanup(); resolve(message.profile); }
        else if (message?.type === "error") fail(new Error(message.error || "Reference analysis failed."));
        else fail(new Error("The reference worker returned an invalid response."));
      } catch (error) { fail(error); }
    };
    worker.onerror = event => { event.preventDefault(); fail(new Error("Reference analysis stopped. Try again.")); };
    worker.onmessageerror = () => fail(new Error("The reference worker could not return its result. Try again."));
    options.signal?.addEventListener("abort", abort, { once: true });
    try { worker.postMessage(startMessage); } catch (error) { fail(error); }
  });
}
