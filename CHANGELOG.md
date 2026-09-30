# Changelog

## Studio Modulator — 2026-09-30

- Selected-track Sound rack with eight sources, 32 routes, four named macros, acyclic source routing, MIDI CC assignment, local presets and seeded variation locks.
- Staged A/B and reference recipes with Apply/Cancel, grouped Undo and protection against audition drafts entering recovery.
- Shared deterministic modulation for live input, audition, arrangements and offline audio exports; preserved legacy dry behavior when absent or bypassed.
- Chord movement shared by generation and live arpeggiation, with separate Enable/Hold, editable captured output, count-in/seek/loop handling and input cleanup.
- Local bounded MP3/WAV reference analysis, cancellable independent FFT worker, confidence/manual corrections, owner-scoped cache and editable curve recipes.
- Version 1 data compatibility, identified macro/CC events and older-client omission protection. Existing private storage, exports and Windows wrapper retained.

## Studio UI upgrade — 2026-09-30

- Palette C charcoal surfaces, cream text, amber accents, instrument-coloured rails and blue selection, with compact responsive workspace and persistent transport.
- Device-local Appearance presets, 2–10px rails and spacing settings; track drawer below 1024px and collapsible performance controls.
- Snapped same-track clip movement/resizing and interactive automation with one Undo per gesture and cancellation rollback.
- Separate locally packaged MP3 encoder worker: stereo 48 kHz / 320 kbps CBR, failure cleanup and retry, with complete third-party notices.
- Recording completion and recovery actions remain accessible while a field is invalid.
- Next.js and its lint configuration pinned to patched 16.3.8 after the production dependency audit.
- Existing online Windows client and installers retained. See studio/docs/VALIDATION.md for executed checks and browser/device checks still outstanding.

## 0.1.0 — 2026-09-30

### Added

- Windows desktop client opening the existing Chordz Studio music workspace.
- Studio menu for returning to the app, opening the browser studio and quitting.
- Per-user Windows installer and portable executable with the Chordz icon.
- Full studio source, licensed factory samples, tests and development documentation.
- Automated desktop and studio build checks.

### Current boundaries

- Internet access is required; the desktop client uses the live hosted studio.
- Native microphone, MIDI, embedded sign-in and listening checks need a musician's validation.
- The Windows build is unsigned.
