import { build } from "esbuild";
import { copyFile } from "node:fs/promises";
await build({
  entryPoints: ["lib/audio/processor.worker.ts", "lib/audio/mp3.worker.ts"],
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
console.log("Audio processing and MP3 workers built.");
