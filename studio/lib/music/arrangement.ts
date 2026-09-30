import { clamp, type AutomationLane, type AutomationParameter, type Clip } from "./types";

export const automationBounds: Record<AutomationParameter, [number, number]> = {
  volume: [-60, 6], pan: [-1, 1], cutoff: [40, 18000], expression: [0, 1],
  modulation: [0, 1], pitchBend: [-1, 1], reverb: [0, 1], delay: [0, 1],
};
export type AutomationPoint = AutomationLane["points"][number];
export const MAX_TICK = 1_000_000_000;
const snap = (tick: number, grid: number) => Math.round(tick / grid) * grid;

export const clampAutomationTick = (tick: number, end: number) =>
  clamp(Math.round(tick), 0, Math.min(end, MAX_TICK));

export function moveClipOnGrid(clip: Clip, deltaTick: number, grid: number): Clip {
  if (deltaTick === 0) return clip;
  return { ...clip, startTick: clamp(snap(clip.startTick + deltaTick, grid), 0, MAX_TICK) };
}

export function resizeClipOnGrid(clip: Clip, deltaTick: number, grid: number): Clip {
  if (deltaTick === 0) return clip;
  // The visible region is separate from its source loop and audio trim.
  return { ...clip, lengthTick: clamp(snap(clip.lengthTick + deltaTick, grid), grid, MAX_TICK) };
}

export function automationPointAt(
  x: number, y: number, end: number, grid: number, parameter: AutomationParameter,
): AutomationPoint {
  const [min, max] = automationBounds[parameter];
  const boundedEnd = Math.min(end, MAX_TICK);
  return {
    tick: clampAutomationTick(snap(clamp(x, 0, 1) * boundedEnd, grid), boundedEnd),
    value: Number((min + (1 - clamp(y, 0, 1)) * (max - min)).toFixed(4)),
  };
}

export function putAutomationPoint(
  points: AutomationPoint[], point: AutomationPoint, parameter: AutomationParameter, end: number,
): AutomationPoint[] {
  const [min, max] = automationBounds[parameter];
  const clean = { tick: clampAutomationTick(point.tick, end),
    value: clamp(point.value, min, max) };
  // Keep legacy points outside the current song intact; only the edited point
  // is constrained to the visible curve. Last write wins at a shared tick.
  const byTick = new Map(points.map(p => [p.tick, p]));
  byTick.set(clean.tick, clean);
  return [...byTick.values()].sort((a, b) => a.tick - b.tick);
}

export function moveAutomationPoint(
  points: AutomationPoint[], sourceTick: number, point: AutomationPoint,
  parameter: AutomationParameter, end: number,
): AutomationPoint[] {
  // A value-only edit must retain a valid legacy time beyond today's song end.
  const valueOnly = point.tick === sourceTick && points.some(p => p.tick === sourceTick);
  return putAutomationPoint(points.filter(p => p.tick !== sourceTick), point, parameter,
    valueOnly ? Math.max(end, sourceTick) : end);
}
