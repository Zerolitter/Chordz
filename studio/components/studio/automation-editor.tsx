"use client";
import { useMemo, useState, type CSSProperties, type PointerEvent } from "react";
import { Trash2 } from "lucide-react";
import { DraftInput } from "./draft-field";
import { IconButton } from "./primitives";
import { useStudio, useTransport } from "./use-studio";
import { useArrangementGesture } from "./use-arrangement-gesture";
import { trackDisplayColor } from "../../lib/client/appearance";
import { projectEnd, ticksPerBar } from "../../lib/music/project";
import { clamp, type AutomationParameter } from "../../lib/music/types";
import { MAX_TICK, automationBounds, automationPointAt, clampAutomationTick, moveAutomationPoint, putAutomationPoint, type AutomationPoint } from "../../lib/music/arrangement";

type PointGesture = {
  points: AutomationPoint[]; sourceTick: number | null; current: AutomationPoint;
  rect: DOMRect; end: number; x: number; y: number; pointerId: number;
};

export function AutomationEditor({ grid }: { grid: number }) {
  const s = useStudio(), transport = useTransport(), track = s.selectedTrack;
  const [lane, setLane] = useState<AutomationParameter>("volume");
  const [selection, setSelection] = useState<{ context: string; tick: number } | null>(null);
  const [fieldKeys, setFieldKeys] = useState<Record<string, string>>({});
  const end = Math.min(projectEnd(s.project), MAX_TICK), bar = ticksPerBar(s.project), [min, max] = automationBounds[lane];
  const context = `${s.project.id}:${track?.id}:${lane}`;
  const rawPoints = track?.automation.find(a => a.parameter === lane)?.points;
  const points = useMemo(() => [...new Map((rawPoints ?? []).map(p => [p.tick, p])).values()]
    .sort((a, b) => a.tick - b.tick), [rawPoints]);
  const selectedTick = selection?.context === context ? selection.tick : null;
  const gesture = useArrangementGesture<PointGesture>("automation:" + context);
  const identities = useMemo(() => {
    const result = new Map<number, string>(), used = new Set<string>();
    // Prioritise the moved field's identity; Undo can restore its old time.
    const ordered = [...points].sort((a, b) => Number(!!fieldKeys[`${context}:${b.tick}`]) - Number(!!fieldKeys[`${context}:${a.tick}`]));
    for (const point of ordered) {
      let key = fieldKeys[`${context}:${point.tick}`] ?? `${context}:${point.tick}`;
      while (used.has(key)) key += ":restored";
      used.add(key); result.set(point.tick, key);
    }
    return result;
  }, [context, fieldKeys, points]);
  const pointKey = (tick: number) => identities.get(tick) ?? `${context}:${tick}`;
  function select(tick: number) { setSelection({ context, tick }); }
  function updatePoints(next: AutomationPoint[]) {
    if (track) s.updateTrack(track.id, current => ({ ...current,
      automation: [...current.automation.filter(a => a.parameter !== lane), { parameter: lane, points: next }],
    }), "Edit automation");
  }
  function changePoint(sourceTick: number, point: AutomationPoint) {
    updatePoints(moveAutomationPoint(points, sourceTick, point, lane, end));
    const tick = point.tick === sourceTick ? sourceTick : clampAutomationTick(point.tick, end);
    // Keep the focused numeric field mounted when sorting or merging times.
    const key = pointKey(sourceTick);
    setFieldKeys(current => {
      const next = { ...current };
      delete next[`${context}:${sourceTick}`];
      next[`${context}:${tick}`] = key;
      return next;
    });
    select(tick);
  }
  function remove(tick: number) {
    if (s.recording || !s.finishEdit()) return;
    updatePoints(points.filter(p => p.tick !== tick));
    setSelection(null);
  }
  function at(event: PointerEvent<SVGSVGElement>, rect: DOMRect, songEnd: number) {
    return automationPointAt((event.clientX - rect.left) / rect.width,
      ((event.clientY - rect.top) / rect.height * 70 - 5) / 60, songEnd, grid, lane);
  }
  function begin(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || !track || s.recording || gesture.active.current) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const source = (event.target as Element).closest("[data-automation-tick]")?.getAttribute("data-automation-tick");
    const sourceTick = source === undefined || source === null ? null : Number(source);
    const point = sourceTick === null ? at(event, rect, end) : points.find(p => p.tick === sourceTick)!;
    if (!gesture.begin({ points, sourceTick, current: point, rect, end, x: event.clientX, y: event.clientY, pointerId: event.pointerId })) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    select(point.tick);
    if (sourceTick === null) updatePoints(putAutomationPoint(points, point, lane, end));
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const g = gesture.active.current;
    if (!g || event.pointerId !== g.pointerId || !gesture.owns() || Math.hypot(event.clientX - g.x, event.clientY - g.y) < 2) return;
    const point = at(event, g.rect, g.end);
    gesture.update({ ...g, current: point });
    const next = g.sourceTick === null ? putAutomationPoint(g.points, point, lane, g.end)
      : moveAutomationPoint(g.points, g.sourceTick, point, lane, g.end);
    updatePoints(next);
    select(point.tick);
  }
  function cancel() {
    const original = gesture.active.current?.sourceTick;
    gesture.cancel();
    if (original !== null && original !== undefined) select(original);
    else setSelection(null);
  }
  const y = (value: number) => 65 - clamp((value - min) / (max - min), 0, 1) * 60;
  return <section className="automation-editor" style={track ? { "--track-color": trackDisplayColor(s.project, track) } as CSSProperties : undefined}>
    <div className="subheading">
      <h3>{track?.name ?? "Track"} automation</h3>
      <select aria-label="Automation parameter" value={lane} onChange={e => { if (s.finishEdit()) setLane(e.target.value as AutomationParameter); }}>
        {Object.keys(automationBounds).map(parameter => <option key={parameter} value={parameter}>{parameter}</option>)}
      </select>
      <button className="text-button" disabled={!track || !!s.recording} onClick={() => {
        if (!track || !s.finishEdit()) return;
        const value = lane === "volume" ? track.volume : lane === "cutoff" ? track.sound.cutoff : lane === "expression" ? 1 : 0;
        const point = { tick: clampAutomationTick(transport.tick, end), value: clamp(value, min, max) };
        updatePoints(putAutomationPoint(points, point, lane, end)); select(point.tick);
      }}>+ Point at playhead</button>
      <IconButton label="Delete selected automation point" disabled={selectedTick === null || !!s.recording}
        onClick={() => { if (selectedTick !== null) remove(selectedTick); }}><Trash2 size={14} /></IconButton>
    </div>
    <svg className="automation-graph" viewBox="0 0 800 70" preserveAspectRatio="none" aria-label={lane + " automation curve"}
      onPointerDown={begin} onPointerMove={move} onPointerUp={e => { if (gesture.active.current?.pointerId === e.pointerId) { move(e); gesture.finish(); } }}
      onPointerCancel={e => { if (gesture.active.current?.pointerId === e.pointerId) cancel(); }}
      onLostPointerCapture={() => { if (gesture.active.current) cancel(); }}>
      <polyline points={points.map(p => `${p.tick / end * 800},${y(p.value)}`).join(" ")} />
      {points.map((point, i) => <circle key={point.tick} className={"automation-point" + (point.tick === selectedTick ? " selected" : "")}
        data-automation-tick={point.tick} cx={point.tick / end * 800} cy={y(point.value)} r={point.tick === selectedTick ? 5 : 4}
        role="button" tabIndex={0} aria-label={`Select automation point ${i + 1}`} aria-pressed={point.tick === selectedTick}
        onFocus={() => select(point.tick)} onKeyDown={event => {
          if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); remove(point.tick); }
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(point.tick); }
        }} />)}
    </svg>
    <p className="helper">Click the curve to add a point. Drag a point to move it on the grid. Select a point and press Delete to remove it; Escape cancels a drag.</p>
    <details className="advanced-inspector" open>
    <summary>Precise automation values</summary>
    <div className="automation-points automation-inspector">
      {points.map((point, i) => <div key={pointKey(point.tick)} className={point.tick === selectedTick ? "selected" : ""}>
        <label>Bar<DraftInput aria-label={`Automation point ${i + 1} bar`} type="number" min={1} max={Math.max(end, point.tick) / bar + 1}
          step={grid / bar} value={point.tick / bar + 1}
          onChange={e => changePoint(point.tick, { ...point, tick: Math.round((Number(e.target.value) - 1) * bar) })} /></label>
        <label>Value<DraftInput aria-label={`Automation point ${i + 1} value`} type="number" min={min} max={max}
          step={lane === "cutoff" ? 10 : .01} value={point.value}
          onChange={e => changePoint(point.tick, { ...point, value: clamp(Number(e.target.value), min, max) })} /></label>
        <IconButton label={`Delete automation point ${i + 1}`} disabled={!!s.recording}
          onClick={() => remove(point.tick)}><Trash2 size={13} /></IconButton>
      </div>)}
    </div>
    </details>
  </section>;
}
