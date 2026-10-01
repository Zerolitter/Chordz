import { build } from "esbuild";
import { copyFile } from "node:fs/promises";
await build({
  entryPoints: ["lib/audio/processor.worker.ts", "lib/audio/mp3.worker.ts", "lib/audio/reference.worker.ts", "lib/audio/sample-refinement.worker.ts"],
  outdir: "public/audio",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
});
await copyFile(
  new URL(import.meta.resolve("wasm-media-encoders/wasm/mp3")),
  "public/audio/mp3.wasm",
);
await copyFile(new URL("../node_modules/fft.js/README.md", import.meta.url), "public/audio/licenses/fft.js-NOTICE.txt");
console.log("Audio processing, MP3, reference and sample-refinement workers built.");
