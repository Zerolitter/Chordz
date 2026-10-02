# Chordz implementation plan

Continue from the approved SPEC.md; preserve the archive. Build sequential complete slices, verifying before expansion.

1. Project document/schema and immutable history; chord theory and deterministic generation; protected library and owner-scoped D1/R2 APIs; playable saved chord workspace.
2. CC0 sample catalog and real sample zone mappings; Web Audio/Tone live and offline graph, synth presets, MIDI expression; prove short WAV rendering.
3. Song sections, clips, piano roll, drum steps, editable accompaniment and expression/automation; loop/seek/transport.
4. AudioWorklet recording, count-in, imported/private audio, waveform/trim/fade/alignment; mixer/effects/meters.
5. WAV/stems/MIDI/ZIP backup workflows, conflicts/recovery, browser/16-track checks, release documentation and multi-user Sites publication.

Cloud saves compare expected revision before mutation. Recording bytes live in R2 and recovery data in owner-scoped IndexedDB. Audio rendering uses the same graph/event compilation as live playback. Offline processing must not buffer large file uploads inside Worker memory. Public access is to the sign-in surface; project endpoints require authentication and ownership.

Runtime errors, unavailable audio devices, failed samples and unavailable cloud storage are visible and recoverable. Do not substitute browser-only saves for the requested cloud persistence.

The approved workspace and device-local reusable library follow-up is recorded in [Phase 0A](../../docs/phase-0a-prototype.md) and [Phase 0B](../../docs/phase-0b-library.md). The user authorized 0B while deferring the observed music-making comparison; earlier completed checklists are historical evidence, not evidence of that human task.

The [Phase 1 precise editing](../../docs/phase-1-note-editing.md) increment is implemented and locally verified, preserving the completed 0A/0B source. Direct note gestures, scoped musical operations and automation routes pass the recorded technical checks. The user authorized its GitHub merge and existing Site publication. The human comparison remains deferred; subsequent recording/take improvements follow the roadmap separately.

The [Phase 3 recording and finishing milestone](../../docs/phase-3-record-finish.md) is implemented and verified from merged main, with internal recording/export/receipt checkpoints. Named recording setup, optional level check, Off/1/2-bar count-in, durable Finish into Notes / Audio, individual audio-take comparison, scoped audio exports and separate device/cloud receipts extend the existing workflows. Final checks pass: 324 unit tests, 88 distinct affected/native Chrome scenarios across recorded runs, TypeScript, zero-warning lint and production build. The subsequent release merged PR #3 as `29e7aa6` with Studio/Windows CI passing, and published Site version 10. The separate sample-refinement branch is preserved. Human comparison, physical devices/listening, hosted workflows and reopened WebView2 remain separate gates.

The [Phase 4 reversible instrument bounce copy](../../docs/phase-4-bounce-copy.md) milestone is implemented and verified: retain the source, add a private WAV/audio region through one Undo action, make tails and source mute explicit, and reject stale or cancelled work. Final checks pass: 354 unit tests in 41 files, 88 distinct Chrome scenarios across recorded runs, TypeScript, zero-warning lint and production build. Native comparisons verify off-grid signal accuracy, long releases, trailing automation and slow delay; workflow cases verify restoration, independent byte ownership, scoped cancellation and draft recovery. It claims no measured CPU improvement. Further optional growth remains demand-led; the deferred musician comparison, physical devices/listening, hosted/native-runtime checks and controlled performance measurement remain separate work.

The user's desktop feedback is incorporated into this milestone: compact Sound banks, grouped headers and modulation alongside the instrument at sufficient actual dock width. Primary verification uses 2560×1440, with 19 passing layout/interaction scenarios and the sample/FM/drum variant check. Mobile remains a responsive fallback check, not the primary musician workflow.

The subsequent [Sound tuning workflow correction](../../docs/sound-workflow-layout.md) follows the user's actual imported-audio screenshots. It replaces the empty audio placeholder with existing track controls and song playback, makes Track name optional, and reflows compact banks and populated/empty modulation racks. Primary checks use 2560×1440 and 2555×1271 with a real imported WAV, two sources and five routes; 21 affected Chrome cases plus the overlapping final audio refinement pass. Typecheck, zero-warning lint and production build pass. This is the complete current follow-up milestone; further roadmap growth stays demand-led after these working-surface corrections.
