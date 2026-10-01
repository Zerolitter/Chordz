"use client";
import {DraftInput} from "./draft-field";
import { useEffect, useState } from "react";
import { useStudio } from "./use-studio";
import { Meter, PanelHeading, Range } from "./primitives";
import { trackDisplayColor } from "../../lib/client/appearance";
import { useKnobModulation } from "./use-knob-modulation";
import "./mixer-panel.css";

export function MixerPanel() {
  const s = useStudio();
  const configLocked = s.recordingPhase !== "idle";
  const effective = useKnobModulation(s.project.tracks.map(track => track.id));
  const [meters, setMeters] = useState<{
    master: number;
    tracks: Record<string, number>;
  }>({ master: 0, tracks: {} });
  useEffect(() => {
    if(s.mode!=="mix")return;
    const timer = setInterval(
      () => setMeters(s.engine?.meter() ?? { master: 0, tracks: {} }),
      100,
    );
    return () => clearInterval(timer);
  }, [s.engine,s.mode]);
  return (
    <div className="mix-panel">
      <PanelHeading
        title="Mixer"
      ><span className="tiny">{s.project.tracks.length} channels · stereo output</span></PanelHeading>
      <div className="mixer-scroll">
        <div className="mixer-channels">
          {s.project.tracks.map((track, index) => (
            <section
              className={
                "mixer-channel " +
                (track.id === s.selectedTrackId ? "selected" : "")
              }
              key={track.id}
              style={{ "--track-color": trackDisplayColor(s.project, track) } as React.CSSProperties}
            >
              <span className="channel-number mono">{String(index + 1).padStart(2, "0")}</span>
              <button
                className="channel-title"
                onClick={() => s.selectTrack(track.id)}
              >
                {track.name}
              </button>
              <div className="channel-buttons">
                <button
                  disabled={configLocked}
                  aria-label={"Mixer mute " + track.name}
                  aria-pressed={track.mute}
                  className={track.mute ? "on" : ""}
                  onClick={() => s.updateTrack(track.id, { mute: !track.mute })}
                >
                  M
                </button>
                <button
                  disabled={configLocked}
                  aria-label={"Mixer solo " + track.name}
                  aria-pressed={track.solo}
                  className={track.solo ? "on" : ""}
                  onClick={() => s.updateTrack(track.id, { solo: !track.solo })}
                >
                  S
                </button>
              </div>
              <Range
                variant="knob" size="small" defaultValue={0}
                trackId={track.id} modulationTarget="track.pan" effectiveValue={effective(track,"track.pan")}
                modulationRange={effective.range(track,"track.pan")}
                label={track.name + " pan"}
                displayLabel="Pan"
                min={-1}
                max={1}
                value={track.pan}
                onChange={(v) =>
                  s.updateTrack(track.id, { pan: v }, "Pan track")
                }
                format={(v) =>
                  v === 0
                    ? "C"
                    : Math.round(Math.abs(v) * 100) + (v < 0 ? " L" : " R")
                }
              />
              <div className="fader">
                <DraftInput
                  disabled={configLocked}
                  aria-label={track.name + " volume"}
                  type="range"
                  min={-60}
                  max={6}
                  step={0.1}
                  value={track.volume}
                  onChange={(e) =>
                    s.updateTrack(
                      track.id,
                      { volume: Number(e.target.value) },
                      "Mix volume",
                    )
                  }
                />
                <Meter
                  value={meters.tracks[track.id] ?? 0}
                  label={track.name + " level"}
                  vertical
                />
              </div>
              <output className="mono">{track.volume.toFixed(1)} dB</output>
              <Range
                variant="knob" size="small" defaultValue={0}
                trackId={track.id} modulationTarget="track.reverb" effectiveValue={effective(track,"track.reverb")}
                modulationRange={effective.range(track,"track.reverb")}
                label={track.name + " reverb"}
                displayLabel="Reverb"
                value={track.reverb}
                onChange={(v) =>
                  s.updateTrack(track.id, { reverb: v }, "Reverb send")
                }
              />
              <Range
                variant="knob" size="small" defaultValue={0}
                trackId={track.id} modulationTarget="track.delay" effectiveValue={effective(track,"track.delay")}
                modulationRange={effective.range(track,"track.delay")}
                label={track.name + " delay"}
                displayLabel="Delay"
                value={track.delay}
                onChange={(v) =>
                  s.updateTrack(track.id, { delay: v }, "Delay send")
                }
              />
            </section>
          ))}
          <section className="mixer-channel master-channel">
            <h3>Master</h3>
            <div className="fader">
              <DraftInput
                disabled={configLocked}
                aria-label="Master volume"
                type="range"
                min={-30}
                max={6}
                step={0.1}
                value={s.project.master.volume}
                onChange={(e) =>
                  s.edit(
                    (p) => ({
                      ...p,
                      master: { ...p.master, volume: Number(e.target.value) },
                    }),
                    "Master volume",
                  )
                }
              />
              <Meter value={meters.master} label="Master level" vertical />
            </div>
            <output className="mono">
              {s.project.master.volume.toFixed(1)} dB
            </output>
            <label className="checkbox-label">
              <DraftInput
                disabled={configLocked}
                type="checkbox"
                checked={s.project.master.limiter}
                onChange={(e) =>
                  s.edit(
                    (p) => ({
                      ...p,
                      master: { ...p.master, limiter: e.target.checked },
                    }),
                    "Master limiter",
                  )
                }
              />
              Limiter
            </label>
            <Range
              variant="knob" size="small" defaultValue={2.4}
              label="Reverb decay"
              min={0.2}
              max={8}
              value={s.project.master.reverbDecay}
              onChange={(v) =>
                s.edit(
                  (p) => ({ ...p, master: { ...p.master, reverbDecay: v } }),
                  "Reverb decay",
                )
              }
              unit=" s"
            />
          </section>
        </div>
      </div>
      {s.selectedTrack && (
        <section className="channel-effects">
          <div className="subheading">
            <h3>{s.selectedTrack.name} <span>EQ & saturation</span></h3>
          </div>
          <div className="effects-row">
            {(["low", "mid", "high"] as const).map((p) => (
              <Range
                variant="knob" defaultValue={0}
                modulationTarget={`track.${p}`} effectiveValue={effective(s.selectedTrack!,`track.${p}`)}
                modulationRange={effective.range(s.selectedTrack!,`track.${p}`)}
                key={p}
                label={p[0].toUpperCase() + p.slice(1) + " EQ"}
                min={-18}
                max={18}
                step={0.1}
                value={s.selectedTrack![p]}
                onChange={(v) =>
                  s.updateTrack(s.selectedTrack!.id, { [p]: v }, "Track EQ")
                }
                unit=" dB"
              />
            ))}
            <Range
              variant="knob" defaultValue={0}
              label="Saturation"
              value={s.selectedTrack.drive}
              onChange={(v) =>
                s.updateTrack(
                  s.selectedTrack!.id,
                  { drive: v },
                  "Track saturation",
                )
              }
            />
          </div>
        </section>
      )}
    </div>
  );
}
