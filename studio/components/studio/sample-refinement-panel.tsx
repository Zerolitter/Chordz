"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStudio } from "./use-studio";
import { useToolInputTermination, useToolVisibility } from "./tool-visibility";
import { LocalRefinementClient, findSimilarMoments, type RefinementCapabilities, type SeparationTarget } from "../../lib/audio/sample-refinement-client";
import { comparisonGains, contextFor, qualityWarnings, refineSample, residualSample, sampleMetrics, slicePCM, validateSampleRange, type PCM, type SampleRange, type SimilarMoment } from "../../lib/audio/sample-refinement";
import type { ReferenceMetadata } from "../../lib/audio/reference-analysis-data";
import { createRefinedSampleEntry } from "../../lib/music/refined-sample";
import { createProject, createTrack, emptyClip, secondsToTick } from "../../lib/music/project";
import { uid } from "../../lib/music/types";
import type { SampleProvenance } from "../../lib/music/sample-provenance";
import type { LibraryEntry } from "../../lib/music/reusable-library";
import type { StudioEngine } from "../../lib/audio/engine";
import { deleteLibraryEntry, saveLibraryEntry } from "../../lib/client/reusable-library-storage";
import { encodeWav, waveformPeaks } from "../../lib/audio/wav";
import "./sample-refinement-panel.css";

interface Result { source: PCM; context: PCM; extracted: PCM; range: SampleRange; contextRange: SampleRange; model: string; separated: boolean; target: SeparationTarget }
const labels: Record<SeparationTarget, string> = { vocals: "Vocals", drums: "Drums", bass: "Bass", piano: "Piano (experimental)", guitar: "Guitar (experimental)", other: "Other instruments (mixed)" };
const time = (value: number) => `${Math.floor(value / 60)}:${(value % 60).toFixed(1).padStart(4, "0")}`;
function fromBuffer(buffer: AudioBuffer): PCM { return { sampleRate: buffer.sampleRate, channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)) }; }

export function SampleRefinementPanel({ buffer, source, blocked }: { buffer: AudioBuffer; source: ReferenceMetadata; blocked: boolean }) {
  const s = useStudio(), visible = useToolVisibility(), scope = `${s.owner}:${s.project.id}:${source.fingerprint}`;
  const current = useRef({ s, scope }), mounted = useRef(true), job = useRef<AbortController | null>(null), previewIntent = useRef(0);
  useLayoutEffect(() => { current.current = { s, scope }; });
  const preview = useRef<{ engine: StudioEngine; unsubscribe?: () => void } | null>(null);
  const [start, setStart] = useState(0), [end, setEnd] = useState(Math.min(4, source.duration)), [target, setTarget] = useState<SeparationTarget>("other");
  const [token, setToken] = useState(""), [capabilities, setCapabilities] = useState<RefinementCapabilities | null>(null);
  const client = useRef<LocalRefinementClient | null>(null);
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [matches, setMatches] = useState<SimilarMoment[]>([]), [searched, setSearched] = useState(false);
  const [result, setResult] = useState<Result | null>(null), [reduction, setReduction] = useState(3), [choice, setChoice] = useState<"extracted" | "refined">("refined");
  const [heard, setHeard] = useState(false), [reviewed, setReviewed] = useState(false), [singleNote, setSingleNote] = useState(false), [root, setRoot] = useState(60);
  const [name, setName] = useState(source.name.replace(/\.[^.]+$/, "").slice(0, 100) + " sample"), [saved, setSaved] = useState<LibraryEntry | null>(null);
  const disabled = !!busy || blocked || s.recordingPhase !== "idle";
  const model = target === "piano" || target === "guitar" ? "htdemucs_6s" : "htdemucs";
  const ready = capabilities?.models.some(value => value.id === model && value.ready && value.targets.includes(target));
  const range = useMemo(() => ({ startSec: start, endSec: end }), [start, end]);
  const selected = useMemo(() => { try { validateSampleRange(range, buffer.duration); return slicePCM(fromBuffer(buffer), range); } catch { return null; } }, [buffer, range]);
  const peaks = useMemo(() => selected ? waveformPeaks(selected.channels, 240) : [], [selected]);
  const outputs = useMemo(() => {
    if (!result) return null;
    const natural = refineSample(result.extracted, 0), refined = refineSample(result.extracted, result.separated ? reduction : 0);
    const residual = result.separated ? residualSample(result.source, result.extracted) : null;
    const comparisons = [result.source, natural, refined, ...(residual ? [residual] : [])];
    return { natural, refined, residual, comparisons, gains: comparisonGains(comparisons), warnings: result.separated ? qualityWarnings(result.source, result.extracted) : ["No separation was performed. Other instruments may remain in this texture."] };
  }, [result, reduction]);
  const chosen = outputs ? choice === "refined" ? outputs.refined : outputs.natural : null;
  const silent = useMemo(() => chosen ? sampleMetrics(chosen).silent : true, [chosen]);
  function stopPreview() { ++previewIntent.current; const value = preview.current; preview.current = null; value?.unsubscribe?.(); value?.engine.cancelCandidateAudition(); }
  useToolInputTermination(stopPreview);
  function cancel() { job.current?.abort(); stopPreview(); }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; job.current?.abort(); const value = preview.current; value?.unsubscribe?.(); value?.engine.cancelCandidateAudition(); }; }, []);
  useEffect(() => { if (!visible || s.recordingPhase !== "idle") { job.current?.abort(); stopPreview(); } }, [visible, s.recordingPhase]);
  function resetResult() { stopPreview(); setResult(null); setSaved(null); setHeard(false); setReviewed(false); setSingleNote(false); setError(""); setNotice(""); }
  function changeRange(next: SampleRange) { resetResult(); setStart(next.startSec); setEnd(next.endSec); }
  async function run(label: string, work: (controller: AbortController, valid: () => boolean) => Promise<void>) {
    if (disabled) return;
    job.current?.abort(); const controller = new AbortController(); job.current = controller;
    const valid = () => mounted.current && current.current.scope === scope && job.current === controller && !controller.signal.aborted;
    setBusy(label); setError(""); setNotice("");
    try { await work(controller, valid); }
    catch (reason) { if (valid()) setError(reason instanceof Error ? reason.message : "Sample refinement failed. Your source is unchanged."); }
    finally { if (mounted.current && job.current === controller) { job.current = null; setBusy(""); } }
  }
  async function connect() {
    await run("Connecting to local engine", async (controller, valid) => {
      client.current = null; setCapabilities(null);
      const next = new LocalRefinementClient(token.trim()), status = await next.capabilities(controller.signal);
      if (!valid()) return; client.current = next; setCapabilities(status);
      setNotice(status.models.some(value => value.ready) ? "Connected. Only selected excerpts are sent to your computer's loopback engine." : "Connected, but no model is prepared. Follow docs/sample-refinement.md to prepare one; no download happens automatically.");
    });
  }
  async function search() {
    if (!selected) { setError("Select 0.3 to 20 seconds inside the source to search."); return; }
    await run("Finding similar moments", async (controller, valid) => {
      const found = await findSimilarMoments(buffer, range, { signal: controller.signal });
      if (valid()) { setMatches(found); setSearched(true); setNotice(found.length ? "Similar sound and envelope, not guaranteed cleaner. Audition an alternative before extracting it." : "No convincing non-overlapping match was found. Try another source range."); }
    });
  }
  function keepTexture() {
    if (!selected || disabled) return; resetResult();
    const contextRange = contextFor(range, buffer.duration);
    setResult({ source: selected, context: slicePCM(fromBuffer(buffer), contextRange), extracted: selected, range, contextRange, model: "none", separated: false, target });
    setChoice("extracted");
  }
  async function extract() {
    if (!selected || !client.current || !ready) return;
    resetResult();
    await run("Preparing source context", async (controller, valid) => {
      const contextRange = contextFor(range, buffer.duration), original = slicePCM(fromBuffer(buffer), contextRange);
      const extracted = await client.current!.separate(original, target, controller.signal, status => { if (valid()) setBusy(status); });
      if (!valid()) return; setBusy("Checking extracted audio");
      const engine = await current.current.s.getEngine(); if (!valid()) return;
      const decoded = await engine.decode(extracted.blob); if (!valid()) return;
      if (decoded.numberOfChannels !== original.channels.length || decoded.sampleRate !== original.sampleRate || Math.abs(decoded.length - original.channels[0].length) > 2)
        throw Error("The engine changed the channel layout, sample rate or duration. This extraction was rejected.");
      // Derive the crop from absolute frame boundaries: rounding two relative
      // seconds independently can otherwise introduce a one-frame mismatch.
      const first = Math.round(range.startSec * buffer.sampleRate) - Math.round(contextRange.startSec * buffer.sampleRate);
      const frames = selected.channels[0].length;
      const pcm: PCM = { sampleRate: decoded.sampleRate, channels: Array.from({ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel).slice(first, first + frames)) };
      if (pcm.channels[0].length !== frames) throw Error("The extracted sample is shorter than the selection. Choose another range.");
      sampleMetrics(pcm);
      setResult({ source: selected, context: original, extracted: pcm, range, contextRange, model: extracted.model, separated: true, target }); setChoice("refined");
    });
  }
  async function hear(index: number) {
    const pcm = outputs?.comparisons[index] ?? (index === 0 ? selected : null); if (!pcm || disabled || !s.finishEdit()) return;
    stopPreview(); const intent = ++previewIntent.current, expectedScope = scope;
    try {
      const engine = await s.getEngine();
      if (!mounted.current || previewIntent.current !== intent || current.current.scope !== expectedScope || current.current.s.recordingPhase !== "idle") return;
      const gain = outputs?.gains[index] ?? comparisonGains([pcm])[0];
      const blob = new Blob([encodeWav(pcm.channels.map(channel => Float32Array.from(channel, value => value * gain)), pcm.sampleRate)], { type: "audio/wav" });
      const document = createProject("Sample comparison"), track = createTrack("piano", "Sample comparison", undefined, "audio"), assetId = uid();
      Object.assign(track, { volume: 0, reverb: 0, delay: 0 });
      const duration = pcm.channels[0].length / pcm.sampleRate, clip = emptyClip(0, Math.max(1, secondsToTick(duration, 120)), "Sample comparison");
      clip.audio = { assetId, offsetSec: 0, gain: 1, fadeInSec: 0, fadeOutSec: 0 }; track.clips = [clip]; document.tracks = [track]; document.chords = [];
      document.sections[0].lengthTick = clip.lengthTick; document.master = { volume: -3, limiter: true, reverbDecay: .2 };
      document.assets = [{ id: assetId, name: "Comparison.wav", mime: "audio/wav", byteLength: blob.size, duration, sampleRate: pcm.sampleRate, channels: pcm.channels.length }];
      const identity = "refine-" + uid(), value = { engine, unsubscribe: undefined as (() => void) | undefined }; preview.current = value;
      const started = engine.previewSnapshot(document, async () => blob, identity);
      value.unsubscribe = engine.subscribe(state => { if (state.previewId !== identity && preview.current === value) { value.unsubscribe?.(); preview.current = null; } });
      if (await started && mounted.current && previewIntent.current === intent && current.current.scope === expectedScope && index > 0 && index < 3) setHeard(true);
    } catch (reason) { if (mounted.current && current.current.scope === expectedScope) setError(reason instanceof Error ? reason.message : "Sample preview failed."); }
  }
  async function save(kind: "audio" | "sound") {
    if (!result || !chosen || !outputs || !heard || silent || (kind === "sound" && (!reviewed || !singleNote))) return;
    await run("Saving independent sample", async (controller, valid) => {
      const mixed = !result.separated || result.target === "other";
      const provenance: SampleProvenance = { version: 1, sourceName: source.name, sourceFingerprint: source.fingerprint,
        sourceRange: result.range, contextRange: result.contextRange, method: !result.separated ? "trimmed" : choice === "refined" && reduction > 0 ? "refined" : "separated",
        target: result.separated ? result.target : "texture", model: result.model, algorithm: "chordz-refine-1", reductionDb: choice === "refined" && result.separated ? reduction : 0,
        status: mixed ? "mixed-texture" : reviewed ? "approved" : "needs-review", warnings: outputs.warnings };
      const snapshot = createRefinedSampleEntry({ name, output: chosen, original: result.context, provenance, kind, root });
      const owner = s.owner, entry = await saveLibraryEntry(owner, snapshot.entry, snapshot.blobs, { signal: controller.signal });
      if (!valid()) { await deleteLibraryEntry(owner, entry.id); return; }
      setSaved(entry); await current.current.s.refreshReusableLibrary();
      if (valid()) setNotice(kind === "sound" ? "Saved in Sounds. The single sample is mapped seven semitones either side of your chosen root." : "Saved in Ideas as an audio phrase. Its original context and recipe are retained in library backups.");
    });
  }
  return <section className="sample-refinement" aria-label="Sample refinement" aria-busy={!!busy} data-edit-policy="bypass">
    <div className="sample-refinement-heading"><div><p className="eyebrow">Extract · compare · keep</p><h3>Refine a reusable sound</h3></div><span className="sample-quality">{source.channels === 2 ? "Stereo preserved" : "Mono source"}</span></div>
    <p className="helper">Choose a short phrase, note or hit. Separation is optional and local; a mixed excerpt is never advertised as an isolated instrument.</p>
    <div className="sample-refinement-grid">
      <div className="sample-refinement-step"><h4>1. Choose the moment</h4>
        <div className="field-grid"><label className="field">Sample start (seconds)<input aria-label="Sample start" type="number" min={0} step={.1} value={Number.isFinite(start) ? start : ""} disabled={disabled} onChange={event => {setMatches([]);setSearched(false);changeRange({startSec:event.target.value === "" ? NaN : Number(event.target.value),endSec:end});}}/></label>
          <label className="field">Sample end (seconds)<input aria-label="Sample end" type="number" min={0} max={source.duration} step={.1} value={Number.isFinite(end) ? end : ""} disabled={disabled} onChange={event => {setMatches([]);setSearched(false);changeRange({startSec:start,endSec:event.target.value === "" ? NaN : Number(event.target.value)});}}/></label></div>
        <svg viewBox="0 0 480 64" role="img" aria-label="Selected sample waveform"><path d={peaks.map((peak, i) => `M${i * 2} ${32 - peak * 29}v${peak * 58}`).join(" ")} stroke="currentColor"/></svg>
        <p className="helper">0.05–20 seconds. Extraction includes up to two seconds of surrounding context on each side.</p>
        <div className="button-row"><button className="secondary-button" disabled={disabled || !selected} onClick={() => void hear(0)}>Hear source</button><button className="secondary-button" disabled={disabled || !selected || end - start < .3} onClick={() => void search()}>Find similar moments</button></div>
        {searched && matches.length > 0 && <div className="sample-matches" aria-label="Similar sample moments">{matches.map(match => <button key={match.startSec} className="secondary-button" disabled={disabled} onClick={() => changeRange(match)}>{time(match.startSec)}–{time(match.endSec)}<small>{Math.round(match.similarity * 100)}% spectral/envelope match · review overlap</small></button>)}</div>}
      </div>
      <div className="sample-refinement-step"><h4>2. Keep the wanted part</h4>
        <label className="field">Sound to keep<select aria-label="Sound to keep" value={target} disabled={disabled} onChange={event => {resetResult();setTarget(event.target.value as SeparationTarget);}}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {(target === "piano" || target === "guitar") && <p className="helper">The six-stem model is experimental. Bleed and damaged notes are possible; audition carefully.</p>}
        {target === "other" && <p className="helper">Other instruments can still overlap each other. This output stays a mixed texture, not a clean instrument.</p>}
        <div className="button-row"><button className="primary-button" disabled={disabled || !selected || !ready} onClick={() => void extract()}>Extract selected sound</button><button className="secondary-button" disabled={disabled || !selected} onClick={keepTexture}>Keep as mixed texture</button></div>
        <details className="sample-engine"><summary>Local separation engine · {capabilities ? ready ? "ready" : "model needed" : "not connected"}</summary>
          <p className="helper">Start the optional engine using docs/sample-refinement.md, then paste its session token. Connection is only to 127.0.0.1:47831. Tokens are not saved. No audio or model downloads are automatic.</p>
          <label className="field">Engine session token<input aria-label="Engine session token" type="password" autoComplete="off" spellCheck={false} value={token} disabled={disabled} onChange={event => {setToken(event.target.value);client.current=null;setCapabilities(null);}}/></label>
          <button className="secondary-button" disabled={disabled || !token.trim()} onClick={() => void connect()}>Connect local engine</button>
        </details>
      </div>
    </div>
    {busy && <div className="sample-job" role="status"><span>{busy}…</span><button className="secondary-button" onClick={cancel}>Cancel refinement</button></div>}
    {error && <p className="studio-notice error" role="alert">{error}</p>}{notice && <p className="helper" role="status">{notice}</p>}
    {result && outputs && <div className="sample-refinement-result"><h4>3. Compare before saving</h4>
      <p className="helper">{result.separated ? `${result.model} · ${labels[result.target]} · needs review` : "Trimmed only · mixed texture"}. Comparisons are level-matched and use the shared audio engine. Your song and source are unchanged.</p>
      <div className="sample-comparisons"><button className="secondary-button" disabled={disabled} onClick={() => void hear(0)}>Original</button><button className="secondary-button" disabled={disabled} aria-pressed={choice === "extracted"} onClick={() => {setChoice("extracted");setHeard(false);setReviewed(false);setSingleNote(false);setSaved(null);void hear(1);}}>Extracted / natural</button>
        {result.separated && <><button className="secondary-button" disabled={disabled} aria-pressed={choice === "refined"} onClick={() => {setChoice("refined");setHeard(false);setReviewed(false);setSingleNote(false);setSaved(null);void hear(2);}}>Refined</button><button className="secondary-button" disabled={disabled} onClick={() => void hear(3)}>Residual</button></>}
        <button className="text-button" onClick={stopPreview}>Stop comparison</button></div>
      {result.separated && <label className="field sample-reduction">Low-level bleed reduction: {reduction} dB maximum<input aria-label="Low-level bleed reduction" type="range" min={0} max={6} step={.5} value={reduction} disabled={disabled} onChange={event => {stopPreview();setReduction(Number(event.target.value));setChoice("refined");setHeard(false);setReviewed(false);setSingleNote(false);setSaved(null);}}/><span className="helper">Conservative stereo-linked attenuation, not another isolation model. It cannot remove a second instrument playing at the same time.</span></label>}
      {outputs.warnings.map(warning => <p className="helper" key={warning}>{warning}</p>)}
      <div className="sample-save-grid"><label className="field">Library sample name<input aria-label="Library sample name" maxLength={120} value={name} disabled={disabled} onChange={event => setName(event.target.value)}/></label>
        <label className="sample-review"><input type="checkbox" checked={reviewed} disabled={disabled || !heard || !result.separated || result.target === "other"} onChange={event => setReviewed(event.target.checked)}/>I checked for remaining instruments and damaged attacks or tails.</label>
        <div className="button-row"><button className="primary-button" disabled={disabled || !heard || silent || !name.trim()} onClick={() => void save("audio")}>{!result.separated || result.target === "other" ? "Save mixed texture" : reviewed ? "Save reviewed audio phrase" : "Save audio for review"}</button></div>
      </div>
      <details className="sample-instrument"><summary>Make a playable sampled instrument</summary><p className="helper">For a single note or hit only, not a chord or a whole phrase. Root pitch is chosen by you; no automatic transcription or sound cloning is claimed.</p>
        <label className="sample-review"><input type="checkbox" checked={singleNote} disabled={disabled || !reviewed} onChange={event => setSingleNote(event.target.checked)}/>I hear one isolated note or hit, not a chord.</label>
        <label className="field">Root MIDI note<input aria-label="Sample root MIDI note" type="number" min={0} max={127} step={1} value={Number.isFinite(root) ? root : ""} disabled={disabled} onChange={event => setRoot(event.target.value === "" ? NaN : Number(event.target.value))}/></label>
        <button className="secondary-button" disabled={disabled || !heard || !reviewed || !singleNote || silent || !Number.isInteger(root) || root < 0 || root > 127 || !result.separated || result.target === "other"} onClick={() => void save("sound")}>Save sampled instrument</button>
      </details>
      {saved && <button className="secondary-button" disabled={disabled || !!s.libraryBusy} onClick={() => {void s.useLibraryEntry(saved, "alternative").then(value => {if (mounted.current && current.current.scope === scope) {if (!value.ok) setError(value.error ?? "Insertion was not committed."); else setNotice("Inserted on a new track. Undo restores the song; the library copy remains.");}});}}>Insert saved sample on a new track</button>}
      {!heard && <p className="helper">Audition the natural or refined result to unlock saving.</p>}
    </div>}
  </section>;
}
