# Polished DAW controls and uninterrupted live modulation

Approved 2026-10-01. Continue from the published Modulator implementation in this target folder. The existing Site checkout at `53b5017c81c107152cdfc45221923c9537e606f6` was reconciled before editing: all 417 Studio blobs matched GitHub source `b2a5ce1f91a850897c4a804c20252e2052e0cdd7`.

## Implementation boundaries

- Retain charcoal/cream/amber, logo, Write/Arrange/Sound/Mix, persistent transport, project schema v1, cloud endpoints, recording recovery, reference analysis and existing exports.
- Adapt the MIT react-knob-headless 0.4.0 primitive at upstream commit `b4ac2bf206ce7d9b2f2924ddb26d6a56b542e883` locally for React 19. Pin `@use-gesture/react` to 10.3.1; retain local license and attribution.
- Sound uses compact instrument controls, four macros, editable labelled source graphs and an adjacent matrix. Detailed movement/reference/patch controls remain expandable. Suitable Sound/Mix controls use knobs; volume faders remain.
- Knobs support vertical drag, Shift precision, exact numeric entry, double-click/default reset, keyboard/a11y and cancellation. Staged A/B/reference edits own history; child gesture savepoints cancel only the child and Apply commits the parent once. Unapplied settings stay out of recovery/autosave.
- Classify engine updates. Scalar Sound/Mix/matrix changes preserve playback clocks and queued note ownership; compatible sources preserve integrated phase and route smoothing. Onset/topology changes affect future voices at their scheduled times while held voices retain their setup. Live editing does not rewrite previously heard audio.
- Reverb decay swaps bounded parallel wet returns with a 100 ms crossfade, coalescing rapid edits. Dry audio and voices stay connected.
- During recording, macros remain performance controls; source/route/base-sound configuration retains its guard. Restart/seek uses saved deterministic settings. Tempo changes and adding/removing tracks retain existing transport retiming behavior outside this update.
- Additional synthesizers, multiband processors, native plugin hosting and OS/hardware changes are outside scope.

## Verification and delivery

Run mapping/savepoint/graph/routing/evaluator unit checks, browser gesture and responsive checks, native Web Audio continuity and live/offline comparisons, recording/recovery and export regressions, type/lint/build/dependency checks. Review before committing. Push verified source and publish the identical Studio subtree through the existing public Site. Record actual results in `docs/VALIDATION.md`; report physical devices/touch and human listening separately. Computer access can inspect the existing Windows wrapper without changing it.
