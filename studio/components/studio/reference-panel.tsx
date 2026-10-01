"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useStudio } from "./use-studio";
import { SampleRefinementPanel } from "./sample-refinement-panel";
import { analyzeReferenceBuffer, referenceWaveform } from "../../lib/audio/reference-analysis-client";
import { cachedReference, cacheReference } from "../../lib/audio/reference-analysis-cache";
import { inspectReferenceFile, REFERENCE_LIMITS, validateReferenceBuffer, type ReferenceMetadata, type ReferenceProfile } from "../../lib/audio/reference-analysis-data";
import { referenceProposal, type ReferenceProposalKind } from "../../lib/audio/reference-analysis-recipes";
import { KEYS, pitchClass } from "../../lib/music/theory";
import type { Track } from "../../lib/music/types";
import { evaluateMovement } from "../../lib/music/chord-movement";
const keys = KEYS;
const canonicalKey = (key: string) => keys[pitchClass(key)] ?? "C";
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function ReferencePanel() {
  const s = useStudio(), owner = "reference-" + useId(), studio = useRef(s);
  useLayoutEffect(() => { studio.current = s; });
  const [refinementBuffer, setRefinementBuffer] = useState<AudioBuffer | null>(null);
  const [source, setSource] = useState<ReferenceMetadata | null>(null), [profile, setProfile] = useState<ReferenceProfile | null>(null), [waveform, setWaveform] = useState<number[]>([]);
  const [rangeStart, setRangeStart] = useState(0), [rangeEnd, setRangeEnd] = useState(60), [fullSong, setFullSong] = useState(false);
  const [status, setStatus] = useState(""), [percent, setPercent] = useState(0), [error, setError] = useState(""), [cacheNotice, setCacheNotice] = useState("");
  const [tempo, setTempo] = useState("120"), [key, setKey] = useState("C"), [mode, setMode] = useState<"major" | "minor">("minor"), [proposalKind, setProposalKind] = useState<ReferenceProposalKind | null>(null);
  const decoded = useRef<AudioBuffer | null>(null), job = useRef<AbortController | null>(null), staged = useRef<{ track: Track; projectId: string } | null>(null);
  const pending = s.ownsEdit(owner), busy = !!status, blocked = busy || s.recordingPhase !== "idle";
  useEffect(() => {
    queueMicrotask(() => { decoded.current = null; setRefinementBuffer(null); staged.current = null; setSource(null); setProfile(null); setWaveform([]); setStatus(""); setProposalKind(null); setError(""); setCacheNotice(""); });
    return () => { job.current?.abort(); studio.current.cancelEdit(owner); studio.current.cancelPreview(); };
  }, [s.owner, s.project.id, owner]);
  useEffect(() => { if (!studio.current.ownsEdit(owner) && staged.current) { studio.current.cancelPreview(); staged.current = null; queueMicrotask(() => setProposalKind(null)); } }, [pending, owner]);
  function cancel() { job.current?.abort(); job.current = null; setStatus(""); setPercent(0); }
  async function choose(file: File) {
    cancel(); const controller = new AbortController(); job.current = controller; setError(""); setStatus("Reading"); setProfile(null); decoded.current = null; setRefinementBuffer(null);
    try {
      if (file.size > REFERENCE_LIMITS.bytes) throw new Error("Choose an MP3 or WAV smaller than 100 MiB.");
      const bytes = new Uint8Array(await file.arrayBuffer()), header = inspectReferenceFile(bytes);
      if (header.duration > REFERENCE_LIMITS.seconds) throw new Error("Choose a reference no longer than 10 minutes.");
      if (![1, 2].includes(header.channels)) throw new Error("Choose mono or stereo audio.");
      const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer)), b => b.toString(16).padStart(2, "0")).join("");
      if (controller.signal.aborted) return;
      const engine = await studio.current.getEngine(), context = await engine.unlock();
      if (header.duration * context.sampleRate * header.channels * 4 > REFERENCE_LIMITS.pcmBytes) throw new Error("This reference exceeds the 256 MiB decoded audio limit.");
      if (controller.signal.aborted) return; setStatus("Decoding");
      const buffer = await engine.decode(file); if (controller.signal.aborted) return; validateReferenceBuffer(buffer);
      decoded.current = buffer; setRefinementBuffer(buffer);
      const metadata: ReferenceMetadata = { name: file.name.slice(0, 200), fingerprint, byteLength: file.size, duration: buffer.duration, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, sourceSampleRate: header.sourceSampleRate, ...(header.bitrate ? { bitrate: header.bitrate } : {}), ...(header.title ? { title: header.title } : {}) };
      setSource(metadata); setRangeStart(0); setRangeEnd(Math.min(60, buffer.duration)); setFullSong(false);
      setStatus("Preparing waveform"); const peaks = await referenceWaveform(buffer, { signal: controller.signal });
      if (!controller.signal.aborted) setWaveform(peaks);
    } catch (reason) { if (!controller.signal.aborted) { setSource(null); setWaveform([]); setError(reason instanceof Error ? reason.message : "Reference decoding failed."); } }
    finally { if (job.current === controller) { setStatus(""); job.current = null; } }
  }
  async function analyze() {
    if (!source || !decoded.current) return;
    const startSec = fullSong ? 0 : rangeStart, endSec = fullSong ? source.duration : rangeEnd;
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec > source.duration || endSec - startSec < Math.min(5, source.duration)) { setError("Select at least five seconds within the reference."); return; }
    const controller = new AbortController(); job.current = controller; setStatus("Analyzing"); setPercent(0); setError(""); setCacheNotice("");
    try {
      let result: ReferenceProfile | undefined;
      try { result = await cachedReference(s.owner, source.fingerprint, { startSec, endSec }); } catch { setCacheNotice("Device caching is unavailable; you can still analyze and apply a recipe."); }
      if (controller.signal.aborted) return;
      result ??= await analyzeReferenceBuffer(decoded.current, source, { startSec, endSec }, { signal: controller.signal, onProgress: p => { if (!controller.signal.aborted) setPercent(Math.floor(p)); } });
      if (controller.signal.aborted) return;
      setProfile(result); setTempo(String(result.tempo.candidates[0]?.bpm ?? s.project.tempo)); setKey(canonicalKey(result.tonal.candidates[0]?.key ?? s.project.key)); setMode(result.tonal.candidates[0]?.mode ?? "minor");
      try { await cacheReference(s.owner, result); } catch { if (!controller.signal.aborted) setCacheNotice("The result is ready, but this device could not cache it. Applied recipes still save with the song."); }
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Reference analysis failed. Try again."); }
    finally { if (job.current === controller) { setStatus(""); job.current = null; } }
  }
  function stage(kind: ReferenceProposalKind) {
    const track = s.selectedTrack; if (!track || !profile || blocked) return;
    try {
      if (!pending) { if (!s.beginEdit(owner)) return; const current = s.projectRef.current.tracks.find(t => t.id === track.id); if (!current) throw new Error("The selected track was removed."); staged.current = { track: structuredClone(current), projectId: s.project.id }; }
      const base = staged.current; if (!base || base.projectId !== s.project.id || base.track.id !== track.id) throw new Error("Cancel the current proposal before changing tracks.");
      const proposed = referenceProposal(base.track, profile, kind, { seed: s.project.seed, phraseBeats: s.selectedSection.lengthTick / 960, startBeat: s.selectedSection.startTick / 960 });
      s.updateTrack(track.id, () => ({ ...base.track, ...proposed }), "Apply reference motion"); setProposalKind(kind); setError("");
    } catch (reason) { if (!pending) s.cancelEdit(owner); setError(reason instanceof Error ? reason.message : "This proposal could not be staged."); }
  }
  function applyTempo() {
    const value = Number(tempo); if (!Number.isFinite(value) || value < 20 || value > 400) { setError("Choose a tempo between 20 and 400 BPM."); return; }
    if (!s.finishEdit()) return; s.edit(p => ({ ...p, tempo: value }), "Use reference tempo"); s.notify("Reference tempo applied. Existing audio is not time stretched.");
  }
  function applyKey() { if (!s.finishEdit()) return; s.edit(p => ({ ...p, key, mode }), "Use reference tonal palette"); s.notify("Tonal palette applied. Existing notes and chord-guide events are preserved."); }
  function hear() {
    const track = s.selectedTrack; if (!track || track.kind !== "instrument") return;
    const tonic = 48 + pitchClass(s.project.key), pitches = [tonic, tonic + (s.project.mode === "minor" ? 3 : 4), tonic + 7, tonic + 14];
    if (track.chordMovement?.enabled) void s.previewPhrase(track.id, evaluateMovement(pitches, track.chordMovement, { startTick: 0, lengthTick: 960 * 8, velocity: .65, seed: s.project.seed }), owner + ":motion:" + JSON.stringify(track.chordMovement));
    else void s.audition(pitches, 2);
  }
  const start = fullSong || !Number.isFinite(rangeStart) ? 0 : rangeStart, end = fullSong ? source?.duration ?? 0 : Number.isFinite(rangeEnd) ? rangeEnd : start;
  return <section className="reference-panel sound-card" aria-label="Reference analysis" data-edit-policy="bypass">
    <div className="panel-heading"><div><p className="eyebrow">Private reference</p><h3>Find a new direction</h3></div></div>
    <p className="helper">Analyze an MP3 or WAV on this device, then audition editable sound and chord movement. Audio stays local. Up to 100 MiB, 10 minutes, mono or stereo.</p>
    <label className="field">Reference audio<input type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" disabled={pending || busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void choose(file); }} /></label>
    {busy && <div role="status" aria-live="polite"><p>{status}{status === "Analyzing" ? ` · ${percent}%` : "…"}</p>{status === "Analyzing" && <progress max={100} value={percent} aria-label="Reference analysis progress" />}<button className="secondary-button" onClick={cancel}>Cancel analysis</button><p className="helper">Cancelling during decoding ignores its result; the browser may finish decoding in the background.</p></div>}
    {source && <>
      <p><strong>{source.title || source.name}</strong> · {time(source.duration)} · {source.channels === 2 ? "Stereo" : "Mono"} · source {source.sourceSampleRate?.toLocaleString()} Hz{source.bitrate ? ` · ${source.bitrate} kbps` : ""}</p>
      <svg viewBox="0 0 640 80" width="100%" height="80" role="img" aria-label="Reference waveform and selected analysis range"><rect x={640 * start / source.duration} y={0} width={640 * Math.max(0, end - start) / source.duration} height={80} fill="var(--amber)" opacity=".15" /><path d={waveform.map((peak, i) => `M${i * 2} ${40 - peak * 36}v${peak * 72}`).join(" ")} stroke="currentColor" opacity=".65" /></svg>
      <label><input type="checkbox" checked={fullSong} disabled={busy || pending} onChange={e => setFullSong(e.target.checked)} /> Analyze the full song</label>
      {!fullSong && <div className="field-grid"><label className="field">Start (seconds)<input aria-label="Reference range start" type="number" min={0} max={source.duration} step={.1} value={Number.isFinite(rangeStart) ? rangeStart : ""} disabled={busy || pending} onChange={e => setRangeStart(e.target.value === "" ? NaN : Number(e.target.value))} /></label><label className="field">End (seconds)<input aria-label="Reference range end" type="number" min={0} max={source.duration} step={.1} value={Number.isFinite(rangeEnd) ? rangeEnd : ""} disabled={busy || pending} onChange={e => setRangeEnd(e.target.value === "" ? NaN : Number(e.target.value))} /></label></div>}
      {refinementBuffer && <SampleRefinementPanel key={source.fingerprint} buffer={refinementBuffer} source={source} blocked={blocked || pending} />}
      <button className="primary-button" disabled={busy || pending} onClick={() => void analyze()}>Analyze {fullSong ? "full song" : "selected range"}</button>
    </>}
    {error && <p className="studio-notice error" role="alert">{error}</p>}{cacheNotice && <p className="helper" role="status">{cacheNotice}</p>}
    {profile && <>
      <p className="eyebrow">Measured {time(profile.coverage.startSec)}–{time(profile.coverage.endSec)}</p>
      <dl className="reference-measurements"><dt>Dynamics</dt><dd>RMS {profile.dynamics.rmsDbfs} dBFS · sample peak {profile.dynamics.samplePeakDbfs} dBFS · crest {profile.dynamics.crestDb} dB</dd><dt>Level variation</dt><dd>{profile.dynamics.p10Dbfs} to {profile.dynamics.p90Dbfs} dBFS across active one-second windows</dd><dt>Stereo</dt><dd>Correlation {profile.stereo.correlation} · side/mid {profile.stereo.sideToMidDb} dB</dd></dl>
      <fieldset disabled={blocked || pending}><legend>Tempo · {profile.tempo.confidence}</legend><p className="helper">{profile.tempo.reason}</p><div className="button-row">{profile.tempo.candidates.map(c => <button className="secondary-button" key={c.bpm} onClick={() => setTempo(String(c.bpm))}>{c.bpm} BPM</button>)}</div><label className="field">Chosen tempo<input aria-label="Reference tempo" type="number" min={20} max={400} value={tempo} onChange={e => setTempo(e.target.value)} /></label><button className="secondary-button" onClick={applyTempo}>Use tempo in song</button></fieldset>
      <fieldset disabled={blocked || pending}><legend>Tonal palette · {profile.tonal.confidence}</legend><p className="helper">{profile.tonal.reason}</p><div className="button-row">{profile.tonal.candidates.map(c => <button className="secondary-button" key={c.key + c.mode} onClick={() => { setKey(canonicalKey(c.key)); setMode(c.mode); }}>{canonicalKey(c.key)} {c.mode}</button>)}</div><div className="field-grid"><label className="field">Key<select aria-label="Reference key" value={key} onChange={e => { if (keys.includes(e.target.value)) setKey(e.target.value); }}>{keys.map(k => <option key={k}>{k}</option>)}</select></label><label className="field">Mode<select aria-label="Reference mode" value={mode} onChange={e => { if (e.target.value === "major" || e.target.value === "minor") setMode(e.target.value); }}><option value="major">Major</option><option value="minor">Minor</option></select></label></div><button className="secondary-button" onClick={applyKey}>Use tonal palette in song</button></fieldset>
      <p className="helper">Proposals use measured energy and brightness as curves fitted to the selected section, repeating after 128 beats in longer sections. Chord movement uses a new editable pattern, not a transcription of the reference.</p>
      <div className="button-row"><button className="secondary-button" disabled={blocked || !s.selectedTrack} aria-pressed={pending && proposalKind === "sound"} onClick={() => stage("sound")}>Sound proposal</button><button className="secondary-button" disabled={blocked || s.selectedTrack?.kind !== "instrument"} aria-pressed={pending && proposalKind === "movement"} onClick={() => stage("movement")}>Movement proposal</button><button className="secondary-button" disabled={blocked || s.selectedTrack?.kind !== "instrument"} aria-pressed={pending && proposalKind === "both"} onClick={() => stage("both")}>Both</button></div>
      {pending && <div role="status"><p>Auditioning {proposalKind}. Apply once to keep it, or cancel to restore your track.</p><div className="button-row"><button className="secondary-button" disabled={blocked || s.selectedTrack?.kind !== "instrument"} onClick={hear}>Hear chord</button><button className="primary-button" disabled={blocked} onClick={() => { if (s.finishEdit(owner)) { staged.current = null; setProposalKind(null); s.notify("Reference proposal applied."); } }}>Apply proposal</button><button className="secondary-button" onClick={() => { s.cancelEdit(owner); s.cancelPreview(); staged.current = null; setProposalKind(null); }}>Cancel proposal</button></div></div>}
      {!!profile.transitions.length && <p className="helper">Candidate changes: {profile.transitions.slice(0, 8).map(t => `${time(t.timeSec)} (${t.changeDb > 0 ? "+" : ""}${t.changeDb} dB)`).join(" · ")}</p>}
      {profile.quality.warnings.map(w => <p className="helper" key={w}>{w}</p>)}
    </>}
  </section>;
}
