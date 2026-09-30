import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeReferenceBuffer } from "../lib/audio/reference-analysis-client";
import { ReferenceAnalyzer } from "../lib/audio/reference-analysis";
class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null; onerror: ((e: ErrorEvent) => void) | null = null; onmessageerror: (() => void) | null = null;
  stopped = false; messages: { type: string; channels?: ArrayBuffer[] }[] = [];
  constructor() { TestWorker.instances.push(this); }
  postMessage(message: { type: string; channels?: ArrayBuffer[] }) { this.messages.push(message); }
  terminate() { this.stopped = true; }
  reply(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}
function fixture() {
  const pcm = new Float32Array(36000), buffer = { duration: 3, length: pcm.length, sampleRate: 12000, numberOfChannels: 1, getChannelData: () => pcm } as unknown as AudioBuffer;
  const metadata = { name: "Silent", fingerprint: "test", byteLength: 1, sampleRate: 12000, duration: 3, channels: 1 }, range = { startSec: 0, endSec: 3 };
  return { pcm, buffer, metadata, range };
}
afterEach(() => { vi.unstubAllGlobals(); TestWorker.instances = []; });
describe("private reference analysis worker", () => {
  it("bounds PCM copies by acknowledgment, preserves playback data and cleans up after a result", async () => {
    vi.stubGlobal("Worker", TestWorker); const f = fixture(), percent: number[] = [];
    const result = analyzeReferenceBuffer(f.buffer, f.metadata, f.range, { onProgress: p => percent.push(p) }), worker = TestWorker.instances[0];
    expect(worker.messages).toHaveLength(1); worker.reply({ type: "ready" });
    expect(worker.messages).toHaveLength(2); expect(worker.messages[1].channels![0].byteLength).toBe(24000 * 4);
    expect(worker.messages[1].channels![0]).not.toBe(f.pcm.buffer);
    worker.reply({ type: "ack", percent: 12 }); expect(worker.messages[2].channels![0].byteLength).toBe(12000 * 4);
    worker.reply({ type: "ack", percent: 20 }); expect(worker.messages[3].type).toBe("finish");
    const analyzer = new ReferenceAnalyzer(f.metadata, f.range); analyzer.push([f.pcm]); const profile = analyzer.finish();
    worker.reply({ type: "result", profile }); expect(await result).toEqual(profile); expect(worker.stopped).toBe(true); expect(f.pcm.length).toBe(36000); expect(percent).toEqual([12, 20]);
  });
  it("cancels a busy job immediately and permits a fresh retry", async () => {
    vi.stubGlobal("Worker", TestWorker); const f = fixture(), controller = new AbortController();
    const result = analyzeReferenceBuffer(f.buffer, f.metadata, f.range, { signal: controller.signal }), rejection = expect(result).rejects.toMatchObject({ name: "AbortError" });
    TestWorker.instances[0].reply({ type: "ready" }); controller.abort(); await rejection;
    expect(TestWorker.instances[0].stopped).toBe(true); expect(TestWorker.instances[0].onmessage).toBeNull();
    const retry = analyzeReferenceBuffer(f.buffer, f.metadata, f.range), retryReject = expect(retry).rejects.toThrow("Try again");
    TestWorker.instances[1].onerror!({ preventDefault() {} } as ErrorEvent); await retryReject; expect(TestWorker.instances[1].stopped).toBe(true);
  });
  it("does not start an already aborted job and rejects malformed worker responses", async () => {
    vi.stubGlobal("Worker", TestWorker); const f = fixture(), controller = new AbortController(); controller.abort();
    await expect(analyzeReferenceBuffer(f.buffer, f.metadata, f.range, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" }); expect(TestWorker.instances).toHaveLength(0);
    const result = analyzeReferenceBuffer(f.buffer, f.metadata, f.range), rejection = expect(result).rejects.toThrow("invalid response");
    TestWorker.instances[0].reply({ type: "result", profile: { version: 1 } }); await rejection; expect(TestWorker.instances[0].stopped).toBe(true);
  });
});
