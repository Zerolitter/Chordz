"use client";
import { useId,useRef, type ButtonHTMLAttributes, type ReactNode, type RefObject } from "react";
import {useStudio} from "./use-studio";
import { DawKnob, type DawKnobProps } from "./daw-knob";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

export function IconButton({
  label,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={"icon-button " + className}
      {...props}
    >
      {children}
    </button>
  );
}
export function Range({ variant = "range", ...props }: DawKnobProps & { variant?: "range" | "knob" }) {
  return variant === "knob" ? <DawKnob {...props} /> : <NativeRange {...props} />;
}
function NativeRange({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  format,
  log = false,
  unit = "",
}: DawKnobProps) {
  const id = useId();
  const s=useStudio(),gesture=useRef(false);
  const displayed = log
    ? (Math.log(Math.max(min, value)) - Math.log(min)) /
      (Math.log(max) - Math.log(min))
    : value;
  return (
    <div className="range-field">
      <div className="range-label">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>
          {format
            ? format(value)
            : Number.isInteger(step)
              ? Math.round(value)
              : value.toFixed(value >= 100 ? 0 : 2)}
          {unit}
        </output>
      </div>
      <input
        id={id}
        type="range"
        aria-label={label}
        min={log ? 0 : min}
        max={log ? 1 : max}
        step={log ? 0.005 : step}
        value={displayed}
        onPointerDown={()=>{gesture.current=true;s.beginEdit(id);}}
        onPointerUp={()=>{gesture.current=false;s.finishEdit(id);}}
        onPointerCancel={()=>{gesture.current=false;s.cancelEdit(id);}}
        onKeyDown={e=>{if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","PageUp","PageDown"].includes(e.key)&&!gesture.current){gesture.current=true;s.beginEdit(id);}if(e.key==="Escape"){e.preventDefault();e.stopPropagation();s.cancelEdit(id);}}}
        onKeyUp={e=>{if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","PageUp","PageDown"].includes(e.key)){gesture.current=false;s.finishEdit(id);}}}
        onChange={(event) => {
          if(!s.ownsEdit(id)&&(gesture.current||!s.beginEdit(id)))return;
          onChange(
            log
              ? Math.exp(
                  Math.log(min) +
                    Number(event.target.value) *
                      (Math.log(max) - Math.log(min)),
                )
              : Number(event.target.value),
          );
        }}
      />
    </div>
  );
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
  className = "",
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
  className?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent
        className={"studio-dialog " + (wide ? "studio-dialog-wide " : "") + className}
        onCloseAutoFocus={event => {
          if (returnFocusRef?.current?.isConnected) { event.preventDefault(); returnFocusRef.current.focus(); }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description ?? " "}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
export function PanelHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="panel-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}
export function Meter({
  value,
  label,
  vertical = false,
}: {
  value: number;
  label: string;
  vertical?: boolean;
}) {
  const fraction = Math.max(
    0,
    Math.min(1, (20 * Math.log10(Math.max(value, 0.001)) + 60) / 60),
  );
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={-60}
      aria-valuemax={0}
      aria-valuenow={Math.max(-60, 20 * Math.log10(Math.max(value, 0.001)))}
      className={
        "level-meter " +
        (vertical ? "vertical" : "") +
        " " +
        (value > 1 ? "clipping" : "")
      }
    >
      <span
        style={
          vertical
            ? { height: fraction * 100 + "%" }
            : { width: fraction * 100 + "%" }
        }
      />
    </div>
  );
}
export function BrandMark() {
  return (
    <svg
      width="27"
      height="29"
      viewBox="0 0 27 29"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 16V24M13.5 5V24M23 10V24"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}
export const frequencyLabel = (value: number) =>
  value >= 1000
    ? (value / 1000).toFixed(1) + " kHz"
    : Math.round(value) + " Hz";
