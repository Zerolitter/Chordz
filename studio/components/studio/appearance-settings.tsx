"use client";
import { useState } from "react";
import { Palette } from "lucide-react";
import { ACCENT_PRESETS, DEFAULT_APPEARANCE, type AppearancePreferences } from "../../lib/client/appearance";
import { Modal } from "./primitives";

export function AppearanceSettings({ value, onChange, storageError }: {
  value: AppearancePreferences;
  onChange: (value: AppearancePreferences) => void;
  storageError: string;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="secondary-button appearance-button" aria-label="Appearance" onClick={() => setOpen(true)}><Palette size={14} /><span>Appearance</span></button>
    <Modal open={open} onClose={() => setOpen(false)} title="Appearance" description="Make the studio feel yours. These preferences stay on this device.">
      <fieldset className="appearance-presets"><legend>Accent colour</legend>
        {ACCENT_PRESETS.map(accent => <button key={accent} type="button" aria-label={"Accent " + accent} aria-pressed={value.accent === accent}
          style={{ background: accent }} onClick={() => onChange({ ...value, accent })}>{value.accent === accent ? "✓" : ""}</button>)}
      </fieldset>
      <label className="field">Track rail width <output>{value.railWidth} px</output>
        <input aria-label="Track rail width" type="range" min={2} max={10} step={1} value={value.railWidth}
          onChange={event => onChange({ ...value, railWidth: Number(event.target.value) })} />
      </label>
      <label className="field">Spacing
        <select aria-label="Interface spacing" value={value.density} onChange={event => onChange({ ...value, density: event.target.value as AppearancePreferences["density"] })}>
          <option value="comfortable">Comfortable</option><option value="compact">Compact</option>
        </select>
      </label>
      {storageError && <p role="status" className="helper">{storageError}</p>}
      <button className="secondary-button" onClick={() => onChange({ ...DEFAULT_APPEARANCE })}>Reset appearance</button>
    </Modal>
  </>;
}
