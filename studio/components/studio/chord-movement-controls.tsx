"use client";
import { DraftInput } from "./draft-field";
import { RackNumber } from "./modulation-field";
import type { ChordMovementSettings } from "../../lib/music/modulation-types";

export function ChordMovementControls({ value, onChange, disabled = false, live = false, stageOwner }: {
  value: ChordMovementSettings;
  onChange: (settings: ChordMovementSettings) => void;
  disabled?: boolean;
  live?: boolean;
  stageOwner?: string;
}) {
  const Slider = RackNumber;
  const update = (patch: Partial<ChordMovementSettings>) => onChange({ ...value, ...patch });
  return <fieldset className="movement-controls" disabled={disabled} data-edit-policy={stageOwner ? "bypass" : undefined}>
    <div className="mod-section-title"><h3>Chord movement</h3><label className="check-label"><input type="checkbox" checked={value.enabled} onChange={e => update({ enabled: e.target.checked })} />Use in generation</label></div>
    {live && <div className="mod-inline-fields"><label className="check-label"><input type="checkbox" checked={value.liveEnabled} onChange={e => update({ liveEnabled: e.target.checked })} />Live arpeggiator</label><label className="check-label"><input type="checkbox" checked={value.hold} disabled={!value.liveEnabled} onChange={e => update({ hold: e.target.checked })} />Hold input notes</label><span className="tiny">{value.liveEnabled ? "Play the piano, keyboard or MIDI; record the resulting notes." : "Live movement is off."}</span></div>}
    <div className="movement-grid">
      <label className="field">Pattern<select aria-label="Movement pattern" value={value.pattern} onChange={e => update({ pattern: e.target.value as ChordMovementSettings["pattern"] })}><option value="chord">Chord pulses</option><option value="up">Up</option><option value="down">Down</option><option value="upDown">Up / down</option><option value="random">Seeded random</option></select></label>
      <label className="field">Rate<select aria-label="Movement rate" value={value.division} onChange={e => update({ division: Number(e.target.value) })}>{!([60, 120, 240, 320, 480, 640, 960, 1920, 3840].includes(value.division)) && <option value={value.division}>{value.division} ticks</option>}{[[60, "1/64"], [120, "1/32"], [240, "1/16"], [320, "1/8 triplet"], [480, "1/8"], [640, "1/4 triplet"], [960, "1/4"], [1920, "1/2"], [3840, "Whole note"]].map(([ticks, label]) => <option key={ticks} value={ticks}>{label}</option>)}</select></label>
      <Slider label="Inversion" min={-4} max={4} step={1} value={value.inversion} stageOwner={stageOwner} onChange={v => update({ inversion: v })} />
      <Slider label="Voicing spread" min={0} max={3} step={1} value={value.spread} stageOwner={stageOwner} onChange={v => update({ spread: v })} />
      <Slider label="Strum" min={0} max={480} step={1} value={value.strum} stageOwner={stageOwner} onChange={v => update({ strum: v })} unit=" ticks" />
      <Slider label="Gate" min={.05} max={1} step={.01} value={value.gate} stageOwner={stageOwner} onChange={v => update({ gate: v })} />
      <Slider label="Octave range" min={1} max={4} step={1} value={value.octaves} stageOwner={stageOwner} onChange={v => update({ octaves: v })} />
      <Slider label="Swing" min={0} max={.75} step={.01} value={value.swing} stageOwner={stageOwner} onChange={v => update({ swing: v })} />
      {stageOwner ? <RackNumber label="Movement seed" min={0} max={4294967295} step={1} value={value.seed} stageOwner={stageOwner} onChange={seed => update({ seed })} /> : <label className="field">Movement seed<DraftInput aria-label="Movement seed" type="number" min={0} max={4294967295} step={1} value={value.seed} onChange={e => update({ seed: Number(e.target.value) })} /></label>}
    </div>
    <p className="helper">Generation inserts editable notes. Live movement shapes newly played notes; Hold is separate from chord selection. Stop releases all held output.</p>
  </fieldset>;
}
