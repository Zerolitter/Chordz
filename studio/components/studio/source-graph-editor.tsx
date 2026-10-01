"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useStudio } from "./use-studio";
import type { ModSourceState } from "../../lib/audio/modulation";
import type { ModSource } from "../../lib/music/modulation-types";
import { clamp } from "../../lib/music/types";
import { editSourceHandle, sourceGraphLayout, sourceGraphPoints, sourceHandlePosition, type SourceHandle } from "./source-graph-math";
import "./source-graph-editor.css";
import { useToolInputTermination, useToolVisibility } from "./tool-visibility";

const graphHeight = 112, plotTop = 22, plotBottom = 86, plotLeft = 24, plotRight = 22;
export function SourceGraphEditor({ source, state, trackId, seed, onChange, stageOwner, disabled = false }: {
  source: ModSource; state?: ModSourceState; trackId: string; seed: number; onChange: (source: ModSource) => void; stageOwner?: string; disabled?: boolean;
}) {
  const s = useStudio(), id = useId(), owner = `source-graph:${id}`;
  const active = useToolVisibility();
  const pointer = useRef<{ id: number; handle: SourceHandle; source: ModSource; layout: ReturnType<typeof sourceGraphLayout>; element: SVGElement } | null>(null), svg = useRef<SVGSVGElement>(null), studio = useRef(s);
  useLayoutEffect(() => { studio.current = s; });
  const keyboard = useRef(false);
  const [graphWidth, setGraphWidth] = useState(256);
  useLayoutEffect(() => {
    const element = svg.current;
    if (!active || !element) return;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) setGraphWidth(width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);
  const [frozenLayout, setFrozenLayout] = useState<ReturnType<typeof sourceGraphLayout> | null>(null);
  const layout = frozenLayout ?? sourceGraphLayout(source, state);
  const graphX = (x: number) => plotLeft + clamp(x, 0, 1) * (graphWidth - plotLeft - plotRight);
  const graphY = (value: number) => source.kind === "envelope"
    ? plotBottom - clamp(value, 0, 1) * (plotBottom - plotTop)
    : (plotTop + plotBottom) / 2 - clamp(value, -1, 1) * (plotBottom - plotTop) / 2;
  const baseline = graphY(0);
  const key = state?.key ?? `${trackId}:${source.id}:${source.scope === "voice" ? "ui-middle-c" : "track"}`, effectiveSeed = state?.seed ?? seed;
  const effectiveLayout = source.kind === "envelope" && state?.release === undefined && state ? { ...layout, releaseAt: Infinity } : layout;
  const points = sourceGraphPoints(source, layout, key, effectiveSeed, source.kind === "step" || source.kind === "reference" ? 1 : source.amplitude), effectivePoints = sourceGraphPoints(source, effectiveLayout, key, effectiveSeed, state?.amplitude ?? source.amplitude);
  const path = (values: typeof points) => values.map((point, index) => `${index ? "L" : "M"}${graphX(point.x)},${graphY(point.value)}`).join(" ");
  const handles: SourceHandle[] = source.kind === "envelope" ? ["attack", "decay", "release"] : source.kind === "step" || source.kind === "reference" ? (source.kind === "step" ? source.steps : source.curve).map((_, index) => index) : source.kind === "lfo" ? ["phase", "amplitude"] : [];
  const label = (handle: SourceHandle) => `${source.name} ${typeof handle === "number" ? `${source.kind === "step" ? "step" : "point"} ${handle + 1}` : handle === "decay" ? "decay and sustain" : handle} graph handle`;
  const valueFor = (handle: SourceHandle) => typeof handle === "number" ? (source.kind === "step" ? source.steps : source.curve)[handle] : source[handle];
  function locate(event: PointerEvent<SVGElement>) {
    const element = svg.current!, matrix = element.getScreenCTM();
    const point = element.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const position = matrix ? point.matrixTransform(matrix.inverse()) : point;
    return {
      x: (position.x - plotLeft) / (graphWidth - plotLeft - plotRight),
      value: source.kind === "envelope" ? (plotBottom - position.y) / (plotBottom - plotTop) : ((plotTop + plotBottom) / 2 - position.y) / ((plotBottom - plotTop) / 2),
    };
  }
  function start(event: PointerEvent<SVGElement>, handle: SourceHandle) { if (!active || disabled || event.button !== 0) return; event.preventDefault(); event.stopPropagation(); if (!s.beginGesture(owner, stageOwner)) return; if (typeof handle === "number") { const x = clamp(locate(event).x, 0, 1), count = source.kind === "step" ? source.steps.length : source.curve.length; handle = source.kind === "step" ? Math.min(count - 1, Math.floor(x * count)) : Math.round(x * Math.max(0, count - 1)); } setFrozenLayout(layout); pointer.current = { id: event.pointerId, handle, source: structuredClone(source), layout, element: event.currentTarget }; event.currentTarget.setPointerCapture(event.pointerId); }
  function move(event: PointerEvent<SVGElement>) { const drag = pointer.current; if (!drag || drag.id !== event.pointerId) return; event.stopPropagation(); if (!s.ownsGesture(owner)) { pointer.current = null; setFrozenLayout(null); return; } const position = locate(event); const value = source.kind === "envelope" && drag.handle === "decay" ? position.value / Math.max(.001, drag.source.amplitude) : position.value; onChange(editSourceHandle(drag.source, drag.handle, position.x, value, drag.layout)); }
  function finish(event: PointerEvent<SVGElement>) { if (pointer.current?.id !== event.pointerId) return; pointer.current = null; setFrozenLayout(null); if (s.ownsGesture(owner)) s.finishGesture(owner); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }
  function cancel() { if (!pointer.current && !keyboard.current) return; const drag = pointer.current; pointer.current = null; keyboard.current = false; setFrozenLayout(null); if (studio.current.ownsGesture(owner)) studio.current.cancelGesture(owner); if (drag?.element.hasPointerCapture(drag.id)) drag.element.releasePointerCapture(drag.id); }
  function terminate() { if (!pointer.current && !keyboard.current) return; const drag = pointer.current; pointer.current = null; keyboard.current = false; setFrozenLayout(null); if (studio.current.ownsGesture(owner)) studio.current.finishGesture(owner); if (drag?.element.hasPointerCapture(drag.id)) drag.element.releasePointerCapture(drag.id); }
  useToolInputTermination(terminate);
  useLayoutEffect(() => { if (!active) terminate(); });
  useEffect(() => { if (!active) return; const cancel = () => { if (!pointer.current && !keyboard.current) return; const drag = pointer.current; pointer.current = null; keyboard.current = false; setFrozenLayout(null); if (studio.current.ownsGesture(owner)) studio.current.cancelGesture(owner); if (drag?.element.hasPointerCapture(drag.id)) drag.element.releasePointerCapture(drag.id); }; const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape" && (pointer.current || keyboard.current)) { event.preventDefault(); event.stopPropagation(); cancel(); } }; window.addEventListener("keydown", escape, true); window.addEventListener("blur", cancel); return () => { window.removeEventListener("keydown", escape, true); window.removeEventListener("blur", cancel); cancel(); }; }, [active, owner]);
  function keyDown(event: KeyboardEvent<SVGCircleElement>, handle: SourceHandle) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); return; }
    if (!active || disabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); if (event.repeat && !keyboard.current) return; if (keyboard.current && !s.ownsGesture(owner)) { keyboard.current = false; setFrozenLayout(null); return; } if (!keyboard.current) { if (!s.beginGesture(owner, stageOwner)) return; setFrozenLayout(layout); } keyboard.current = true;
    const position = sourceHandlePosition(source, handle, layout), increment = event.shiftKey ? .001 : .01, direction = ["ArrowLeft", "ArrowDown", "Home"].includes(event.key) ? -1 : 1;
    let x = position.x, value = typeof handle === "number" || handle === "amplitude" ? valueFor(handle) : handle === "decay" ? source.sustain : position.value;
    if (typeof handle === "number" || handle === "amplitude") value = event.key === "Home" ? typeof handle === "number" ? -1 : 0 : event.key === "End" ? 1 : value + direction * increment;
    else if (handle === "decay" && ["ArrowUp", "ArrowDown"].includes(event.key)) value += direction * increment;
    else x = event.key === "Home" ? 0 : event.key === "End" ? 1 : x + direction * increment;
    onChange(editSourceHandle(source, handle, x, value, layout));
  }
  const cursorX = state ? source.kind === "envelope" ? state.elapsed / layout.duration : (state.phase - layout.originCycle) / layout.cycles % 1 : null;
  return <div className={`mod-source-graph daw-source-graph graph-kind-${source.kind}`} data-edit-policy="bypass">
    <svg ref={svg} viewBox={`0 0 ${graphWidth} ${graphHeight}`} preserveAspectRatio="xMidYMid meet" role="group" aria-label={`${source.name} editable ${source.kind} graph`} aria-describedby={`${id}-help`} onPointerDown={event => { if ((source.kind === "step" || source.kind === "reference") && handles.length) start(event, 0); }} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel}>
      <g aria-hidden="true">
        {[0, .25, .5, .75, 1].map(x => <line key={x} className="graph-grid" vectorEffect="non-scaling-stroke" x1={graphX(x)} y1={plotTop} x2={graphX(x)} y2={plotBottom} />)}
        {(source.kind === "envelope" ? [1, .5, 0] : [1, .5, 0, -.5, -1]).map(value => <line key={value} className={value === 0 ? "graph-zero" : "graph-grid"} vectorEffect="non-scaling-stroke" x1={plotLeft} y1={graphY(value)} x2={graphX(1)} y2={graphY(value)} />)}
        <text className="graph-axis" x={plotLeft - 7} y={plotTop + 3} textAnchor="end">{source.kind === "envelope" ? "1" : "+1"}</text>
        <text className="graph-axis" x={plotLeft - 7} y={baseline + 3} textAnchor="end">0</text>
        {source.kind !== "envelope" && <text className="graph-axis" x={plotLeft - 7} y={plotBottom + 3} textAnchor="end">−1</text>}
        <path className="graph-area" d={`${path(effectivePoints)} L${graphX(1)},${baseline} L${graphX(0)},${baseline} Z`} />
        <path className="graph-base" vectorEffect="non-scaling-stroke" d={path(points)} /><path className="graph-effective" vectorEffect="non-scaling-stroke" d={path(effectivePoints)} />
        {source.kind === "envelope" && [[0, source.attack, "A"], [source.attack, source.attack + source.decay, "D"], [source.attack + source.decay, layout.releaseAt, "S"], [layout.releaseAt, layout.releaseAt + source.release, "R"]].map(([start, end, phase]) => Number(end) - Number(start) > layout.duration * .055 && <text key={phase} className="graph-phase" x={graphX((Number(start) + Number(end)) / 2 / layout.duration)} y={plotBottom - 5} textAnchor="middle">{phase}</text>)}
        {cursorX !== null && state && <g><line className="graph-cursor" vectorEffect="non-scaling-stroke" x1={graphX(cursorX)} y1={plotTop} x2={graphX(cursorX)} y2={plotBottom} /><circle className="graph-live-point" cx={graphX(cursorX)} cy={graphY(state.value)} r={3} /></g>}
        <text className="graph-axis" x={plotLeft} y={104}>0</text><text className="graph-axis" x={graphX(1)} y={104} textAnchor="end">{source.kind === "envelope" ? `${layout.duration.toFixed(2)} s` : `${layout.cycles} cycle${layout.cycles > 1 ? "s" : ""}`}</text>
      </g>
      {handles.map(handle => { const position = sourceHandlePosition(source, handle, layout), value = valueFor(handle); return <g key={handle}><circle className="graph-handle-hit" cx={graphX(position.x)} cy={graphY(position.value)} r={3.5} vectorEffect="non-scaling-stroke" role="slider" aria-label={label(handle)} aria-valuemin={typeof handle === "number" ? -1 : handle === "attack" || handle === "decay" ? .001 : handle === "release" ? .01 : 0} aria-valuemax={handle === "attack" || handle === "decay" ? 10 : handle === "release" ? 15 : 1} aria-valuenow={value} aria-valuetext={handle === "decay" ? `${source.decay.toFixed(3)} seconds decay, ${Math.round(source.sustain * 100)} percent sustain` : `${value.toFixed(3)}${["attack", "release"].includes(String(handle)) ? " seconds" : ""}`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0} onPointerDown={event => start(event, handle)} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={event => keyDown(event, handle)} onKeyUp={() => { if (keyboard.current) { keyboard.current = false; setFrozenLayout(null); if (s.ownsGesture(owner)) s.finishGesture(owner); } }} onBlur={() => { if (keyboard.current) { keyboard.current = false; setFrozenLayout(null); if (s.ownsGesture(owner)) s.finishGesture(owner); } }} /><circle className="graph-handle" cx={graphX(position.x)} cy={graphY(position.value)} r={3.5} vectorEffect="non-scaling-stroke" pointerEvents="none" /></g>; })}
    </svg>
    <span id={`${id}-help`} className="graph-help">{source.kind === "envelope" ? "Drag attack, decay/sustain and release nodes. Arrow keys adjust precisely." : source.kind === "step" || source.kind === "reference" ? "Drag values vertically; time stays fixed. Arrow keys adjust precisely." : source.kind === "lfo" ? "Drag phase and amplitude nodes. Arrow keys adjust precisely." : "Seeded random motion displays the current sequence."}</span>
  </div>;
}
