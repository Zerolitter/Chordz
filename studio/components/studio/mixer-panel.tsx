"use client";
import {DraftInput} from "./draft-field";
import { useEffect, useState } from "react";
import { useStudio } from "./use-studio";
import { Meter, PanelHeading, Range } from "./primitives";

export function MixerPanel() {
  const s = useStudio();
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
        eyebrow="Every part, in its place"
        title="Make it feel finished."
      />
      <div className="mixer-scroll">
        <div className="mixer-channels">
          {s.project.tracks.map((track) => (
            <section
              className={
                "mixer-channel " +
                (track.id === s.selectedTrackId ? "selected" : "")
              }
              key={track.id}
              style={{ "--track-color": track.color } as React.CSSProperties}
            >
              <button
                className="channel-title"
                onClick={() => s.selectTrack(track.id)}
              >
                {track.name}
              </button>
              <div className="channel-buttons">
                <button
                  aria-label={"Mixer mute " + track.name}
                  aria-pressed={track.mute}
                  className={track.mute ? "on" : ""}
                  onClick={() => s.updateTrack(track.id, { mute: !track.mute })}
                >
                  M
                </button>
                <button
                  aria-label={"Mixer solo " + track.name}
                  aria-pressed={track.solo}
                  className={track.solo ? "on" : ""}
                  onClick={() => s.updateTrack(track.id, { solo: !track.solo })}
                >
                  S
                </button>
              </div>
              <Range
                label={track.name + " pan"}
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
                label={track.name + " reverb"}
                value={track.reverb}
                onChange={(v) =>
                  s.updateTrack(track.id, { reverb: v }, "Reverb send")
                }
              />
              <Range
                label={track.name + " delay"}
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
            <h3>{s.selectedTrack.name} · tone & effects</h3>
            <span className="tiny">Shared reverb & tempo-synced delay</span>
          </div>
          <div className="effects-row">
            {(["low", "mid", "high"] as const).map((p) => (
              <Range
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
