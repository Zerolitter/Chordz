"use client";
import { useEffect, useRef, useState } from "react";
import { useStudio } from "./use-studio";
import { Meter } from "./primitives";
import "./recording-setup.css";

export function RecordingSetup() {
  const s = useStudio();
  const [level, setLevel] = useState(0);
  const [open, setOpen] = useState(false);
  const element = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!open) return;
    const position = () => {
      const node = element.current;
      if (!node) return;
      const bounds = node.querySelector("summary")!.getBoundingClientRect();
      node.style.setProperty("--record-setup-top", `${Math.max(12, Math.min(bounds.bottom + 8, innerHeight - Math.min(320, innerHeight * .55) - 12))}px`);
      node.style.setProperty("--record-setup-left", `${Math.max(12, Math.min(bounds.left, innerWidth - Math.min(640, innerWidth - 24) - 12))}px`);
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => { window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setLevel((s.recorder.current ?? s.recordingInput.input.current)?.meter() ?? 0), 100);
    return () => clearInterval(timer);
  }, [open, s.recorder, s.recordingInput.input]);
  const tracks = s.project.tracks.filter(track => track.kind === (s.recordKind === "audio" ? "audio" : "instrument"));
  const destination = s.recordingDestination;
  const mic = s.recordKind === "audio";
  const readiness = s.recordingDestinationMissing ? "Previous destination unavailable · choose a track."
    : s.recording ? `Recording to ${s.recordingTargetName}`
    : mic ? s.recordingInput.state.message || "Check input, or allow microphone access on Record."
    : destination ? "Computer keyboard ready · MIDI devices optional" : "Choose an instrument track.";
  return <details ref={element} className="recording-setup" onToggle={event => {
    const expanded = event.currentTarget.open;
    setOpen(expanded);
    if (!expanded) s.recordingInput.release();
  }} onKeyDown={event => {
    if (event.key === "Escape" && event.currentTarget.open && !s.recording) {
      event.preventDefault(); event.stopPropagation();
      s.recordingInput.release(); event.currentTarget.open = false;
      event.currentTarget.querySelector("summary")?.focus();
    }
  }}>
    <summary aria-label="Recording setup"><span>Record setup</span><span className="tiny">{s.recordingTargetName}</span></summary>
    <div className="recording-setup-body">
      <label>Destination<select aria-label="Recording destination" value={s.recordingDestinationMissing ? "missing" : destination?.id ?? "new"} disabled={s.recording || !!s.busy} onChange={event => s.setRecordingDestination(event.target.value)}>
        {s.recordingDestinationMissing && <option value="missing" disabled>Previous destination unavailable</option>}
        {mic && <option value="new">New audio track</option>}
        {!mic && !tracks.length && <option value="new">Choose an instrument</option>}
        {tracks.map(track => <option key={track.id} value={track.id}>{track.name}</option>)}
      </select></label>
      <label>Input<select aria-label={mic ? "Recording microphone input" : "Recording MIDI input"} value={mic ? s.microphoneId : s.midiInputId} disabled={s.recording || !!s.busy} onChange={event => mic ? s.setMicrophoneId(event.target.value) : s.setMidiInputId(event.target.value)}>
        <option value={mic ? "" : "all"}>{mic ? "Default microphone" : "All connected MIDI devices"}</option>
        {mic ? s.microphones.map((input, index) => <option key={input.deviceId} value={input.deviceId}>{input.label || `Microphone ${index + 1}`}</option>) : s.midiInputs.map(input => <option key={input.id} value={input.id}>{input.name}</option>)}
      </select></label>
      <label>Count-in<select aria-label="Recording count-in" value={s.recordCountIn} disabled={s.recording || !!s.busy} onChange={event => s.setRecordCountIn(Number(event.target.value))}>
        <option value={0}>Off</option><option value={1}>1 bar</option><option value={2}>2 bars</option>
      </select></label>
      {mic && <label className="checkbox-label"><input aria-label="Recording monitor input" type="checkbox" checked={s.monitor} disabled={!!s.busy} onChange={event => s.setMonitor(event.target.checked)} />Monitor · headphones</label>}
      {mic ? <><button className="secondary-button" disabled={s.recording || !!s.busy || s.recordingInput.state.phase === "checking"} onClick={() => void s.checkRecordingInput()}>Check microphone</button>
        <Meter value={level} label="Recording input level" />
        {s.recordingInput.state.phase === "ready" && <button className="text-button" data-edit-policy="bypass" onClick={s.recordingInput.release}>Release input</button>}</>
        : <button className="secondary-button" disabled={s.recording || !!s.busy} onClick={() => void s.enableMidi()}> {s.midiEnabled ? "Refresh MIDI" : "Enable MIDI"}</button>}
      <span role="status" aria-label="Recording readiness" className="recording-readiness">{readiness}</span>
    </div>
  </details>;
}
