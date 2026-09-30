# Workflow patch checkpoints

Approved specification: [workflow-patch.md](workflow-patch.md). Prior completed checklist remains in todo.md.

- [x] Inspect clean existing checkout and record approved specification before coding.
- [x] Slice 1: cancellation, source-owned performance, atomic recording/recovery; focused/browser audio checkpoint.
- [x] Slice 2: shortcut dispatcher and preferences; focus/capture checkpoint.
- [x] Slice 3: pure timing commands, editable canvas, grouped history; timing/concurrency checkpoint.
- [x] Slice 4: harmony-aware deterministic generation, alternative destination/Edit phrase; compatibility checkpoint.
- [x] Slice 5: bounded polish and complete workflows; responsive checkpoint.
- [x] Final TypeScript, lint, unit/browser regression and production build.
- [x] Round-trip/export/ownership/recovery checks; document physical-device/listening limitations.
- [x] Commit, package, publish same Site and confirm native deployment success.

## Slice 1 evidence

TypeScript, lint (zero warnings), 24 existing Vitest tests and production build pass. Five focused Chrome browser scenarios pass: real audio/WAV/loop/sustain/worklet; denied microphone/failed sample; common-output cancellation and delayed loads; pre-capture cancellation plus failed atomic preservation/double Retry; cancelled late microphone preparation followed by a successful new recording. Numerical windows and ownership results: output/playwright/cancellation.json. No physical microphone/controller or human listening claim.

## Slice 2 evidence

TypeScript, lint, 27 Vitest tests and production build pass. Chrome verifies protected Stop while typing, native field/button Space, modal Escape, capture conflicts and Escape, custom Play binding, source release after focus moves, and preference reload. Computer piano and commands now share one dispatcher; pointer/button input remains source-owned.

## Slice 3 evidence

39 Vitest tests pass, including three timing fixtures, suffix overlaps, immutable overflow rejection, split IDs, meter snapping, concurrent imports, same-field/missing-owner conflicts and structural transaction composition. Chrome verifies direct insertion/splitting, selected voicing edits, rest removal, drag/drop and Undo, title grouping, invalid-field ownership and workspace blocking, retained overflow proposal, and grouped mixer fader Undo. Prior five focused workflow/audio checks pass. TypeScript, zero-warning lint and production build pass. Source-owned drafts and recording guards are retained; the existing note editor is reused.

## Slice 4 evidence

Captured 48 exact ordered generator baselines plus both demo arrangements before editing (source SHA in generator-baseline.json). All remain identical. 46 Vitest tests pass: clipped/resumed/tied legacy harmony, populated gaps versus empty guides, minor-mode tonic fallback, within-bar pitched rests/revoicing, alternative-track inheritance and 64-track refusal. Chrome checks audition cancellation from generator changes while unrelated title edits keep playback, overlap alternatives, phrase selection and handoff to the existing piano roll, and non-drum step restrictions. TypeScript, zero-warning lint and production build pass. Visible and shortcut progression auditions share the resolver.

## Slice 5 evidence

Workspace and phrase selection survive navigation, reload and reopening the same cloud song. Generator settings, snap, grid and zoom use versioned browser preferences. Samples expose unloaded/loading/ready/failed/retry states; single-zone loading and instrument changes are verified. Accessible piano Enter/Space input releases after focus changes and ignores repeated key-down. Track/phrase insertion cannot interrupt a pinned recording. Effective sound controls, compact suggestions, workspace-scoped errors and desktop/tablet/mobile overflow checks pass.

Final checks: TypeScript, zero-warning ESLint, 46 Vitest tests, all 24 Chrome scenarios and 12 focused Edge scenarios pass. The Chrome regression had one ambiguous test locator; after correction that same-project reopen scenario passed separately, with no application change. The additional microphone-frame and disconnected-pedal scenario passes in both browsers. The 16-track reference includes a simulated microphone take, another-browser cloud reopen and a finite, nonzero 304.8-second stereo 48 kHz / 24-bit WAV. Existing import, waveform trim, MIDI, individual stems, backup restore, ownership and recovery checks pass.

Blank, demo, gapped, overlapping, boundary-crossing and recorded v1 documents round-trip unchanged through cloud save/reopen and portable backups; recorded asset bytes match exactly. Numerical cancellation windows satisfy peak < 1e-4 and RMS < 1e-5 after 100 ms and beyond the scheduled event/tail; delayed loading remains silent. See docs/evidence/workflow-patch.json and the browser test sources. Real microphones/controllers, physical touch devices and human listening remain unverified. Hosted sign-in belongs to Sites; local tests use the dispatch simulation. MIDI export does not preserve runtime input-source identities. Independent implementation and licensed assets are retained; no note-editor overhaul or broader engine expansion was included.

## Publication evidence

Sites version 2 successfully published to https://chordz-studio.pdekker24.chatgpt.site on 2026-09-30. Exact released source: 527868259aec07ab08ccd9cc9587e3630b49e4d1. Saved version: appgprj_6abc8e1f0ef88191b294a0e66e6c7a84~appgver_b26eea465fe08191985e5c2a96b24960. Deployment: appgdep_6abce5d4502c8191860b915572871e6d; native status succeeded. The existing public studio audience and owner-private song/asset endpoints are unchanged. This final receipt updates documentation only after publication.
