"use client";
import { useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { DraftInput } from "./draft-field";
import { useStudio } from "./use-studio";
import { IconButton, Range } from "./primitives";
import { PPQ, uid, clamp, type NoteEvent } from "../../lib/music/types";
import { ticksPerBar } from "../../lib/music/project";
import { quantizeClip, humanizeClip } from "../../lib/music/edit";
import { instrumentFor, isDrumInstrument } from "../../lib/audio/catalog";
import { noteName } from "../../lib/music/theory";
import { useToolInputTermination, useToolVisibility } from "./tool-visibility";

export function ClipNoteEditor({ grid, setGrid, swing, setSwing }: { grid: number; setGrid: (value: number) => void; swing: number; setSwing: (value: number) => void }) {
  const s = useStudio(), clip = s.selectedClip, track = s.selectedTrack;
  const bar = ticksPerBar(s.project);
  const [noteId, setNoteId] = useState("");
  const [editor, setEditor] = useState<"notes" | "drums">("notes");
  const active = useToolVisibility(), roll = useRef<HTMLDivElement>(null), positionedClip = useRef("");
  const notePointer = useRef<(() => void) | null>(null), noteKeyboard = useRef<string | null>(null);
  function endNoteInput() { notePointer.current?.(); notePointer.current = null; noteKeyboard.current = null; }
  useToolInputTermination(endNoteInput);
  const releaseNoteInput = useEffectEvent(endNoteInput);
  useLayoutEffect(() => { if (!active) releaseNoteInput(); return () => releaseNoteInput(); }, [active, clip?.id, track?.id, s.project.id, editor]);
  useLayoutEffect(() => {
    const element = roll.current, context = `${s.project.id}:${clip?.id ?? ""}`;
    if (!active || !clip || !element || positionedClip.current === context) return;
    const position = () => {
      if (!element.clientHeight || positionedClip.current === context) return;
      const pitches = clip.notes.map(note => note.pitch);
      const middle = pitches.length ? (Math.min(...pitches) + Math.max(...pitches)) / 2 : 48;
      element.scrollTop = Math.max(0, (84 - clamp(middle, 36, 84)) * 18 + 9 - element.clientHeight / 2);
      positionedClip.current = context;
    };
    position();
    const observer = new ResizeObserver(position); observer.observe(element);
    return () => observer.disconnect();
  }, [active, clip, editor, s.project.id]);
  const chosen = clip?.notes.find(n => n.id === noteId);
  function editNote(update: Partial<NoteEvent>) {
    if (clip && track) s.updateClip(track.id, clip.id, c => ({ ...c,
      notes: c.notes.map(n => n.id === noteId ? { ...n, ...update } : n) }), "Edit note");
  }
  function changeEditor(next: "notes" | "drums") { endNoteInput(); if (s.finishEdit()) setEditor(next); }
  if (!clip || !track) return null;
  return <>
              <div className="editor-tabs">
                <button
                  data-edit-policy="bypass"
                  className={editor === "notes" ? "active" : ""}
                  onClick={() => changeEditor("notes")}
                >
                  Piano roll
                </button>
                <button
                  data-edit-policy="bypass"
                  disabled={!isDrumInstrument(instrumentFor(s.project,track))}
                  className={editor === "drums" ? "active" : ""}
                  onClick={() => changeEditor("drums")}
                >
                  Drum steps
                </button>
                <button
                  data-edit-policy="bypass"
                  onClick={() => s.setDetailTool("automation")}
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
                  <div ref={roll} className="piano-roll-scroll">
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
                        if (!active) return;
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
                            if (!active) return;
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
                              e.preventDefault();
                              const owner = "note:" + n.id;
                              if (!s.beginEdit(owner)) return;
                              noteKeyboard.current = owner;
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
                          onKeyUp={e=>{const owner="note:"+n.id;if(e.key.startsWith("Arrow")&&noteKeyboard.current===owner){noteKeyboard.current=null;s.finishEdit(owner);}}}
                          onBlur={()=>{const owner="note:"+n.id;if(noteKeyboard.current===owner){noteKeyboard.current=null;s.finishEdit(owner);}}}
                          onPointerDown={(e) => {
                            if(!active)return;
                            endNoteInput();
                            const owner = "note:" + n.id;
                            if(!s.beginEdit(owner))return;
                            const start = e.clientX,
                              startY = e.clientY,
                              rect =
                                e.currentTarget.parentElement!.getBoundingClientRect(),
                              target = e.currentTarget;
                            target.setPointerCapture(e.pointerId);
                            const up = (ev: globalThis.PointerEvent) => {
                              cleanup();if(!s.ownsEdit(owner))return;
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
                              s.finishEdit(owner);
                            };
                            const pointerId=e.pointerId;
                            const cleanup=()=>{target.removeEventListener("pointerup",up);target.removeEventListener("pointercancel",cancel);target.removeEventListener("lostpointercapture",cancel);window.removeEventListener("keydown",escape,true);if(notePointer.current===cleanup)notePointer.current=null;if(target.hasPointerCapture(pointerId))target.releasePointerCapture(pointerId);};
                            const cancel=()=>{cleanup();s.cancelEdit(owner);};
                            const escape=(ev:KeyboardEvent)=>{if(ev.key==="Escape"){ev.preventDefault();ev.stopPropagation();cancel();}};
                            notePointer.current=cleanup;
                            target.addEventListener("pointerup", up);target.addEventListener("pointercancel",cancel);target.addEventListener("lostpointercapture",cancel);window.addEventListener("keydown",escape,true);
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
  </>;
}
