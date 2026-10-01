"use client";
import {DraftInput} from "./draft-field";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { useStudio } from "./use-studio";
import { PanelHeading, Range, frequencyLabel } from "./primitives";
import {SoundReadiness} from "./sound-readiness";
import { ModulationRack, type SoundPanelSection } from "./modulation-rack";
import { ToolVisibilityProvider, useToolInputTermination, useToolVisibility } from "./tool-visibility";
import { useKnobModulation } from "./use-knob-modulation";
import { SourceGraphEditor } from "./source-graph-editor";
import { makeSource } from "../../lib/audio/modulation";
import { instrumentFor, instrumentSettings,isDrumInstrument } from "../../lib/audio/catalog";
import {
  clamp,
  type SoundSettings,
  type SampleZone,
} from "../../lib/music/types";

export function releaseSoundPanelInputs(studio: Pick<ReturnType<typeof useStudio>, "releaseSource">) { studio.releaseSource("sound:sustain"); }

export function SoundPanel({ active = true, section, onOpenMovement }: { active?: boolean; section?: SoundPanelSection; onOpenMovement?: () => void } = {}) {
  const soundVisible = active && (!section || section === "sound");
  return <div className="sound-panel">
    <ToolVisibilityProvider active={soundVisible}><div hidden={!soundVisible}><InstrumentSoundBody onOpenMovement={onOpenMovement} /></div></ToolVisibilityProvider>
    <ModulationRack active={active} section={section} />
  </div>;
}

function InstrumentSoundBody({ onOpenMovement }: { onOpenMovement?: () => void }) {
  const s = useStudio(),
    track = s.selectedTrack;
  const active = useToolVisibility();
  const sustainHeld = useRef(false);
  const pedalPointer = useRef<{ id: number; element: HTMLButtonElement } | null>(null);
  function pressSustain() { if (!active || sustainHeld.current) return; sustainHeld.current = true; s.expression("sustain", 1, "sound:sustain"); }
  function endSustain() {
    if (sustainHeld.current) { sustainHeld.current = false; releaseSoundPanelInputs(s); }
    const pointer = pedalPointer.current; pedalPointer.current = null;
    if (pointer?.element.hasPointerCapture(pointer.id)) pointer.element.releasePointerCapture(pointer.id);
  }
  useToolInputTermination(endSustain);
  const releaseSustain = useEffectEvent(endSustain);
  useLayoutEffect(() => { if (!active) releaseSustain(); }, [active]);
  useEffect(() => () => releaseSustain(), []);
  const [bend, setBend] = useState(0),
    [expression, setExpression] = useState(1),
    [modulation, setModulation] = useState(0);
  const effective = useKnobModulation(track ? [track.id] : [], active);
  const configLocked = s.recordingPhase !== "idle";
  if (track?.kind === "audio")
    return (
      <div>
        <PanelHeading eyebrow="Recorded audio" title={track.name}>{onOpenMovement && <button data-edit-policy="bypass" className="secondary-button" onClick={onOpenMovement}>Movement</button>}</PanelHeading>
        <p className="helper">
          Edit waveforms, trims and fades in Arrange, then balance this take in
          Mix.
        </p>
        <button data-edit-policy="bypass" className="primary-button" onClick={() => s.setMode("arrange")}>
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
  const defaults = instrumentSettings(instrument);
  const envelope = { ...makeSource("envelope", "instrument-envelope", "voice"), name: "Instrument envelope", attack: sound.attack, decay: sound.decay, sustain: sound.sustain, release: sound.release };
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
    <div className="instrument-sound-body">
      <PanelHeading eyebrow={instrument.family} title={instrument.name}>
        <button
          data-edit-policy="bypass"
          disabled={configLocked}
          className="secondary-button"
          onClick={() => { if (!s.finishGesture()) return;
            s.updateTrack(
              track.id,
              { sound: instrumentSettings(instrument) },
              "Reset preset",
            ); }}
        >
          Reset sound
        </button>
        {onOpenMovement && <button data-edit-policy="bypass" className="secondary-button" onClick={onOpenMovement}>Movement</button>}
      </PanelHeading>
      <div className="sound-instrument-header"><label className="field">
        Track name
        <DraftInput
          disabled={configLocked}
          aria-label="Track name"
          value={track.name}
          onChange={(e) =>
            s.updateTrack(track.id, { name: e.target.value }, "Rename track")
          }
        />
      </label>
      <div><SoundReadiness/>
      <p className="sound-description">{instrument.description}</p>
      </div><span className="sound-next-notes" title="Envelope timing, synthesis engine and articulation changes apply when a note starts.">Envelope, engine & articulation · next notes</span></div>
      <div className="sound-modules" key={track.id} data-edit-policy="bypass">
        <section className="sound-device sound-performance">
          <h3>
            {instrument.kind === "sample" ? "Performance" : "Oscillators"}
          </h3>
          {instrument.kind === "synth" && (
            <>
              <label className="field">
                Engine
                <select
                  disabled={configLocked}
                  aria-label="Synthesis engine"
                  value={sound.algorithm}
                  onChange={(e) => { if (!s.finishGesture()) return;
                    change({
                      algorithm: e.target.value as SoundSettings["algorithm"],
                    }); }}
                >
                  <option value="subtractive">Subtractive · unison</option>
                  <option value="fm">Frequency modulation</option>
                </select>
              </label>
              {sound.algorithm==="subtractive"&&<label className="field">
                Waveform
                <select
                  disabled={configLocked}
                  aria-label="Oscillator waveform"
                  value={sound.wave}
                  onChange={(e) => { if (s.finishGesture()) change({ wave: e.target.value as SoundSettings["wave"] }); }}
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
                    variant="knob"
                    label="FM ratio"
                    min={0.1}
                    max={20}
                    defaultValue={defaults.fmRatio}
                    modulationTarget="voice.fmRatio"
                    effectiveValue={effective(track,"voice.fmRatio")}
                    modulationRange={effective.range(track,"voice.fmRatio")}
                    value={sound.fmRatio}
                    onChange={(v) => change({ fmRatio: v })}
                  />
                  <Range
                    variant="knob"
                    label="FM depth"
                    min={0}
                    max={30}
                    defaultValue={defaults.fmIndex}
                    modulationTarget="voice.fmIndex"
                    effectiveValue={effective(track,"voice.fmIndex")}
                    modulationRange={effective.range(track,"voice.fmIndex")}
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
              disabled={configLocked}
              aria-label="Instrument articulation"
              value={sound.articulation}
              onChange={(e) => { if (s.finishGesture()) change({ articulation: e.target.value }); }}
            >
              {!instrument.articulations.includes(sound.articulation)&&<option value={sound.articulation}>Unavailable · {sound.articulation} (kept)</option>}
              {instrument.articulations.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          }
          {instrument.kind!=="drums"&&<Range
            variant="knob"
            label="Detune"
            min={-1200}
            max={1200}
            defaultValue={defaults.detune}
            step={1}
            value={sound.detune}
            onChange={(v) => change({ detune: v })}
            unit=" cents"
          />
          }
          {instrument.kind!=="drums"&&<Range
            variant="knob" performance defaultValue={0}
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
            variant="knob" performance defaultValue={1}
            label="Expression"
            value={expression}
            onChange={(v) => {
              setExpression(v);
              s.expression("expression", v);
            }}
          />
          {!isDrumInstrument(instrument)&&<button
            className="secondary-button sound-module-note"
            onPointerDown={event => { if (!active) return; pedalPointer.current = { id: event.pointerId, element: event.currentTarget }; event.currentTarget.setPointerCapture(event.pointerId); pressSustain(); }}
            onPointerUp={endSustain}
            onPointerCancel={endSustain}
            onLostPointerCapture={endSustain}
            onBlur={endSustain}
            onKeyDown={event => { if (["Enter"," "].includes(event.key)) { event.preventDefault(); event.stopPropagation(); if (!event.repeat) pressSustain(); } }}
            onKeyUp={event => { if (["Enter"," "].includes(event.key)) { event.preventDefault(); event.stopPropagation(); endSustain(); } }}
          >
            Hold sustain pedal
          </button>}
        </section>
        {!isDrumInstrument(instrument)&&<section className="sound-device sound-amplitude">
          <h3>Amplitude envelope</h3>
          <div className="instrument-envelope-graph"><SourceGraphEditor source={envelope} trackId={track.id} seed={s.project.seed} disabled={configLocked}
            onChange={source => change({ attack: source.attack, decay: source.decay, sustain: source.sustain, release: source.release })} /></div>
          {(["attack", "decay", "sustain", "release"] as const).map(
            (parameter) => (
              <Range
                variant="knob"
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
                  parameter === "sustain" ? 1 : parameter === "release" ? 15 : 10
                }
                step={parameter === "sustain" ? .01 : .001}
                defaultValue={defaults[parameter]}
                modulationTarget={`voice.${parameter}`}
                effectiveValue={effective(track,`voice.${parameter}`)}
                modulationRange={effective.range(track,`voice.${parameter}`)}
                log={parameter !== "sustain"}
                value={sound[parameter]}
                onChange={(v) => change({ [parameter]: v })}
                unit={parameter === "sustain" ? "" : " s"}
              />
            ),
          )}
        </section>
        }
        <section className="sound-device sound-filter">
          <h3>Filter & modulation</h3>
          <Range
            variant="knob"
            label="Filter cutoff"
            min={20}
            max={20000}
            step={1}
            defaultValue={defaults.cutoff}
            modulationTargets={instrument.kind === "synth" ? ["track.cutoff","voice.cutoff"] : ["track.cutoff"]}
            effectiveValue={effective(track,"track.cutoff")}
            modulationRange={effective.range(track,"track.cutoff")}
            log
            value={sound.cutoff}
            onChange={(v) => change({ cutoff: v })}
            format={frequencyLabel}
          />
          <Range
            variant="knob"
            label="Resonance"
            min={0}
            max={24}
            defaultValue={defaults.resonance}
            modulationTargets={instrument.kind === "synth" ? ["track.resonance","voice.resonance"] : ["track.resonance"]}
            effectiveValue={effective(track,"track.resonance")}
            modulationRange={effective.range(track,"track.resonance")}
            value={sound.resonance}
            onChange={(v) => change({ resonance: v })}
          />
          {instrument.kind==="synth"&&<Range
            variant="knob" defaultValue={defaults.filterEnvelope}
            label="Filter envelope"
            min={0}
            max={1}
            value={sound.filterEnvelope}
            onChange={(v) => change({ filterEnvelope: v })}
          />
          }
          <Range
            variant="knob" defaultValue={defaults.lfoRate}
            label="LFO rate"
            min={0}
            max={30}
            value={sound.lfoRate}
            onChange={(v) => change({ lfoRate: v })}
            unit=" Hz"
          />
          <Range
            variant="knob" defaultValue={defaults.lfoDepth}
            label="LFO depth"
            value={sound.lfoDepth}
            onChange={(v) => change({ lfoDepth: v })}
          />
          <Range
            variant="knob" performance defaultValue={0}
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
        <details className="sample-map sound-sample-inspector">
          <summary>
            <span>Sample mapping</span>
            <span className="tiny">
              {instrument.zones.length} zones · {instrument.license}
            </span>
          </summary>
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
                  const editable = !!z.assetId && !configLocked;
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
        </details>
      )}
    </div>
  );
}
