# Sample refinement: extract a reusable sound

This feature extends the existing Reference detail tool and device library. It does not replace the shared canvas, transport, keyboard controller or audio engine.

## What is implemented

Open **Refine a sample** in the library, import a WAV or MP3 under **Reference audio**, and select 0.05-20 seconds. **Find similar moments** streams small chunks to a dedicated worker and suggests up to five non-overlapping matches. Matches describe spectral/envelope similarity, not instrument identity or a guarantee of cleaner audio. Search requires at least 0.3 seconds.

**Keep as mixed texture** works without a model. It trims a useful excerpt but does not claim to remove overlapping instruments. Real instrument-group extraction uses the optional local Demucs service below. Only the selected excerpt plus up to two seconds of context on either side reaches that service. It never accepts more than 24 seconds at once.

Compare **Original**, **Extracted / natural**, **Refined**, and **Residual** through the existing shared audio engine. Audition gains are level-matched; they do not change saved audio. Residual is the aligned source minus the unmodified separator output. It is not proof that the target was recovered correctly.

Refinement applies short edge fades, linked peak protection and optional stereo-linked attenuation of low-level material, limited to 6 dB. It does not use a hard gate, arbitrary EQ, independent left/right masks, or another source-separation model. It cannot remove a second instrument coinciding with the target at comparable level. The natural alternative remains available.

Audition a result before saving it. Unreviewed extractions remain **Needs review**; a positive isolation review is explicitly a human judgment, not a model score. Trimmed audio and the **Other instruments** stem remain **Mixed texture** and cannot be saved as an approved isolated instrument.

Audio phrases save under **Ideas**. A reviewed single note or hit can instead be saved under **Sounds**, using a manually chosen MIDI root and a limited +/-7-semitone mapping. The user must confirm that it is a single note/hit, not a chord. This is a sampled instrument, not automatic pitch detection, note transcription, multisampling or synth cloning. There is no automatic sustain loop.

Each library save is an independent atomic copy containing the output WAV, an unprocessed decoded source-context WAV and a validated recipe (source SHA-256, name, boundaries, target, model, method, reduction and review state). The retained original is the selected decoded excerpt with context, **not the entire original MP3 file or a bit-identical MP3 archive**. Library backups carry both audio files. Insertion copies only the playable output to the song, retaining provenance metadata; the original remains private in the library. Deleting the library entry does not delete music already inserted in a song. Song insertion uses existing revision checks and Undo.

## Optional local separation engine

The service binds only to `127.0.0.1:47831`. Every data endpoint requires a freshly generated session token. Browser access uses an exact origin allowlist, not `*`; Host checks protect against rebinding. The browser does not save the token. No hosted Chordz API receives the audio. One bounded worker process runs at a time with two CPU inference threads by default. Cancel terminates that process and removes its temporary audio. Completed abandoned jobs expire after five minutes; running jobs are bounded by a nine-minute process timeout. A forced OS termination can leave temporary files, so use a dedicated temporary folder.

The HTTP service and its tests use Python's standard library. Model execution is isolated into a separate process/environment; do not install its dependencies into an unrelated project or an active music environment.

### Windows setup (explicit downloads)

Use a separate **Python 3.11** environment for the model. Python 3.14 can run the HTTP server tests but is not the pinned model runtime. From the repository root in PowerShell:

```powershell
py -3.11 -m venv tools/sample-engine/.venv
$python = Resolve-Path tools/sample-engine/.venv/Scripts/python.exe
& $python -m pip install --upgrade pip
# Reproducible CPU pair. Choose an appropriate matching CUDA pair separately when using a GPU.
& $python -m pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu
& $python -m pip install -r tools/sample-engine/requirements.txt
# This command explicitly downloads the model. No music is sent with it.
& $python tools/sample-engine/worker.py --cache tools/sample-engine/.models --prepare htdemucs
```

For experimental piano/guitar extraction, prepare the separate six-stem model explicitly:

```powershell
& $python tools/sample-engine/worker.py --cache tools/sample-engine/.models --prepare htdemucs_6s
```

Start the service:

```powershell
& $python tools/sample-engine/server.py --cache tools/sample-engine/.models --work-dir D:/tmp/chordz-sample-engine --origin http://127.0.0.1:5173
```

The production origin `https://www.chordz.zerolitter.net` is allowed by default. The additional origin above is only for the local development server. Supply another exact `--origin` only for a trusted deployment; never permit arbitrary origins. Paste the printed token into **Local separation engine** and choose **Connect local engine**. Keep the terminal open during extraction; Ctrl+C stops the service. Do not paste the token into issues, commits or logs.

Linux/macOS: use `python3.11 -m venv`, the environment's `bin/python`, and a local temporary directory instead of the Windows paths. GPU execution is opt-in with `--device cuda`; install a compatible matching PyTorch/torchaudio build first. No worker is launched by opening Chordz and no checkpoint is downloaded by an extraction request. Missing packages or model files produce an error rather than a fake extraction.

A browser or WebView may ask permission to reach localhost or block local-network requests from the hosted app. Permit the request only for your trusted Chordz origin. Never weaken browser security globally. Local development at `http://127.0.0.1:5173` provides a direct test path. Packaged WebView/hosted-origin behavior needs verification in its actual runtime; this feature does not claim all browser policies are identical.

### Model scope and quality limitations

`htdemucs` extracts vocals, drums, bass or an **other** group. `htdemucs_6s` adds piano and guitar but those targets remain experimental, with potential bleed and artifacts. Neither model can reliably separate every individual instrument in its group. Descriptions such as "that short metallic pluck" and selection-guided SAM Audio are not wired in this release. No downloaded model, license or dependency is bundled into the web app or Tauri installer.

The adapter preserves original sample rate, channel count and frame count. Mono input is mapped back to mono; stereo channels are not averaged into a mono output. A changed or misaligned output is rejected by the UI. Numerical signal checks detect invalid samples, silence and suspicious loss of energy, but they do not establish musical fidelity or clean separation.

Primary references for the optional adapter and installation:
- Demucs implementation/model caveats: https://github.com/facebookresearch/demucs
- PyTorch version-specific installation: https://pytorch.org/get-started/previous-versions/
- SoundFile WAV I/O: https://python-soundfile.readthedocs.io/

## Verification

```powershell
cd studio
npm ci --no-audit --no-fund
npm run typecheck
npm test
node scripts/build-audio-workers.mjs
# Start npm run dev in another terminal before browser tests.
npx playwright test tests/browser/sample-refinement.spec.ts
cd ..
python -m unittest discover -s tools/sample-engine -p test_server.py -v
```

The HTTP contract tests use a clearly named deterministic subprocess test double. Browser transport tests may use synthetic server responses. Neither is evidence of trained-model separation quality. Record any real-model test separately, including environment, checkpoint, input, channels, alignment, runtime and actual audition observations. Do not label a passing fake-worker test as a quality result.

For musical acceptance, compare a real input alone and in a different backing track. Listen for remaining instruments, lost attacks, damaged decays, phasiness and unstable sustains. Known-source synthetic mixtures allow signal comparisons, but cannot replace auditioning actual music. An extraction may correctly remain unsuitable for reuse.
