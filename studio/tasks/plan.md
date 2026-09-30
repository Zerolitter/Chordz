# Chordz implementation plan

Continue from the approved SPEC.md; preserve the archive. Build sequential complete slices, verifying before expansion.

1. Project document/schema and immutable history; chord theory and deterministic generation; protected library and owner-scoped D1/R2 APIs; playable saved chord workspace.
2. CC0 sample catalog and real sample zone mappings; Web Audio/Tone live and offline graph, synth presets, MIDI expression; prove short WAV rendering.
3. Song sections, clips, piano roll, drum steps, editable accompaniment and expression/automation; loop/seek/transport.
4. AudioWorklet recording, count-in, imported/private audio, waveform/trim/fade/alignment; mixer/effects/meters.
5. WAV/stems/MIDI/ZIP backup workflows, conflicts/recovery, browser/16-track checks, release documentation and multi-user Sites publication.

Cloud saves compare expected revision before mutation. Recording bytes live in R2 and recovery data in owner-scoped IndexedDB. Audio rendering uses the same graph/event compilation as live playback. Offline processing must not buffer large file uploads inside Worker memory. Public access is to the sign-in surface; project endpoints require authentication and ownership.

Runtime errors, unavailable audio devices, failed samples and unavailable cloud storage are visible and recoverable. Do not substitute browser-only saves for the requested cloud persistence.
