"use client";
/**
 * React 19 compatibility adapter of react-knob-headless 0.4.0.
 * Copyright (c) 2023 @satelllte, MIT. Full license: public/licenses/react-knob-headless-MIT.txt.
 * Upstream b4ac2bf206ce7d9b2f2924ddb26d6a56b542e883, packages/react-knob-headless/src/KnobHeadless.tsx.
 * Chordz replaces prop merging/math dependencies and exposes cancellable gesture boundaries.
 */
import { forwardRef, useImperativeHandle, useRef, type HTMLAttributes } from "react";
import { useDrag } from "@use-gesture/react";
import { knobFromUnit, knobToUnit } from "../../lib/client/knob";

export interface KnobHeadlessHandle { cancel(): void }
export interface KnobHeadlessProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  valueRaw: number; valueMin: number; valueMax: number; log?: boolean; disabled?: boolean;
  valueRawDisplayFn: (value: number) => string;
  onValueRawChange: (value: number) => void;
  onGestureStart: () => boolean;
  onGestureEnd: (canceled: boolean) => void;
}
export const KnobHeadless = forwardRef<KnobHeadlessHandle, KnobHeadlessProps>(function KnobHeadless({
  valueRaw, valueMin, valueMax, valueRawDisplayFn, onValueRawChange,
  onGestureStart, onGestureEnd, log = false, disabled = false, children, style,
  onPointerDown, onPointerCancel, onLostPointerCapture, ...props
}, ref) {
  const active = useRef(false), raw = useRef(valueRaw), stop = useRef<(() => void) | null>(null);
  const cancel = () => {
    if (!active.current) return;
    active.current = false;
    stop.current?.();
    stop.current = null;
    onGestureEnd(true);
  };
  useImperativeHandle(ref, () => ({ cancel }));
  const bind = useDrag(state => {
    if (state.canceled || state.event.type === "pointercancel") { cancel(); return; }
    if (state.first) {
      if (disabled || !onGestureStart()) { state.cancel(); return; }
      active.current = true;
      raw.current = valueRaw;
      stop.current = state.cancel;
    }
    // use-gesture schedules a final callback after cancel(). It cannot write or reopen an edit.
    if (!active.current) return;
    if (state.delta[0] || state.delta[1]) {
      const delta = -state.delta[1] * .005 * (state.shiftKey ? .1 : 1);
      raw.current = knobFromUnit(knobToUnit(raw.current, valueMin, valueMax, log) + delta, valueMin, valueMax, log);
      onValueRawChange(raw.current);
    }
    if (state.last) { active.current = false; stop.current = null; onGestureEnd(false); }
  }, { enabled: !disabled, pointer: { keys: false, capture: true }, filterTaps: false });
  const drag = bind();
  return <div {...props} {...drag} role="slider" tabIndex={disabled ? -1 : 0}
    aria-disabled={disabled || undefined} aria-valuemin={valueMin} aria-valuemax={valueMax}
    aria-valuenow={valueRaw} aria-valuetext={valueRawDisplayFn(valueRaw)} aria-orientation="vertical"
    style={{ ...style, touchAction: "none" }}
    onPointerDown={event => { if (!disabled) event.currentTarget.focus(); drag.onPointerDown?.(event); onPointerDown?.(event); }}
    onPointerCancel={event => { cancel(); drag.onPointerCancel?.(event); onPointerCancel?.(event); }}
    onLostPointerCapture={event => { cancel(); onLostPointerCapture?.(event); }}>
    {children}
  </div>;
});
