"use client";
import { useEffect, useEffectEvent, useLayoutEffect } from "react";
import { ChevronDown, Keyboard, SlidersHorizontal, Upload } from "lucide-react";
import { Piano } from "./piano";
import { useStudio } from "./use-studio";
import { DEFAULT_CHORD_MOVEMENT } from "../../lib/music/chord-movement";
import { ToolVisibilityProvider } from "./tool-visibility";

export function releasePerformanceDockInputs(studio: Pick<ReturnType<typeof useStudio>, "releaseSource">) {
  studio.releaseSource("pointer:");
  studio.releaseSource("button:");
}

export function PerformanceDock({ open, onOpenChange, embedded = false, active = true, onOpenMovement }: {
  open: boolean; onOpenChange: (open: boolean) => void; embedded?: boolean; active?: boolean; onOpenMovement?: () => void;
}) {
  const s = useStudio();
  const visible = active && open;
  const releaseOwnedInputs = useEffectEvent(() => releasePerformanceDockInputs(s));
  useLayoutEffect(() => { if (!visible) releaseOwnedInputs(); }, [visible]);
  useEffect(() => () => releaseOwnedInputs(), []);
  const movement = s.selectedTrack?.chordMovement ?? DEFAULT_CHORD_MOVEMENT;
  function toggle() {
    if (open) releasePerformanceDockInputs(s);
    if (!s.finishGesture()) return;
    onOpenChange(!open);
  }
  async function importFile(file: File | undefined, sample: boolean) {
    if (!file || !s.finishEdit()) return;
    try {
      s.setBusy(sample ? "Mapping sample…" : "Importing audio…");
      if (sample) await s.addAudio(file, file.name, 0, true);
      else await s.addAudio(file, file.name);
    } catch (error) { s.report(error); }
    finally { s.setBusy(""); }
  }
  return <ToolVisibilityProvider active={visible}><section className={`performance-dock${embedded ? " performance-dock-embedded" : ""}`}>
    {!embedded && <button data-edit-policy="bypass" className="performance-toggle" aria-label="Performance dock" aria-expanded={open} aria-controls="performance-controls" onClick={toggle}>
      <Keyboard size={15} /><strong>Perform</strong><span>{s.selectedTrack?.name ?? "Choose a track"}</span>{movement.liveEnabled && <span className="performance-arp-state">Arp · {movement.pattern}{movement.hold ? " · Hold" : ""}</span>}<ChevronDown size={14} className={open ? "expanded" : ""} />
    </button>}
    <div id="performance-controls" hidden={!visible} className="workspace-bottom">
      <div className="import-row">
        <button className="secondary-button" onClick={() => { s.setDeviceOpen(true); void s.refreshDevices(); }}><SlidersHorizontal size={14} />MIDI & microphone</button>
        <label className="checkbox-label"><input type="checkbox" checked={s.monitor} onChange={event => s.setMonitor(event.target.checked)} />Monitor input · headphones</label>
        <label className="text-button file-button"><Upload size={14} />Import audio
          <input aria-label="Import audio file" type="file" accept="audio/*" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void importFile(file, false); }} />
        </label>
        <label className="text-button file-button">Map a sample
          <input aria-label="Import sample file" type="file" accept="audio/*" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void importFile(file, true); }} />
        </label>
      </div>
      {s.selectedTrack?.kind === "instrument" && <div className="performance-arp-controls">
        <label className="check-label"><input aria-label="Performance live arpeggiator" type="checkbox" checked={movement.liveEnabled} disabled={s.recording} onChange={e => { if (s.selectedTrack) s.updateTrack(s.selectedTrack.id, { chordMovement: { ...movement, liveEnabled: e.target.checked } }, "Toggle live arpeggiator"); }} />Live arpeggiator</label>
        <label className="check-label"><input aria-label="Performance arpeggiator hold" type="checkbox" checked={movement.hold} disabled={s.recording || !movement.liveEnabled} onChange={e => { if (s.selectedTrack) s.updateTrack(s.selectedTrack.id, { chordMovement: { ...movement, hold: e.target.checked } }, "Hold live arpeggiator input"); }} />Hold input notes</label>
        <button data-edit-policy="bypass" className="text-button" onClick={() => onOpenMovement ? onOpenMovement() : s.setMode("sound")}>Edit movement</button>
        <span className="tiny">Record captures generated notes. Stop releases held output.</span>
      </div>}
      <Piano />
    </div>
  </section></ToolVisibilityProvider>;
}
