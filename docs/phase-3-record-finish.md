# Phase 3: record, compare and finish

Date: 2026-10-02. Workspace: `D:/.codex/worktrees/db98/Chordz`, branch `codex/phase-3-record-finish`. Continue from merged main `a9d07d9`, whose source tree matches the completed Phase 1 release at `a076a85`. The requested recording, comparison and finishing milestone is implemented and locally verified. Completed 0A/0B/Phase 1 work and the original checkout's three untracked design files remain intact.

## Reconciliation with existing work

The approved specification, implementation plan and 0A/0B/Phase 1 receipts remain the starting point. The roadmap's discovery phase was already delivered as 0B. Phase 3 adds the remaining recording and finishing workflow around existing capture, imported audio, editing, recovery and export.

| Roadmap need | Existing behavior | This milestone |
| --- | --- | --- |
| Clear recording setup | MIDI/microphone capture, devices, monitoring and fixed one-bar count-in | Named destination, nearby input selection/readiness, microphone level check and Off/1/2-bar count-in |
| Review a captured attempt | Durable recovery, selected saved clip, existing Notes / Audio editor | Finish opens the saved take in the shared dock |
| Choose a take before full comping | Multiple captures append clips without replacing earlier music | Individual audio-region comparison with an explicit overlap warning |
| Finish the intended music | WAV, MP3, stems, MIDI and complete project backup | Full-song/selected-section audio range, explicit tails and destination, one ZIP for downloaded stems and cancellation |
| Understand saving | Cloud status and local recovery storage | Separate device-draft receipt with retry, alongside the existing cloud status |

The separate `origin/feat/sample-refinement` branch was inspected read-only before implementation. Its recording-independent work remains separate; it was not merged, recreated or published here.

## Recording and comparison

Open **Record setup** beside the transport to choose the recording destination, microphone or MIDI input and count-in. Destination and count-in are session controls. The destination is scoped to the current owner/song/source and captured before asynchronous preparation. Selecting another track during capture does not redirect the take. A destination that disappears requires an explicit new choice.

**Check microphone** requests access from the user's action and displays the input level without starting playback or creating a take. Optional monitoring remains explicit. Closing setup, changing its scope or pressing Stop releases the disposable input check; a late permission result cannot restart it or disturb a successor recording. The check reports device access and signal level, not a measured round-trip latency or a listening result.

Capture retains the existing preparing/count-in/capturing/finalizing/recovery-error lifecycle. Start/cutoff are measured against the audio clock; held notes, pedals and performance controls retain their independent owners. The count-in choice changes the scheduled start, while the native recording origin remains the timing source. Finish still preserves one identity and commits only after atomic device storage succeeds. Storage failure keeps sealed bytes/events available for Retry or download.

After durable preservation, Finish selects the saved clip and opens Notes / Audio in the existing dock. It retains the finish position. Protected Stop and invalid-field behavior remain intact.

**Choose a take** lists the selected track's existing audio regions, including recordings and imports. Selection opens that region for existing offset/length/start, gain and fade editing. Preview auditions only that region, preserving its source offset, gain, fades and track mix. It pauses an already playing song at its current position and does not resume automatically. The label **Region audition · no song automation** makes the comparison scope explicit.

Comparison changes neither the arrangement nor music history. Earlier attempts are retained. Overlapping regions still play together in the song; the warning directs the user to move or delete unwanted regions explicitly. There is no automatic keeper, clip muting, take-group schema or comp editing. Pending previews retain their own token, terminate before a tool can hide, and cannot cancel a successor preview when late preparation completes. Hidden tools stop their transport subscriptions.

## Export and save receipts

WAV, MP3 and stems offer **Full song** or **Selected section**, an explicit **Include effect tails** choice and **Browser download** or **Choose folder**. MIDI remains a full-song export; a project ZIP remains the complete project with private audio. The summary states these choices before export starts. Browser-downloaded all-track stems arrive as one ZIP, bounded to 512 MiB; folder export writes individual stem files where the browser supports it.

Export captures the committed project, owner, section and choices before a picker, loader or renderer awaits. Selected-section rendering preserves the absolute song timeline during preroll so crossing voices, original audio fades, effects and automation reach the section boundary correctly. Output starts at the section's exact sample boundary, excludes following-section onsets and holds final automation through an included tail. Disabling tails ends output at the musical boundary. Live playback and export continue to share the existing graph and deterministic compilation.

**Cancel export** ends the user-facing job promptly, releases an MP3 encoder, suppresses late output/progress/completion and aborts a writable acquired after cancellation. Already completed folder files are retained. Cancellation permits a fresh export and does not claim that native offline rendering can be synchronously terminated.

The header distinguishes **Device draft saved/pending/unavailable** from cloud state. A failed device refresh after a successful cloud save does not erase the cloud receipt. **Retry device draft** saves the current recoverable document without committing staged proposals or an invalid raw field. Take recovery continues to use its existing dedicated Retry/download path and atomic preservation receipt.

## Internal checkpoints and verification

The implementation preserved completed work and used inspection, failing regressions, focused implementation checks, independent review and final verification checkpoints. Initial RED checks reproduced missing recording setup/take comparison/export-range behavior. Later RED regressions exposed section-end events, late writable cleanup and MP3-worker cancellation. The implemented regressions cover preparation/decode/encoder/picker/writable boundaries, exact musical timing and durable recovery.

Internal Git checkpoints are `2a92617` (recording setup, take review and device-draft receipt), `f4c8a69` (scoped cancellable audio exports), and the final receipt/fixture checkpoint. No project code changed after the final browser verification; documentation and the reviewed fixture corrections follow separately.

| Check | Recorded result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test` | **324/324 unit tests across 37 files passed** |
| `npm run lint -- --max-warnings 0` | Passed with zero warnings |
| Chrome verification | **88 distinct scenarios verified** across broad and final focused runs; exact provenance below |
| Production build | Passed; existing large-client-chunk advisory remains |
| `git diff --check` | Passed |
| Independent source/document review | No remaining material blocker in the changed paths |

Pure tests cover isolated region identity/asset/mix preservation, independent snapshots, half-open overlaps, valid export ranges, crossing notes/audio, automation at the boundary, exact sample lengths and cancellation. Browser checks exercise real Web Audio with finite synthetic fixtures, preserving the distinction between native signal verification and physical recording/listening. Existing ownership, recovery, library, editing and export regressions remain part of final affected verification.

Final browser provenance, from `studio/` with one isolated Chrome worker:

| Run | Result | Coverage |
| --- | --- | --- |
| `output/phase3-affected-final` | **75/77 passed**, 7.4 minutes | New recording/draft/take/export cases and existing library audition, recording, recovery, permissions, UI, cloud, workspace lifecycle and five-minute reference |
| `output/phase3-corrected-and-native-final` | **14/14 passed**, 25.2 seconds | Both corrected failures, the take-layout screenshot case and all 11 native modulation/audio cases |

The first run used `npx playwright test` with `recording-workflow`, `draft-durability`, `take-review`, `export-workflow`, `ui-upgrade-recording`, `modulation-recording`, `workflow-patch`, `workspace-lifecycle`, `library-audition`, `recovery`, `ui-upgrade-recovery`, `permissions`, `ui-upgrade` and `studio` specs, plus `--output=output/phase3-affected-final`.

The final follow-up command was:

```powershell
npx playwright test tests/browser/modulation-audio.spec.ts tests/browser/export-workflow.spec.ts tests/browser/workflow-patch.spec.ts tests/browser/take-review.spec.ts --grep 'PCM|eight-source|seeking a looping|releasing one MIDI|all stems download|pre-capture Stop|take comparison controls' --output=output/phase3-corrected-and-native-final
```

This is aggregate verification of 88 distinct scenarios, not one uninterrupted 88-case green run. Both broad-run failures were fixture defects. The new stems fixture addressed visible “Insert track” text instead of the existing accessible name “Add instrument track”. The older preservation fixture injected a failure into any three-store write, allowing ordinary draft autosave to consume it; it now targets the exact atomic take transaction. Their output, timing, recovery and idempotency assertions are unchanged. Earlier focused recording/recovery runs also pass, but add no distinct cases to this total.

Finish now opens Notes / Audio, so the existing modulation-recording fixture explicitly returns to Sound before editing macros. Its live-movement release fixture now holds input long enough to cross the existing 240-tick step boundary. The measured release window, note-count limits and recorded-ending assertions remain intact. A deterministic synthetic input tone verifies the microphone-check meter; simulated microphone access does not establish physical device quality.

Recording setup bounds pass at 1920, 1366, 850 and 390 pixels; export at 1920, 1366, 1024 and 390; take comparison at 1366, 1024 and 390. Rendered recording, export and take screenshots were inspected at narrow and larger sizes under ignored `output/phase3-review`, `output/phase3-export-review` and `output/phase3-take-review`.

Native section rendering preserves crossing synth/audio, original fades and volume automation within `7.450580596923828e-9` maximum PCM error before the cutoff boundary quantum. A one-second section exports exactly 48,000 frames; including the existing four-second tail produces 240,000 frames. Following-section music is excluded and the source document is unchanged. Two downloaded stems share the selected section's exact 768,000-frame length. Cancellation checks prove no late downloads, writes, closes or success and a fresh usable export.

The five-minute, 16-track workflow records, saves, reopens and exports finite stereo 48 kHz/24-bit PCM: **304.8 seconds**, RMS `0.01018175712802524`, peak `0.1424245834350586`, measured render time **58.871 seconds**. The actual MP3 export still downloads and decodes successfully. Bounded numeric evidence is in [phase-3-record-finish.json](../studio/docs/evidence/phase-3-record-finish.json); generated audio, screenshots, traces and browser profiles remain outside source.

## Preserved boundaries and delivery state

Project schema v1, owner/project boundaries, cloud endpoints, private asset ownership, atomic take storage, library copies, existing draft/proposal persistence rules, note sessions, graphite surfaces and the Windows wrapper are preserved. No dependency installation, hardware setting, firmware setting or OS performance configuration changed.

Physical microphone/MIDI/hotplug, physical touch, human listening, hosted end-to-end behavior and reopened WebView2 remain unverified. The musician workflow comparison remains deferred; automated interaction and synthetic PCM do not satisfy that observation. Full comping, warping, bounce, new DSP, cloud library sync and second-editor pinning remain outside this milestone.

This is a local implementation on `codex/phase-3-record-finish`. No new push, merge or Site publication has occurred. The completed Phase 1 release remains the published source; publication of this milestone requires a separate release instruction after final verification.
