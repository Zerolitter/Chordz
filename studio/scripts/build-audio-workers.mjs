import { build } from "esbuild";
await build({
  entryPoints: ["lib/audio/processor.worker.ts"],
  outfile: "public/audio/processor.worker.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
});
console.log("Audio processing worker built.");
