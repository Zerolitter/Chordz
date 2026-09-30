"use client";
import { useEffect, useId, useRef, useState } from "react";
import { clamp } from "../../lib/music/types";
import { useStudio } from "./use-studio";
function useRackDraft(value: string | number, owner?: string) {
  const [draft, setDraft] = useState<{ raw: string; expected: string | number; owner?: string } | null>(null);
  const matches = draft?.expected === value && draft?.owner === owner;
  useEffect(() => { if (draft && !matches) queueMicrotask(() => setDraft(current => current === draft ? null : current)); }, [draft, matches]);
  return { raw: matches ? draft?.raw ?? null : null, set: (raw: string, expected: string | number = value) => setDraft({ raw, expected, owner }), clear: () => setDraft(null) };
}
/** Uses one editor transaction per gesture, including all edits while A/B is staged. */
export function RackNumber({ label, value, min, max, step = .01, unit, onChange, stageOwner, disabled = false }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string;
  onChange: (value: number) => void; stageOwner?: string; disabled?: boolean;
}) {
  const s = useStudio(), field = useId(), owner = stageOwner ?? field, gesture = useRef(false);
  const finePointer = useRef<{ id: number; x: number; value: number; width: number } | null>(null);
  const draft = useRackDraft(value, stageOwner), raw = draft.raw;
  const quantize = (number: number) => clamp(Math.round(number / step) * step, min, max);
  const begin = () => s.ownsEdit(owner) || s.beginEdit(owner);
  const finish = () => { gesture.current = false; if (stageOwner ? raw === null || !!raw.trim() && Number.isFinite(Number(raw)) && Number(raw) >= min && Number(raw) <= max : s.finishEdit(owner)) draft.clear(); };
  const cancel = () => { gesture.current = false; s.cancelEdit(owner); draft.clear(); };
  return <label className="rack-number"><span>{label}</span><div>
    <input type="range" aria-label={label} min={min} max={max} step={step} value={value} disabled={disabled}
      onPointerDown={e => { gesture.current = begin(); if (gesture.current && e.shiftKey) { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); finePointer.current = { id: e.pointerId, x: e.clientX, value, width: e.currentTarget.getBoundingClientRect().width }; } }} onPointerUp={() => { finePointer.current = null; finish(); }} onPointerCancel={() => { finePointer.current = null; cancel(); }}
      onPointerMove={e => { const point = finePointer.current; if (point?.id === e.pointerId) onChange(quantize(point.value + (e.clientX - point.x) / Math.max(1, point.width) * (max - min) * .1)); }}
      onKeyDown={e => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) { gesture.current = begin(); if (e.shiftKey && e.key.startsWith("Arrow") && gesture.current) { e.preventDefault(); onChange(quantize(value + (["ArrowLeft", "ArrowDown"].includes(e.key) ? -1 : 1) * step)); } } if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finePointer.current = null; cancel(); } }}
      onKeyUp={e => { if (e.key !== "Escape") finish(); }}
      onChange={e => { if (begin()) onChange(Number(e.target.value)); }} />
    <input type="number" className="rack-value" aria-label={`${label} value`} min={min} max={max} step={step} value={raw ?? value} disabled={disabled}
      onFocus={() => { if (begin()) draft.set(String(value)); }} onBlur={finish}
      onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); } else if (e.key === "Enter") { e.preventDefault(); finish(); e.currentTarget.blur(); } }}
      onChange={e => { const text = e.target.value, n = Number(text), valid = !!text.trim() && Number.isFinite(n) && n >= min && n <= max; draft.set(text, valid ? n : value); if (!begin()) return; if (!valid) { s.invalidateEdit(`${label} must be between ${min} and ${max}.`, owner); return; } s.invalidateEdit(null, owner); onChange(n); }} />
    {unit && <span className="tiny">{unit}</span>}
  </div></label>;
}

export function RackText({ label, value, maxLength, minLength = 0, onChange, stageOwner, disabled }: {
  label: string; value: string; maxLength: number; minLength?: number; onChange: (value: string) => void; stageOwner?: string; disabled?: boolean;
}) {
  const s = useStudio(), field = useId(), owner = stageOwner ?? field;
  const draft = useRackDraft(value, stageOwner), raw = draft.raw;
  const begin = () => s.ownsEdit(owner) || s.beginEdit(owner);
  const finish = () => { if (stageOwner ? raw === null || raw.length >= minLength : s.finishEdit(owner)) draft.clear(); };
  return <input aria-label={label} type="text" maxLength={maxLength} value={raw ?? value} disabled={disabled}
    onFocus={() => { if (begin()) draft.set(value); }} onBlur={finish}
    onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); s.cancelEdit(owner); draft.clear(); } else if (e.key === "Enter") { e.preventDefault(); finish(); e.currentTarget.blur(); } }}
    onChange={e => { const next = e.target.value, valid = next.length >= minLength; draft.set(next, valid ? next : value); if (!begin()) return; if (!valid) { s.invalidateEdit(`${label} needs at least ${minLength} character.`, owner); return; } s.invalidateEdit(null, owner); onChange(next); }} />;
}
