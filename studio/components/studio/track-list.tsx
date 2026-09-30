"use client";
import {DraftInput} from "./draft-field";
import {
  Headphones,
  Music2,
  Plus,
  AudioLines,
  ChevronDown,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useStudio } from "./use-studio";
import {
  instrumentFor,
  instruments,
  instrumentSettings,
} from "../../lib/audio/catalog";
import {SoundReadiness} from "./sound-readiness";
import { IconButton, Modal } from "./primitives";

export function TrackList() {
  const s = useStudio();
  const [soundsOpen, setSoundsOpen] = useState(false),
    [adding, setAdding] = useState(false),
    [query, setQuery] = useState("");
  const catalog = instruments(s.project);
  const selected = s.selectedTrack;
  function choose(id: string) {
    const instrument = catalog.find((i) => i.id === id)!;
    if (adding) {
      s.addTrack(id, instrument.name);
    } else if (selected) {
      s.updateTrack(
        selected.id,
        {
          instrumentId: id,
          name: instrument.name,
          sound: instrumentSettings(instrument),
        },
        "Change instrument",
      );
    }
    setSoundsOpen(false);
  }
  return (
    <aside className="track-sidebar" aria-label="Song tracks">
      <div className="sidebar-heading">
        <div>
          <span className="eyebrow">Your ensemble</span>
          <h2>
            Tracks <span>{s.project.tracks.length}</span>
          </h2>
        </div>
        <IconButton
          label="Add instrument track"
          disabled={s.recording}
          onClick={() => {
            setAdding(true);
            setSoundsOpen(true);
          }}
        >
          <Plus size={19} />
        </IconButton>
      </div>
      <div className="track-rows">
        {s.project.tracks.map((track, index) => (
          <div
            key={track.id}
            className={
              "track-row " + (track.id === s.selectedTrackId ? "selected" : "")
            }
            style={{ "--track-color": track.color } as React.CSSProperties}
          >
            <button
              className="track-select"
              onClick={() => s.selectTrack(track.id)}
              aria-label={"Select " + track.name}
            >
              <span className="track-number mono">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="track-icon">
                {track.kind === "audio" ? (
                  <AudioLines size={18} />
                ) : (
                  <Music2 size={18} />
                )}
              </span>
              <span className="track-text">
                <strong>{track.name}</strong>
                <small>
                  {track.kind === "audio"
                    ? "Audio take"
                    : instrumentFor(s.project, track).family}
                </small>
              </span>
            </button>
            <div className="track-switches">
              <button
                aria-label={"Mute " + track.name}
                aria-pressed={track.mute}
                className={track.mute ? "on" : ""}
                onClick={() =>
                  s.updateTrack(track.id, { mute: !track.mute }, "Mute track")
                }
              >
                M
              </button>
              <button
                aria-label={"Solo " + track.name}
                aria-pressed={track.solo}
                className={track.solo ? "on" : ""}
                onClick={() =>
                  s.updateTrack(track.id, { solo: !track.solo }, "Solo track")
                }
              >
                S
              </button>
            </div>
          </div>
        ))}
      </div>
      {selected && (
        <div className="selected-instrument">
          <div className="eyebrow">Selected sound</div>
          <button
            className="instrument-select"
            onClick={() => {
              setAdding(false);
              setSoundsOpen(true);
            }}
            disabled={selected.kind === "audio"}
          >
            <Headphones size={19} />
            <span>
              {selected.kind === "audio"
                ? "Recorded audio"
                : instrumentFor(s.project, selected).name}
            </span>
            <ChevronDown size={16} />
          </button>
          <SoundReadiness/>
          <div className="selected-track-actions">
            <button
              className="text-button"
              onClick={() =>
                s.setMode(selected.kind === "audio" ? "mix" : "sound")
              }
            >
              Edit {selected.kind === "audio" ? "mix" : "sound"}
            </button>
            <IconButton
              label="Remove selected track"
              onClick={() => {
                s.edit(
                  (p) => ({
                    ...p,
                    tracks: p.tracks.filter((t) => t.id !== selected.id),
                  }),
                  "Remove track",
                );
                s.selectTrack(
                  s.project.tracks.find((t) => t.id !== selected.id)?.id ?? "",
                );
              }}
            >
              <Trash2 size={15} />
            </IconButton>
          </div>
        </div>
      )}
      <div className="sidebar-foot">
        <span className="tiny">
          {s.project.key} {s.project.mode.replace("-", " ")}
        </span>
        <span className="tiny">{s.project.sections.length} sections</span>
      </div>
      <Modal
        open={soundsOpen}
        onClose={() => setSoundsOpen(false)}
        title={adding ? "Build your ensemble" : "Choose an instrument"}
        description="Recorded acoustic instruments and editable synthesis. Sounds load when you play them."
        wide
      >
        <DraftInput
          className="search-input"
          aria-label="Search instruments"
          placeholder="Find a sound…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="sound-browser">
          {catalog
            .filter((i) =>
              (i.name + " " + i.family)
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((instrument) => (
              <button
                key={instrument.id}
                onClick={() => choose(instrument.id)}
                className="sound-choice"
              >
                <span className="sound-choice-icon">
                  <Music2 size={23} />
                </span>
                <strong>{instrument.name}</strong>
                <small>
                  {instrument.family} ·{" "}
                  {instrument.kind === "sample"
                    ? "Sampled"
                    : instrument.kind === "drums"
                      ? "Drum machine"
                      : "Synthesizer"}
                </small>
                <p>{instrument.description}</p>
                <span className="tiny">
                  {instrument.articulations.includes("short")
                    ? "Sustain + short articulations"
                    : instrument.kind === "sample"
                      ? `${instrument.zones.length} sample zones`
                      : "Deep synthesis controls"}
                </span>
              </button>
            ))}
        </div>
      </Modal>
    </aside>
  );
}
