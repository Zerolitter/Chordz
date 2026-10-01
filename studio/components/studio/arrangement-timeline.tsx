"use client";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from "react";
import { MoveHorizontal } from "lucide-react";
import { useStudio, useTransport } from "./use-studio";
import { useArrangementGesture } from "./use-arrangement-gesture";
import { projectEnd, ticksPerBar, tickToSeconds } from "../../lib/music/project";
import { moveClipOnGrid, resizeClipOnGrid } from "../../lib/music/arrangement";
import { trackDisplayColor } from "../../lib/client/appearance";
import type { Clip, Track } from "../../lib/music/types";
import { TrackHeader } from "./track-header";
import "./song-canvas.css";

function regionPeaks(peaks: number[], assetSeconds: number, offset: number, seconds: number, loopSeconds: number) {
  if (!peaks.length || !assetSeconds) return [];
  return Array.from({ length: 128 }, (_, i) => {
    const position = ((i + .5) / 128) * seconds;
    const source = offset + (loopSeconds > 0 ? position % loopSeconds : position);
    return source >= 0 && source < assetSeconds ? (peaks[Math.floor(source / assetSeconds * peaks.length)] ?? 0) : 0;
  });
}

export function ArrangementTimeline({ zoom, grid, viewportRef, follow = false, onUserNavigation }: {
  zoom: number; grid: number; viewportRef?: RefObject<HTMLDivElement | null>; follow?: boolean; onUserNavigation?: () => void;
}) {
  const s = useStudio(), transport = useTransport();
  const internalRef = useRef<HTMLDivElement>(null), scrollRef = viewportRef ?? internalRef;
  const followScrollTarget = useRef<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const bar = ticksPerBar(s.project), bars = Math.ceil(projectEnd(s.project) / bar);
  const rulerStep = Math.max(1, Math.ceil(30 / zoom));
  const timeWidth = Math.max(viewportWidth || 780, bars * zoom);
  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const measure = () => {
      const headerWidth = Number.parseFloat(getComputedStyle(viewport).getPropertyValue("--song-track-header-width")) || 188;
      setViewportWidth(Math.max(1, viewport.clientWidth - headerWidth));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [scrollRef]);
  useEffect(() => {
    const viewport = scrollRef.current;
    if (!follow || !viewport || !transport.playing || s.transaction?.owner?.startsWith("clip:")) return;
    const x = transport.tick / bar * zoom;
    if (x < viewport.scrollLeft || x > viewport.scrollLeft + viewportWidth - 24) {
      const left = Math.min(Math.max(0, x - viewportWidth * .25), viewport.scrollWidth - viewport.clientWidth);
      if (Math.abs(left - viewport.scrollLeft) < 1) return;
      followScrollTarget.current = left;
      viewport.scrollLeft = left;
    }
  }, [follow, transport.tick, transport.playing, bar, zoom, viewportWidth, scrollRef, s.transaction?.owner]);
  return <div ref={scrollRef} className="timeline-scroll song-timeline-scroll" aria-label="Song arrangement"
    onWheel={() => { followScrollTarget.current = null; onUserNavigation?.(); }}
    onScroll={event => {
      const expected = followScrollTarget.current;
      followScrollTarget.current = null;
      if (expected !== null && Math.abs(event.currentTarget.scrollLeft - expected) < 1) return;
      if (follow) onUserNavigation?.();
    }}>
    <div className="timeline song-timeline" style={{ width: `calc(var(--song-track-header-width) + ${timeWidth}px)` }}>
      <div className="song-timeline-guides">
      <div className="song-guide-row"><div className="song-guide-heading">Sections</div><div className="section-lane">
        {s.project.sections.map(section => <button key={section.id}
          className={section.id === s.selectedSection.id ? "selected" : ""}
          style={{ left: section.startTick / bar * zoom, width: section.lengthTick / bar * zoom }}
          onClick={() => { s.setSelectedSectionId(section.id); void s.seek(section.startTick); }}>
          {section.name}
        </button>)}
      </div></div>
      <div className="song-guide-row"><div className="song-guide-heading">Bars</div><div className="bar-ruler">
        {Array.from({ length: Math.ceil(bars / rulerStep) }, (_, i) => i * rulerStep).map(i => <button key={i}
          style={{ left: i * zoom, width: Math.min(rulerStep, bars - i) * zoom }} onClick={() => void s.seek(i * bar)}>{i + 1}</button>)}
      </div></div>
      <div className="song-guide-row"><div className="song-guide-heading">Chords</div><div className="song-chord-guide" aria-label="Song chord guide">
        {s.project.chords.map((chord, index) => <button key={`${chord.id}:${index}`} type="button" data-edit-policy="bypass"
          aria-label={`${chord.symbol} chord at bar ${chord.tick / bar + 1}`}
          aria-pressed={chord.id === s.selectedChordId} className={chord.id === s.selectedChordId ? "selected" : ""}
          style={{ left: chord.tick / bar * zoom, width: Math.max(1, chord.duration / bar * zoom) }}
          onClick={() => { if (!s.setMode("write")) return; s.setSelectedSectionId(chord.sectionId); s.setSelectedChordId(chord.id); }}
          title={`${chord.symbol} · open voicing and suggestions`}>{chord.symbol}</button>)}
        {!s.project.chords.length && <span className="song-chord-empty">Add chords in Writing</span>}
      </div></div>
      </div>
      {s.project.tracks.map((track, index) => <div className="song-track-row" key={track.id}>
        <TrackHeader track={track} index={index} compact />
        <div className={`timeline-row${track.id === s.selectedTrack?.id ? " selected" : ""}`}
          style={{ backgroundSize: zoom + "px 100%", "--track-color": trackDisplayColor(s.project, track) } as CSSProperties}>
          {track.clips.map(clip => <TimelineClip key={clip.id} track={track} clip={clip} zoom={zoom} bar={bar} grid={grid} />)}
          {!track.clips.length && <span className="song-lane-empty">No phrases</span>}
        </div>
      </div>)}
      {!s.project.tracks.length && <div className="song-tracks-empty">Choose a sound in the browser to add your first track.</div>}
      <div className="playhead" style={{ left: `calc(var(--song-track-header-width) + ${transport.tick / bar * zoom}px)` }} />
    </div>
  </div>;
}

function TimelineClip({ track, clip, zoom, bar, grid }: {
  track: Track; clip: Clip; zoom: number; bar: number; grid: number;
}) {
  const s = useStudio();
  const gesture = useArrangementGesture<{ clip: Clip; x: number; kind: "move" | "resize"; delta: number; pointer: boolean; pointerId: number | null; scale: number; grid: number; bar: number; scrollLeft: number; viewport: HTMLElement | null }>("clip:" + clip.id);
  function begin(event: PointerEvent<HTMLButtonElement>, kind: "move" | "resize") {
    if (event.button !== 0 || s.recording || gesture.active.current) return;
    event.preventDefault();
    if (!s.selectClip(track.id, clip.id)) return;
    const viewport = event.currentTarget.closest<HTMLElement>(".song-timeline-scroll");
    if (gesture.begin({ clip, x: event.clientX, kind, delta: 0, pointer: true, pointerId: event.pointerId,
      scale: zoom / bar, grid, bar, scrollLeft: viewport?.scrollLeft ?? 0, viewport })) event.currentTarget.setPointerCapture(event.pointerId);
  }
  function preview(delta: number) {
    const g = gesture.active.current;
    if (!g || !gesture.owns()) return;
    gesture.update({ ...g, delta });
    const updated = g.kind === "move" ? moveClipOnGrid(g.clip, delta, g.grid) : resizeClipOnGrid(g.clip, delta, g.grid);
    s.updateClip(track.id, clip.id, current => ({ ...current, startTick: updated.startTick, lengthTick: updated.lengthTick }),
      g.kind === "move" ? "Move clip" : "Resize clip");
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const g = gesture.active.current;
    if (g?.pointer && event.pointerId === g.pointerId) preview((event.clientX - g.x + (g.viewport?.scrollLeft ?? 0) - g.scrollLeft) / g.scale);
  }
  function keyboard(event: React.KeyboardEvent<HTMLButtonElement>, kind: "move" | "resize") {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    if (!gesture.active.current) {
      if (event.repeat || !s.selectClip(track.id, clip.id)) return;
      const viewport = event.currentTarget.closest<HTMLElement>(".song-timeline-scroll");
      if (!gesture.begin({ clip, x: 0, kind, delta: 0, pointer: false, pointerId: null, scale: zoom / bar, grid, bar,
        scrollLeft: viewport?.scrollLeft ?? 0, viewport })) return;
    }
    const g = gesture.active.current;
    if (g && !g.pointer) preview(g.delta + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? g.bar : g.grid));
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
    <button type="button" className="timeline-clip-body" data-edit-policy="bypass" {...interactions("move")}
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
