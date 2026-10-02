# Sample refinement verification

Date: 1 October 2026. Base: a9d07d9540795c7017b2a27d123a6ab04e856d1c, the merged shared-workspace/reusable-library implementation.

## Automated checks

- TypeScript: `tsc --noEmit` passed.
- Complete unit suite: 324 tests across 36 files passed, including 15 new DSP/search/provenance/library tests.
- Targeted Chrome browser suite: 20 tests passed (sample-refinement, reference-analysis and reusable-library specs). This is not a claim that the entire browser suite was run.
- Local HTTP service: 12 standard-library tests passed, covering authentication, exact origins/Host, bounded WAV validation, single-worker concurrency, subprocess cancellation, cancellation-before-upload, expiry and cleanup.
- Production build: `node scripts/run-framework.mjs build` passed. The bundler reports a greater-than-500-kB chunk warning; this is not treated as a passing performance benchmark.

The HTTP unit tests use an explicitly named fake subprocess and the browser transport test uses synthetic responses. The separate tests below exercised actual trained models.

## Real-model smoke tests

An eight-second excerpt of a user-provided stereo recording was read locally after verifying that its complete-file hash matched the uploaded input. No user recording, model weights or runtime environment is committed.

Environment: Windows, isolated Python 3.11.16, torch/torchaudio 2.5.1+cpu, Demucs 4.0.1, SoundFile 0.13.1, NumPy 1.26.4, two inference threads. Source: 48,000 Hz, two channels, 384,000 frames.

| Model / target | Process runtime | Output | Observation |
| --- | ---: | --- | --- |
| htdemucs / bass | 16.468 s | Same rate, channels and frame count; finite samples | Raw float output peak was 1.3623, demonstrating why linked peak protection is needed. |
| htdemucs_6s / piano | 17.234 s | Same rate, channels and frame count; finite samples | About -70.9 dBFS RMS; a very weak candidate, not evidence of a usable piano sample. |

The outputs retained nonzero left/right differences; they were not silently averaged into mono. Adding target and computed residual reconstructed the source to within 1.2e-7 numerical error. Neither observation proves perceptual separation quality.

## Real browser -> service -> model -> library check

A separate Chrome run used the actual authenticated loopback service and htdemucs, without a mocked transport. It extracted bass from the excerpt, exercised fractional-second/frame-boundary cropping, auditioned the processed result and saved an independent library entry as **Needs review**. No human-review approval was asserted.

Observed: zero page errors, no `/api/assets` audio upload, no document horizontal overflow at 1024 x 768, and no temporary job folders remaining after result retrieval/deletion. The 1440 x 1000 and 1024 x 768 layouts were captured for inspection. The temporary validation service was closed afterward.

Browser testing also caught and fixed a catalogue issue: inserting a refined audio texture must not add a dummy synthesizer to the Sounds browser. A regression assertion covers this separately from normal sampled-instrument insertion.

## Release boundaries

Perceptual listening approval has not been performed. These are execution, integration and signal-integrity results, not certification that any extracted part is musically clean. Arbitrary text/span-directed isolation, SAM Audio, automatic note detection, multisampling, sustain-loop generation and synth recreation are outside this release. Piano/guitar remain explicitly experimental.

The hosted HTTPS origin and packaged Tauri/WebView local-network permission flow still need validation in those exact runtimes. Current functional browser verification used a loopback development origin. This work does not merge or deploy production.

See [sample-refinement.md](sample-refinement.md) for use, installation, privacy and reproducible test commands. New provenance metadata is optional for existing projects, but archives carrying it require an updated Chordz reader; older strict-schema builds may reject those new fields.
