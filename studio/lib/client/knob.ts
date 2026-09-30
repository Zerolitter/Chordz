export const KNOB_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"] as const;
const unit = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const bounded = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
const positiveLog = (min: number, max: number, log = false) => log && min > 0 && max > min;

export function knobToUnit(value: number, min: number, max: number, log = false): number {
  if (max <= min) return 0;
  const v = bounded(value, min, max);
  return unit(positiveLog(min, max, log) ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
}
export function knobFromUnit(value: number, min: number, max: number, log = false): number {
  if (max <= min) return min;
  const p = unit(value);
  // Preserve exact endpoints rather than a floating-point approximation of max.
  if (p === 0) return min;
  if (p === 1) return max;
  return positiveLog(min, max, log) ? min * Math.pow(max / min, p) : min + p * (max - min);
}
export function knobQuantize(value: number, min: number, max: number, step: number): number {
  const v = bounded(value, min, max);
  if (v === min || v === max || !Number.isFinite(step) || step <= 0) return v;
  return bounded(Number((min + Math.round((v - min) / step) * step).toPrecision(12)), min, max);
}
export function knobKeyValue(key: string, value: number, bounds: { min: number; max: number; step: number }, fine = false): number | null {
  const { min, max, step } = bounds;
  if (key === "Home") return min;
  if (key === "End") return max;
  const direction = ["ArrowRight", "ArrowUp", "PageUp"].includes(key) ? 1 : ["ArrowLeft", "ArrowDown", "PageDown"].includes(key) ? -1 : 0;
  if (!direction) return null;
  const increment = fine || step >= 1 ? step : step * 10;
  return knobQuantize(value + direction * increment * (key.startsWith("Page") ? 10 : 1), min, max, step);
}
export function knobParseNumber(text: string, min: number, max: number): number | null {
  if (!text.trim()) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}
function position(p: number, radius = 21) {
  const angle = (-225 + unit(p) * 270) * Math.PI / 180;
  return [28 + radius * Math.cos(angle), 28 + radius * Math.sin(angle)];
}
export function knobArc(from: number, to: number): string {
  const a = unit(from), b = unit(to);
  if (a === b) return "";
  const [x1, y1] = position(a), [x2, y2] = position(b);
  return `M ${x1} ${y1} A 21 21 0 ${Math.abs(b - a) > 2 / 3 ? 1 : 0} ${b > a ? 1 : 0} ${x2} ${y2}`;
}
