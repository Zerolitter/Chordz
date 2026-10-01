"use client";
import { useRef } from "react";
import { Plus, Trash2, Maximize2, LocateFixed } from "lucide-react";
import { DraftInput } from "./draft-field";
import { usePreference, numericPreference } from "./use-preference";
import { useStudio } from "./use-studio";
import { IconButton } from "./primitives";
import { PPQ, uid, clamp } from "../../lib/music/types";
import { emptyClip, projectEnd, ticksPerBar } from "../../lib/music/project";
import { moveSection } from "../../lib/music/edit";
import { ArrangementTimeline } from "./arrangement-timeline";
import { ClipEditor } from "./clip-editor";
import { AutomationEditor } from "./automation-editor";

export function SongCanvas({ grid, setGrid, className = "" }: {
  grid: number; setGrid: (value: number) => void; className?: string;
}) {
  const s = useStudio();
  const { zoom, follow } = s.songViewport;
  const viewport = useRef<HTMLDivElement>(null);
  const bar = ticksPerBar(s.project), track = s.selectedTrack;
  const navigatingDisabled = !s.songViewportReady || !!s.transaction?.owner?.startsWith("clip:");
  function newClip() {
    if (!track) return;
    const clip = emptyClip(s.selectedSection.startTick, s.selectedSection.lengthTick, "New phrase");
    s.insertClip(track.id, clip);
  }
  function width() {
    const element = viewport.current;
    if (!element) return 780;
    return Math.max(1, element.clientWidth - (Number.parseFloat(getComputedStyle(element).getPropertyValue("--song-track-header-width")) || 188));
  }
  function fit(selection: boolean) {
    if (navigatingDisabled || !s.finishEdit()) return;
    const target = selection ? s.selectedClip ?? s.selectedSection : null;
    const start = target?.startTick ?? 0, length = target?.lengthTick ?? projectEnd(s.project);
    const next = clamp(width() / Math.max(1, length / bar), .001, 100);
    s.setSongViewport({ zoom: next, leftTick: start, follow: false });
  }
  function changeZoom(next: number) {
    if (navigatingDisabled || !s.finishEdit()) return;
    const centerTick = ((viewport.current?.scrollLeft ?? 0) + width() / 2) / zoom * bar;
    s.setSongViewport({ zoom: next, leftTick: Math.max(0, centerTick - width() / 2 / next * bar), follow: false });
  }
  return <section className={`song-canvas ${className}`} aria-label="Song canvas" aria-busy={!s.songViewportReady}>
      <div className="song-canvas-toolbar">
          <span className="song-canvas-title">Song</span>
          <select aria-label="Edit section" value={s.selectedSection.id} onChange={e => s.setSelectedSectionId(e.target.value)}>
            {s.project.sections.map(section => <option key={section.id} value={section.id}>{section.name}</option>)}
          </select>
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
              min={.001}
              max={100}
              step={.001}
              value={zoom}
              disabled={navigatingDisabled}
              onChange={(e) => changeZoom(Number(e.target.value))}
            />
          </label>
          <label className="compact-field">
            Snap
            <select aria-label="Timeline snap" value={grid} onChange={e => { if (s.finishEdit()) setGrid(Number(e.target.value)); }}>
              <option value={PPQ}>1/4</option>
              <option value={PPQ / 2}>1/8</option>
              <option value={PPQ / 4}>1/16</option>
              <option value={PPQ / 8}>1/32</option>
            </select>
          </label>
          <div className="song-navigation-tools">
            <button type="button" className="secondary-button" disabled={navigatingDisabled} onClick={() => fit(false)} aria-label="Fit song"><Maximize2 size={13} />Fit song</button>
            <button type="button" className="secondary-button" disabled={navigatingDisabled} onClick={() => fit(true)} aria-label="Fit selected clip or section">Fit selection</button>
            <button type="button" className={`secondary-button${follow ? " active" : ""}`} aria-label="Follow playhead" aria-pressed={follow}
              disabled={navigatingDisabled} onClick={() => { if (s.finishEdit()) s.setSongViewport({ follow: !follow }); }}><LocateFixed size={13} />Follow</button>
          </div>
          <details className="song-section-settings"><summary>Section settings</summary><SectionTools /></details>
      </div>
      <ArrangementTimeline zoom={zoom} grid={grid} viewportRef={viewport} />
    </section>;
}

export function ArrangePanel({ canvasOnly = false }: { canvasOnly?: boolean } = {}) {
  const [grid, setGrid] = usePreference("grid", PPQ / 4, numericPreference(PPQ / 8, PPQ));
  const [swing, setSwing] = usePreference("swing", 0, numericPreference(0, .6));
  return <div className={`arrange-panel${canvasOnly ? " canvas-only" : ""}`}>
    <SongCanvas grid={grid} setGrid={setGrid} />
    {!canvasOnly && <><ClipEditor grid={grid} setGrid={setGrid} swing={swing} setSwing={setSwing} /><AutomationEditor grid={grid} /></>}
  </div>;
}

function SectionTools() {
  const s = useStudio(), bar = ticksPerBar(s.project), end = projectEnd(s.project);
  return <div className="section-tools">
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
      </div>;
}
