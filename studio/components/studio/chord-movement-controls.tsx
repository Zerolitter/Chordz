"use client";
import { DawKnob } from "./daw-knob";
import { useStudio } from "./use-studio";
import { DEFAULT_CHORD_MOVEMENT } from "../../lib/music/chord-movement";
import type { ChordMovementSettings } from "../../lib/music/modulation-types";

export function ChordMovementControls({ value, onChange, disabled = false, live = false, stageOwner }: {
  value: ChordMovementSettings;
  onChange: (settings: ChordMovementSettings) => void;
  disabled?: boolean;
  live?: boolean;
  stageOwner?: string;
}) {
  const s = useStudio();
  const update = (patch: Partial<ChordMovementSettings>) => onChange({ ...value, ...patch });
  const action = (patch: Partial<ChordMovementSettings>) => { if (s.finishGesture()) update(patch); };
  return <fieldset className="movement-controls" disabled={disabled} data-edit-policy={stageOwner ? "bypass" : undefined}>
    <div className="movement-toolbar"><label className="check-label"><input type="checkbox" checked={value.enabled} onChange={e => action({ enabled: e.target.checked })} />Use in generation</label>
    {live && <><label className="check-label"><input type="checkbox" checked={value.liveEnabled} onChange={e => action({ liveEnabled: e.target.checked })} />Live arpeggiator</label><label className="check-label"><input type="checkbox" checked={value.hold} disabled={!value.liveEnabled} onChange={e => action({ hold: e.target.checked })} />Hold input notes</label><span className="movement-state">{value.liveEnabled ? "Live on" : "Live off"}</span></>}</div>
    <div className="movement-grid">
      <section className="movement-module movement-pattern" aria-label="Movement pattern and rate"><h3>Pattern</h3><div className="movement-selectors">
      <label className="field">Pattern<select aria-label="Movement pattern" value={value.pattern} onChange={e => action({ pattern: e.target.value as ChordMovementSettings["pattern"] })}><option value="chord">Chord pulses</option><option value="up">Up</option><option value="down">Down</option><option value="upDown">Up / down</option><option value="random">Seeded random</option></select></label>
      <label className="field">Rate<select aria-label="Movement rate" value={value.division} onChange={e => action({ division: Number(e.target.value) })}>{!([60, 120, 240, 320, 480, 640, 960, 1920, 3840].includes(value.division)) && <option value={value.division}>{value.division} ticks</option>}{[[60, "1/64"], [120, "1/32"], [240, "1/16"], [320, "1/8 triplet"], [480, "1/8"], [640, "1/4 triplet"], [960, "1/4"], [1920, "1/2"], [3840, "Whole note"]].map(([ticks, label]) => <option key={ticks} value={ticks}>{label}</option>)}</select></label>
      </div><details className="movement-variation"><summary>Variation <span className="mono">{value.seed}</span></summary><DawKnob size="small" label="Movement seed" min={0} max={4294967295} step={1} defaultValue={0} value={value.seed} stageOwner={stageOwner} disabled={disabled} onChange={seed => update({ seed })} /></details></section>
      <section className="movement-module" aria-label="Movement timing"><h3>Timing</h3><div className="movement-knobs">
      <DawKnob size="small" label="Strum" min={0} max={480} step={1} defaultValue={DEFAULT_CHORD_MOVEMENT.strum} value={value.strum} stageOwner={stageOwner} disabled={disabled} onChange={v => update({ strum: v })} unit=" ticks" />
      <DawKnob size="small" label="Gate" min={.05} max={1} step={.01} defaultValue={DEFAULT_CHORD_MOVEMENT.gate} value={value.gate} stageOwner={stageOwner} disabled={disabled} onChange={v => update({ gate: v })} />
      <DawKnob size="small" label="Swing" min={0} max={.75} step={.01} defaultValue={DEFAULT_CHORD_MOVEMENT.swing} value={value.swing} stageOwner={stageOwner} disabled={disabled} onChange={v => update({ swing: v })} />
      </div></section>
      <section className="movement-module" aria-label="Movement voicing"><h3>Voicing</h3><div className="movement-knobs">
      <DawKnob size="small" label="Inversion" min={-4} max={4} step={1} defaultValue={DEFAULT_CHORD_MOVEMENT.inversion} value={value.inversion} stageOwner={stageOwner} disabled={disabled} onChange={v => update({ inversion: v })} />
      <DawKnob size="small" label="Voicing spread" min={0} max={3} step={1} defaultValue={DEFAULT_CHORD_MOVEMENT.spread} value={value.spread} stageOwner={stageOwner} disabled={disabled} onChange={v => update({ spread: v })} />
      <DawKnob size="small" label="Octave range" min={1} max={4} step={1} defaultValue={DEFAULT_CHORD_MOVEMENT.octaves} value={value.octaves} stageOwner={stageOwner} disabled={disabled} onChange={v => update({ octaves: v })} />
      </div></section>
    </div>
    <p className="helper movement-help">Live changes affect new notes. Recorded movement remains editable; Stop releases held notes.</p>
  </fieldset>;
}
