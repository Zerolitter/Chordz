"use client";
import {DraftInput} from "./draft-field";
import { useEffect, useState, type PointerEvent } from "react";
import { Plus, Copy, Scissors, Trash2, Music2 } from "lucide-react";
import {usePreference,numericPreference} from "./use-preference";
import { useStudio, useTransport } from "./use-studio";
import { PanelHeading, IconButton, Range } from "./primitives";
import {
  PPQ,
  uid,
  clamp,
  type AutomationParameter,
  type NoteEvent,
} from "../../lib/music/types";
import {
  emptyClip,
  projectEnd,
  ticksPerBar,
  tickToSeconds,
} from "../../lib/music/project";
import {
  duplicateClip,
  splitClip,
  quantizeClip,
  humanizeClip,
  moveSection,
} from "../../lib/music/edit";
import {instrumentFor,isDrumInstrument} from "../../lib/audio/catalog";
import { noteName } from "../../lib/music/theory";

const bounds: Record<AutomationParameter, [number, number]> = {
  volume: [-60, 6],
  pan: [-1, 1],
  cutoff: [40, 18000],
  expression: [0, 1],
  modulation: [0, 1],
  pitchBend: [-1, 1],
  reverb: [0, 1],
  delay: [0, 1],
};
function regionPeaks(
  peaks: number[],
  assetSeconds: number,
  offset: number,
  seconds: number,
  loopSeconds: number,
) {
  if (!peaks.length || !assetSeconds) return [];
  return Array.from({ length: 128 }, (_, i) => {
    const position = ((i + 0.5) / 128) * seconds;
    const source =
      offset + (loopSeconds > 0 ? position % loopSeconds : position);
    return source >= 0 && source < assetSeconds
      ? (peaks[Math.floor((source / assetSeconds) * peaks.length)] ?? 0)
      : 0;
  });
}
export function ArrangePanel() {
  const s = useStudio(),
    transport = useTransport();
  const [zoom, setZoom] = usePreference("timeline-zoom",38,numericPreference(18,100)),
    [grid, setGrid] = usePreference("grid",PPQ/4,numericPreference(PPQ/8,PPQ)),
    [swing, setSwing] = usePreference("swing",0,numericPreference(0,.6)),
    [noteId, setNoteId] = useState(""),
    [lane, setLane] = useState<AutomationParameter>("volume"),
    [editor, setEditor] = useState<"notes" | "drums" | "automation">("notes"),
    [eventType, setEventType] = useState<
      "sustain" | "pitchBend" | "modulation" | "expression"
    >("expression");
  const bar = ticksPerBar(s.project),
    end = projectEnd(s.project),
    bars = Math.ceil(end / bar),
    width = Math.max(780, bars * zoom),
    clip = s.selectedClip,
    track = s.selectedTrack;
  const chosen = clip?.notes.find((n) => n.id === noteId);
  useEffect(() => {
    if (clip?.audio) void s.hydrateWaveform(clip.audio.assetId);
    // One waveform hydration per asset; the callback resolves the private cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip?.audio?.assetId]);
  function newClip() {
    if (track)
      s.insertClip(
        track.id,
        emptyClip(
          s.selectedSection.startTick,
          s.selectedSection.lengthTick,
          "New phrase",
        ),
      );
  }
  function editNote(update: Partial<NoteEvent>) {
    if (clip && track)
      s.updateClip(
        track.id,
        clip.id,
        (c) => ({
          ...c,
          notes: c.notes.map((n) =>
            n.id === noteId ? { ...n, ...update } : n,
          ),
        }),
        "Edit note",
      );
  }
  function dragClip(event:PointerEvent<HTMLButtonElement>,id:string,clipId:string){
    if(event.button!==0||s.recording||!s.beginEdit("clip:"+clipId))return;
    const original=s.project.tracks.find(t=>t.id===id)!.clips.find(c=>c.id===clipId)!;
    const target=event.currentTarget,startX=event.clientX;
    target.setPointerCapture(event.pointerId);
    const cleanup=()=>{target.removeEventListener("pointermove",move);target.removeEventListener("pointerup",up);target.removeEventListener("pointercancel",cancel);window.removeEventListener("keydown",escape,true);};
    const move=(e:globalThis.PointerEvent)=>{if(!s.ownsEdit("clip:"+clipId)){cleanup();return;}const tick=Math.max(0,Math.round((original.startTick+(e.clientX-startX)/zoom*bar)/grid)*grid);s.updateClip(id,clipId,c=>({...c,startTick:tick}),"Move clip");};
    const up=()=>{cleanup();s.finishEdit("clip:"+clipId);};
    const cancel=()=>{cleanup();s.cancelEdit("clip:"+clipId);};
    const escape=(e:KeyboardEvent)=>{if(e.key==="Escape"){e.preventDefault();e.stopPropagation();cancel();}};
    target.addEventListener("pointermove",move);target.addEventListener("pointerup",up);target.addEventListener("pointercancel",cancel);window.addEventListener("keydown",escape,true);
  }
  const auto =
    track?.automation.find((a) => a.parameter === lane)?.points ?? [];
  function updatePoints(points: typeof auto) {
    if (track)
      s.updateTrack(
        track.id,
        (t) => ({
          ...t,
          automation: [
            ...t.automation.filter((a) => a.parameter !== lane),
            { parameter: lane, points: points.sort((a, b) => a.tick - b.tick) },
          ],
        }),
        "Edit automation",
      );
  }
  return (
    <div className="arrange-panel">
      <PanelHeading eyebrow="Give your song a shape" title="The whole picture.">
        <div className="button-row">
          <button
            className="secondary-button"
            disabled={!track||s.recording}
            onClick={newClip}
          >
            <Plus size={15} />
            New phrase
          </button>
          <label className="compact-field">
            Zoom
            <DraftInput
              aria-label="Timeline zoom"
              type="range"
              min={18}
              max={100}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
        </div>
      </PanelHeading>
      <div className="section-tools">
        <select
          aria-label="Edit section"
          value={s.selectedSection.id}
          onChange={(e) => s.setSelectedSectionId(e.target.value)}
        >
          {s.project.sections.map((sec) => (
            <option key={sec.id} value={sec.id}>
              {sec.name}
            </option>
          ))}
        </select>
        <label>
          Name
          <DraftInput
            aria-label="Section name"
            value={s.selectedSection.name}
            onChange={(e) =>
              s.edit(
                (p) => ({
                  ...p,
                  sections: p.sections.map((sec) =>
                    sec.id === s.selectedSection.id
                      ? { ...sec, name: e.target.value }
                      : sec,
                  ),
                }),
                "Rename section",
              )
            }
          />
        </label>
        <label>
          Start bar
          <DraftInput
            aria-label="Section start bar"
            type="number"
            min={1}
            value={s.selectedSection.startTick / bar + 1}
            onChange={(e) =>
              s.edit(
                (p) =>
                  moveSection(
                    p,
                    s.selectedSection.id,
                    Math.max(0, (Number(e.target.value) - 1) * bar),
                  ),
                "Move section",
              )
            }
          />
        </label>
        <label>
          Bars
          <DraftInput
            aria-label="Section length bars"
            type="number"
            min={1}
            max={512}
            value={s.selectedSection.lengthTick / bar}
            onChange={(e) =>
              s.edit(
                (p) => ({
                  ...p,
                  sections: p.sections.map((sec) =>
                    sec.id === s.selectedSection.id
                      ? {
                          ...sec,
                          lengthTick:
                            clamp(Number(e.target.value), 1, 512) * bar,
                        }
                      : sec,
                  ),
                }),
                "Resize section",
              )
            }
          />
        </label>
        <button
          className="text-button"
          onClick={() => {
            const section = {
              id: uid(),
              name: "New section",
              startTick: end,
              lengthTick: bar * 8,
              lyrics: "",
            };
            s.edit(
              (p) => ({ ...p, sections: [...p.sections, section] }),
              "Add section",
            );
            s.setSelectedSectionId(section.id);
          }}
        >
          + Section
        </button>
        <IconButton
          label="Delete section and its chord guide"
          disabled={s.project.sections.length === 1}
          onClick={() =>
            s.edit(
              (p) => ({
                ...p,
                sections: p.sections.filter(
                  (sec) => sec.id !== s.selectedSection.id,
                ),
                chords: p.chords.filter(
                  (c) => c.sectionId !== s.selectedSection.id,
                ),
              }),
              "Delete section",
            )
          }
        >
          <Trash2 size={14} />
        </IconButton>
      </div>
      <div className="timeline-scroll">
        <div className="timeline" style={{ width }}>
          <div className="section-lane">
            {s.project.sections.map((sec) => (
              <button
                key={sec.id}
                className={sec.id === s.selectedSection.id ? "selected" : ""}
                style={{
                  left: (sec.startTick / bar) * zoom,
                  width: (sec.lengthTick / bar) * zoom,
                }}
                onClick={() => {
                  s.setSelectedSectionId(sec.id);
                  void s.seek(sec.startTick);
                }}
              >
                {sec.name}
              </button>
            ))}
          </div>
          <div className="bar-ruler">
            {Array.from({ length: bars }, (_, i) => (
              <button
                key={i}
                style={{ left: i * zoom, width: zoom }}
                onClick={() => void s.seek(i * bar)}
              >
                {i + 1}
              </button>
            ))}
          </div>
          {s.project.tracks.map((t) => (
            <div
              className="timeline-row"
              key={t.id}
              style={
                {
                  backgroundSize: zoom + "px 100%",
                  "--track-color": t.color,
                } as React.CSSProperties
              }
            >
              <span className="timeline-track-label">{t.name}</span>
              {t.clips.map((c) => (
                <button
                  key={c.id}
                  className={
                    "timeline-clip " +
                    (c.id === s.selectedClipId ? "selected" : "")
                  }
                  style={{
                    left: (c.startTick / bar) * zoom,
                    width: Math.max(12, (c.lengthTick / bar) * zoom),
                  }}
                  onClick={() => s.selectClip(t.id, c.id)}
                  onPointerDown={(e) => dragClip(e, t.id, c.id)}
                  title={`${t.name} · ${c.name} · drag to move`}
                >
                  <span>
                    {c.name}
                    {c.loop ? " ↻" : ""}
                  </span>
                  <svg
                    viewBox="0 0 200 26"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    {c.audio
                      ? regionPeaks(
                          s.waveforms[c.audio.assetId] ?? [],
                          s.project.assets.find(
                            (a) => a.id === c.audio!.assetId,
                          )?.duration ?? 0,
                          c.audio.offsetSec,
                          tickToSeconds(c.lengthTick, s.project.tempo),
                          c.loop
                            ? tickToSeconds(c.sourceLengthTick, s.project.tempo)
                            : 0,
                        ).map((v, i) => (
                          <line
                            key={i}
                            x1={(i / 128) * 200}
                            x2={(i / 128) * 200}
                            y1={13 - v * 12}
                            y2={13 + v * 12}
                          />
                        ))
                      : c.notes
                          .slice(0, 140)
                          .map((n, i) => (
                            <rect
                              key={i}
                              x={(n.tick / c.sourceLengthTick) * 200}
                              y={24 - (n.pitch % 24)}
                              width={Math.max(
                                1,
                                (n.duration / c.sourceLengthTick) * 200,
                              )}
                              height={1.5}
                            />
                          ))}
                  </svg>
                </button>
              ))}
            </div>
          ))}
          <div
            className="playhead"
            style={{ left: (transport.tick / bar) * zoom }}
          />
        </div>
      </div>
      {clip && track ? (
        <section className="clip-editor">
          <div className="clip-toolbar">
            <DraftInput
              aria-label="Clip name"
              value={clip.name}
              onChange={(e) =>
                s.updateClip(
                  track.id,
                  clip.id,
                  (c) => ({ ...c, name: e.target.value }),
                  "Rename clip",
                )
              }
            />
            <label>
              Start bar
              <DraftInput
                aria-label="Clip start bar"
                type="number"
                min={1}
                step={0.25}
                value={clip.startTick / bar + 1}
                onChange={(e) =>
                  s.updateClip(
                    track.id,
                    clip.id,
                    (c) => ({
                      ...c,
                      startTick: Math.max(
                        0,
                        Math.round((Number(e.target.value) - 1) * bar),
                      ),
                    }),
                    "Move clip",
                  )
                }
              />
            </label>
            <label>
              Length
              <DraftInput
                aria-label="Clip length bars"
                type="number"
                min={0.25}
                max={512}
                step={0.25}
                value={clip.lengthTick / bar}
                onChange={(e) =>
                  s.updateClip(
                    track.id,
                    clip.id,
                    (c) => ({
                      ...c,
                      lengthTick:
                        clamp(Number(e.target.value), 0.25, 512) * bar,
                    }),
                    "Resize clip",
                  )
                }
              />
            </label>
            {!clip.audio && (
              <>
                <label>
                  Loop source
                  <DraftInput
                    aria-label="Loop source bars"
                    type="number"
                    min={0.25}
                    max={512}
                    step={0.25}
                    value={clip.sourceLengthTick / bar}
                    onChange={(e) =>
                      s.updateClip(
                        track.id,
                        clip.id,
                        (c) => ({
                          ...c,
                          sourceLengthTick:
                            clamp(Number(e.target.value), 0.25, 512) * bar,
                        }),
                        "Resize loop source",
                      )
                    }
                  />
                </label>
                <label>
                  Transpose
                  <DraftInput
                    aria-label="Clip transpose"
                    type="number"
                    min={-48}
                    max={48}
                    value={clip.transpose}
                    onChange={(e) =>
                      s.updateClip(
                        track.id,
                        clip.id,
                        (c) => ({
                          ...c,
                          transpose: clamp(Number(e.target.value), -48, 48),
                        }),
                        "Transpose clip",
                      )
                    }
                  />
                </label>
                <label className="checkbox-label">
                  <DraftInput
                    type="checkbox"
                    checked={clip.loop}
                    onChange={(e) =>
                      s.updateClip(
                        track.id,
                        clip.id,
                        (c) => ({ ...c, loop: e.target.checked }),
                        "Loop clip",
                      )
                    }
                  />
                  Loop
                </label>
              </>
            )}
            <IconButton
              label="Duplicate selected clip"
              disabled={s.recording}
              onClick={() =>
                s.insertClip(track.id, duplicateClip(clip), "Duplicate clip")
              }
            >
              <Copy size={17} />
            </IconButton>
            <IconButton
              label="Split clip at playhead"
              disabled={
                transport.tick <= clip.startTick ||
                transport.tick >= clip.startTick + clip.lengthTick
              }
              onClick={() => {
                const pieces = splitClip(clip, transport.tick, s.project.tempo);
                s.updateTrack(
                  track.id,
                  (t) => ({
                    ...t,
                    clips: t.clips.flatMap((c) =>
                      c.id === clip.id ? pieces : [c],
                    ),
                  }),
                  "Split clip",
                );
              }}
            >
              <Scissors size={17} />
            </IconButton>
            <IconButton
              label="Delete selected clip"
              onClick={() =>
                s.updateTrack(
                  track.id,
                  (t) => ({
                    ...t,
                    clips: t.clips.filter((c) => c.id !== clip.id),
                  }),
                  "Delete clip",
                )
              }
            >
              <Trash2 size={17} />
            </IconButton>
          </div>
          {clip.audio ? (
            <div className="audio-editor">
              <h3>Audio region</h3>
              <p className="helper">
                Trim with the source offset and clip length. Move the start to
                align your take.
              </p>
              <Range
                label="Source offset"
                value={clip.audio.offsetSec}
                min={0}
                max={
                  s.project.assets.find((a) => a.id === clip.audio!.assetId)
                    ?.duration ?? 300
                }
                onChange={(v) =>
                  s.updateClip(
                    track.id,
                    clip.id,
                    (c) => ({ ...c, audio: { ...c.audio!, offsetSec: v } }),
                    "Trim audio",
                  )
                }
                unit=" s"
              />
              <Range
                label="Region gain"
                min={0}
                max={4}
                value={clip.audio.gain}
                onChange={(v) =>
                  s.updateClip(
                    track.id,
                    clip.id,
                    (c) => ({ ...c, audio: { ...c.audio!, gain: v } }),
                    "Audio gain",
                  )
                }
              />
              {(["fadeInSec", "fadeOutSec"] as const).map((param, i) => (
                <Range
                  key={param}
                  label={i ? "Fade out" : "Fade in"}
                  min={0}
                  max={Math.min(
                    10,
                    tickToSeconds(clip.lengthTick, s.project.tempo) / 2,
                  )}
                  value={clip.audio![param]}
                  onChange={(v) =>
                    s.updateClip(
                      track.id,
                      clip.id,
                      (c) => ({ ...c, audio: { ...c.audio!, [param]: v } }),
                      "Audio fade",
                    )
                  }
                  unit=" s"
                />
              ))}
            </div>
          ) : (
            <>
              <div className="editor-tabs">
                <button
                  className={editor === "notes" ? "active" : ""}
                  onClick={() => setEditor("notes")}
                >
                  Piano roll
                </button>
                <button
                  disabled={!isDrumInstrument(instrumentFor(s.project,track))}
                  className={editor === "drums" ? "active" : ""}
                  onClick={() => setEditor("drums")}
                >
                  Drum steps
                </button>
                <button
                  className={editor === "automation" ? "active" : ""}
                  onClick={() => setEditor("automation")}
                >
                  Automation
                </button>
                <select
                  aria-label="Quantization grid"
                  value={grid}
                  onChange={(e) => setGrid(Number(e.target.value))}
                >
                  <option value={PPQ}>1/4</option>
                  <option value={PPQ / 2}>1/8</option>
                  <option value={PPQ / 4}>1/16</option>
                  <option value={PPQ / 8}>1/32</option>
                </select>
                <label>
                  {" "}
                  Swing
                  <DraftInput
                    aria-label="Swing"
                    type="range"
                    min={0}
                    max={0.6}
                    step={0.01}
                    value={swing}
                    onChange={(e) => setSwing(Number(e.target.value))}
                  />
                </label>
                <button
                  className="text-button"
                  onClick={() =>
                    s.updateClip(
                      track.id,
                      clip.id,
                      (c) => quantizeClip(c, grid, swing),
                      "Quantize notes",
                    )
                  }
                >
                  Quantize
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    s.updateClip(
                      track.id,
                      clip.id,
                      (c) => humanizeClip(c, s.project.seed, 0.6),
                      "Humanize notes",
                    )
                  }
                >
                  Humanize
                </button>
              </div>
              {(editor === "notes" || editor==="drums"&&instrumentFor(s.project,track).kind!=="drums") && (
                <>
                  <div className="piano-roll-scroll">
                    <div
                      className="piano-roll"
                      style={{
                        width: Math.max(
                          720,
                          (clip.sourceLengthTick / bar) * 100,
                        ),
                        backgroundSize: `${(grid / clip.sourceLengthTick) * 100}% 18px`,
                      }}
                      onDoubleClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const tick = clamp(
                            Math.floor(
                              (((e.clientX - rect.left) / rect.width) *
                                clip.sourceLengthTick) /
                                grid,
                            ) * grid,
                            0,
                            clip.sourceLengthTick - 1,
                          ),
                          pitch = clamp(
                            84 - Math.floor((e.clientY - rect.top) / 18),
                            0,
                            127,
                          );
                        const note = {
                          id: uid(),
                          tick,
                          pitch,
                          duration: grid,
                          velocity: 0.75,
                        };
                        s.updateClip(
                          track.id,
                          clip.id,
                          (c) => ({ ...c, notes: [...c.notes, note] }),
                          "Add note",
                        );
                        setNoteId(note.id);
                      }}
                    >
                      {Array.from({ length: 49 }, (_, i) => (
                        <span
                          key={i}
                          className="roll-note-label"
                          style={{ top: i * 18 }}
                        >
                          {noteName(84 - i, s.project.key)}
                        </span>
                      ))}
                      {clip.notes.map((n) => (
                        <button
                          className={
                            "roll-note " + (n.id === noteId ? "selected" : "")
                          }
                          key={n.id}
                          style={{
                            left: (n.tick / clip.sourceLengthTick) * 100 + "%",
                            width:
                              Math.max(
                                0.3,
                                (n.duration / clip.sourceLengthTick) * 100,
                              ) + "%",
                            top: (84 - n.pitch) * 18,
                            height: 16,
                            opacity: 0.35 + n.velocity * 0.65,
                          }}
                          aria-label={`${noteName(n.pitch, s.project.key)} note at beat ${n.tick / PPQ + 1}`}
                          onClick={() => setNoteId(n.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Delete") {
                              s.updateClip(
                                track.id,
                                clip.id,
                                (c) => ({
                                  ...c,
                                  notes: c.notes.filter((x) => x.id !== n.id),
                                }),
                                "Delete note",
                              );
                            }
                            if (e.key.startsWith("Arrow")) {
                              e.preventDefault();s.beginEdit("note:"+n.id);
                              s.updateClip(
                                track.id,
                                clip.id,
                                (c) => ({
                                  ...c,
                                  notes: c.notes.map((x) =>
                                    x.id === n.id
                                      ? {
                                          ...x,
                                          pitch: clamp(
                                            x.pitch +
                                              (e.key === "ArrowUp"
                                                ? 1
                                                : e.key === "ArrowDown"
                                                  ? -1
                                                  : 0),
                                            0,
                                            127,
                                          ),
                                          tick: clamp(
                                            x.tick +
                                              (e.key === "ArrowLeft"
                                                ? -grid
                                                : e.key === "ArrowRight"
                                                  ? grid
                                                  : 0),
                                            0,
                                            c.sourceLengthTick - 1,
                                          ),
                                        }
                                      : x,
                                  ),
                                }),
                                "Move note",
                              );
                            }
                          }}
                          onKeyUp={e=>{if(e.key.startsWith("Arrow"))s.finishEdit();}}
                          onPointerDown={(e) => {
                            if(!s.beginEdit("note:"+n.id))return;
                            const start = e.clientX,
                              startY = e.clientY,
                              rect =
                                e.currentTarget.parentElement!.getBoundingClientRect(),
                              target = e.currentTarget;
                            target.setPointerCapture(e.pointerId);
                            const up = (ev: globalThis.PointerEvent) => {
                              cleanup();if(!s.ownsEdit("note:"+n.id))return;
                              const tick = clamp(
                                  Math.round(
                                    (n.tick +
                                      ((ev.clientX - start) / rect.width) *
                                        clip.sourceLengthTick) /
                                      grid,
                                  ) * grid,
                                  0,
                                  clip.sourceLengthTick - 1,
                                ),
                                pitch = clamp(
                                  n.pitch -
                                    Math.round((ev.clientY - startY) / 18),
                                  0,
                                  127,
                                );
                              if (tick !== n.tick || pitch !== n.pitch)
                                s.updateClip(
                                  track.id,
                                  clip.id,
                                  (c) => ({
                                    ...c,
                                    notes: c.notes.map((x) =>
                                      x.id === n.id ? { ...x, tick, pitch } : x,
                                    ),
                                  }),
                                  "Move note",
                                );
                              s.finishEdit("note:"+n.id);
                            };
                            const cleanup=()=>{target.removeEventListener("pointerup",up);target.removeEventListener("pointercancel",cancel);window.removeEventListener("keydown",escape,true);};
                            const cancel=()=>{cleanup();s.cancelEdit();};
                            const escape=(ev:KeyboardEvent)=>{if(ev.key==="Escape"){ev.preventDefault();ev.stopPropagation();cancel();}};
                            target.addEventListener("pointerup", up);target.addEventListener("pointercancel",cancel);window.addEventListener("keydown",escape,true);
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  <p className="helper">
                    Double-click the grid to add a note. Drag notes or use arrow
                    keys. Delete removes a selected note.
                  </p>
                  {chosen && (
                    <div className="note-inspector">
                      <label>
                        Pitch
                        <DraftInput
                          aria-label="Note MIDI pitch"
                          type="number"
                          min={0}
                          max={127}
                          value={chosen.pitch}
                          onChange={(e) =>
                            editNote({
                              pitch: clamp(Number(e.target.value), 0, 127),
                            })
                          }
                        />
                      </label>
                      <label>
                        Beat
                        <DraftInput
                          aria-label="Note beat"
                          type="number"
                          min={1}
                          step={0.25}
                          value={chosen.tick / PPQ + 1}
                          onChange={(e) =>
                            editNote({
                              tick: clamp(
                                Math.round((Number(e.target.value) - 1) * PPQ),
                                0,
                                clip.sourceLengthTick - 1,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        Duration
                        <DraftInput
                          aria-label="Note duration beats"
                          type="number"
                          min={0.0625}
                          step={0.25}
                          value={chosen.duration / PPQ}
                          onChange={(e) =>
                            editNote({
                              duration: Math.max(
                                1,
                                Math.round(Number(e.target.value) * PPQ),
                              ),
                            })
                          }
                        />
                      </label>
                      <Range
                        label="Note velocity"
                        min={0.01}
                        value={chosen.velocity}
                        onChange={(v) => editNote({ velocity: v })}
                      />
                      <IconButton
                        label="Delete note"
                        onClick={() =>
                          s.updateClip(
                            track.id,
                            clip.id,
                            (c) => ({
                              ...c,
                              notes: c.notes.filter((n) => n.id !== noteId),
                            }),
                            "Delete note",
                          )
                        }
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  )}
                </>
              )}
              {editor === "drums" && isDrumInstrument(instrumentFor(s.project,track)) && (
                <div className="drum-editor">
                  {[
                    [36, "Kick"],
                    [38, "Snare"],
                    [42, "Closed hat"],
                    [46, "Open hat"],
                    [49, "Crash"],
                  ].map(([pitch, name]) => (
                    <div className="drum-row" key={pitch}>
                      <span>{name}</span>
                      {Array.from({ length: 16 }, (_, i) => {
                        const tick = (i * PPQ) / 4,
                          note = clip.notes.find(
                            (n) =>
                              n.pitch === pitch && Math.abs(n.tick - tick) < 10,
                          );
                        return (
                          <button
                            key={i}
                            className={
                              (note ? "on " : "") + (i % 4 === 0 ? "beat" : "")
                            }
                            aria-label={`${name} step ${i + 1}`}
                            aria-pressed={!!note}
                            onClick={() =>
                              s.updateClip(
                                track.id,
                                clip.id,
                                (c) => ({
                                  ...c,
                                  notes: note
                                    ? c.notes.filter((n) => n.id !== note.id)
                                    : [
                                        ...c.notes,
                                        {
                                          id: uid(),
                                          pitch: Number(pitch),
                                          tick,
                                          duration: PPQ / 8,
                                          velocity: i % 4 === 0 ? 0.9 : 0.65,
                                        },
                                      ],
                                }),
                                "Edit drum step",
                              )
                            }
                          />
                        );
                      })}
                    </div>
                  ))}
                  <p className="helper">
                    First bar pattern. Turn on Loop to repeat this phrase after
                    setting its length.
                  </p>
                </div>
              )}
            </>
          )}
          <section className="performance-events">
            <div className="subheading">
              <h3>Performance expression</h3>
              <select
                aria-label="Performance control"
                value={eventType}
                onChange={(e) =>
                  setEventType(e.target.value as typeof eventType)
                }
              >
                <option value="expression">Expression</option>
                <option value="sustain">Sustain</option>
                <option value="pitchBend">Pitch bend</option>
                <option value="modulation">Modulation</option>
              </select>
              <button
                className="text-button"
                onClick={() =>
                  s.updateClip(
                    track.id,
                    clip.id,
                    (c) => ({
                      ...c,
                      events: [
                        ...c.events,
                        {
                          tick: clamp(
                            Math.round(transport.tick - c.startTick),
                            0,
                            c.lengthTick - 1,
                          ),
                          type: eventType,
                          value: eventType === "pitchBend" ? 0 : 1,
                        },
                      ],
                    }),
                    "Add performance control",
                  )
                }
              >
                + Control at playhead
              </button>
            </div>
            <div className="automation-points">
              {clip.events
                .map((event, index) => ({ event, index }))
                .filter(({ event }) => event.type === eventType)
                .slice(0, 100)
                .map(({ event, index }) => (
                  <div key={index}>
                    <label>
                      Beat
                      <DraftInput
                        aria-label={
                          "Performance control " + (index + 1) + " beat"
                        }
                        type="number"
                        min={1}
                        step={0.25}
                        value={event.tick / PPQ + 1}
                        onChange={(e) =>
                          s.updateClip(
                            track.id,
                            clip.id,
                            (c) => ({
                              ...c,
                              events: c.events.map((ev, i) =>
                                i === index
                                  ? {
                                      ...ev,
                                      tick: Math.max(
                                        0,
                                        Math.round(
                                          (Number(e.target.value) - 1) * PPQ,
                                        ),
                                      ),
                                    }
                                  : ev,
                              ),
                            }),
                            "Move performance control",
                          )
                        }
                      />
                    </label>
                    <label>
                      Value
                      <DraftInput
                        aria-label={
                          "Performance control " + (index + 1) + " value"
                        }
                        type="number"
                        min={eventType === "pitchBend" ? -1 : 0}
                        max={1}
                        step={0.01}
                        value={event.value}
                        onChange={(e) =>
                          s.updateClip(
                            track.id,
                            clip.id,
                            (c) => ({
                              ...c,
                              events: c.events.map((ev, i) =>
                                i === index
                                  ? {
                                      ...ev,
                                      value: clamp(
                                        Number(e.target.value),
                                        eventType === "pitchBend" ? -1 : 0,
                                        1,
                                      ),
                                    }
                                  : ev,
                              ),
                            }),
                            "Edit performance control",
                          )
                        }
                      />
                    </label>
                    <IconButton
                      label={"Delete performance control " + (index + 1)}
                      onClick={() =>
                        s.updateClip(
                          track.id,
                          clip.id,
                          (c) => ({
                            ...c,
                            events: c.events.filter((_, i) => i !== index),
                          }),
                          "Delete performance control",
                        )
                      }
                    >
                      <Trash2 size={13} />
                    </IconButton>
                  </div>
                ))}
            </div>
            <p className="helper">
              First 100 controls of this type. Draw continuous movement with
              track automation below.
            </p>
          </section>
        </section>
      ) : (
        <div className="empty-state">
          <Music2 size={24} />
          <p>
            Select a phrase to edit its notes or audio, or add a new phrase.
          </p>
        </div>
      )}
      <section className="automation-editor">
        <div className="subheading">
          <h3>{track?.name ?? "Track"} automation</h3>
          <select
            aria-label="Automation parameter"
            value={lane}
            onChange={(e) => setLane(e.target.value as AutomationParameter)}
          >
            {Object.keys(bounds).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button
            className="text-button"
            disabled={!track}
            onClick={() =>
              updatePoints([
                ...auto,
                {
                  tick: Math.round(transport.tick),
                  value:
                    lane === "volume"
                      ? track!.volume
                      : lane === "cutoff"
                        ? track!.sound.cutoff
                        : lane === "expression"
                          ? 1
                          : 0,
                },
              ])
            }
          >
            + Point at playhead
          </button>
        </div>
        <svg
          className="automation-graph"
          viewBox="0 0 800 70"
          preserveAspectRatio="none"
          aria-label={lane + " automation curve"}
        >
          <polyline
            points={auto
              .map(
                (p) =>
                  `${(p.tick / end) * 800},${65 - ((p.value - bounds[lane][0]) / (bounds[lane][1] - bounds[lane][0])) * 60}`,
              )
              .join(" ")}
          />
          {auto.map((p, i) => (
            <circle
              key={i}
              cx={(p.tick / end) * 800}
              cy={
                65 -
                ((p.value - bounds[lane][0]) /
                  (bounds[lane][1] - bounds[lane][0])) *
                  60
              }
              r={3}
            />
          ))}
        </svg>
        <div className="automation-points">
          {auto.map((p, i) => (
            <div key={i}>
              <label>
                Bar
                <DraftInput
                  aria-label={"Automation point " + (i + 1) + " bar"}
                  type="number"
                  min={1}
                  step={0.25}
                  value={p.tick / bar + 1}
                  onChange={(e) =>
                    updatePoints(
                      auto.map((x, j) =>
                        i === j
                          ? {
                              ...x,
                              tick: Math.max(
                                0,
                                Math.round((Number(e.target.value) - 1) * bar),
                              ),
                            }
                          : x,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Value
                <DraftInput
                  aria-label={"Automation point " + (i + 1) + " value"}
                  type="number"
                  min={bounds[lane][0]}
                  max={bounds[lane][1]}
                  step={lane === "cutoff" ? 10 : 0.01}
                  value={p.value}
                  onChange={(e) =>
                    updatePoints(
                      auto.map((x, j) =>
                        i === j
                          ? {
                              ...x,
                              value: clamp(
                                Number(e.target.value),
                                ...bounds[lane],
                              ),
                            }
                          : x,
                      ),
                    )
                  }
                />
              </label>
              <IconButton
                label={"Delete automation point " + (i + 1)}
                onClick={() => updatePoints(auto.filter((_, j) => j !== i))}
              >
                <Trash2 size={13} />
              </IconButton>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
