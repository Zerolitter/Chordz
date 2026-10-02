import { z } from "zod";
import { encodeWav } from "./wav";
import { validateReferenceBuffer } from "./reference-analysis-data";
import { validatePCM, validateSampleRange, type PCM, type SampleRange, type SimilarMoment } from "./sample-refinement";

export const LOCAL_REFINER = "http://127.0.0.1:47831";
export const separationTargetSchema = z.enum(["vocals", "drums", "bass", "piano", "guitar", "other"]);
export type SeparationTarget = z.infer<typeof separationTargetSchema>;
const capabilitiesSchema = z.object({
  version: z.literal(1), maxSeconds: z.literal(24),
  models: z.array(z.object({ id: z.enum(["htdemucs", "htdemucs_6s"]), ready: z.boolean(), targets: z.array(separationTargetSchema).max(6) }).strict()).max(2),
}).strict();
export type RefinementCapabilities = z.infer<typeof capabilitiesSchema>;
const statusSchema = z.object({ id: z.string().uuid(), state: z.enum(["queued", "running", "complete", "failed", "cancelled"]), error: z.string().max(500).optional() }).strict();
function cancelled(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException("Sample refinement cancelled.", "AbortError"); }
async function pause(ms: number, signal: AbortSignal) {
  cancelled(signal);
  await new Promise<void>((resolve, reject) => {
    const finish = () => { signal.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new DOMException("Sample refinement cancelled.", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
  });
}
async function boundedBytes(response: Response, max: number) {
  if (Number(response.headers.get("content-length")) > max) throw Error("Local engine response exceeds its size limit.");
  const reader = response.body?.getReader(); if (!reader) throw Error("Local engine returned an empty response.");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const next = await reader.read(); if (next.done) break; length += next.value.length; if (length > max) throw Error("Local engine response exceeds its size limit."); chunks.push(next.value); }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const output = new Uint8Array(length); let at = 0; for (const chunk of chunks) { output.set(chunk, at); at += chunk.length; } return output;
}
/** Fixed loopback destination; token is memory-only and no audio reaches a hosted Chordz API. */
export class LocalRefinementClient {
  constructor(private token: string) {
    if (!/^[A-Za-z0-9_-]{24,256}$/.test(token)) throw Error("Paste the connection token printed by the local sample engine.");
  }
  private async request(path: string, options: RequestInit, signal?: AbortSignal) {
    cancelled(signal);
    const timeout = AbortSignal.timeout(15000), combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(LOCAL_REFINER + path, { ...options, signal: combined, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
      headers: { Authorization: `Bearer ${this.token}`, ...options.headers } });
    if (!response.ok) {
      const bytes = await boundedBytes(response, 8192);
      let message = "Local sample engine request failed.";
      try { const data = JSON.parse(new TextDecoder().decode(bytes)); if (typeof data.error === "string") message = data.error.slice(0, 500); } catch { /* Never render server HTML. */ }
      throw Error(message);
    }
    return response;
  }
  private async json(path: string, options: RequestInit, signal?: AbortSignal) {
    const response = await this.request(path, options, signal);
    return JSON.parse(new TextDecoder().decode(await boundedBytes(response, 16384)));
  }
  async capabilities(signal?: AbortSignal): Promise<RefinementCapabilities> { return capabilitiesSchema.parse(await this.json("/v1/capabilities", {}, signal)); }
  async separate(pcm: PCM, target: SeparationTarget, signal: AbortSignal, onStatus: (status: string) => void): Promise<{ blob: Blob; model: string }> {
    validatePCM(pcm); separationTargetSchema.parse(target); cancelled(signal);
    const model = target === "piano" || target === "guitar" ? "htdemucs_6s" : "htdemucs";
    const id = crypto.randomUUID(), lifetime = AbortSignal.any([signal, AbortSignal.timeout(10 * 60 * 1000)]);
    try {
      onStatus("Sending the selected excerpt to your local engine");
      const started = statusSchema.parse(await this.json(`/v1/jobs/${id}?target=${target}&model=${model}`, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: encodeWav(pcm.channels, pcm.sampleRate) }, lifetime));
      if (started.id !== id) throw Error("The local engine returned a different job identity.");
      onStatus("Separating on this device");
      while (true) {
        cancelled(lifetime);
        const state = statusSchema.parse(await this.json(`/v1/jobs/${id}`, {}, lifetime));
        if (state.id !== id) throw Error("The local engine returned a different job identity.");
        if (state.state === "complete") {
          const response = await this.request(`/v1/jobs/${id}/audio`, {}, lifetime);
          if (!response.headers.get("content-type")?.startsWith("audio/wav")) throw Error("The local engine did not return WAV audio.");
          const bytes = await boundedBytes(response, 40 * 1024 * 1024);
          cancelled(lifetime); return { blob: new Blob([bytes], { type: "audio/wav" }), model };
        }
        if (state.state === "failed" || state.state === "cancelled") throw Error(state.error ?? "The extraction did not complete.");
        await pause(750, lifetime);
      }
    } finally {
      // A fresh timeout allows remote cancellation even after the caller's signal aborted.
      await this.request(`/v1/jobs/${id}`, { method: "DELETE" }).then(response => response.body?.cancel()).catch(() => {});
    }
  }
}

export function findSimilarMoments(buffer: AudioBuffer, range: SampleRange, options: { signal?: AbortSignal; onProgress?: (percent: number) => void } = {}): Promise<SimilarMoment[]> {
  validateReferenceBuffer(buffer); validateSampleRange(range, buffer.duration); cancelled(options.signal);
  const worker = new Worker("/audio/sample-refinement.worker.js", { type: "module" });
  return new Promise((resolve, reject) => {
    let offset = 0, waiting = false, settled = false;
    const cleanup = () => { clearTimeout(timer); worker.terminate(); options.signal?.removeEventListener("abort", abort); };
    const fail = (error: unknown) => { if (settled) return; settled = true; cleanup(); reject(error); };
    const abort = () => fail(new DOMException("Sample search cancelled.", "AbortError"));
    const timer = setTimeout(() => fail(Error("Sample search timed out. Try a shorter source.")), 120000);
    const send = () => {
      if (offset === buffer.length) { worker.postMessage({ type: "finish", range }); return; }
      const end = Math.min(buffer.length, offset + Math.round(buffer.sampleRate * 2));
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel).slice(offset, end).buffer);
      offset = end; waiting = true; worker.postMessage({ type: "chunk", channels }, channels);
    };
    worker.onmessage = event => {
      try {
        const message = event.data;
        if (message?.type === "ready" && offset === 0 && !waiting) send();
        else if (message?.type === "ack" && waiting) { waiting = false; options.onProgress?.(offset / buffer.length * 100); send(); }
        else if (message?.type === "result" && !waiting && offset === buffer.length) {
          const matches = z.array(z.object({ startSec: z.number().finite().min(0), endSec: z.number().finite().max(buffer.duration), similarity: z.number().finite().min(0).max(1), activity: z.number().finite().min(0).max(1) }).strict()).max(5).parse(message.matches);
          matches.forEach(match => validateSampleRange(match, buffer.duration)); settled = true; cleanup(); resolve(matches);
        } else if (message?.type === "error") fail(Error(String(message.error).slice(0, 500)));
        else fail(Error("The sample search returned an invalid response."));
      } catch (error) { fail(error); }
    };
    worker.onerror = event => { event.preventDefault(); fail(Error("The sample search worker stopped. Try again.")); };
    worker.onmessageerror = () => fail(Error("The sample search worker returned unreadable data."));
    options.signal?.addEventListener("abort", abort, { once: true });
    try { worker.postMessage({ type: "start", sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, length: buffer.length }); } catch (error) { fail(error); }
  });
}
