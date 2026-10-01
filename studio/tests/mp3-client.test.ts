import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeMp3Buffer } from "../lib/audio/mp3-client";

class TestWorker {
  static instances: TestWorker[] = [];
  static postingError = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  stopped = false;
  message?: { channels: ArrayBuffer[]; sampleRate: number };
  constructor() { TestWorker.instances.push(this); }
  postMessage(message: { channels: ArrayBuffer[]; sampleRate: number }) {
    if (TestWorker.postingError) throw new Error("Posting failed");
    this.message = message;
  }
  terminate() { this.stopped = true; }
  reply(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
  fail() { this.onerror?.({ preventDefault() {} } as ErrorEvent); }
}

function audioBuffer() {
  const channels = [new Float32Array([0.1, -0.1]), new Float32Array([0.2, -0.2])];
  return {
    numberOfChannels: 2,
    sampleRate: 48000,
    length: 2,
    getChannelData: (channel: number) => channels[channel],
  } as AudioBuffer;
}

afterEach(() => {
  vi.unstubAllGlobals();
  TestWorker.instances = [];
  TestWorker.postingError = false;
});

describe("dedicated MP3 worker client", () => {
  it("terminates an aborted encoder and ignores its late bytes and progress",async()=>{
    vi.stubGlobal("Worker",TestWorker);const controller=new AbortController(),progress:number[]=[];
    const result=encodeMp3Buffer(audioBuffer(),value=>progress.push(value),controller.signal);void result.catch(()=>{});
    const worker=TestWorker.instances[0];controller.abort();expect(worker.stopped).toBe(true);
    worker.reply({type:"progress",percent:90});worker.reply({type:"result",mp3:new ArrayBuffer(8)});
    await expect(result).rejects.toMatchObject({name:"AbortError"});expect(progress).toEqual([]);
  });
  it("does not create a worker or copy PCM when encoding is already cancelled",async()=>{
    vi.stubGlobal("Worker",TestWorker);const controller=new AbortController();controller.abort();
    await expect(encodeMp3Buffer(audioBuffer(),undefined,controller.signal)).rejects.toMatchObject({name:"AbortError"});
    expect(TestWorker.instances).toHaveLength(0);
  });
  it("returns an audio/mpeg Blob, reports progress and releases its worker", async () => {
    vi.stubGlobal("Worker", TestWorker);
    const buffer = audioBuffer(), progress: number[] = [];
    const result = encodeMp3Buffer(buffer, (value) => progress.push(value));
    const worker = TestWorker.instances[0];
    expect(worker.message?.channels[0]).not.toBe(buffer.getChannelData(0).buffer);
    expect(worker.message?.sampleRate).toBe(48000);
    worker.reply({ type: "progress", percent: 70 });
    worker.reply({ type: "result", mp3: new Uint8Array([255, 251, 228, 0]).buffer });
    const blob = await result;
    expect(blob.type).toBe("audio/mpeg");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([255, 251, 228, 0]));
    expect(progress).toEqual([70]);
    expect(worker.stopped).toBe(true);
  });

  it("rejects worker failures and can retry using a fresh worker", async () => {
    vi.stubGlobal("Worker", TestWorker);
    const failed = encodeMp3Buffer(audioBuffer());
    const rejection = expect(failed).rejects.toThrow("MP3");
    TestWorker.instances[0].fail();
    await rejection;
    expect(TestWorker.instances[0].stopped).toBe(true);
    const retried = encodeMp3Buffer(audioBuffer());
    TestWorker.instances[1].reply({ type: "result", mp3: new Uint8Array([1]).buffer });
    expect((await retried).size).toBe(1);
    expect(TestWorker.instances[1].stopped).toBe(true);
  });

  it("rejects encoder and posting errors without leaving workers alive", async () => {
    vi.stubGlobal("Worker", TestWorker);
    const failed = encodeMp3Buffer(audioBuffer());
    const rejection = expect(failed).rejects.toThrow("Encoder unavailable");
    TestWorker.instances[0].reply({ type: "error", error: "Encoder unavailable" });
    await rejection;
    expect(TestWorker.instances[0].stopped).toBe(true);
    TestWorker.postingError = true;
    await expect(encodeMp3Buffer(audioBuffer())).rejects.toThrow("Posting failed");
    expect(TestWorker.instances[1].stopped).toBe(true);
  });
});
