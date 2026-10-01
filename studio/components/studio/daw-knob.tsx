"use client";
import { useEffect, useEffectEvent, useId, useRef, useState, type DragEvent } from "react";
import { MOD_TARGETS, type ModTarget } from "../../lib/music/modulation-types";
import { KNOB_KEYS, knobArc, knobKeyValue, knobParseNumber, knobQuantize, knobToUnit } from "../../lib/client/knob";
import { KnobHeadless, type KnobHeadlessHandle } from "./knob-headless";
import { useStudio } from "./use-studio";
import "./daw-knob.css";

export interface DawKnobProps {
  label: string; displayLabel?: string; value: number; min?: number; max?: number; step?: number;
  defaultValue?: number; unit?: string; format?: (value: number) => string; log?: boolean;
  disabled?: boolean; size?: "normal" | "small"; stageOwner?: string; performance?: boolean;
  effectiveValue?: number; modulationRange?: readonly [number, number]; modulationTarget?: ModTarget; modulationTargets?: readonly ModTarget[];
  trackId?: string; onModulationDrop?: (sourceId: string, target: ModTarget) => void;
  onChange: (value: number) => void;
}
const SOURCE_MIME = "application/x-chordz-mod-source", TRACK_MIME = "application/x-chordz-track-id";
type Gesture = { kind: "pointer" | "keyboard" | "numeric" | "reset"; start: number; value: number; invalid: boolean };

export function DawKnob({ label, displayLabel, value, min = 0, max = 1, step = .01, defaultValue,
  unit = "", format, log = false, disabled: disabledProp = false, size = "normal", stageOwner, performance = false,
  effectiveValue, modulationRange, modulationTarget, modulationTargets, trackId, onModulationDrop, onChange }: DawKnobProps) {
  const s = useStudio(), owner = "knob:" + useId(), labelId = useId(), helpId = useId(), inputId = useId();
  const disabled = disabledProp || (performance ? !["idle","count-in","capturing"].includes(s.recordingPhase) : s.recordingPhase !== "idle");
  const headless = useRef<KnobHeadlessHandle>(null), gesture = useRef<Gesture | null>(null), blocked = useRef(false);
  const mounted = useRef(false), displayEpoch = useRef(0);
  const [raw, setRaw] = useState<string | null>(null), [invalid, setInvalid] = useState(false), [dragOver, setDragOver] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<{ sourceId: string; origin: string } | null>(null);
  const targets = [...new Set(modulationTargets ?? (modulationTarget ? [modulationTarget] : []))];
  const display = (n: number) => (format ? format(n) : (min < 0 && n > 0 ? "+" : "") + (Number.isInteger(step) ? Math.round(n).toString() : Number(n.toPrecision(4)).toString())) + unit;
  function stopGesture(restorePerformance = true) {
    const current = gesture.current;
    if (!current) return false;
    gesture.current = null; displayEpoch.current++;
    if (performance) { if (restorePerformance) onChange(current.start); } else s.cancelGesture(owner);
    headless.current?.cancel();
    return true;
  }
  function cancel() {
    if (!stopGesture()) return false;
    if (mounted.current) { setRaw(null); setInvalid(false); }
    return true;
  }
  function finish() {
    const current = gesture.current;
    if (!current) return true;
    if (current.invalid || (!performance && !s.finishGesture(owner))) return false;
    gesture.current = null; setRaw(null); setInvalid(false);
    return true;
  }
  function begin(kind: Gesture["kind"]) {
    if (disabled) return false;
    if (gesture.current) {
      if (gesture.current.kind === kind && (performance || s.ownsGesture(owner))) return true;
      if (!finish()) return false;
    }
    if (!performance && !s.beginGesture(owner, stageOwner)) return false;
    displayEpoch.current++;
    gesture.current = { kind, start: value, value, invalid: false };
    return true;
  }
  function publish(next: number, quantize = true) {
    const current = gesture.current;
    if (!current) return;
    if (!performance && !s.ownsGesture(owner)) { cancel(); return; }
    const n = quantize ? knobQuantize(next, min, max, step) : next;
    current.value = n; current.invalid = false;
    if (!performance) s.invalidateGesture(null, owner);
    setInvalid(false); onChange(n);
  }
  const cancelCurrent = useEffectEvent(cancel);
  const reconcile = useEffectEvent(() => {
    if (!gesture.current) return false;
    // A take cutoff freezes the last emitted controller value. It must not emit a rollback event.
    if (disabled && performance) return stopGesture(false);
    if (disabled || !performance && !s.ownsGesture(owner)) return stopGesture();
    return false;
  });
  const clearReconciledDraft = useEffectEvent((epoch: number) => {
    if (!mounted.current || displayEpoch.current !== epoch || gesture.current) return;
    setRaw(null); setInvalid(false);
  });
  const endLifetime = useEffectEvent(() => { mounted.current = false; displayEpoch.current++; });
  useEffect(() => {
    mounted.current = true;
    return () => { endLifetime(); };
  }, []);
  useEffect(() => {
    if (!reconcile()) return;
    const epoch = displayEpoch.current;
    queueMicrotask(() => clearReconciledDraft(epoch));
  }, [s.transaction, disabled, performance]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && cancelCurrent()) { event.preventDefault(); event.stopPropagation(); blocked.current = true; }
    };
    const blur = () => { cancelCurrent(); };
    window.addEventListener("keydown", escape, true); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", escape, true); window.removeEventListener("blur", blur); cancelCurrent(); };
  }, []);
  function reset() { if (defaultValue !== undefined && begin("reset")) { publish(defaultValue, false); finish(); } }
  function assign(sourceId: string, target: ModTarget, origin: string) {
    if (onModulationDrop) onModulationDrop(sourceId, target);
    else s.assignModulation(sourceId, target, trackId, origin || undefined);
    setPendingDrop(null);
  }
  function drop(event: DragEvent) {
    setDragOver(false);
    if (disabled || !targets.length || !event.dataTransfer.types.includes(SOURCE_MIME)) return;
    event.preventDefault(); event.stopPropagation();
    const sourceId = event.dataTransfer.getData(SOURCE_MIME), origin = event.dataTransfer.getData(TRACK_MIME);
    if (!sourceId) return;
    if (targets.length === 1) assign(sourceId, targets[0], origin); else setPendingDrop({ sourceId, origin });
  }
  const p = knobToUnit(value, min, max, log), effective = effectiveValue === undefined ? p : knobToUnit(effectiveValue, min, max, log);
  const numericValue = raw ?? Number(value.toPrecision(8)).toString();
  return <div className={`daw-knob daw-knob-${size}${dragOver ? " is-drop-target" : ""}${disabled ? " is-disabled" : ""}`} data-edit-policy="bypass"
    onDragOver={event => { if (!disabled && targets.length && event.dataTransfer.types.includes(SOURCE_MIME)) { event.preventDefault(); setDragOver(true); } }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false); }} onDrop={drop}>
    <span id={labelId} className="daw-knob-label" title={label}>{displayLabel ?? label}</span>
    <div className="daw-knob-control">
      <KnobHeadless ref={headless} className="daw-knob-dial" aria-label={displayLabel ? label : undefined} aria-labelledby={displayLabel ? undefined : labelId} aria-describedby={helpId}
        valueRaw={value} valueMin={min} valueMax={max} log={log} disabled={disabled} valueRawDisplayFn={display}
        onGestureStart={() => begin("pointer")} onValueRawChange={publish}
        onGestureEnd={canceled => { if (gesture.current?.kind === "pointer") { if (canceled) cancel(); else finish(); } }}
        onDoubleClick={event => { event.preventDefault(); reset(); }}
        onKeyDown={event => {
          if (event.key === "Escape") { if (cancel()) { event.preventDefault(); event.stopPropagation(); blocked.current = true; } return; }
          if (!(KNOB_KEYS as readonly string[]).includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          if (!event.repeat) blocked.current = false;
          if (blocked.current || event.repeat && (!gesture.current || !performance && !s.ownsGesture(owner)) || !begin("keyboard")) return;
          const next = knobKeyValue(event.key, gesture.current!.value, { min, max, step }, event.shiftKey);
          if (next !== null) publish(next);
        }}
        onKeyUp={event => { if ((KNOB_KEYS as readonly string[]).includes(event.key)) { event.stopPropagation(); if (gesture.current?.kind === "keyboard") finish(); blocked.current = false; } }}
        onBlur={() => { if (gesture.current?.kind === "keyboard") finish(); }}>
        <svg viewBox="0 0 56 56" aria-hidden="true">
          <path className="knob-track" d={knobArc(0, 1)} />
          {modulationRange && <path className="knob-modulation-range" d={knobArc(knobToUnit(modulationRange[0],min,max,log),knobToUnit(modulationRange[1],min,max,log))} />}
          <path className="knob-value" d={knobArc(min < 0 && max > 0 ? knobToUnit(0, min, max) : 0, p)} />
          {effective !== p && <path className="knob-modulation" d={knobArc(p, effective)} />}
          <circle className="knob-face" cx="28" cy="28" r="16" />
          <line className="knob-indicator" x1="28" y1="18" x2="28" y2="13" transform={`rotate(${-135 + p * 270} 28 28)`} />
          {effective !== p && <circle className="knob-effective-dot" cx="28" cy="7" r="2" transform={`rotate(${-135 + effective * 270} 28 28)`} />}
        </svg>
      </KnobHeadless>
      {defaultValue !== undefined && <button type="button" className="daw-knob-reset" disabled={disabled} aria-label={`Reset ${label}`} title={`Reset ${label} to ${display(defaultValue)}`} onClick={reset}>↺</button>}
    </div>
    <label className="daw-knob-readout" htmlFor={inputId}>
    {raw === null && min < 0 && value > 0 && <span className="daw-knob-sign" aria-hidden="true">+</span>}
    <input id={inputId} className="daw-knob-number" aria-label={`${label} value`} aria-invalid={invalid || undefined} aria-describedby={helpId}
      type="text" inputMode="decimal" disabled={disabled} value={numericValue}
      style={{ width: `${Math.max(2, Math.min(14, numericValue.length))}ch` }}
      onFocus={event => { if (begin("numeric")) { setRaw(Number(value.toPrecision(8)).toString()); event.currentTarget.select(); } }}
      onChange={event => {
        if (!begin("numeric")) return;
        const text = event.target.value, n = knobParseNumber(text, min, max); setRaw(text);
        if (n === null) { gesture.current!.invalid = true; setInvalid(true); if (!performance) s.invalidateGesture(`${label} must be between ${min} and ${max}, or press Escape to restore it.`, owner); }
        else publish(n, false);
      }} onBlur={() => { if (gesture.current?.kind === "numeric") finish(); }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Enter") { event.preventDefault(); if (finish()) event.currentTarget.blur(); }
        if (event.key === "Escape") { event.preventDefault(); cancel(); event.currentTarget.blur(); }
      }} />
      {unit && <span className="daw-knob-unit" aria-hidden="true">{unit.trim()}</span>}
    </label>
    {format && <output className="daw-knob-display" aria-hidden="true">{display(value)}</output>}
    {effectiveValue !== undefined && effective !== p && <span className="daw-knob-effective">Now {display(effectiveValue)}</span>}
    {modulationRange && effectiveValue === undefined && <span className="daw-knob-effective">{targets.every(target => target.startsWith("voice.")) ? "Awaiting voice" : "Awaiting audio"}</span>}
    <span id={helpId} className="sr-only">Drag up or down. Hold Shift for fine control. Arrow keys adjust; Home and End set limits. Enter a number below. Escape cancels.{modulationRange ? ` Modulation range ${display(modulationRange[0])} to ${display(modulationRange[1])}.` : ""}{targets.length ? " Drop a modulation source to assign it." : ""}</span>
    {invalid && <span role="alert" className="daw-knob-error">{min}–{max} required</span>}
    {pendingDrop && <div className="daw-knob-destinations" role="group" aria-label={`Modulation destination for ${label}`}>
      {targets.map(target => <button type="button" key={target} onClick={() => assign(pendingDrop.sourceId, target, pendingDrop.origin)}>{MOD_TARGETS[target as keyof typeof MOD_TARGETS]?.label ?? target}</button>)}
      <button type="button" onClick={() => setPendingDrop(null)}>Cancel assignment</button>
    </div>}
  </div>;
}
