"use client";
import { useEffect, useState } from "react";
import { Copy, Scissors, Trash2, Music2 } from "lucide-react";
import { DraftInput } from "./draft-field";
import { useStudio, useTransport } from "./use-studio";
import { IconButton, Range } from "./primitives";
import { clamp, PPQ } from "../../lib/music/types";
import { ticksPerBar, tickToSeconds } from "../../lib/music/project";
import { duplicateClip, splitClip } from "../../lib/music/edit";
import { ClipNoteEditor } from "./clip-note-editor";
import { noteEditorContext, useNoteEditorSession } from "./use-note-editor-session";
import { ToolVisibilityProvider, useToolVisibility } from "./tool-visibility";
import { AudioTakeReview } from "./audio-take-review";

export function ClipEditor({ grid, setGrid, swing, setSwing, embedded = false, active = true }: { grid: number; setGrid: (value: number) => void; swing: number; setSwing: (value: number) => void; embedded?: boolean; active?: boolean }) {
  const parentActive = useToolVisibility(), visible = active && parentActive;
  const s = useStudio(), transport = useTransport(visible);
  const clip = s.selectedClip, track = s.selectedTrack, bar = ticksPerBar(s.project);
  const ownerId = s.user?.userId ?? "guest";
  const noteSession = useNoteEditorSession(ownerId, noteEditorContext(ownerId, s.project.id, track?.id, clip?.id));
  const [eventType, setEventType] = useState<"sustain" | "pitchBend" | "modulation" | "expression">("expression");
  useEffect(() => {
    if (visible && clip?.audio) void s.hydrateWaveform(clip.audio.assetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, clip?.audio?.assetId]);
  return <ToolVisibilityProvider active={active}>
      {clip && track ? (
        <section className={`clip-editor${embedded ? " clip-editor-embedded" : ""}`}>
          <details className="clip-editor-metadata" open={embedded ? undefined : true}>
            <summary hidden={!embedded}>Clip settings · {clip.name}</summary>
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
          </div>
          </details>
          <div className="clip-toolbar clip-editor-actions">
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
                s.recording ||
                transport.tick <= clip.startTick ||
                transport.tick >= clip.startTick + clip.lengthTick
              }
              onClick={() => {
                if (!s.finishEdit()) return;
                const current = s.committedRef.current;
                const selected = current.tracks.find(t => t.id === track.id)?.clips.find(c => c.id === clip.id);
                if (!selected) return;
                const pieces = splitClip(selected, transport.tick, current.tempo);
                if (pieces.length !== 2) return;
                const next = { ...current, tracks: current.tracks.map(t => t.id === track.id ? { ...t, clips: t.clips.flatMap(c => c.id === clip.id ? pieces : [c]) } : t) };
                if (s.commit(next, "Split clip")) s.selectClip(track.id, pieces[0].id);
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
              <AudioTakeReview active={visible} />
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
            <div className="clip-editor-grid">
              <ClipNoteEditor noteSession={noteSession} grid={grid} setGrid={setGrid} swing={swing} setSwing={setSwing} />
            </div>
          )}
          <details className="performance-events advanced-inspector">
            <summary>Performance expression</summary>
            <div className="subheading">
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
          </details>
        </section>
      ) : (
        <div className="empty-state">
          <Music2 size={24} />
          <p>
            Select a phrase to edit its notes or audio, or add a new phrase.
          </p>
        </div>
      )}
  </ToolVisibilityProvider>;
}
