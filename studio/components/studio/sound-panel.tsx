"use client";
import {DraftInput} from "./draft-field";
import { useState } from "react";
import { useStudio } from "./use-studio";
import { PanelHeading, Range, frequencyLabel } from "./primitives";
import {SoundReadiness} from "./sound-readiness";
import { instrumentFor, instrumentSettings,isDrumInstrument } from "../../lib/audio/catalog";
import {
  clamp,
  type SoundSettings,
  type SampleZone,
} from "../../lib/music/types";

export function SoundPanel() {
  const s = useStudio(),
    track = s.selectedTrack;
  const [bend, setBend] = useState(0),
    [expression, setExpression] = useState(1),
    [modulation, setModulation] = useState(0);
  if (track?.kind === "audio")
    return (
      <div>
        <PanelHeading eyebrow="Recorded audio" title={track.name} />
        <p className="helper">
          Edit waveforms, trims and fades in Arrange, then balance this take in
          Mix.
        </p>
        <button className="primary-button" onClick={() => s.setMode("arrange")}>
          Open arrangement
        </button>
      </div>
    );
  if (!track)
    return (
      <div className="empty-state">Add an instrument to shape its sound.</div>
    );
  const sound = track.sound,
    instrument = instrumentFor(s.project, track);
  function change(update: Partial<SoundSettings>) {
    s.updateTrack(track!.id, t=>({...t,sound:{...t.sound,...update}}), "Shape sound");
  }
  function zone(index: number, update: Partial<SampleZone>) {
    s.edit(
      (p) => ({
        ...p,
        userInstruments: p.userInstruments.map((i) =>
          i.id === instrument.id
            ? {
                ...i,
                zones: i.zones.map((z, n) =>
                  n === index ? { ...z, ...update } : z,
                ),
              }
            : i,
        ),
      }),
      "Map sample",
    );
  }
  return (
    <div className="sound-panel">
      <PanelHeading eyebrow={instrument.family} title={track.name}>
        <button
          className="secondary-button"
          onClick={() =>
            s.updateTrack(
              track.id,
              { sound: instrumentSettings(instrument) },
              "Reset preset",
            )
          }
        >
          Reset sound
        </button>
      </PanelHeading>
      <label className="field">
        Track name
        <DraftInput
          aria-label="Track name"
          value={track.name}
          onChange={(e) =>
            s.updateTrack(track.id, { name: e.target.value }, "Rename track")
          }
        />
      </label>
      <SoundReadiness/>
      <p className="sound-description">{instrument.description}</p>
      <p className="helper">Tune while auditioning. Oscillator mode, attack, decay and sample articulation apply on the next note.</p>
      <div className="sound-modules">
        <section>
          <h3>
            {instrument.kind === "sample" ? "Performance" : "Oscillators"}
          </h3>
          {instrument.kind === "synth" && (
            <>
              <label className="field">
                Engine
                <select
                  aria-label="Synthesis engine"
                  value={sound.algorithm}
                  onChange={(e) =>
                    change({
                      algorithm: e.target.value as SoundSettings["algorithm"],
                    })
                  }
                >
                  <option value="subtractive">Subtractive · unison</option>
                  <option value="fm">Frequency modulation</option>
                </select>
              </label>
              {sound.algorithm==="subtractive"&&<label className="field">
                Waveform
                <select
                  aria-label="Oscillator waveform"
                  value={sound.wave}
                  onChange={(e) =>
                    change({ wave: e.target.value as SoundSettings["wave"] })
                  }
                >
                  {["sine", "triangle", "sawtooth", "square"].map((w) => (
                    <option key={w}>{w}</option>
                  ))}
                </select>
              </label>
              }
              {sound.algorithm === "fm" && (
                <>
                  <Range
                    label="FM ratio"
                    min={0.25}
                    max={16}
                    value={sound.fmRatio}
                    onChange={(v) => change({ fmRatio: v })}
                  />
                  <Range
                    label="FM depth"
                    min={0}
                    max={20}
                    value={sound.fmIndex}
                    onChange={(v) => change({ fmIndex: v })}
                  />
                </>
              )}
            </>
          )}
          {instrument.articulations.length>1&&<label className="field">
            Articulation
            <select
              aria-label="Instrument articulation"
              value={sound.articulation}
              onChange={(e) => change({ articulation: e.target.value })}
            >
              {!instrument.articulations.includes(sound.articulation)&&<option value={sound.articulation}>Unavailable · {sound.articulation} (kept)</option>}
              {instrument.articulations.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          }
          {instrument.kind!=="drums"&&<Range
            label="Detune"
            min={-50}
            max={50}
            step={1}
            value={sound.detune}
            onChange={(v) => change({ detune: v })}
            unit=" cents"
          />
          }
          {instrument.kind!=="drums"&&<Range
            label="Pitch bend"
            min={-1}
            max={1}
            value={bend}
            onChange={(v) => {
              setBend(v);
              s.expression("pitchBend", v);
            }}
          />
          }
          <Range
            label="Expression"
            value={expression}
            onChange={(v) => {
              setExpression(v);
              s.expression("expression", v);
            }}
          />
          {!isDrumInstrument(instrument)&&<button
            className="secondary-button"
            onPointerDown={() => s.expression("sustain", 1)}
            onPointerUp={() => s.expression("sustain", 0)}
            onPointerLeave={() => s.expression("sustain", 0)}
          >
            Hold sustain pedal
          </button>}
        </section>
        {!isDrumInstrument(instrument)&&<section>
          <h3>Amplitude envelope</h3>
          <svg
            className="envelope-visual"
            viewBox="0 0 260 80"
            aria-hidden="true"
          >
            <path
              d={`M5 75 L${25 + sound.attack * 20} 8 L120 ${75 - sound.sustain * 65} L180 ${75 - sound.sustain * 65} L250 75`}
            />
          </svg>
          {(["attack", "decay", "sustain", "release"] as const).map(
            (parameter) => (
              <Range
                key={parameter}
                label={parameter[0].toUpperCase() + parameter.slice(1)}
                min={
                  parameter === "sustain"
                    ? 0
                    : parameter === "release"
                      ? 0.01
                      : 0.001
                }
                max={
                  parameter === "sustain" ? 1 : parameter === "release" ? 8 : 4
                }
                log={parameter !== "sustain"}
                value={sound[parameter]}
                onChange={(v) => change({ [parameter]: v })}
                unit={parameter === "sustain" ? "" : " s"}
              />
            ),
          )}
        </section>
        }
        <section>
          <h3>Filter & movement</h3>
          <Range
            label="Filter cutoff"
            min={40}
            max={18000}
            log
            value={sound.cutoff}
            onChange={(v) => change({ cutoff: v })}
            format={frequencyLabel}
          />
          <Range
            label="Resonance"
            min={0.1}
            max={20}
            value={sound.resonance}
            onChange={(v) => change({ resonance: v })}
          />
          {instrument.kind==="synth"&&<Range
            label="Filter envelope"
            min={0}
            max={1}
            value={sound.filterEnvelope}
            onChange={(v) => change({ filterEnvelope: v })}
          />
          }
          <Range
            label="LFO rate"
            min={0.05}
            max={20}
            log
            value={sound.lfoRate}
            onChange={(v) => change({ lfoRate: v })}
            unit=" Hz"
          />
          <Range
            label="LFO depth"
            value={sound.lfoDepth}
            onChange={(v) => change({ lfoDepth: v })}
          />
          <Range
            label="Modulation"
            value={modulation}
            onChange={(v) => {
              setModulation(v);
              s.expression("modulation", v);
            }}
          />
        </section>
      </div>
      {instrument.kind === "sample" && (
        <section className="sample-map">
          <div className="subheading">
            <h3>Sample mapping</h3>
            <span className="tiny">
              {instrument.zones.length} zones · {instrument.license}
            </span>
          </div>
          <p className="helper">
            {s.project.userInstruments.some((i) => i.id === instrument.id)
              ? "Edit note ranges, velocity layers, and sustain loops for your recordings."
              : "Curated velocity layers and round-robin variations. Samples download when this instrument is played."}
          </p>
          <div className="mapping-scroll">
            <table>
              <thead>
                <tr>
                  <th>Sample</th>
                  <th>Root</th>
                  <th>Low</th>
                  <th>High</th>
                  <th>Velocity</th>
                  <th>Articulation</th>
                  <th>Loop start / end (s)</th>
                </tr>
              </thead>
              <tbody>
                {instrument.zones.map((z, i) => {
                  const editable = !!z.assetId;
                  return (
                    <tr key={i}>
                      <td>
                        {z.assetId
                          ? s.project.assets.find((a) => a.id === z.assetId)
                              ?.name
                          : z.url?.split("/").at(-1)}
                      </td>
                      {(["root", "low", "high"] as const).map((p) => (
                        <td key={p}>
                          {editable ? (
                            <DraftInput
                              aria-label={`Sample ${i + 1} ${p}`}
                              type="number"
                              min={0}
                              max={127}
                              value={z[p]}
                              onChange={(e) =>
                                zone(i, {
                                  [p]: clamp(Number(e.target.value), 0, 127),
                                })
                              }
                            />
                          ) : (
                            z[p]
                          )}
                        </td>
                      ))}
                      <td>
                        {editable ? (
                          <div className="inline-inputs">
                            <DraftInput
                              aria-label="Velocity layer minimum"
                              type="number"
                              min={0}
                              max={1}
                              step={0.01}
                              value={z.velocityLow}
                              onChange={(e) =>
                                zone(i, {
                                  velocityLow: clamp(
                                    Number(e.target.value),
                                    0,
                                    1,
                                  ),
                                })
                              }
                            />
                            <DraftInput
                              aria-label="Velocity layer maximum"
                              type="number"
                              min={0}
                              max={1}
                              step={0.01}
                              value={z.velocityHigh}
                              onChange={(e) =>
                                zone(i, {
                                  velocityHigh: clamp(
                                    Number(e.target.value),
                                    0,
                                    1,
                                  ),
                                })
                              }
                            />
                          </div>
                        ) : (
                          `${Math.round(z.velocityLow * 127)}–${Math.round(z.velocityHigh * 127)}`
                        )}
                      </td>
                      <td>{z.articulation}</td>
                      <td>
                        {editable ? (
                          <div className="inline-inputs">
                            <DraftInput
                              aria-label="Sample loop start"
                              type="number"
                              min={0}
                              step={0.01}
                              value={z.loopStart ?? 0}
                              onChange={(e) =>
                                zone(i, {
                                  loopStart: Math.max(
                                    0,
                                    Number(e.target.value),
                                  ),
                                })
                              }
                            />
                            <DraftInput
                              aria-label="Sample loop end"
                              type="number"
                              min={0}
                              step={0.01}
                              value={z.loopEnd ?? 0}
                              onChange={(e) =>
                                zone(i, {
                                  loopEnd: Math.max(0, Number(e.target.value)),
                                })
                              }
                            />
                          </div>
                        ) : (
                          z.loopStart?.toFixed(2) +
                          " / " +
                          z.loopEnd?.toFixed(2)
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
