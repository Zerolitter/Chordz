# Chordz studio specification

Approved by the user on 2026-09-30. The archive at `D:/Archive/Codex/Chordz` is preserved: it contains a screen magnifier, not a functioning music app.

## Outcome

A browser studio for complete songs, with editable musical assistance, hybrid/cinematic instruments, deep sound editing, MIDI performance, microphone recording, mixing, WAV/stem/MIDI export and portable backups. Other musicians sign in with ChatGPT; projects and recordings are private to their owner.

## Capability map and contracts

| Module | Responsibility | Depends on |
| --- | --- | --- |
| project-core | Versioned documents, musical edits, history and deterministic generation | — |
| cloud-library | Authenticated project and asset persistence, revision conflicts | project-core |
| sound-engine | Sample voices, subtractive/FM synthesis, expressive playback and offline rendering | project-core |
| song-studio | Write/arrange/sound/mix UI, piano roll, lyrics, recording and export | all above |

`ProjectDocument` owns song metadata, key/scale, BPM/meter, sections, chords, tracks, clips, notes, expression, automation, mixer settings and private asset references. Musical positions use integer ticks (960 PPQ); audio offsets use seconds. `InstrumentManifest` declares zones, synthesis defaults and actual articulation capabilities. `PerformanceEvent` carries tick-based notes and channel expression. All project data is validated at API and backup boundaries.

## Product behavior

- Writing: interactive piano; chord recognition and enharmonic labels; keys/scales; extensions, inversions and voice-leading; lyrics linked to sections.
- Assistance: audition chords/melodies/bass/percussion/accompaniment, control energy/density/register/tension, and insert editable notes. Existing notes are never silently regenerated.
- Arrangement: named song sections, multitrack timeline, piano-roll and drum editing, move/resize/split/duplicate/loop/transpose, quantize/swing/humanize and automation.
- Performance: onscreen/computer keyboards and feature-detected MIDI; velocity, sustain, bend, modulation and expression; metronome/count-in and microphone takes; imported audio, waveforms, trims/splits/fades/gain/alignment.
- Sound: CC0 curated VSCO/VCSL sample zones, velocity/round-robin/loops where supported; piano/orchestral/percussion and subtractive/FM presets; envelopes/filters/LFO, mapped user samples, per-track effects and shared sends.
- Mix/export: level/pan/mute/solo, meters/master processing; stereo WAV, stems, MIDI, project ZIP backups including user assets. Playback and rendering share the graph builder and deterministic variation seed.
- Persistence: cloud autosave, local recovery drafts, revision conflicts preserving both versions, delete and cross-device reload. Owners are checked on every project and asset operation; private audio is never served as a public static file.

## Architecture, commands and style

React 19 + TypeScript in the provided Vinext/Sites starter; Cloudflare Worker, D1 (`DB`) and R2 (`BUCKET`). Preserve the starter's Sites build integration and dispatch-owned sign-in. UI is warm charcoal/amber, compact, keyboard accessible, responsive and immediately useful. Audio modules are loaded only in the browser. Samples are loaded on demand and failures are visible without changing instrument settings.

- `npm run dev`: portable local preview, including loopback-only simulated ChatGPT sign-in.
- `npm run typecheck`: TypeScript checks.
- `npm test`: focused Vitest logic/security/export tests.
- `npm run test:browser`: browser integration, rendering and workflow tests.
- `npm run db:generate`: append-only Drizzle migrations.
- `npm run build`: deployment build (Sites publishing invokes its build helper).

Sources: `lib/music/`, `lib/audio/`, `lib/server/`, `components/studio/`, `app/api/`; tests in `tests/`; build-only helpers in `scripts/`. Use explicit typed functions, immutable project edits, semantic native controls, scoped modules, and normal React escaping. Never log credentials, song documents or recording bytes.

## Validation and boundaries

Test musical logic, edits/history, deterministic generation, schema limits, authorization, conflicting saves, backup round trips, MIDI and WAV encoding. In real browsers verify audio unlock, scheduling/seek/loops, expression, recording alignment, playback/render consistency, meters, keyboard navigation and responsive layout. Exercise a five-minute, 16-track reference project and record the evidence and any limits truthfully.

Always preserve user edits on recoverable failure. Request microphone/MIDI access only from explicit user interaction. Factory sound manifests include licence/source metadata. This release uses local musical rules, not paid AI; native VST hosting, live collaboration, vocal tuning and time-stretching are deferred. Do not modify any hardware or operating-system performance configuration.
