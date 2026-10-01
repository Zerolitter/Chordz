# Phase 1: precise editing in the shared workspace

Date: 2026-10-01. Continue from `42f935e` on `codex/phase-0a-workspace`. The user requested continuation of the supplied roadmap after 0A and 0B. The roadmap's next compatible milestone is Phase 1, precise editing. Its document instructions are design context; the user's request authorizes this implementation. The previously deferred observed workflow comparison remains unperformed.

## Reconciliation with completed work

| Roadmap requirement | Existing behavior | This increment |
| --- | --- | --- |
| Shared canvas and nearby tools | Approved 0A shell, selection, presets and bounded scrolling | Preserve the shell and transport |
| Discovery and reusable content | Verified 0B library with checked insertion and independent audio copies | Preserve its contracts and regression coverage |
| Direct note movement and lengths | One selected note, release-only pointer movement, numeric lengths | Live group movement and both edge previews |
| Several notes and musical reuse | Single-note keyboard edits; whole-clip duplication | Toggle/marquee/select-all, note duplication and session copy/paste |
| Dynamics and scale visibility | Numeric velocity; fixed MIDI pitch rows 36–84 | Compact velocity lane, all 128 pitches, Fold used notes and scale highlighting |
| Timing tools near the grid | Immediate whole-phrase quantize/humanize | Explicit selected-note or phrase scope, deterministic preview, Apply/Cancel and Undo |
| Direct automation | Existing dock graph, precise points and shared runtime resolution | Supported-control routes, automated status and correct current-value point defaults |

## Implementation contracts

All note positions and durations remain integer **source ticks at 960 PPQ**, independent of the clip's arrangement start, length, transpose, loop count or destination tempo. Editing notes preserves performance events, articulation, existing source metadata and unselected notes. Existing note tails across a loop boundary are not silently trimmed.

Group movement and transposition use one bounded delta to retain intervals and relative timing. Edge resizing retains at least one tick; the left edge holds the original end, while the right edge changes duration. Existing tails survive no-op gestures. New clipboard uses receive fresh note identities, preserve complete selected-note payloads and reject an out-of-range group rather than silently clipping it. Clipboard contents are device-session state within the loaded owner, not the operating-system clipboard or saved project data.

Pointer resize targets occupy opposite six-pixel corner bands, leaving the note centre available for movement. Selected handles take precedence over neighbouring unselected handles; short handles retain a stable width on hover and focus. These hit targets never alter displayed onset, pitch, duration width or saved musical timing. Native pointer regressions cover short/short and short/long neighbours in both orders.

Timing transforms reject selected onsets outside the loop source rather than waking latent notes. Velocity-only humanize preserves those onsets. Pitch-only movement and right-edge resizing also require selected onsets inside the source; direct timing movement can bring a group into range using one common bounded delta. Groups that cannot fit are rejected without independently clipping their notes, and zero-delta edits preserve the original notes and tails.

Selection, editor view and gesture ownership are scoped to owner/project/track/clip. Reconcile deleted notes after edits and Undo/Redo; another clip or account must not inherit note identities or a pending input. Pointer previews use the existing gesture savepoints. Release commits one edit; Escape, cancellation, lost capture, window blur or disappearing controls terminate the owned input and prevent late events from restarting it. Child cancellation must retain an enclosing staged proposal.

Unfinished note pointer/keyboard previews and explicit timing proposals are excluded from device recovery and asynchronous cloud-save completion. Those paths use the latest committed document, including intervening committed edits. Ordinary numeric-field draft recovery retains its existing behavior. Selecting another note settles a valid numeric draft first; an invalid draft blocks the selection without losing its raw value. Display-only selection, Fold and scale changes retain an explicit timing proposal.

The always-mounted clip editor owns the session map and owner-scoped clipboard, so MIDI/audio/no-clip navigation does not discard them. Folded pointer movement uses its original pitch-row lookup; repeated coordinates and release cannot transpose the preview a second time. Protected Stop remains available from focused notes. A zero-velocity click remains silent and adds no Undo step.

Timing previews start from immutable source notes, use an explicit selected-note or whole-phrase scope, and commit only through Apply. Cancel and navigation restore the committed source; a pure dock collapse retains the staged session while ending active gestures. Deterministic humanize never generates a new result merely because the view renders. Fold and scale highlighting are display-only: chromatic pitches remain available and key changes never repitch existing notes.

Automation routes address an explicit track and supported project-v1 lane, reopen the same detail dock and preserve phrase, section, viewport and playback position. Opening a lane adds no music history. A requested point uses the correct current base value. Existing inactive bindings retain their authored data and exact reasons. Hidden automation UI stops transport subscriptions.

Closing automation ends its captured pointer before close validation. Its last valid owned preview becomes one Undo step; a different field's invalid draft remains untouched and can block closing. Escape, capture loss, blur and stale pointer events cannot resume the ended gesture.

For MIDI/drum notes, effective dock sizing starts from a 320px minimum body, clamped by the existing 220px desktop/160px narrow canvas reservation. The saved requested ratio remains unchanged. The note roll reserves 90px; additional proposals/status content and smaller viewports use internal grid scrolling instead of clipping the velocity lane or selected-note inspector. Other dock tools retain their existing sizing rules.

## Using the editor

Select a MIDI or drum phrase to open Notes / Audio. Click a note, Shift-click to toggle notes, or drag the empty grid to select a group. Drag a note body to move the group; use its upper-left start or lower-right end handle to change its length. The velocity lane edits the same selected group. Arrow keys move selected notes, and Escape cancels a current gesture or timing proposal.

Copy, paste, duplicate, delete, transpose and exact velocity actions sit above the grid. Ctrl/Cmd+A, C, V and D provide selection, copy, paste and duplication within the editor; text fields retain their normal editing shortcuts. The source ruler sets the paste position. Fold shows used pitches; Scale highlights pitches without changing music. Maximize opens more pitch space while transport remains reachable.

Choose Selected notes or Phrase before Quantize or Humanize, inspect the proposed change, then Apply or Cancel. Use Automate beside a supported Sound or Mix control to open its exact lane in the existing dock. Automated and inactive statuses identify existing data without creating a point merely by opening the lane.

## Verification and acceptance

Tests precede new behavior: the initial browser regression reproduces the missing live drag preview; focused unit/browser checks cover source timing, group bounds, fresh identities, cancellation, staged previews, scope, recording guards and automation routes. Run final typecheck, unit tests, zero-warning lint and production build. Inspect laptop/desktop/tablet/narrow layouts at 1366×768, 1920×1080, 1024×768 and 390×844, with a populated and empty phrase.

The roadmap's four-bar phrase task remains a human observation: change lengths and dynamics, duplicate material and draw a fade while retaining song context. Automated operation does not establish musician usability, listening quality, physical devices, hosted behavior or reopened WebView2 behavior. Recording workflow improvements, take comparison and export scope belong to the subsequent Phase 3; warping, comping, bounce, new DSP, cloud library sync and second-editor pinning remain outside this increment.

After implementation, the user explicitly requested committing and merging this slice on GitHub and updating the existing Site. That release authorization supersedes the earlier local-only boundary. Preserve the Site identity, public audience, DB/BUCKET bindings and native wrapper; record GitHub checks/merge and native Sites deployment status separately from the local browser evidence.

## Delivery receipt

The precise-editing increment is implemented and locally verified. Pure note operations were committed as `50b9643`; the final UI, lifecycle, regression tests and this receipt follow on the same branch. Independent review found no material release blocker after the short-note pointer corrections.

Final source checks, executed from `studio/`:

- `npm run typecheck`: passed.
- `npm test`: **309 tests across 35 files passed**.
- `npm run lint -- --max-warnings 0`: passed with zero warnings.
- `npm run build`: passed; the existing large-client-chunk advisory remains.
- `git diff --check`: passed.

Chrome evidence verifies **179 distinct scenarios across broad and focused runs**, not one uninterrupted green suite:

| Run | Result | Purpose |
| --- | --- | --- |
| `npx playwright test --output=output/phase1-full-final` | 174/177 passed, 18.3 minutes | Broad music, storage, library, native audio, recording, export and UI regressions |
| `npx playwright test tests/browser/arrangement.spec.ts tests/browser/modulation-recording.spec.ts --grep 'clip movement and right edge resize\|live movement records emitted notes once' --output=output/phase1-corrected-existing` | 2/2 passed | Corrected metadata selector and deterministic recording setup |
| `npx playwright test tests/browser/note-editing.spec.ts --grep 'adjacent short-note centers\|a minimum-width note beside a long note\|a blocked Notes close releases' --output=output/phase1-all-corners-green` | 3/3 passed | Native-pointer regressions for neighbouring short/long notes and blocked close |
| `npx playwright test tests/browser/arrangement.spec.ts tests/browser/note-editing.spec.ts tests/browser/workspace-lifecycle.spec.ts --output=output/phase1-affected-final-complete` | **51/51 passed, 4.7 minutes** | Exact final source: five arrangement, 29 note-editing and 17 workspace lifecycle scenarios |

The broad run exposed three failures. The new note-loop label made an older substring locator ambiguous; the corrected selector addresses the existing metadata control exactly. A cold acoustic recording fixture exceeded its existing preparation/count-in deadline while loading samples; the affected fixture now uses the existing Glass FM synth setup without changing deadlines or recording assertions. The blocked-close test exposed a real short-note hit-target defect. The final universal opposite-corner handles resolve both short/short and mixed short/long neighbours while retaining exact musical coordinates. Two additional native-pointer regressions reproduced those defects before the fix. An interim affected run was deliberately stopped for the mixed-neighbour correction and is not counted as completed evidence.

Four supported-control automation-routing scenarios passed in the broad run; their source was unchanged by the later note hit-target fix. The final 51-case run also verifies invalid-draft handling, owner-scoped sessions, committed-only recovery, staged proposals, recording guards, held inputs, independent input owners, sole/shared pedal ownership, scrolling and all four requested viewport sizes.

Eight populated/empty note-editor screenshots at 1366×768, 1920×1080, 1024×768 and 390×844 were inspected under ignored `output/phase1-review/`. Populated/empty preset and compact Sound/Mix screenshots retain neutral graphite surfaces, readable song context and reachable transport. Automated browser checks verify internal scrolling and selected controls; they do not replace the deferred musician observation.

The five-minute, 16-track reference still records, saves, reopens and exports finite stereo 48 kHz/24-bit PCM: 304.8 seconds including tails, RMS `0.010181965515043944`, peak `0.1425989866256714`, measured render time 61.691 seconds. Existing WAV, MP3, stems, MIDI, backup, ownership and library workflows pass. Bounded numeric evidence is in [phase-1-note-editing.json](../studio/docs/evidence/phase-1-note-editing.json); generated recordings, browser profiles and screenshots remain outside source.

The observed musician comparison remains deferred by the user. Physical microphone/MIDI/hotplug, physical touch, human listening, hosted end-to-end behavior and reopened WebView2 remain unverified. No dependency, hardware or operating-system performance settings were changed. The authorized GitHub merge and native Sites publication are performed after this verified source is committed; their results are reported separately at delivery.
