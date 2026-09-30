# Approved workflow patch — 2026-09-30

Continue the existing studio. Preserve ProjectDocument v1, cloud endpoints, projects, assets and completed release evidence. Implement independently from Chordz and licensed dependencies/assets. Do not copy or translate Zrythm code, artwork, samples or documentation. No hardware/OS changes. Defer the note-editor overhaul and broader sound-engine expansion.

## Shared rules

Integer ticks; editing beat = PPQ * 4 / denominator; tempo remains quarter-note BPM. New chords default to one bar. Snap defaults to one beat, with half-beat, quarter-beat and bar options. Separate song, audition, recording and source-owned live input. Pure validated chord commands produce one Undo action. Keep snapshot history with scoped preview overlays; runtime identities/receipts remain outside v1.

Legacy harmony uses half-open intervals clipped to the selected section: latest active onset wins; equal-onset ties use original stored order; when a winner ends, resume an earlier still-active chord. Generation and progression audition share this rule without changing stored timing. C[0,4) + G[1,2) resolves C[0,1), G[1,2), C[2,4).

## Slice 1 — audio and recording

Audition pauses song at its position, replaces prior audition and toggles off for the same identity, including loading. No auto-resume. Play cancels audition. Auto chord preview only while song stopped. Semantic identities include project/destination/section timing/relevant harmony/key/meter/tempo/generator parameters/seed/instrument/phrase revision, exclude generated UUIDs and unrelated edits. Cancel immediately on relevant changes and recheck every async boundary. Separate activity/live ownership; cancel future sources and fade activity output/tails in 20ms. Stop All clears live notes, pedals, pending loads, clicks and monitoring.

Live owners: computer code, pointer ID/pitch, MIDI port/channel/pitch. Pin track/pitch on note-on; release only that owner. Same-owner retriggers; other owners continue. Capture overlapping notes separately. Blur releases computer, pointer cancel its pointer, disconnect its port. Combine sustain pedal sources.

Recording states: preparing, count-in, capturing, finalizing, recoverable error. Pin owner/project/target/start/tempo/IDs before awaits. Pre-capture Stop creates nothing and disposes late streams. Count-in input audible but not captured; seed still-held inputs at capture start. Seal exact frame/tick cutoff before Stop. Finish Take preserves cutoff position. IDs allocated once; repeated Stop joins finalization, Retry reuses identity. Atomically store asset/pending/recovery/latest pointer/receipt in IndexedDB before one history commit. Completed receipt prevents duplicate/resurrected take. Retain sealed bytes/events on failure; label “Take kept in memory — not saved to this device or cloud. Retry or download before closing.” Reset playhead only after durable local success; upload later with same asset ID. Block project replacement/incompatible engine actions until completion.

Checkpoint: delayed-load cancellation/common-output silence, preparation/count-in cancellation, exact cutoff, storage failure/idempotent Retry, multi-source pitch/pedal/disconnect.

## Slice 2 — shortcuts

One shared dispatcher. Defaults: Space play/pause; Shift+Space generated audition; Shift+R record/finish; Primary+S save; Primary+Z undo; Primary+Shift+Z redo. Protected Primary+Shift+Enter Stop All works while typing. Separately assignable Play/Pause/chord/progression audition. Browser-local versioned preferences, reset/clear/conflict validation. Escape handles capture, drag, dialog/popover, unfinished field, then Stop. Capture consumes every key; visible Stop remains available. Preserve native editing/control/composition input; ignore repeated transport commands; always release inputs after focus changes.

Checkpoint: fields/buttons/dialogs/capture, conflicts/reload, accidental playback/stuck notes.

## Slice 3 — canvas and grouped history

Ruler/rests/insertion markers/drag handles/destination preview/accessible movement. Visible selection retained across workspaces; inline inspector edits symbol/duration/exact notes/inversions/note octaves/voicing register. Explicit Use played notes; unmatched notes Custom. Compact suggestions with separate Preview/Insert/Replace; explicit progression audition.

Insert ripples guide time; split one crossed chord (prefix keeps ID, remainder new ID). Resize holds start and shifts later guide. Remove leaves rest; Delete time closes duration. Move closes source then inserts original ID at destination measured after removal. Preserve gaps and existing clips/audio/automation. Validate whole proposal, reject overflow with required-space feedback, retain candidate, no autoextend/truncation. Reject cross-section moves/ambiguous overlap source/cuts; overlaps wholly in translated suffix move together; untouched legacy data remains usable.

Fixtures section [0,8): insert length1 at2.5 into C[0,2),D[3,5) => C[0,2),G[2.5,3.5),D[4,6). Move A before C in A[0,1),B[2,4),C[5,6) => B[1,3),A[4,5),C[5,6). Insert at1 into C[0,2),G[2,3) => prefix[0,1),Dm[1,2),remainder[2,3),G[3,4).

Preview only owned fields over latest committed document. One commit on pointer release/key-up/Enter or valid blur/drop. Escape cancels overlay. Async completion commits against latest document. Same-field conflicts retain newer committed edit and proposal with Reapply/Discard. Undo cancels active first. Save/export/workspace switch settle valid drafts; invalid drafts stay visible and block dependent action. Cloud saves committed music; recovery includes valid preview, cancellation restores committed recovery.

Checkpoint: fixtures/IDs/selection/overflow/legacy, grouped text/slider, import during drag/cancel/Undo, same-field conflicts/Save.

## Slice 4 — generation and editing handoff

Shared resolver at every onset/preview boundary; sustained accompaniment revoices at changes and trims at explicit rests. Preserve exact existing seeded output/random calls for unchanged fully-covered bar-aligned fixtures; capture baseline before change. Empty guide tonic fallback; populated guide gaps pitched rests. Test nonzero starts/within-bar/nested overlap/ties/boundary/meter.

Show destination/instrument/section/length. Overlap offers alternative track inheriting instrument/sound/mixer, fresh IDs, empty automation, unmuted/unsoloed. At64 tracks retain proposal with destination choices. Select inserted phrase; Edit phrase opens existing Arrange editor, no parallel editor/overhaul. Drums only compatible tracks.

Checkpoint: golden fixtures/resolver agreement/stale preview, inheritance/limit/Edit phrase.

## Slice 5 — bounded polish/release

Preserve workspace/generator/grid/zoom/last clip per track. Scope errors. Show effective sound controls while retaining unavailable settings. Explicit loading/ready/failure/retry. Improve density/labels/contrast/hit targets/collapsible keyboard preferences.

Checkpoint: Write→Preview→Insert→Edit→Arrange→Record→Save→Reopen→Export; desktop/tablet/mobile.

## Final verification

Each checkpoint passes before next slice. Focused Vitest/browser checks then TypeScript/lint/build. Cancellation: audible before Stop; from +100ms successive100ms common-output windows peak<1e-4/RMS<1e-5/finite beyond final previously scheduled event+tail; no delayed return. Round-trip blank/demo/gapped/overlap/boundary/audio projects+backups preserves musical fields/asset bytes except existing restoration ID remap. Recheck ownership/recovery/MIDI/WAV/stems where touched. Preserve prior evidence; publish same Site after checks. Report physical mic/controller/human-listening limitations; runtime input identity not retained by current MIDI export.
