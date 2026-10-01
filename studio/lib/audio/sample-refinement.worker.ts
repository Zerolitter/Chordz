import { SimilarityAnalyzer } from "./sample-refinement";
const worker = globalThis as unknown as { onmessage: (event: MessageEvent) => void; postMessage(message: unknown): void };
let analyzer: SimilarityAnalyzer | null = null;
worker.onmessage = event => {
  try {
    const message = event.data;
    if (message?.type === "start") { analyzer = new SimilarityAnalyzer(message.sampleRate, message.channels, message.length); worker.postMessage({ type: "ready" }); }
    else if (message?.type === "chunk" && analyzer) { analyzer.push(message.channels.map((buffer: ArrayBuffer) => new Float32Array(buffer))); worker.postMessage({ type: "ack" }); }
    else if (message?.type === "finish" && analyzer) { const matches = analyzer.finish(message.range); analyzer = null; worker.postMessage({ type: "result", matches }); }
    else throw Error("Invalid similar-moment search request.");
  } catch (error) { analyzer = null; worker.postMessage({ type: "error", error: error instanceof Error ? error.message : "Sample search failed." }); }
};
