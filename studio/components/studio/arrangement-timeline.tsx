"use client";
import { type CSSProperties, type PointerEvent } from "react";
import { MoveHorizontal } from "lucide-react";
import { useStudio, useTransport } from "./use-studio";
import { useArrangementGesture } from "./use-arrangement-gesture";
import { projectEnd, ticksPerBar, tickToSeconds } from "../../lib/music/project";
import { moveClipOnGrid, resizeClipOnGrid } from "../../lib/music/arrangement";
import { trackDisplayColor } from "../../lib/client/appearance";
import type { Clip, Track } from "../../lib/music/types";

function regionPeaks(peaks: number[], assetSeconds: number, offset: number, seconds: number, loopSeconds: number) {
  if (!peaks.length || !assetSeconds) return [];
  return Array.from({ length: 128 }, (_, i) => {
    const position = ((i + .5) / 128) * seconds;
    const source = offset + (loopSeconds > 0 ? position % loopSeconds : position);
    return source >= 0 && source < assetSeconds ? (peaks[Math.floor(source / assetSeconds * peaks.length)] ?? 0) : 0;
  });
}

export function ArrangementTimeline({ zoom, grid }: { zoom: number; grid: number }) {
  const s = useStudio(), transport = useTransport();
  const bar = ticksPerBar(s.project), bars = Math.ceil(projectEnd(s.project) / bar);
  return <div className="timeline-scroll">
    <div className="timeline" style={{ width: Math.max(780, bars * zoom) }}>
      <div className="section-lane">
        {s.project.sections.map(section => <button key={section.id}
          className={section.id === s.selectedSection.id ? "selected" : ""}
          style={{ left: section.startTick / bar * zoom, width: section.lengthTick / bar * zoom }}
          onClick={() => { s.setSelectedSectionId(section.id); void s.seek(section.startTick); }}>
          {section.name}
        </button>)}
      </div>
      <div className="bar-ruler">
        {Array.from({ length: bars }, (_, i) => <button key={i} style={{ left: i * zoom, width: zoom }}
          onClick={() => void s.seek(i * bar)}>{i + 1}</button>)}
      </div>
      {s.project.tracks.map(track => <div className="timeline-row" key={track.id}
        style={{ backgroundSize: zoom + "px 100%", "--track-color": trackDisplayColor(s.project, track) } as CSSProperties}>
        <span className="timeline-track-label">{track.name}</span>
        {track.clips.map(clip => <TimelineClip key={clip.id} track={track} clip={clip} zoom={zoom} bar={bar} grid={grid} />)}
      </div>)}
      <div className="playhead" style={{ left: transport.tick / bar * zoom }} />
    </div>
  </div>;
}

function TimelineClip({ track, clip, zoom, bar, grid }: { track: Track; clip: Clip; zoom: number; bar: number; grid: number }) {
  const s = useStudio();
  const gesture = useArrangementGesture<{ clip: Clip; x: number; kind: "move" | "resize"; delta: number; pointer: boolean; pointerId: number | null }>("clip:" + clip.id);
  function begin(event: PointerEvent<HTMLButtonElement>, kind: "move" | "resize") {
    if (event.button !== 0 || s.recording || gesture.active.current) return;
    event.preventDefault();
    if (!s.finishEdit()) return;
    s.selectClip(track.id, clip.id);
    if (gesture.begin({ clip, x: event.clientX, kind, delta: 0, pointer: true, pointerId: event.pointerId })) event.currentTarget.setPointerCapture(event.pointerId);
  }
  function preview(delta: number) {
    const g = gesture.active.current;
    if (!g || !gesture.owns()) return;
    gesture.update({ ...g, delta });
    const updated = g.kind === "move" ? moveClipOnGrid(g.clip, delta, grid) : resizeClipOnGrid(g.clip, delta, grid);
    s.updateClip(track.id, clip.id, current => ({ ...current, startTick: updated.startTick, lengthTick: updated.lengthTick }),
      g.kind === "move" ? "Move clip" : "Resize clip");
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const g = gesture.active.current;
    if (g?.pointer && event.pointerId === g.pointerId) preview((event.clientX - g.x) / zoom * bar);
  }
  function keyboard(event: React.KeyboardEvent<HTMLButtonElement>, kind: "move" | "resize") {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    if (!gesture.active.current) {
      if (event.repeat || !s.finishEdit()) return;
      s.selectClip(track.id, clip.id);
      if (!gesture.begin({ clip, x: 0, kind, delta: 0, pointer: false, pointerId: null })) return;
    }
    const g = gesture.active.current;
    if (g && !g.pointer) preview(g.delta + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? bar : grid));
  }
  const interactions = (kind: "move" | "resize") => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => begin(e, kind),
    onPointerMove: move,
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) => { if (gesture.active.current?.pointerId === e.pointerId) { move(e); gesture.finish(); } },
    onPointerCancel: (e: PointerEvent<HTMLButtonElement>) => { if (gesture.active.current?.pointerId === e.pointerId) gesture.cancel(); },
    onLostPointerCapture: () => { if (gesture.active.current?.pointer) gesture.cancel(); },
    onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => keyboard(e, kind),
    onKeyUp: (e: React.KeyboardEvent<HTMLButtonElement>) => { if (["ArrowLeft", "ArrowRight"].includes(e.key)) gesture.finish(); },
    onBlur: () => { if (gesture.active.current && !gesture.active.current.pointer) gesture.finish(); },
  });
  return <div className={"timeline-clip " + (clip.id === s.selectedClipId ? "selected" : "")}
    style={{ left: clip.startTick / bar * zoom, width: Math.max(12, clip.lengthTick / bar * zoom) }}>
    <button type="button" className="timeline-clip-body" {...interactions("move")}
      onClick={() => s.selectClip(track.id, clip.id)} title={`${track.name} · ${clip.name} · drag to move`}>
      <span>{clip.name}{clip.loop ? " ↻" : ""}</span>
      <svg viewBox="0 0 200 26" preserveAspectRatio="none" aria-hidden="true">
        {clip.audio ? regionPeaks(s.waveforms[clip.audio.assetId] ?? [], s.project.assets.find(a => a.id === clip.audio!.assetId)?.duration ?? 0,
          clip.audio.offsetSec, tickToSeconds(clip.lengthTick, s.project.tempo), clip.loop ? tickToSeconds(clip.sourceLengthTick, s.project.tempo) : 0)
          .map((v, i) => <line key={i} x1={i / 128 * 200} x2={i / 128 * 200} y1={13 - v * 12} y2={13 + v * 12} />)
          : clip.notes.slice(0, 140).map((note, i) => <rect key={i} x={note.tick / clip.sourceLengthTick * 200}
            y={24 - note.pitch % 24} width={Math.max(1, note.duration / clip.sourceLengthTick * 200)} height={1.5} />)}
      </svg>
    </button>
    <button type="button" className="timeline-clip-resize" {...interactions("resize")} role="slider"
      aria-label={`Resize ${clip.name} clip`} aria-valuemin={grid / bar} aria-valuemax={1_000_000_000 / bar}
      aria-valuenow={clip.lengthTick / bar} aria-valuetext={`${clip.lengthTick / bar} bars`}
      title="Drag the right edge to resize · arrows adjust, Shift adjusts a bar"><MoveHorizontal size={12} /></button>
  </div>;
}
