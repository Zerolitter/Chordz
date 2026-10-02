"use client";
import { useEffect, useRef, useState } from "react";
import { useStudio } from "./use-studio";
import "./track-bounce-controls.css";

export function TrackBounceControls() {
  const s = useStudio(), element = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false), [includeTails, setIncludeTails] = useState(true), [muteSource, setMuteSource] = useState(true);
  const source = s.selectedTrack, eligible = source?.kind === "instrument" && source.clips.length > 0;
  const state = s.bounceState;
  useEffect(() => {
    if (!open) return;
    const position = () => {
      const node = element.current;
      if (!node) return;
      const bounds = node.querySelector("summary")!.getBoundingClientRect();
      node.style.setProperty("--bounce-top", `${Math.max(12, Math.min(bounds.bottom + 8, innerHeight - Math.min(360, innerHeight * .65) - 12))}px`);
      node.style.setProperty("--bounce-left", `${Math.max(12, Math.min(bounds.left, innerWidth - Math.min(420, innerWidth - 24) - 12))}px`);
    };
    position(); window.addEventListener("resize", position); window.addEventListener("scroll", position, true);
    return () => { window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
  }, [open]);
  function close() {
    s.cancelBounce();
    if (element.current) { element.current.open = false; element.current.querySelector("summary")?.focus({ preventScroll: true }); }
  }
  return <details ref={element} className="track-bounce" onToggle={event => {
    const expanded = event.currentTarget.open; setOpen(expanded); if (!expanded) s.cancelBounce();
  }} onKeyDown={event => {
    if (event.key === "Escape" && event.currentTarget.open) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <summary aria-label="Bounce to audio">Bounce to audio</summary>
    <div className="track-bounce-body">
      <strong>{state.busy ? state.sourceName : source?.name ?? "Choose an instrument"}</strong>
      <p>Create an audio copy with the track’s sound, movement and effects. Keep the original instrument for future edits.</p>
      <label><input type="checkbox" aria-label="Include bounce effect tails" checked={includeTails} disabled={state.busy} onChange={event => setIncludeTails(event.target.checked)}/>Include bounce effect tails</label>
      <p className="bounce-help">Tails extend the audio region, especially with a long release or delay.</p>
      <label><input type="checkbox" aria-label="Mute source after bounce" checked={muteSource} disabled={state.busy} onChange={event => setMuteSource(event.target.checked)}/>Mute source after bounce</label>
      {!eligible && !state.busy && <p className="bounce-help">Select an instrument track with a clip to create another copy.</p>}
      <div className="bounce-actions">
        <button className="primary-button" disabled={!eligible || !!s.busy || s.recording || !s.hydrated} onClick={() => { if (source) void s.startBounce(source.id, { includeTails, muteSource }); }}>Create audio copy</button>
        {state.busy && !state.committed && <button className="secondary-button" onClick={s.cancelBounce}>Cancel bounce</button>}
        <button className="text-button" onClick={close}>Close bounce</button>
      </div>
      <span role="status" aria-label="Bounce status">{state.message}</span>
      <p className="bounce-help">Undo restores the previous song immediately. Later, mute the audio copy and unmute the original. Changes to the instrument need a new bounce.</p>
    </div>
  </details>;
}
