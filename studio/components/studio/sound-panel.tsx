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
import { DEFAULT_SOUND } from "../../lib/music/project";
import {
  clamp,
  type SoundSettings,
  type SampleZone,
  type Track,
} from "../../lib/music/types";

export function releaseSoundPanelInputs(studio: Pick<ReturnType<typeof useStudio>, "releaseSource">) { studio.releaseSource("sound:sustain"); }

export function SoundPanel({ active = true, section, onOpenMovement }: { active?: boolean; section?: SoundPanelSection; onOpenMovement?: () => void } = {}) {
  const soundVisible = active && (!section || section === "sound");
  return <div className="sound-panel">
    <div className="sound-workspace">
      <ToolVisibilityProvider active={soundVisible}><div className="sound-devices" hidden={!soundVisible}><InstrumentSoundBody onOpenMovement={onOpenMovement} /></div></ToolVisibilityProvider>
      <ModulationRack active={active} section={section} />
    </div>
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
  if (!track)
    return (
      <div className="empty-state">Add an instrument to shape its sound.</div>
    );
  const sound = track.sound;
  function change(update: Partial<SoundSettings>) {
    s.updateTrack(track!.id, t=>({...t,sound:{...t.sound,...update}}), "Shape sound");
  }
  if (track.kind === "audio") {
    const region = s.selectedClip?.audio ? s.selectedClip : track.clips.find(clip => clip.audio);
    return <div className="instrument-sound-body audio-sound-body">
      <div className="sound-tuning-row">
        <PanelHeading eyebrow="Audio track" title={track.name}>
          {region && <button data-edit-policy="bypass" className="secondary-button" onClick={() => s.selectClip(track.id, region.id)}>Audio editor</button>}
        </PanelHeading>
        <SoundDetails key={track.id} track={track} description="Track effects shape every audio region. Edit trims and fades in the audio editor." />
      </div>
      <div className="sound-modules sound-audio-modules" key={track.id} data-edit-policy="bypass">
        <section className="sound-device sound-filter">
          <h3>Filter & modulation</h3>
          <TrackFilterControls track={track} defaults={{ ...DEFAULT_SOUND, cutoff: 20000, resonance: 0, lfoDepth: 0 }} effective={effective} change={change} modulation={modulation} onModulation={value => { setModulation(value); s.expression("modulation", value); }} />
        </section>
        <section className="sound-device sound-audio-effects">
          <h3>Effects & sends</h3>
          <Range variant="knob" label="Saturation" defaultValue={0} value={track.drive} onChange={value => s.updateTrack(track.id, { drive: value }, "Track saturation")} />
          <Range variant="knob" label="Reverb" defaultValue={0} trackId={track.id} modulationTarget="track.reverb" effectiveValue={effective(track, "track.reverb")} modulationRange={effective.range(track, "track.reverb")} value={track.reverb} onChange={value => s.updateTrack(track.id, { reverb: value }, "Reverb send")} />
          <Range variant="knob" label="Delay" defaultValue={0} trackId={track.id} modulationTarget="track.delay" effectiveValue={effective(track, "track.delay")} modulationRange={effective.range(track, "track.delay")} value={track.delay} onChange={value => s.updateTrack(track.id, { delay: value }, "Delay send")} />
        </section>
      </div>
    </div>;
  }
  const instrument = instrumentFor(s.project, track);
  const defaults = instrumentSettings(instrument);
  const envelope = { ...makeSource("envelope", "instrument-envelope", "voice"), name: "Instrument envelope", attack: sound.attack, decay: sound.decay, sustain: sound.sustain, release: sound.release };
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
      <div className="sound-tuning-row">
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
        <SoundReadiness />
      </PanelHeading>
      <SoundDetails key={track.id} track={track} description={instrument.description} nextNotes />
      </div>
      <div className="sound-modules" key={track.id} data-edit-policy="bypass">
        <section className="sound-device sound-performance">
          <h3>
            {instrument.kind === "sample" ? "Performance" : "Oscillators"}
          </h3>
          {instrument.kind === "synth" && (
            <>
              <div className="sound-selectors">
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
              </div>
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
            label="Pitch bend" automationParameter="pitchBend"
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
            label="Expression" automationParameter="expression"
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
          <div className="sound-envelope-controls">
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
          </div>
        </section>
        }
        <section className="sound-device sound-filter">
          <h3>Filter & modulation</h3>
          <TrackFilterControls track={track} defaults={defaults} synth={instrument.kind === "synth"} effective={effective} change={change} modulation={modulation} onModulation={value => { setModulation(value); s.expression("modulation", value); }} />
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


function SoundDetails({ track, description, nextNotes = false }: { track: Track; description: string; nextNotes?: boolean }) {
  const s = useStudio();
  function settle() {
    if (!s.finishGesture()) return false;
    if (s.transaction?.invalid) return s.finishEdit(s.transaction.owner);
    const staged = /^(reference[-:]|modulation-ab:|note-transform:)/.test(s.transaction?.owner ?? "");
    return staged || s.finishEdit();
  }
  return <details className="sound-details" onKeyDown={event => {
    if (event.key !== "Escape" || event.defaultPrevented || !event.currentTarget.open) return;
    event.preventDefault(); event.stopPropagation();
    if (!settle()) return;
    event.currentTarget.open = false;
    event.currentTarget.querySelector("summary")?.focus({ preventScroll: true });
  }}>
    <summary data-edit-policy="bypass" onPointerDown={event => {
      if (!settle()) { event.preventDefault(); event.stopPropagation(); }
    }} onClick={event => {
      if (!settle()) { event.preventDefault(); event.stopPropagation(); }
    }}>Sound details</summary>
    <div className="sound-instrument-header">
      <label className="field">Track name<DraftInput disabled={s.recordingPhase !== "idle"} aria-label="Track name" value={track.name} onChange={event => s.updateTrack(track.id, { name: event.target.value }, "Rename track")} /></label>
      <div className="sound-instrument-meta">
        <p className="sound-description">{description}</p>
        {nextNotes && <span className="sound-next-notes" title="Envelope timing, synthesis engine and articulation changes apply when a note starts.">Envelope, engine & articulation · next notes</span>}
      </div>
    </div>
  </details>;
}

function TrackFilterControls({ track, defaults, synth = false, effective, change, modulation, onModulation }: {
  track: Track; defaults: SoundSettings; synth?: boolean; effective: ReturnType<typeof useKnobModulation>;
  change: (update: Partial<SoundSettings>) => void; modulation: number; onModulation: (value: number) => void;
}) {
  return <>
          <Range
            variant="knob"
            label="Filter cutoff"
            min={20}
            max={20000}
            step={1}
            defaultValue={defaults.cutoff}
            modulationTargets={synth ? ["track.cutoff","voice.cutoff"] : ["track.cutoff"]}
            effectiveValue={effective(track,"track.cutoff")}
            modulationRange={effective.range(track,"track.cutoff")}
            log
            value={track.sound.cutoff}
            onChange={(v) => change({ cutoff: v })}
            format={frequencyLabel}
          />
          <Range
            variant="knob"
            label="Resonance"
            min={0}
            max={24}
            defaultValue={defaults.resonance}
            modulationTargets={synth ? ["track.resonance","voice.resonance"] : ["track.resonance"]}
            effectiveValue={effective(track,"track.resonance")}
            modulationRange={effective.range(track,"track.resonance")}
            value={track.sound.resonance}
            onChange={(v) => change({ resonance: v })}
          />
          {synth&&<Range
            variant="knob" defaultValue={defaults.filterEnvelope}
            label="Filter envelope"
            min={0}
            max={1}
            value={track.sound.filterEnvelope}
            onChange={(v) => change({ filterEnvelope: v })}
          />
          }
          <Range
            variant="knob" defaultValue={defaults.lfoRate}
            label="LFO rate"
            min={0}
            max={30}
            value={track.sound.lfoRate}
            onChange={(v) => change({ lfoRate: v })}
            unit=" Hz"
          />
          <Range
            variant="knob" defaultValue={defaults.lfoDepth}
            label="LFO depth"
            value={track.sound.lfoDepth}
            onChange={(v) => change({ lfoDepth: v })}
          />
          <Range
            variant="knob" performance defaultValue={0}
            label="Modulation" automationParameter="modulation"
            value={modulation}
            onChange={onModulation}
          />
  </>;
}
