"use client";
import type { CSSProperties, DragEvent } from "react";
import { Trash2 } from "lucide-react";
import { DawKnob } from "./daw-knob";
import { RackNumber, RackText } from "./modulation-field";
import { SourceGraphEditor } from "./source-graph-editor";
import { useStudio } from "./use-studio";
import type { ModSourceState } from "../../lib/audio/modulation";
import type { ModSource, ModTarget } from "../../lib/music/modulation-types";

const sourceColours = ["#7db5dc", "#af95db", "#8fc6a5", "#dca39a", "#9bcacc", "#d3b880", "#c8a0c5", "#a6b2df"];
function sourceColour(id: string) { let hash = 0; for (const character of id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0; return sourceColours[hash % sourceColours.length]; }

export function ModulationSourceCard({ source, state, trackId, seed, stageOwner, disabled, audioTrack, selected, rangeFor, onChange, onAssign, onDelete, onDragStart }: {
  source: ModSource; state?: ModSourceState; trackId: string; seed: number; stageOwner?: string; disabled: boolean; audioTrack: boolean; selected: boolean;
  onChange: (source: ModSource) => void; onAssign: () => void; onDelete: () => void; onDragStart: (event: DragEvent, sourceId: string) => void;
  rangeFor: (target: ModTarget, base: number) => readonly [number, number] | undefined;
}) {
  const s = useStudio();
  const update = (patch: Partial<ModSource>) => onChange({ ...source, ...patch });
  const action = (patch: Partial<ModSource>) => { if (s.finishGesture()) update(patch); };
  const points = source.kind === "step" ? source.steps : source.curve;
  return <article className={`mod-source${selected ? " source-selected" : ""}`} style={{ "--source-color": sourceColour(source.id) } as CSSProperties}>
    <div className="mod-source-heading"><button className="mod-drag-source" draggable={!disabled} onDragStart={event => onDragStart(event, source.id)} onClick={onAssign} aria-label={`Assign ${source.name}`} aria-pressed={selected}><strong>{source.name}</strong><span className="tiny">{source.kind} · {source.scope}</span></button><label className="check-label"><input aria-label={`Enable ${source.name}`} type="checkbox" checked={source.enabled} disabled={disabled} onChange={event => action({ enabled: event.target.checked })} />On</label><button className="text-button" disabled={disabled} aria-label={`Delete ${source.name}`} onClick={onDelete}><Trash2 size={13} /></button></div>
    {source.kind === "lfo" && <div className="mod-wave-shapes" role="group" aria-label={`${source.name} waveform`}>{(["sine", "triangle", "saw", "square"] as const).map(shape => <button key={shape} type="button" aria-pressed={source.shape === shape} disabled={disabled} onClick={() => action({ shape })}>{shape}</button>)}</div>}
    <SourceGraphEditor source={source} state={state} trackId={trackId} seed={seed} onChange={onChange} stageOwner={stageOwner} disabled={disabled} />
    <div className="mod-source-knobs">
      {source.kind !== "envelope" && (source.sync ? <label className="field mod-cycle">Cycle<select aria-label={`${source.name} cycle`} value={source.division} disabled={disabled} onChange={event => action({ division: Number(event.target.value) })}>{![.125, .25, .5, 1, 2, 4, 8, 16].includes(source.division) && <option value={source.division}>{source.division} beats</option>}{[[.125,"1/32"],[.25,"1/16"],[.5,"1/8"],[1,"1/4"],[2,"1/2"],[4,"Whole"],[8,"2 bars"],[16,"4 bars"]].map(([beats,label]) => <option key={beats} value={beats}>{label}</option>)}</select><span className="tiny">{state ? `${state.rate.toFixed(2)} Hz` : "Beat sync"}</span></label> : <DawKnob size="small" displayLabel="Rate" label={`${source.name} rate`} value={source.rate} min={.01} max={30} step={.01} defaultValue={1} unit="Hz" log stageOwner={stageOwner} disabled={disabled} modulationTarget={`source:${source.id}:rate`} effectiveValue={state?.rate} modulationRange={rangeFor(`source:${source.id}:rate`, source.rate)} trackId={trackId} onChange={rate => update({ rate })} />)}
      <DawKnob size="small" displayLabel="Amount" label={`${source.name} amplitude`} value={source.amplitude} min={0} max={1} step={.01} defaultValue={1} stageOwner={stageOwner} disabled={disabled} modulationTarget={`source:${source.id}:amplitude`} effectiveValue={state?.amplitude} modulationRange={rangeFor(`source:${source.id}:amplitude`, source.amplitude)} trackId={trackId} onChange={amplitude => update({ amplitude })} />
    </div>
    <details className="mod-source-inspector"><summary>Source settings{state && <span className="mono">{state.value.toFixed(2)}</span>}</summary><div className="source-settings"><label className="field">Name<RackText label={`${source.name} name`} value={source.name} minLength={1} maxLength={80} stageOwner={stageOwner} disabled={disabled} onChange={name => update({ name })} /></label><label className="field">Scope<select aria-label={`${source.name} scope`} value={source.scope} disabled={disabled} onChange={event => action({ scope: event.target.value as ModSource["scope"] })}><option value="track">Whole track</option><option value="voice" disabled={audioTrack}>Each voice</option></select></label>{source.kind !== "envelope" && <label className="check-label"><input aria-label={`Synchronize ${source.name}`} type="checkbox" checked={source.sync} disabled={disabled} onChange={event => action({ sync: event.target.checked })} />Beat sync</label>}</div>
      <div className="mod-source-precision">      {source.kind !== "envelope" && <DawKnob size="small" displayLabel="Phase" label={`${source.name} phase`} value={source.phase} min={0} max={1} step={.01} defaultValue={0} unit="cycle" stageOwner={stageOwner} disabled={disabled} onChange={phase => update({ phase })} />}
      {source.kind === "envelope" && (["attack", "decay", "sustain", "release"] as const).map(parameter => <DawKnob size="small" key={parameter} displayLabel={parameter[0].toUpperCase() + parameter.slice(1)} label={`${source.name} ${parameter}`} value={source[parameter]} min={parameter === "sustain" ? 0 : parameter === "release" ? .01 : .001} max={parameter === "sustain" ? 1 : parameter === "release" ? 15 : 10} step={parameter === "sustain" ? .01 : .001} defaultValue={parameter === "attack" ? .1 : parameter === "decay" ? .3 : parameter === "sustain" ? .6 : .5} unit={parameter === "sustain" ? "" : "s"} log={parameter !== "sustain"} stageOwner={stageOwner} disabled={disabled} onChange={value => update({ [parameter]: value })} />)}
</div>
      {(source.kind === "step" || source.kind === "reference") && <><div className="mod-point-actions"><span className="tiny">{points.length} fixed time values</span><button className="text-button" disabled={disabled || points.length >= (source.kind === "step" ? 64 : 256)} onClick={() => action({ [source.kind === "step" ? "steps" : "curve"]: [...points, 0] })}>Add {source.kind === "step" ? "step" : "point"}</button><button className="text-button" disabled={disabled || points.length <= 1} onClick={() => action({ [source.kind === "step" ? "steps" : "curve"]: points.slice(0, -1) })}>Remove last</button></div><details><summary>Precise values</summary><div className="source-steps">{points.map((value, index) => <RackNumber key={index} label={`${source.name} ${source.kind === "step" ? "step" : "point"} ${index + 1}`} value={value} min={-1} max={1} step={.01} stageOwner={stageOwner} disabled={disabled} onChange={next => { const values = [...points]; values[index] = next; update({ [source.kind === "step" ? "steps" : "curve"]: values }); }} />)}</div></details></>}
    </details>
  </article>;
}
