"use client";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Copy, Dice5, LockKeyhole, Play, Plus, Trash2, Unlock } from "lucide-react";
import { useStudio, useTransport } from "./use-studio";
import { Meter } from "./primitives";
import { RackText } from "./modulation-field";
import { DawKnob } from "./daw-knob";
import { ModulationSourceCard } from "./modulation-source-card";
import { ChordMovementControls } from "./chord-movement-controls";
import { ReferencePanel } from "./reference-panel";
import { DEFAULT_CHORD_MOVEMENT } from "../../lib/music/chord-movement";
import { instrumentFor } from "../../lib/audio/catalog";
import { emptyPatch, makeSource, compileModulation, ModulationEvaluator, applyModTarget, type ModSample } from "../../lib/audio/modulation";
import { automationValue, compileSong } from "../../lib/audio/compile";
import { MACRO_IDS, MOD_TARGETS, modulationIssues, type ModRoute, type ModSource, type ModTarget, type ModulationPatch } from "../../lib/music/modulation-types";
import { clamp, uid, type SoundSettings } from "../../lib/music/types";
import { clipboardTrackPatchSchema, storedSoundPresetSchema, trackPatchSchema, type TrackPatch } from "../../lib/music/track-patch";
import { knobModulationBounds } from "../../lib/client/knob-modulation";
import "./modulation-rack.css";

type StoredPreset = { name: string; patch: TrackPatch };
type RuntimeSample = ModSample & { seconds: number; effectiveTargets?: Readonly<Partial<Record<ModTarget, number>>> };
const SOURCE_MIME = "application/x-chordz-mod-source";
const PRESET_KEY = "chordz-modulation-presets-v1";
const builtins = [
  ...MACRO_IDS.map(id => [id, id] as const), ["velocity", "Velocity"], ["key", "Key / pitch"],
  ["modulation", "MIDI mod wheel"], ["expression", "MIDI expression"], ["pressure", "MIDI pressure"], ["pitchBend", "MIDI pitch bend"],
] as readonly (readonly [string, string])[];

function patchFor(track: NonNullable<ReturnType<typeof useStudio>["selectedTrack"]>): TrackPatch {
  return structuredClone({ sound: track.sound, modulation: track.modulation ?? emptyPatch(), chordMovement: track.chordMovement ?? DEFAULT_CHORD_MOVEMENT });
}
function formatValue(value: number, unit = "") { return `${value.toFixed(Math.abs(value) >= 100 ? 0 : 2)}${unit ? ` ${unit}` : ""}`; }
function targetDepth(target: ModTarget) { return target.startsWith("source:") ? target.endsWith(":rate") ? 3 : 1 : MOD_TARGETS[target as keyof typeof MOD_TARGETS].depth; }
function targetUnit(target: ModTarget, kind: "value" | "depth") {
  if (target.startsWith("source:")) return target.endsWith(":rate") ? kind === "depth" ? "oct" : "Hz" : "";
  const descriptor = MOD_TARGETS[target as keyof typeof MOD_TARGETS];
  return kind === "value" && descriptor.scale === "log" ? "Hz" : descriptor.unit;
}
function targetName(target: ModTarget, patch: ModulationPatch) {
  if (!target.startsWith("source:")) return MOD_TARGETS[target as keyof typeof MOD_TARGETS]?.label ?? target;
  const [, id, parameter] = target.split(":");
  return `${patch.sources.find(source => source.id === id)?.name ?? id} · ${parameter}`;
}
function baseValue(target: ModTarget, patch: TrackPatch, track: NonNullable<ReturnType<typeof useStudio>["selectedTrack"]>, tick: number, tempo: number) {
  const parameter = target.split(".")[1];
  if (target.startsWith("track.")) {
    if (parameter === "cutoff") return automationValue(track, "cutoff", tick, patch.sound.cutoff);
    if (parameter === "resonance") return patch.sound.resonance;
    if (parameter === "gain") return 0;
    const base = track[parameter as "pan" | "low" | "mid" | "high" | "reverb" | "delay"];
    return automationValue(track, parameter, tick, base);
  }
  if (target.startsWith("voice.")) {
    if (parameter === "pitch" || parameter === "gain") return 0;
    return patch.sound[parameter as "cutoff" | "resonance" | "fmRatio" | "fmIndex" | "attack" | "decay" | "sustain" | "release"];
  }
  const [, id, sourceParameter] = target.split(":");
  const source = patch.modulation.sources.find(source => source.id === id);
  return sourceParameter === "rate" && source?.sync ? tempo / 60 / source.division : source?.[sourceParameter as "rate" | "amplitude"] ?? 0;
}

export function ModulationRack() {
  const s = useStudio(), transport = useTransport(), track = s.selectedTrack;
  const macroPerformance = s.recordingPhase === "count-in" || s.recordingPhase === "capturing";
  const [assignSource, setAssignSource] = useState("M1"), [assignTarget, setAssignTarget] = useState<ModTarget>("track.cutoff"), [selectedTarget, setSelectedTarget] = useState<ModTarget>("track.cutoff");
  const [cc, setCc] = useState(74), [ccChannel, setCcChannel] = useState("all"), [error, setError] = useState("");
  const [presetWarning, setPresetWarning] = useState("");
  const [presets, setPresets] = useState<StoredPreset[]>([]), [presetName, setPresetName] = useState(""), [presetSelection, setPresetSelection] = useState("");
  const [staging, setStaging] = useState(false), [abSlot, setAbSlot] = useState<"A" | "B">("A"), [locks, setLocks] = useState({ sound: true, movement: true, sourceRates: false, routeDepths: false });
  const snapshots = useRef<{ trackId: string; A: TrackPatch; B: TrackPatch } | null>(null), previousTrack = useRef(track?.id), output = useRef(0);
  const [meter, setMeter] = useState(0);
  const [runtimeSample, setRuntimeSample] = useState<{ trackId: string; sample: RuntimeSample } | null>(null);
  const owner = `modulation-ab:${track?.id ?? "none"}`;
  useEffect(() => { let active = true; queueMicrotask(() => { if (!active) return; try { const parsed = JSON.parse(localStorage.getItem(PRESET_KEY) ?? "[]"); if (!Array.isArray(parsed)) { setPresetWarning("Saved sound patches could not be read. You can still shape and copy patches."); return; } const checked = parsed.slice(0, 64).map(preset => storedSoundPresetSchema.safeParse(preset)); setPresets(checked.flatMap(result => result.success ? [result.data] : [])); if (checked.some(result => !result.success)) setPresetWarning("Some saved sound patches are invalid and were skipped."); } catch { setPresetWarning("Preset storage is unavailable. You can still shape and copy patches."); } }); return () => { active = false; }; }, []);
  useEffect(() => { const interval = setInterval(() => { const id = track?.id ?? "", next = s.engine?.meter().tracks[id] ?? 0; if (Math.abs(next - output.current) > .005) { output.current = next; setMeter(next); } const sample = s.engine?.modulationSample(id); setRuntimeSample(sample ? { trackId: id, sample } : null); }, 100); return () => clearInterval(interval); }, [s.engine, track?.id]);
  useEffect(() => { if (previousTrack.current !== track?.id) { previousTrack.current = track?.id; snapshots.current = null; queueMicrotask(() => { setStaging(false); setAbSlot("A"); setError(""); }); } }, [track?.id]);
  const patch = track ? patchFor(track) : null;
  const trackId = track?.id;
  const modulation = useMemo(() => track?.modulation ?? emptyPatch(), [track?.modulation]);
  const performanceMacros = s.performanceMacros;
  const displayedModulation = useMemo(() => macroPerformance ? { ...modulation, macros: performanceMacros } : modulation, [modulation, macroPerformance, performanceMacros]);
  const controlEvents = useMemo(() => trackId ? compileSong(s.project, trackId).events.filter(event => event.trackId === trackId).map(event => ({ ...event, seconds: event.tick * 60 / (s.project.tempo * 960) })) : [], [s.project, trackId]);
  const controlLanes = useMemo(() => (track?.automation ?? []).filter(lane => [...MACRO_IDS, "modulation", "expression", "pressure", "pitchBend"].includes(lane.parameter)).map(lane => ({ id: lane.parameter, points: lane.points.map(point => ({ seconds: point.tick * 60 / (s.project.tempo * 960), value: point.value })) })), [track?.automation, s.project.tempo]);
  const evaluator = useMemo(() => trackId ? new ModulationEvaluator(compileModulation(displayedModulation, trackId, s.project.tempo, controlEvents, controlLanes)) : null, [displayedModulation, trackId, s.project.tempo, controlEvents, controlLanes]);
  const previewEvaluation = useMemo<ModSample>(() => {
    if (!evaluator) return { sources: {}, targets: {} };
    const seconds = transport.tick * 60 / (s.project.tempo * 960);
    return evaluator.sample(seconds, { key: "ui-middle-c", pitch: 60, velocity: .75, start: 0 });
  }, [evaluator, s.project.tempo, transport.tick]);
  const nativeSample = runtimeSample?.trackId === trackId ? runtimeSample.sample : null;
  const evaluation = nativeSample ?? previewEvaluation;
  const effectiveTick = nativeSample ? nativeSample.seconds * s.project.tempo * 960 / 60 : transport.tick;
  useEffect(() => { if (staging && s.transaction?.owner !== owner) { snapshots.current = null; queueMicrotask(() => setStaging(false)); } }, [staging, s.transaction?.owner, owner]);
  if (!track || !patch) return null;
  const instrument = instrumentFor(s.project, track), configurationDisabled = s.recordingPhase !== "idle";
  const activeOwner = s.transaction?.owner;
  const stageOwner = activeOwner && (activeOwner.startsWith("modulation-ab:") || activeOwner.startsWith("reference-") || activeOwner.startsWith("reference:")) && s.ownsEdit(activeOwner) ? activeOwner : undefined;
  const sourceOptions = [...builtins.map(([id, label]) => [id, id.startsWith("M") ? `${id} · ${modulation.macroNames[Number(id[1]) - 1]}` : label]), ...modulation.sources.map(source => [source.id, source.name]), [`cc:${ccChannel}:${cc}`, `MIDI CC ${cc} · ${ccChannel === "all" ? "all channels" : `channel ${Number(ccChannel) + 1}`}`]];
  const targets = [...Object.keys(MOD_TARGETS), ...modulation.sources.flatMap(source => source.kind === "envelope" ? [`source:${source.id}:amplitude`] : [`source:${source.id}:rate`, `source:${source.id}:amplitude`])] as ModTarget[];
  function available(target: ModTarget) {
    if (target.startsWith("source:")) return "";
    const descriptor = MOD_TARGETS[target as keyof typeof MOD_TARGETS];
    if (descriptor.scope === "voice" && track!.kind === "audio") return "Instrument tracks only";
    if (descriptor.synthOnly && instrument.kind !== "synth") return "Synth instruments only";
    if (target.startsWith("voice.fm") && patch!.sound.algorithm !== "fm") return "Select the FM engine";
    return "";
  }
  function update(next: ModulationPatch, label = "Edit modulation") {
    if (configurationDisabled) return;
    const issues = modulationIssues(next);
    if (issues.length) { setError(issues[0]); return; }
    setError(""); s.updateTrack(track!.id, { modulation: next }, label);
  }
  function updateSource(source: ModSource) { update({ ...modulation, sources: modulation.sources.map(existing => existing.id === source.id ? source : existing) }, "Shape modulation source"); }
  function updateRoute(route: ModRoute) { update({ ...modulation, routes: modulation.routes.map(existing => existing.id === route.id ? route : existing) }, "Edit modulation route"); }
  function addRoute(sourceId = assignSource, target = assignTarget) {
    if (!s.finishGesture()) return;
    if (modulation.routes.length >= 32) { setError("This rack supports 32 routes. Remove a route before adding another."); return; }
    const unavailable = available(target); if (unavailable) { setError(unavailable); return; }
    const next = { ...modulation, enabled: true, routes: [...modulation.routes, { id: uid(), sourceId, target, amount: targetDepth(target) * .1, curve: "linear" as const, slew: .01, enabled: true }] };
    update(next, "Assign modulation"); setSelectedTarget(target);
  }
  function dragStart(event: DragEvent, sourceId: string) { event.dataTransfer.setData(SOURCE_MIME, sourceId); event.dataTransfer.setData("application/x-chordz-track-id", track!.id); event.dataTransfer.effectAllowed = "copy"; }
  function drop(event: DragEvent, target: ModTarget) { event.preventDefault(); const sourceId = event.dataTransfer.getData(SOURCE_MIME), origin = event.dataTransfer.getData("application/x-chordz-track-id"); if (origin && origin !== track!.id) { setError("Choose a source from this track before assigning it."); return; } if (sourceOptions.some(([id]) => id === sourceId)) addRoute(sourceId, target); }
  function applyPatch(next: unknown, label: string) {
    if (configurationDisabled || !s.finishGesture()) return;
    const result = trackPatchSchema.safeParse(next); if (!result.success) { setError("This sound patch is invalid or incompatible. Choose another patch."); return; }
    setError("");
    s.updateTrack(track!.id, result.data, label);
  }
  function startCompare() {
    if (!s.beginEdit(owner)) return;
    snapshots.current = { trackId: track!.id, A: patchFor(track!), B: patchFor(track!) }; setAbSlot("A"); setStaging(true);
  }
  function switchCompare(slot: "A" | "B") {
    if (!snapshots.current || !s.ownsEdit(owner) || !s.finishGesture()) return;
    snapshots.current[abSlot] = patchFor(track!); applyPatch(snapshots.current[slot], "Compare sound patch"); setAbSlot(slot);
  }
  function finishCompare(keep: boolean) { if (keep ? s.finishEdit(owner) : s.cancelEdit(owner)) { snapshots.current = null; setStaging(false); } }
  function savePreset() {
    const name = presetName.trim(); if (!name) { setError("Name the patch before saving it."); return; }
    const next = [...presets.filter(preset => preset.name !== name), { name: name.slice(0, 80), patch: patchFor(track!) }].slice(-64);
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(next)); setPresets(next); setPresetSelection(`user:${name}`); setError(""); s.notify("Sound patch saved on this device."); } catch { setError("Preset storage is unavailable. Copy the patch to keep it."); }
  }
  async function copyPatch() { try { await navigator.clipboard.writeText(JSON.stringify({ chordzPatch: 1, ...patchFor(track!) })); s.notify("Sound patch copied."); } catch { setError("Clipboard access is unavailable in this browser."); } }
  async function pastePatch() {
    try { const result = clipboardTrackPatchSchema.safeParse(JSON.parse(await navigator.clipboard.readText())); if (!result.success) throw new Error("The clipboard does not contain a valid Chordz sound patch."); const { sound, modulation, chordMovement } = result.data; applyPatch({ sound, modulation, chordMovement }, "Paste sound patch"); } catch (problem) { setError(problem instanceof Error ? problem.message : "This patch could not be pasted."); }
  }
  function loadStarter(name: string) {
    if (!s.finishGesture()) return;
    const next = emptyPatch(s.project.seed), source = makeSource("lfo", uid(), "track");
    source.name = name === "pulse" ? "Pulse" : name === "drift" ? "Stereo drift" : "Filter bloom";
    source.sync = true; source.division = name === "pulse" ? .5 : name === "drift" ? 8 : 16;
    source.shape = name === "pulse" ? "square" : "sine";
    source.amplitude = .5;
    next.enabled = true; next.sources = [source];
    next.macroNames = ["Motion", "Tone", "Space", "Air"];
    next.routes = [
      { id: uid(), sourceId: source.id, target: name === "pulse" ? "track.gain" : name === "drift" ? "track.pan" : "track.cutoff", amount: name === "pulse" ? -24 : name === "drift" ? 1.2 : 3, curve: "linear", slew: .02, enabled: true },
      { id: uid(), sourceId: "M1", target: `source:${source.id}:amplitude`, amount: .5, curve: "linear", slew: .02, enabled: true },
      { id: uid(), sourceId: "M2", target: "track.cutoff", amount: 2, curve: "linear", slew: .02, enabled: true },
      { id: uid(), sourceId: "M3", target: "track.reverb", amount: .6, curve: "linear", slew: .02, enabled: true },
      { id: uid(), sourceId: "M4", target: "track.high", amount: 6, curve: "linear", slew: .02, enabled: true },
    ];
    update(next, "Load motion starter");
  }
  function vary() {
    let seed = (modulation.seed + 1) >>> 0;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const next = { ...modulation, seed: (modulation.seed + 1) % 2147483647, sources: modulation.sources.map(source => locks.sourceRates ? source : { ...source, rate: clamp(source.rate * (.7 + random() * .6), .01, 30), phase: random(), amplitude: .3 + random() * .7 }), routes: modulation.routes.map(route => locks.routeDepths ? route : { ...route, amount: clamp(route.amount * (.6 + random() * .8), -targetDepth(route.target), targetDepth(route.target)) }) };
    const movement = locks.movement ? patch!.chordMovement : { ...patch!.chordMovement, inversion: Math.floor(random() * 5) - 2, spread: Math.floor(random() * 3), gate: .3 + random() * .6, swing: random() * .35, seed: next.seed };
    const sound = locks.sound ? patch!.sound : { ...patch!.sound, cutoff: 200 + random() * 10000, resonance: random() * 5, detune: (random() - .5) * 24 };
    applyPatch({ sound, modulation: next, chordMovement: movement }, "Vary sound and movement");
  }
  const stagePolicy = stageOwner ? "bypass" : undefined;
  const selectedParameter = selectedTarget.split(".")[1];
  const selectedDescriptor = !selectedTarget.startsWith("source:") ? MOD_TARGETS[selectedTarget as keyof typeof MOD_TARGETS] : undefined;
  const editableBase = selectedDescriptor && !available(selectedTarget) && (selectedTarget.startsWith("voice.") && !["gain", "pitch"].includes(selectedParameter) || ["track.cutoff", "track.resonance"].includes(selectedTarget));
  const settled = (action: () => void) => { if (s.finishGesture()) action(); };
  const effective = (target: ModTarget) => {
    const nativeValue = nativeSample?.effectiveTargets?.[target];
    if (nativeValue !== undefined) return nativeValue;
    const base = baseValue(target, patch, track, effectiveTick, s.project.tempo);
    return target.startsWith("source:") ? evaluation.sourceParameters?.[target] ?? base : applyModTarget(target, base, Number(evaluation.targets[target] ?? 0));
  };
  return <section className="modulation-rack" aria-label="Selected track modulation rack">
    <div className="mod-rack-header" data-edit-policy={stagePolicy}>
      <div className="mod-rack-title"><h2>Modulation</h2><span className="mod-runtime-state" title={nativeSample ? "Graphs and effective values follow the audio engine." : "Playhead preview at middle C and 75% velocity. Audition to follow sounding notes."}>{nativeSample ? "Live" : "Preview"}</span></div>
      <div className="mod-rack-tools">
        <button className="secondary-button" disabled={configurationDisabled} onClick={() => { if (s.selectedNotes.length) void s.audition(s.selectedNotes, 4); else void s.audition(s.project.chords.find(chord => chord.sectionId === s.selectedSection.id)?.notes ?? [60, 64, 67], 4); }}><Play size={14} />Audition chord</button>
        <Meter value={meter} label="Selected track output" />
        <label className="check-label"><input type="checkbox" checked={modulation.enabled} disabled={configurationDisabled} onChange={event => settled(() => update({ ...modulation, enabled: event.target.checked }, "Bypass modulation rack"))} />Rack enabled</label>
      </div>
    </div>
    <div className="mod-presets" data-edit-policy={stagePolicy}>
      <label className="field">Patch<select aria-label="Sound patch preset" value={presetSelection} disabled={configurationDisabled} onChange={event => { const name = event.target.value; if (!s.finishGesture()) return; setPresetSelection(name); if (name.startsWith("starter:")) loadStarter(name.slice(8)); else { const preset = presets.find(item => `user:${item.name}` === name); if (preset) applyPatch(preset.patch, "Load sound patch"); } }}><option value="">Choose a starter or saved patch</option><optgroup label="Motion starters"><option value="starter:pulse">Sync pulse</option><option value="starter:drift">Wide drift</option><option value="starter:bloom">Slow bloom</option></optgroup>{!!presets.length && <optgroup label="On this device">{presets.map(preset => <option key={preset.name} value={`user:${preset.name}`}>{preset.name}</option>)}</optgroup>}</select></label>
      <button className="secondary-button" disabled={configurationDisabled || staging} onClick={startCompare}>Compare A/B</button>
      {staging && <div className="mod-ab" data-edit-policy="bypass"><button aria-pressed={abSlot === "A"} onClick={() => switchCompare("A")}>A</button><button aria-pressed={abSlot === "B"} onClick={() => switchCompare("B")}>B</button><button className="text-button" onClick={() => settled(() => { if (snapshots.current) snapshots.current[abSlot === "A" ? "B" : "A"] = patchFor(track); })}>Copy {abSlot} → {abSlot === "A" ? "B" : "A"}</button><button className="primary-button" onClick={() => finishCompare(true)}>Use {abSlot}</button><button className="secondary-button" onClick={() => finishCompare(false)}>Cancel comparison</button></div>}
      <details className="mod-patch-actions"><summary>Patch actions</summary><div className="mod-action-menu"><button className="secondary-button" disabled={configurationDisabled} onClick={() => settled(() => void copyPatch())}><Copy size={14} />Copy patch</button><button className="secondary-button" disabled={configurationDisabled} onClick={() => settled(() => void pastePatch())}>Paste patch</button><input aria-label="Preset name" placeholder="Patch name" maxLength={80} value={presetName} onChange={event => setPresetName(event.target.value)} /><button className="secondary-button" disabled={configurationDisabled} onClick={() => settled(savePreset)}>Save on device</button></div></details>
    </div>
    {staging && <p className="mod-staged-message" role="status">Comparing {abSlot} · Use {abSlot} keeps one edit; Cancel restores the starting patch.</p>}
    <div className="mod-macros" data-edit-policy="bypass">{MACRO_IDS.map((macroId, index) => <div key={macroId} className="mod-macro">
      <div className="macro-label"><span draggable={!configurationDisabled} onDragStart={event => dragStart(event, macroId)}>{macroId}</span><RackText label={`${macroId} name`} value={modulation.macroNames[index]} maxLength={40} stageOwner={stageOwner} disabled={configurationDisabled} onChange={name => { const names = [...modulation.macroNames] as ModulationPatch["macroNames"]; names[index] = name; update({ ...modulation, macroNames: names }, "Rename macro"); }} /></div>
      <DawKnob size="small" displayLabel={macroPerformance ? "Perform" : "Amount"} label={macroPerformance ? `${macroId} performance` : `${macroId} amount`} value={macroPerformance ? s.performanceMacros[index] : modulation.macros[index]} min={0} max={1} step={.01} defaultValue={0} stageOwner={stageOwner} performance={macroPerformance} disabled={configurationDisabled && !macroPerformance} effectiveValue={evaluation.sources[macroId]} onChange={value => { if (macroPerformance) s.performMacro(index, value); else { const macros = [...modulation.macros] as ModulationPatch["macros"]; macros[index] = value; update({ ...modulation, macros }, "Move macro"); } }} />
      <button className="text-button" disabled={configurationDisabled} aria-pressed={assignSource === macroId} onClick={() => setAssignSource(macroId)}>Assign {macroId}</button>
    </div>)}</div>
    <fieldset disabled={configurationDisabled} data-edit-policy={stagePolicy}>
      <div className={`mod-workspace${modulation.sources.length ? "" : " mod-workspace-empty"}`}>
        <div className="mod-sources-panel">
          <div className="mod-section-title"><h3>Sources <span className="tiny">{modulation.sources.length}/8</span></h3><select aria-label="Add modulation source" value="" disabled={modulation.sources.length >= 8} onChange={event => { const kind = event.target.value; if (!kind) return; const text = event.target.selectedOptions[0].text; settled(() => { const source = makeSource(kind as ModSource["kind"], uid()); source.name = `${text} ${modulation.sources.length + 1}`; update({ ...modulation, enabled: true, sources: [...modulation.sources, source] }, "Add modulation source"); setAssignSource(source.id); }); }}><option value="">+ Add source</option><option value="lfo">LFO</option><option value="envelope">Envelope</option><option value="random">Seeded random</option><option value="step">Step sequencer</option><option value="reference">Reference curve</option></select></div>
          <div className="mod-source-grid">{modulation.sources.map(source => <ModulationSourceCard key={source.id} source={source} state={evaluation.sourceStates?.[source.id]} trackId={track.id} seed={modulation.seed} stageOwner={stageOwner} disabled={configurationDisabled} audioTrack={track.kind === "audio"} selected={assignSource === source.id} rangeFor={(target, base) => knobModulationBounds(modulation, target, base)} onChange={updateSource} onAssign={() => setAssignSource(source.id)} onDragStart={dragStart} onDelete={() => settled(() => { update({ ...modulation, sources: modulation.sources.filter(item => item.id !== source.id), routes: modulation.routes.filter(route => route.sourceId !== source.id && !route.target.startsWith(`source:${source.id}:`)) }, "Remove modulation source"); if (assignSource === source.id) setAssignSource("M1"); })} />)}</div>
          {!modulation.sources.length && <div className="mod-source-empty"><span>No sources</span><span className="tiny">Add a source above, or route a macro or MIDI controller.</span></div>}
        </div>
        <aside className="mod-matrix" aria-label="Modulation matrix">
          <div className="mod-section-title"><h3>Matrix <span className="tiny">{modulation.routes.length}/32</span></h3><span className="tiny">Drag to a knob, or Assign.</span></div>
          <div className="mod-assign"><label className="field">Source<select aria-label="Route source" value={assignSource} onChange={event => setAssignSource(event.target.value)}>{sourceOptions.map(([sourceId, label]) => <option key={sourceId} value={sourceId}>{label}</option>)}</select></label><label className="field">Destination<select aria-label="Route destination" value={assignTarget} onChange={event => setAssignTarget(event.target.value as ModTarget)}>{targets.map(target => <option key={target} value={target} disabled={!!available(target)}>{targetName(target, modulation)}{available(target) ? ` · ${available(target)}` : ""}</option>)}</select></label><button className="primary-button" onClick={() => addRoute()} disabled={modulation.routes.length >= 32}><Plus size={14} />Assign</button></div>
          <details className="mod-midi-inspector"><summary>MIDI CC source</summary><div className="mod-inline-fields"><label>CC<input aria-label="Modulation MIDI CC" type="number" min={0} max={119} value={cc} onChange={event => { const value = clamp(Math.round(Number(event.target.value)), 0, 119); setCc(value); setAssignSource(`cc:${ccChannel}:${value}`); }} /></label><label>Channel<select aria-label="Modulation MIDI channel" value={ccChannel} onChange={event => { setCcChannel(event.target.value); setAssignSource(`cc:${event.target.value}:${cc}`); }}><option value="all">All</option>{Array.from({ length: 16 }, (_, channel) => <option key={channel} value={channel}>{channel + 1}</option>)}</select></label><button className="secondary-button" onClick={() => { if (s.midiLearning) s.cancelMidiLearn(); else void s.beginMidiLearn((number, channel) => { setCc(number); setCcChannel(String(channel)); setAssignSource(`cc:${channel}:${number}`); }); }}>{s.midiLearning ? "Cancel MIDI learn" : "Learn CC"}</button></div></details>
          <div className="mod-route-list">{modulation.routes.map(route => <article key={route.id} tabIndex={0} aria-label={`${route.sourceId} to ${targetName(route.target, modulation)} route`} onKeyDown={event => { if (event.key === "Delete" && event.target === event.currentTarget) { event.preventDefault(); settled(() => update({ ...modulation, routes: modulation.routes.filter(item => item.id !== route.id) }, "Remove modulation route")); } }} className={`mod-route ${route.target === selectedTarget ? "highlighted" : ""}`}>
            <div className="mod-route-top"><label className="check-label"><input aria-label={`Enable route ${route.id}`} type="checkbox" checked={route.enabled} onChange={event => settled(() => updateRoute({ ...route, enabled: event.target.checked }))} />On</label><button className="mod-route-title" onClick={() => { setSelectedTarget(route.target); setAssignTarget(route.target); }}><span>{sourceOptions.find(([sourceId]) => sourceId === route.sourceId)?.[1] ?? route.sourceId}</span><strong>→ {targetName(route.target, modulation)}</strong></button><button className="text-button" aria-label={`Delete route ${route.id}`} onClick={() => settled(() => update({ ...modulation, routes: modulation.routes.filter(item => item.id !== route.id) }, "Remove modulation route"))}><Trash2 size={14} /></button></div>
            <div className="mod-route-controls"><DawKnob size="small" displayLabel="Depth" label={`Depth to ${targetName(route.target, modulation)}`} min={-targetDepth(route.target)} max={targetDepth(route.target)} step={targetDepth(route.target) > 100 ? 1 : .01} unit={targetUnit(route.target, "depth")} defaultValue={0} value={route.amount} stageOwner={stageOwner} disabled={configurationDisabled} onChange={amount => updateRoute({ ...route, amount })} /><details><summary>Route settings</summary><div className="mod-route-settings"><label className="field">Source<select aria-label={`Source for ${targetName(route.target, modulation)}`} value={route.sourceId} onChange={event => settled(() => updateRoute({ ...route, sourceId: event.target.value }))}>{!sourceOptions.some(([sourceId]) => sourceId === route.sourceId) && <option value={route.sourceId}>{route.sourceId}</option>}{sourceOptions.map(([sourceId, label]) => <option key={sourceId} value={sourceId}>{label}</option>)}</select></label><label className="field">Destination<select aria-label={`Destination for route ${route.id}`} value={route.target} onChange={event => settled(() => { const target = event.target.value as ModTarget; updateRoute({ ...route, target, amount: clamp(route.amount, -targetDepth(target), targetDepth(target)) }); })}>{targets.map(target => <option key={target} value={target} disabled={!!available(target)}>{targetName(target, modulation)}</option>)}</select></label><label className="field">Curve<select aria-label={`Curve for route ${route.id}`} value={route.curve} onChange={event => settled(() => updateRoute({ ...route, curve: event.target.value as ModRoute["curve"] }))}><option value="linear">Linear</option><option value="exponential">Exponential</option></select></label><DawKnob size="small" displayLabel="Smooth" label={`Smoothing for route ${route.id}`} min={0} max={.5} step={.01} defaultValue={.01} value={route.slew} unit="s" stageOwner={stageOwner} disabled={configurationDisabled} onChange={slew => updateRoute({ ...route, slew })} /><button className="text-button" aria-label={`Duplicate route ${route.id}`} disabled={modulation.routes.length >= 32} onClick={() => settled(() => update({ ...modulation, routes: [...modulation.routes, { ...route, id: uid() }] }, "Duplicate modulation route"))}><Copy size={13} />Duplicate</button></div></details></div>
            {available(route.target) && <span className="mod-route-warning">Inactive: {available(route.target)}. Route retained.</span>}
          </article>)}</div>
          <details className="mod-destination-browser"><summary>All destinations</summary><div className="mod-destinations">{targets.map(target => { const reason = available(target), count = modulation.routes.filter(route => route.target === target).length; return <button key={target} className={selectedTarget === target ? "selected" : ""} disabled={!!reason} title={reason || "Select or drop a source here"} onClick={() => { setSelectedTarget(target); setAssignTarget(target); }} onDragOver={event => { if (event.dataTransfer.types.includes(SOURCE_MIME) && !reason) event.preventDefault(); }} onDrop={event => drop(event, target)}><strong>{targetName(target, modulation)}</strong><span className="mono">{formatValue(effective(target), targetUnit(target, "value"))}</span><span className="tiny">{reason || `${count} routes`}</span></button>; })}</div></details>
          {editableBase && selectedDescriptor && <details className="mod-base-details"><summary>Base parameter <span className="tiny">{targetName(selectedTarget, modulation)}</span></summary><div className="mod-base-inspector"><DawKnob size="small" displayLabel="Base" label={`${selectedDescriptor.label} base`} min={selectedDescriptor.min} max={selectedDescriptor.max} step={selectedParameter === "cutoff" ? 1 : .01} unit={selectedParameter === "cutoff" ? "Hz" : selectedDescriptor.unit} log={selectedDescriptor.scale === "log"} value={patch.sound[selectedParameter as keyof SoundSettings] as number} effectiveValue={effective(selectedTarget)} modulationRange={knobModulationBounds(modulation, selectedTarget, baseValue(selectedTarget, patch, track, effectiveTick, s.project.tempo))} modulationTarget={selectedTarget} trackId={track.id} stageOwner={stageOwner} disabled={configurationDisabled} onChange={value => s.updateTrack(track.id, { sound: { ...track.sound, [selectedParameter]: value } }, "Shape base sound")} /><span className="tiny">{targetName(selectedTarget, modulation)}<br />{formatValue(effective(selectedTarget), targetUnit(selectedTarget, "value"))} effective</span></div></details>}
        </aside>
      </div>
      <details className="mod-vary-inspector"><summary>Vary & locks <span className="tiny">seed {modulation.seed}</span></summary><div className="mod-vary"><button className="secondary-button" onClick={vary}><Dice5 size={14} />Vary</button>{Object.entries(locks).map(([key, locked]) => <button key={key} className="mod-lock" aria-pressed={locked} onClick={() => setLocks(current => ({ ...current, [key]: !locked }))}>{locked ? <LockKeyhole size={13} /> : <Unlock size={13} />}{({ sound: "Sound", movement: "Movement", sourceRates: "Sources", routeDepths: "Depths" } as Record<string, string>)[key]}</button>)}<button className="text-button" onClick={() => settled(() => update(emptyPatch(s.project.seed), "Reset modulation rack"))}>Reset rack</button><span className="tiny">Levels, instrument, tempo and notes stay fixed.</span></div></details>
    </fieldset>
    <details className="movement-inspector"><summary>Live & generated chord movement</summary><ChordMovementControls value={track.chordMovement ?? DEFAULT_CHORD_MOVEMENT} stageOwner={stageOwner} live disabled={configurationDisabled || track.kind === "audio"} onChange={chordMovement => s.updateTrack(track.id, { chordMovement }, "Shape chord movement")} /></details>
    <details className="mod-reference-inspector"><summary>Reference audio <span className="tiny">Analyze sound & movement</span></summary><ReferencePanel /></details>
    {error && <p className="action-error" role="alert">{error}</p>}{!error && presetWarning && <p className="action-error" role="alert">{presetWarning}</p>}
  </section>;
}
