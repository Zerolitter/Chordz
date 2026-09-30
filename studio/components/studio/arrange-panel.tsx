"use client";
import { Plus, Trash2 } from "lucide-react";
import { DraftInput } from "./draft-field";
import { usePreference, numericPreference } from "./use-preference";
import { useStudio } from "./use-studio";
import { PanelHeading, IconButton } from "./primitives";
import { PPQ, uid, clamp } from "../../lib/music/types";
import { emptyClip, projectEnd, ticksPerBar } from "../../lib/music/project";
import { moveSection } from "../../lib/music/edit";
import { ArrangementTimeline } from "./arrangement-timeline";
import { ClipEditor } from "./clip-editor";
import { AutomationEditor } from "./automation-editor";

export function ArrangePanel() {
  const s = useStudio();
  const [zoom, setZoom] = usePreference("timeline-zoom", 38, numericPreference(18, 100));
  const [grid, setGrid] = usePreference("grid", PPQ / 4, numericPreference(PPQ / 8, PPQ));
  const [swing, setSwing] = usePreference("swing", 0, numericPreference(0, .6));
  const bar = ticksPerBar(s.project), end = projectEnd(s.project), track = s.selectedTrack;
  function newClip() {
    if (track) s.insertClip(track.id, emptyClip(s.selectedSection.startTick, s.selectedSection.lengthTick, "New phrase"));
  }
  return <div className="arrange-panel">
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
          <label className="compact-field">
            Snap
            <select aria-label="Timeline snap" value={grid} onChange={e => setGrid(Number(e.target.value))}>
              <option value={PPQ}>1/4</option>
              <option value={PPQ / 2}>1/8</option>
              <option value={PPQ / 4}>1/16</option>
              <option value={PPQ / 8}>1/32</option>
            </select>
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

      <ArrangementTimeline zoom={zoom} grid={grid} />
      <ClipEditor grid={grid} setGrid={setGrid} swing={swing} setSwing={setSwing} />
      <AutomationEditor grid={grid} />
    </div>;
}
