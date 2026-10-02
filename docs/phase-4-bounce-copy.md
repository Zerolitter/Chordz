# Phase 4: reversible instrument bounce copy

Date: 2026-10-02. Workspace: `D:/.codex/worktrees/db98/Chordz`, branch `codex/phase-4-bounce-copy`. Continue from the completed Phase 3 receipt at `8040fe0`. **Local technical milestone: complete and verified.** Domain/rendering work is checkpointed at `340d76a`; the complete operation and interface at `d6f5079`. Phase 3 is released through GitHub PR #3 and Site version 10. At this receipt, the Phase 4 release is being prepared and has not yet been merged or published. No performance benefit is claimed.

## Roadmap and scope

The supplied *Chordz bedroom-artist roadmap*, page 6, ranks this optional growth candidate first:

> Best next growth candidate: bounce an instrument part to audio while retaining a reversible source. Reuse offline rendering to help modest computers. Validate source restoration, tails, automation and stale rendered audio before claiming a performance improvement. Manual chapter 20, pp. 425-430.

This milestone makes a **Bounce copy** of one selected instrument track using the existing offline graph. It creates a fresh private stereo WAV asset and an audio track containing the rendered copy. The original instrument, notes, clips, controls, automation, modulation and asset references remain intact. The explicit **Mute source after bounce** choice is on by default and takes effect only when the copy is successfully inserted; unchecking it leaves the source's existing mute state unchanged.

The copy is a static snapshot. Changing its source requires another bounce; there is no durable linked pair, automatic source restoration or automatic re-render. One Undo reverses the insertion and its optional source mute. Existing mute and delete controls let the user return to the retained source later. Track names do not act as source identifiers.

The roadmap's schema-v1 and ownership contracts remain unchanged. Reusable library discovery, recording recovery, take comparison and export already provide the prerequisites. The separate `origin/feat/sample-refinement` work remains separate; this milestone does not merge or copy its service, schema or optional metadata. Launchers, comping, warping and new persistent musical state are outside this increment.

## Rendering and commit contract

- Capture the source track, its instrument and assets, timing, automation/modulation and graph settings before asynchronous work. Render an unmuted source snapshot with native 48 kHz stereo PCM, baking its track mix and effects once. Internal bounce bypasses the master compressor, including its native lookahead, while ordinary rendering/playback retains its existing master compressor path. The new audio track uses neutral playback and inherits the source's solo setting, so the copy does not receive its source processing twice or unexpectedly remove solo isolation; the song's master processing remains the live master stage.
- Render the complete source part with absolute song-origin preroll, then crop at its first region's start. The crop and neutral audio placement use the same rounded native sample clock, retaining the original clip tick and WAV duration rather than adding a compensating trim. Offer an explicit **Include bounce effect tails** choice, on by default. Preserve an included tail in both the WAV and the audio region length, and explain that it can extend the audible end of the song. Disabling tails ends the copy at the source's musical boundary.
- An included bounce tail retains authored automation beyond the last source clip, including ramps and modulation that affect its release. Ordinary selected-range export keeps its existing held-at-boundary policy. Bounce uses a deterministic finite allowance: `voice allowance + 0.1 seconds + 8 seconds for filter settling + max(reverb allowance, delay allowance)`. The voice allowance is the largest of static release, 15 seconds for an enabled supported voice-release route, and 1.4 seconds for percussion. A reachable reverb send adds the finite impulse's decay duration; a reachable delay send adds 20 periods of `(60 / tempo) × 0.75` seconds. Static sends, positive send automation or enabled supported send routes make a bus reachable. The 0.34 feedback loop's nominal attenuation is below `1e-7` after 15 feedback passes; 20 periods include a margin and the first echo. This bounded budget does not imply an infinite tail is completely captured or establish a measured speed improvement.
- Check capacity before rendering or committing: schema v1 allows 64 tracks, 1,000 assets, tick positions through `1e9`, positive clip lengths and a 100 MiB asset limit. Predict stereo 48 kHz/24-bit WAV size as `44 + frames × 6` bytes, bounding both cropped output and absolute-preroll rendering before allocation; check encoded metadata and capacity again before insertion. Reject nonfinite PCM or a sample magnitude above 1 with an actionable error rather than silently clipping or normalizing the source. Preserve the source and arrangement when any bound fails.
- Keep a monotonic source revision and operation identity. Edits followed by Undo still invalidate an in-flight render. A changed source, relevant timing/effect setting, project or owner, cancellation or a successor operation cannot insert stale output. Unrelated edits may remain while the copy is inserted into the current document through one checked history action.
- Stage encoded bytes under the operation's private asset ownership before insertion. Release only that operation's uncommitted assets on failure, cancellation or stale scope. After a successful document commit, retain the owned asset for Undo/Redo and recovery, and use the existing activation/retry contract; an activation failure must not remove committed music.
- Cancel remains responsive across graph preparation, native rendering, encoding and storage boundaries. Suppress late progress, success and insertion; dispose operation-owned resources. Native offline work may finish after cancellation because the browser exposes no synchronous cancellation API.

## Internal checkpoints and validation

The domain/rendering checkpoint `340d76a` retains the source, creates neutral audio copies within schema v1, checks musical revisions and shares the exact bounce frame/tail plan with the renderer. The operation/interface checkpoint `d6f5079` completes cancellation, checked insertion, owned storage and recovery. Independent read-only review found no remaining material source blocker after the scoped lifecycle, sample-clock, tail and interface fixes. Final checks below validate the resulting implementation.

The final focused native Chrome run recorded **9/9 passing cases in 16.2 seconds**, with one worker. Off-grid placement at tempo 137 / ticks 3841 and 3839 differs from the original full mix by at most `6.33e-8`; post-clip automation by `7.45e-8`. A 10-second static release retains signal beyond the earlier four-second cutoff (late peak `0.0017339`, copied duration `26.6` seconds, full-mix error `7.45e-8`). At tempo 20, the delayed signal reaches late peak `0.0182253`; after the `54.2`-second bounded copy, the extended reference has peak `1.82e-12`, with full-mix error `7.45e-8`. The 24-bit WAV case produces 806,400 stereo frames at 48 kHz; decoded neutral replay error is `5.42e-20` and normal full-mix error `2.51e-8`.

Unit and browser cases cover retained source content and optional mute, Undo/Redo, source and scope invalidation, compatible unrelated edits, tails and automation, owned staging and storage cancellation, activation failure/retry, durable save/reopen, capacity and PCM rejection, recording exclusion, and reachable progress/cancel/error controls. Native encoding cancellation terminates the operation-owned worker exactly once and ignores late delivery. Screenshots at 1920, 1366, 1024 and 390 pixels were inspected.

| Final check | Recorded result |
| --- | --- |
| Complete unit run | **354/354 passed across 41 files** |
| Focused domain/rendering units | **66/66 passed across 5 files**, 797 ms |
| Typecheck | Passed after final interface fixes |
| Focused native Chrome audio | **9/9 passed**, 16.2 seconds |
| Final bounce interface and affected export confirmation | **18/18 passed**, 69.027417 seconds: 16 bounce cases and 2 export cases |
| Affected browser regression | **61/63 passed**, 4.1 minutes; both failed label-query cases passed in the final confirmation |
| Zero-warning lint | Passed after final interface fixes |
| Production build | Passed after final interface fixes; existing large client chunk advisory remains |
| Final diff check and independent review | Passed; no remaining material source blocker identified |

The browser receipt verifies **88 distinct cases across separate runs**: 63 existing regression cases, 9 native bounce audio cases and 16 new bounce interface cases. It is not one uninterrupted 88-case green run. The consolidated evidence is [phase-4-bounce-copy.json](../studio/docs/evidence/phase-4-bounce-copy.json).

Commands were run from `studio/`:

```powershell
npm run test
npm run test -- tests/bounce-tail.test.ts tests/track-bounce.test.ts tests/audio-filter.test.ts tests/modulation-graph.test.ts tests/export-range.test.ts
npm run test:browser -- tests/browser/track-bounce-audio.spec.ts --output output/phase4-audio-final
npx playwright test tests/browser/draft-durability.spec.ts tests/browser/export-workflow.spec.ts tests/browser/library-audition.spec.ts tests/browser/library-storage.spec.ts tests/browser/modulation-audio.spec.ts tests/browser/recording-workflow.spec.ts tests/browser/reusable-library.spec.ts tests/browser/roundtrip-patch.spec.ts tests/browser/studio.spec.ts --reporter=list,json --output=output/phase4-affected-final
npx playwright test tests/browser/track-bounce.spec.ts tests/browser/export-workflow.spec.ts --grep "track-bounce\.spec\.ts|export identifies|all stems download" --reporter=list,json --output=output/phase4-confirmation-final
npm run typecheck
npm run lint -- --max-warnings 0
npm run build
git diff --check
```

Native artifacts remain under ignored `studio/output/phase4-audio-final`, affected results under `studio/output/phase4-affected-final`, and final confirmation under `studio/output/phase4-confirmation-final`.

The first eight-case interface run had three passes and five failures: three module-class interception gates missed the actual rendered operation, one device-retry injection raced ordinary autosave, and one production defect made the workspace inert during a bounce. The production fix keeps Cancel/Close and musical edits reachable for the bounce while retaining other operation/hydration boundaries. The corrected native `OfflineAudioContext` and operation-specific IndexedDB gates exercise the actual preparation/storage lifecycle. The resulting expanded 13-case run passes, and screenshots at 1920, 1366, 1024 and 390 pixels were inspected.

The 63-case affected run passed 61 cases in 4.1 minutes. Both failures were export fixtures whose broad `getByLabel('Include effect tails')` query also matched the hidden new bounce control. The new control now has the distinct visible and accessible name **Include bounce effect tails**. The final follow-up passed all 16 interface cases, including clipping/nonfinite rejection and owned encoder cancellation, and both affected export cases. The export assertions remained unchanged. Final typecheck, zero-warning lint, build and diff checks passed after the interface corrections.

The affected five-minute, 16-track regression passes recording, durable save/reopen and native export. Its synthetic recording lasts `2.112` seconds; the project document has **1,428,736 JSON characters** (the raw fixture's `bytes` field is a character count). The exported WAV is finite stereo 48 kHz/24-bit PCM, `304.8` seconds long, with RMS `0.010181624314560572`, peak `0.1426081657409668`, `29,041,988` nonzero samples and a measured render time of `61.591` seconds. This is a compatibility receipt, not a measured CPU benefit from bouncing.

Synthetic native PCM establishes the tested rendering behavior. Physical devices, human listening, physical touch, hosted end-to-end behavior and reopened WebView2 require their own evidence. The musician workflow comparison remains deferred. No CPU benefit is claimed until a separate controlled measurement proves it, and no hardware, firmware or operating-system performance configuration is changed.

## Desktop Sound layout follow-up

The user's six screenshots identified the main working resolution as **2560 × 1440**. The phone view was a defensive responsive check, not the primary music-making layout. The release also includes the requested desktop correction: bounded control banks, grouped instrument actions and metadata, and modulation alongside the instrument when the actual available panel width is at least 1760 pixels. Narrower instrument containers reflow the banks without changing their input ownership or saved musical state.

At the same 2560 × 1440 Arrange viewport, the Sound panel now uses 2300 pixels of content width instead of the previous 1320-pixel cap. Fine-pointer knob cells measure 76.66–79.5 pixels, compared with 111.89–143.02 pixels before the change. Performance, amplitude and filter cards measure 206.5, 264.5 and 185.5 pixels high respectively, replacing three equally stretched 312.5-pixel cards. The 1182-pixel modulation rack occupies the right side; its preset and Assign controls are visible at the dock's scroll origin. The envelope graph and 44-pixel graph hit areas retain their existing geometry. Reset buttons have reserved space beside the dials, with explicit 44-pixel coarse-pointer targets retained.

The focused **19-case Chrome confirmation passes in 74.922337 seconds**, with one worker and no unexpected, flaky or skipped cases. It covers exact values, reset, Undo, pointer/keyboard cancellation, A/B retention, envelope timing and hit targets, recording expressions, sustain ownership, fine/coarse bounds, Arrange and maximized Sound, and responsive views. An expanded 1440p instrument-variant case then passes for sample, FM and drums in 6.0 seconds. The first focused run passed 18/19 and exposed the normal reset/dial overlap; the reserved-space fix and explicit normal/touch bounds resolve it. Final TypeScript, zero-warning lint, build and diff checks pass; the existing build chunk advisory remains.

The final desktop captures were inspected at 2560 × 1440 and 2048 × 1152. The latter checks a smaller CSS viewport that can arise through display scaling; it does not claim a physical scaling or touch-device test. Existing internal dock scrolling remains available when expanded content exceeds its height. Desktop evidence and initial/final test provenance are included in the consolidated JSON, with screenshots under ignored `studio/output/desktop-density` and `studio/output/compact-layout`.
