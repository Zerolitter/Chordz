"use client";
import { useRef, useState } from "react";
import { Palette } from "lucide-react";
import { ACCENT_PRESETS, DEFAULT_APPEARANCE, type AppearancePreferences } from "../../lib/client/appearance";
import { Modal } from "./primitives";
import "./appearance-settings.css";

const ACCENT_NAMES = ["Amber", "Honey", "Copper", "Sand"];

export function AppearanceSettings({ value, onChange, storageError }: {
  value: AppearancePreferences;
  onChange: (value: AppearancePreferences) => void;
  storageError: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={trigger} className="secondary-button appearance-button" aria-label="Appearance" onClick={() => setOpen(true)}><Palette size={14} /><span>Appearance</span></button>
    <Modal open={open} onClose={() => setOpen(false)} returnFocusRef={trigger} title="Appearance" className="appearance-dialog" description="Preferences for this device.">
      <fieldset className="appearance-presets"><legend>Accent</legend>
        <div className="appearance-accent-options">
        {ACCENT_PRESETS.map((accent, index) => <button key={accent} type="button" aria-label={"Accent " + accent} aria-pressed={value.accent === accent}
          onClick={() => onChange({ ...value, accent })}><span className="appearance-swatch" style={{ background: accent }} aria-hidden="true">{value.accent === accent ? "✓" : ""}</span><span>{ACCENT_NAMES[index]}</span></button>)}
        </div>
      </fieldset>
      <label className="appearance-setting appearance-rail-setting"><span className="appearance-setting-name">Track rails</span>
        <span className="appearance-rail-control">
        <input aria-label="Track rail width" type="range" min={2} max={10} step={1} value={value.railWidth}
          onChange={event => onChange({ ...value, railWidth: Number(event.target.value) })} />
        <output>{value.railWidth} px</output>
        </span>
      </label>
      <label className="appearance-setting"><span className="appearance-setting-name">Spacing</span>
        <select aria-label="Interface spacing" value={value.density} onChange={event => onChange({ ...value, density: event.target.value as AppearancePreferences["density"] })}>
          <option value="comfortable">Comfortable</option><option value="compact">Compact</option>
        </select>
      </label>
      {storageError && <p role="status" className="helper">{storageError}</p>}
      <div className="appearance-footer"><span>Device settings</span><button className="text-button" aria-label="Reset appearance" onClick={() => onChange({ ...DEFAULT_APPEARANCE })}>Reset defaults</button></div>
    </Modal>
  </>;
}
