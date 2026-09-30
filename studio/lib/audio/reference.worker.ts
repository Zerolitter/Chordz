import { ReferenceAnalyzer, type ReferenceMetadata, type ReferenceRange } from "./reference-analysis";
import { ReferenceWaveform } from "./reference-analysis-waveform";
const worker = globalThis as unknown as { onmessage: (event: MessageEvent) => void; postMessage: (message: unknown) => void };
let analyzer: ReferenceAnalyzer | null = null, received = 0, expected = 0;
let waveform: ReferenceWaveform | null = null;
worker.onmessage = (event: MessageEvent) => {
  try {
    const message = event.data;
    if (message.type === "waveform-start") {
      waveform = new ReferenceWaveform(message.length, message.channels); analyzer = null; received = 0; expected = message.length;
      worker.postMessage({ type: "ready" });
    } else if (message.type === "start") {
      const metadata = message.metadata as ReferenceMetadata, range = message.range as ReferenceRange;
      analyzer = new ReferenceAnalyzer(metadata, range); waveform = null; received = 0; expected = Math.ceil((range.endSec - range.startSec) * metadata.sampleRate);
      worker.postMessage({ type: "ready" });
    } else if (message.type === "chunk" && (analyzer || waveform)) {
      const channels = (message.channels as ArrayBuffer[]).map(b => new Float32Array(b));
      if (analyzer) analyzer.push(channels); else waveform!.push(channels); received += channels[0].length;
      worker.postMessage({ type: "ack", percent: Math.min(waveform ? 100 : 20, received / expected * (waveform ? 100 : 20)) });
    } else if (message.type === "finish" && waveform) {
      const peaks = waveform.finish(); waveform = null; worker.postMessage({ type: "waveform", peaks });
    } else if (message.type === "finish" && analyzer) {
      const profile = analyzer.finish(percent => worker.postMessage({ type: "progress", percent }));
      analyzer = null; worker.postMessage({ type: "result", profile });
    } else throw new Error("Invalid reference analysis request.");
  } catch (error) {
    analyzer = null; waveform = null; worker.postMessage({ type: "error", error: error instanceof Error ? error.message : "Reference analysis failed." });
  }
};
