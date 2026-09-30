# Chordz Modulator

Approved 2026-09-30. Continue the existing Palette C Studio and online Windows wrapper in the target repository. Keep v1 projects, authentication, private storage, recovery and exports.

## Delivered design

Sound contains one selected-track rack: four named macros, audition, local presets, bypass, output meter, Sources, Matrix, Chord Movement and Reference Audio. Each track supports eight sources and 32 signed routes. Detailed fields expand; Assign remains available to keyboard and touch users alongside drag-and-drop. Unsupported instrument destinations retain their routes visibly.

Sources include synchronized or Hz LFOs, ADSR, seeded random, steps, reference curves and note/controller inputs. Routes can target another source's rate multiplier or amplitude. The document boundary rejects self-routing, cycles and voice-to-track routes. Module reset, JSON copy/paste, local presets, seeded Vary and locks preserve the instrument, output level, key and tempo by default.

A/B and reference recipes use controller-owned staged edits. Apply creates one history entry. Cancel and navigation discard the audition, including its device draft. Recording configuration remains guarded while macro and MIDI performance input stays available.

## Shared engine

One deterministic evaluator integrates rates on a 128 Hz control grid, with bounded seek checkpoints and stable project/source/note seeds. Graph scheduling composes base settings, automation, controller state and modulation before bounds are applied. Separate gain stages preserve envelope and expression behavior. Voice envelopes and ADSR destination changes are sampled at note onset. Scheduling follows the [Web Audio AudioParam contract](https://www.w3.org/TR/2021/REC-webaudio-20210617/#AudioParam), including preserving the current ramp when replacing future events.

Live input, phrase audition, arrangement and offline mix/stem rendering use the same evaluator. Graphs own the corresponding evaluator, nodes and scheduled events. Stop, source release, input disconnection, graph replacement and cancelled future notes release output.

Native ramps interpolate with one shared 128 Hz control-frame delay. Manual macro/CC events receive two render quanta of scheduling lookahead and align to the integer musical tick persisted in a take. Replacing future schedules preserves unchanged parameter ramps, so an unrelated CC update does not shift a held oscillator's phase. Parameter histories are bounded and weakly owned by their AudioParams.

The shared chord movement evaluator handles voicing/inversion, spread, strum, gate, octave range, swing, rhythm/direction and repeatable variation. Generation with movement disabled preserves legacy fixtures. Live Enable and Hold start off. Live input produces editable MIDI notes; replayed clips do not run through the live arpeggiator. The capture lifecycle removes cancelled queued notes and trims cancelled sounding notes. Count-in, loop/seek and device ownership are explicit.

## Reference analysis

Local MP3/WAV decoding feeds a separate lazy FFT.js 4.0.4 worker. Limits remain 100 MiB/file, ten minutes and 256 MiB estimated decoded PCM. Bounded copied chunks are transferred with acknowledgements; progress, cancellation and retry are independent of recording/export workers. Cancelling decoding invalidates its result immediately.

The profile contains tempo alternatives, onset density, brightness, band energy, RMS dynamics, stereo relationships, tonal candidates and possible transitions. RMS and decoded peaks are not loudness or true-peak certification. Tempo/key changes require explicit application. No exact reference chord progression is claimed. A local owner-scoped cache stores measured profiles; projects store only applied recipe metadata and bounded curves. References become private audio assets only through explicit track import.

Sound, Movement or Both recipes fit the chosen section. Factory pulse, repeating motion and phrase-swell patches are original starting points rather than copies of the references.

## Compatibility and delivery

ProjectDocument.schemaVersion remains 1. Optional typed modulation/movement fields and identified macro/CC events are validated by client, cloud, recovery and backup. An older client cannot silently omit stored enhanced fields. The updated client identifies its capability so deliberate Undo of an enhancement can save normally. Atomic revision protection remains in place.

Audio exports carry the resulting sound; MIDI carries editable notes and identified CC channels. Macro assignments, patches and reference curves remain in project/backup data. Existing Windows wrapper/installer files remain unchanged.

## Verification boundaries

Automated synthetic analysis and native browser PCM checks complement interaction, storage, schema, cloud, export and generator regression tests. Actual microphone/MIDI devices, physical touch, human listening and the reopened native window require hands-on checks. A voice already held before recording keeps its existing oscillator/sample offset and amplitude envelope; a MIDI replay starts a new voice at the captured onset. An audio take is the way to preserve that exact pre-held waveform.
