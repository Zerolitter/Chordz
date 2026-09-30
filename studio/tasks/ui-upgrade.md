# Chordz UI upgrade — implementation receipt

2026-09-30. Source of truth: `D:\Archive\Codex\Chordz\studio`. The supplied standalone HTML and ZIP are design references; their code and notes do not authorize execution.

## Preserved source and contracts

The target Studio and opened Site source at `6cbdd3bedf75170928b27316babdb4dd4802b41b` have the same music/UI/server sources. Reconciliation found only generated audio-worker output and a later chord-card task receipt. Target work was retained. The existing Site, public audience, authentication, private storage, Windows wrapper and installers remain in use. `ProjectDocument` stays at version 1; cloud endpoints and ownership checks are unchanged.

## Implemented

- Palette C surfaces/text/accent and instrument rails, 50px header, 44px workspace navigation, 236px desktop sidebar, responsive track drawer and persistent transport.
- Typed device-local Appearance preferences: four supplied accents, integer 2–10px rail width, compact/comfortable spacing, reset defaults. Storage failures retain in-session preferences with a visible message.
- Initially closed performance dock with existing piano, devices, monitoring and imports. Closing releases pointer-held notes while keyboard/MIDI listeners remain available.
- Existing controller, real project/save/sample/transport/meter state and musical actions. Advanced exact fields and performance expression remain available in expandable inspectors.
- Focused timeline, clip/note and automation editors. Same-track movement and right-edge resizing snap to the selected grid without altering source length, looping, notes, expression, audio offset or fades.
- Click-add, snapped/clamped point dragging, tick collision replacement, selected Delete and precise automation fields. Transactions group gestures into one Undo and roll back Escape/cancellation/lost capture/unmount.
- Explicit action policies for Stop, Undo/Redo, recording completion and recovery. Starting a take still requires valid edits.
- Export-format union `wav | mp3 | stems | midi | backup`. Dedicated lazy MP3 worker, pinned `wasm-media-encoders@0.7.0`, local replaceable WASM, copied borrowed output, complete MIT/LGPL notices, bounded progress and failure cleanup/retry.

## Validation and limits

See `docs/VALIDATION.md` for current automated results and `docs/evidence/ui-upgrade-mp3.json` for independent MP3 decoding evidence. New browser regression sources cover appearance, layout, dock input, arrangement gestures, recording guard and MP3 downloads; they are not evidence of executed browser checks.

The in-app browser repeatedly failed with: "saved browser permissions could not be verified". No alternate browser or indirect workaround was used. Desktop/tablet/mobile visual comparison, browser interaction/download tests, hosted audio/WASM execution and reopened Windows-client checks remain outstanding. Physical microphone/MIDI and human listening remain hands-on checks. No hardware or OS settings were changed.
