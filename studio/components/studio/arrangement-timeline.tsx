"use client";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from "react";
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

type ScrollGeometry = { width: number; height: number; contentWidth: number; contentHeight: number };
function scrollGeometry(viewport: HTMLElement): ScrollGeometry {
  return { width: viewport.clientWidth, height: viewport.clientHeight, contentWidth: viewport.scrollWidth, contentHeight: viewport.scrollHeight };
}
function sameGeometry(a: ScrollGeometry | null, b: ScrollGeometry) {
  return !!a && a.width === b.width && a.height === b.height && a.contentWidth === b.contentWidth && a.contentHeight === b.contentHeight;
}
function restoreSongPosition(viewport: HTMLElement, leftTick: number, scrollTop: number, bar: number, zoom: number) {
  const geometry = scrollGeometry(viewport);
  const target = { left: Math.min(leftTick / bar * zoom, Math.max(0, geometry.contentWidth - geometry.width)),
    top: Math.min(scrollTop, Math.max(0, geometry.contentHeight - geometry.height)) };
  viewport.scrollLeft = target.left;
  viewport.scrollTop = target.top;
  return { geometry, target };
}

export function ArrangementTimeline({ zoom, grid, viewportRef }: {
  zoom: number; grid: number; viewportRef?: RefObject<HTMLDivElement | null>;
}) {
  const s = useStudio(), transport = useTransport();
  const internalRef = useRef<HTMLDivElement>(null), scrollRef = viewportRef ?? internalRef;
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollTarget = useRef<{ left: number; top: number } | null>(null);
  const geometryRef = useRef<ScrollGeometry | null>(null);
  const [size, setSize] = useState({ timeWidth: 0, height: 0, contentWidth: 0, contentHeight: 0 });
  const { leftTick, scrollTop, follow } = s.songViewport;
  const bar = ticksPerBar(s.project), bars = Math.ceil(projectEnd(s.project) / bar);
  const rulerStep = Math.max(1, Math.ceil(30 / zoom));
  const timeWidth = Math.max(size.timeWidth || 780, bars * zoom);
  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const measure = () => {
      const headerWidth = Number.parseFloat(getComputedStyle(viewport).getPropertyValue("--song-track-header-width")) || 188;
      const measured = { timeWidth: Math.max(1, viewport.clientWidth - headerWidth), height: viewport.clientHeight,
        contentWidth: viewport.scrollWidth, contentHeight: viewport.scrollHeight };
      setSize(current => Object.keys(measured).every(key => current[key as keyof typeof current] === measured[key as keyof typeof measured]) ? current : measured);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [scrollRef]);
  useLayoutEffect(() => {
    // A resized window may temporarily clamp the DOM. Keep the scoped request so
    // returning to the earlier geometry restores the same song position.
    const viewport = scrollRef.current;
    if (!viewport || !s.songViewportReady) return;
    const restored = restoreSongPosition(viewport, leftTick, scrollTop, bar, zoom);
    geometryRef.current = restored.geometry;
    scrollTarget.current = restored.target;
  }, [scrollRef, s.songViewportReady, leftTick, scrollTop, bar, zoom, s.owner, s.project.id, bars, s.project.tracks.length, size]);
  useEffect(() => {
    const viewport = scrollRef.current;
    if (!s.songViewportReady || !follow || !viewport || !transport.playing || s.transaction?.owner?.startsWith("clip:")) return;
    const x = transport.tick / bar * zoom;
    if (x < viewport.scrollLeft || x > viewport.scrollLeft + size.timeWidth - 24) {
      const left = Math.min(Math.max(0, x - size.timeWidth * .25), viewport.scrollWidth - viewport.clientWidth);
      if (Math.abs(left - viewport.scrollLeft) < 1) return;
      s.setSongViewport({ leftTick: left / zoom * bar });
    }
  }, [s, follow, transport.tick, transport.playing, bar, zoom, size.timeWidth, scrollRef]);
  function manualNavigation() {
    scrollTarget.current = null;
    if (s.songViewportReady && follow) s.setSongViewport({ follow: false });
  }
  return <div ref={scrollRef} className="timeline-scroll song-timeline-scroll" aria-label="Song arrangement" tabIndex={0}
    onWheel={manualNavigation}
    onKeyDown={event => { if (event.target === event.currentTarget && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) manualNavigation(); }}
    onScroll={event => {
      if (!s.songViewportReady) return;
      const viewport = event.currentTarget, geometry = scrollGeometry(viewport);
      if (!sameGeometry(geometryRef.current, geometry)) {
        const restored = restoreSongPosition(viewport, leftTick, scrollTop, bar, zoom);
        geometryRef.current = restored.geometry; scrollTarget.current = restored.target;
        return;
      }
      const expected = scrollTarget.current;
      if (expected && Math.abs(viewport.scrollLeft - expected.left) < 1 && Math.abs(viewport.scrollTop - expected.top) < 1) return;
      scrollTarget.current = null;
      s.setSongViewport({ leftTick: viewport.scrollLeft / zoom * bar, scrollTop: viewport.scrollTop, follow: false });
    }}>
    <div ref={contentRef} className="timeline song-timeline" style={{ width: `calc(var(--song-track-header-width) + ${timeWidth}px)` }}>
      <div className="song-timeline-guides">
      <div className="song-guide-row"><div className="song-guide-heading">Sections</div><div className="section-lane">
        {s.project.sections.map(section => <button key={section.id} data-edit-policy="bypass"
          className={section.id === s.selectedSection.id ? "selected" : ""}
          style={{ left: section.startTick / bar * zoom, width: section.lengthTick / bar * zoom }}
          onClick={() => { if (s.setSelectedSectionId(section.id)) void s.seek(section.startTick); }}>
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
          onClick={() => { if (!s.setMode("write") || !s.setSelectedSectionId(chord.sectionId)) return; s.setSelectedChordId(chord.id); }}
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
