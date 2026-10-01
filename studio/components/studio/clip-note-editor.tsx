"use client";
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { Trash2 } from "lucide-react";
import { DraftInput } from "./draft-field";
import { useStudio } from "./use-studio";
import { IconButton, Range } from "./primitives";
import { PPQ, uid, clamp, type Clip, type NoteEvent, type Mode } from "../../lib/music/types";
import { ticksPerBar } from "../../lib/music/project";
import { copyNotes, duplicateNotes, humanizeNotes, marqueeNoteIds, moveNotes, notePitchRows, pasteNotes, quantizeNotes, reconcileNoteSelection, resizeNotes, type NoteScope } from "../../lib/music/note-editing";
import { instrumentFor, isDrumInstrument } from "../../lib/audio/catalog";
import { KEYS, MODES, scaleNotes } from "../../lib/music/theory";
import { useToolInputTermination, useToolVisibility } from "./tool-visibility";
import { noteEditorContext, type NoteEditorSessionController } from "./use-note-editor-session";
import { NoteEditorCanvas, NOTE_GUTTER, NOTE_ROW, NOTE_RULER, type NoteMarquee } from "./note-editor-canvas";
import "./clip-note-editor.css";

type NoteGesture = { owner: string; baseline: Clip; ids: string[]; pitchRows: number[]; kind: "move" | "left" | "right" | "velocity"; x: number; y: number; row: number; pitch: number; deltaTick: number; deltaPitch: number; deltaVelocity: number; target: HTMLElement; pointerId?: number; rect: DOMRect };
type MarqueeGesture = { context: string; target: HTMLElement; pointerId: number; rect: DOMRect; x: number; y: number; original: string[]; extend: boolean; moved: boolean };
type Proposal = { context: string; owner: string; kind: "quantize" | "humanize"; scope: "selected" | "phrase"; count: number };

export function ClipNoteEditor({ noteSession, grid, setGrid, swing, setSwing }: { noteSession: NoteEditorSessionController; grid: number; setGrid: (value: number) => void; swing: number; setSwing: (value: number) => void }) {
  const s = useStudio(), clip = s.selectedClip, track = s.selectedTrack, active = useToolVisibility();
  const ownerId = s.user?.userId ?? "guest";
  const context = noteEditorContext(ownerId, s.project.id, track?.id, clip?.id);
  const { session, update, rememberScroll, copy, clipboard } = noteSession;
  const [heldPitchRows, setHeldPitchRows] = useState<{ context: string; rows: number[] } | null>(null);
  const selection = clip ? reconcileNoteSelection(clip, session.selection) : [];
  const chosen = clip?.notes.find(note => note.id === selection.at(-1));
  const bar = ticksPerBar(s.project), width = Math.max(720, (clip?.sourceLengthTick ?? bar) / bar * 100);
  const derivedRows = useMemo(() => clip ? notePitchRows(clip, session.fold) : [], [clip, session.fold]);
  const heldPitches = useMemo(() => new Set(heldPitchRows?.rows), [heldPitchRows]);
  const rows = heldPitchRows?.context === context && clip?.notes.every(note => heldPitches.has(note.pitch)) ? heldPitchRows.rows : derivedRows;
  const scaleSetting = session.scale === "song" ? [s.project.key, s.project.mode] : session.scale.split(":");
  const scale = scaleNotes(scaleSetting[0], scaleSetting[1] as Mode);
  const roll = useRef<HTMLDivElement>(null), velocity = useRef<HTMLDivElement>(null), positioned = useRef("");
  const gesture = useRef<NoteGesture | null>(null), marqueeGesture = useRef<MarqueeGesture | null>(null), serial = useRef(0);
  const [marquee, setMarquee] = useState<NoteMarquee | null>(null), [scope, setScope] = useState<"selected" | "phrase">("selected");
  const [proposal, setProposal] = useState<Proposal | null>(null), [message, setMessage] = useState("");
  const [transpose, setTranspose] = useState("0"), [groupVelocity, setGroupVelocity] = useState("0.75");
  const pending = proposal?.context === context && s.ownsEdit(proposal.owner) ? proposal : null;
  const configLocked = s.recordingPhase !== "idle", mutationDisabled = !active || configLocked;
  const selectedScope: NoteScope = scope === "phrase" ? "all" : selection;
  const editor = session.editor === "drums" && track && isDrumInstrument(instrumentFor(s.project, track)) ? "drums" : "notes";

  function releaseCapture(target: HTMLElement, pointerId?: number) { if (pointerId !== undefined && target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId); }
  function terminate() {
    const current = gesture.current; gesture.current = null;
    if (current) { setHeldPitchRows(null); s.cancelGesture(current.owner); releaseCapture(current.target, current.pointerId); }
    const box = marqueeGesture.current; marqueeGesture.current = null;
    if (box) { update({ selection: box.original }, box.context); releaseCapture(box.target, box.pointerId); setMarquee(null); }
  }
  useToolInputTermination(terminate);
  const terminateCurrent = useEffectEvent(terminate);
  const cleanProposal = useEffectEvent(() => { if (proposal) s.cancelEdit(proposal.owner); });
  useLayoutEffect(() => { if (!active) terminateCurrent(); return () => terminateCurrent(); }, [active, context, editor]);
  useEffect(() => {
    const cancel = () => terminateCurrent();
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape" && (gesture.current || marqueeGesture.current)) { event.preventDefault(); event.stopPropagation(); terminateCurrent(); } };
    window.addEventListener("blur", cancel); window.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("blur", cancel); window.removeEventListener("keydown", escape, true); terminateCurrent(); cleanProposal(); };
  }, []);
  useLayoutEffect(() => {
    const element = roll.current, token = context + ":" + session.fold + ":" + editor;
    if (!active || !clip || !element || positioned.current === token) return;
    const place = () => {
      if (!element.clientHeight || positioned.current === token) return;
      const pitches = clip.notes.map(note => note.pitch), middle = pitches.length ? (Math.min(...pitches) + Math.max(...pitches)) / 2 : 48;
      const row = rows.findIndex(pitch => pitch <= middle);
      element.scrollTop = session.top ?? Math.max(0, NOTE_RULER + Math.max(0, row) * NOTE_ROW + 9 - element.clientHeight / 2);
      element.scrollLeft = session.left;
      if (velocity.current) velocity.current.scrollLeft = element.scrollLeft;
      positioned.current = token;
    };
    place(); const observer = new ResizeObserver(place); observer.observe(element); return () => observer.disconnect();
  }, [active, context, clip, rows, editor, session.fold, session.left, session.top]);

  function musicError(error: unknown) { setMessage(error instanceof Error ? error.message : String(error)); }
  function mutate(transform: (current: Clip) => Clip, label: string) {
    if (!clip || !track || mutationDisabled || pending || !s.finishEdit()) return false;
    const owner = `note-command:${context}:${++serial.current}`;
    if (!s.beginGesture(owner)) return false;
    try { s.updateClip(track.id, clip.id, transform, label); if (!s.finishGesture(owner)) return false; setMessage(""); return true; }
    catch (error) { s.cancelGesture(owner); musicError(error); return false; }
  }
  function editNote(values: Partial<NoteEvent>) {
    if (clip && track && chosen && !mutationDisabled && !pending) s.updateClip(track.id, clip.id, current => ({ ...current, notes: current.notes.map(note => note.id === chosen.id ? { ...note, ...values } : note) }), "Edit note");
  }
  function canSelect() { return pending ? !s.transaction?.invalid : s.finishEdit(); }
  function selectAll() { terminate(); if (clip && canSelect()) update({ selection: clip.notes.map(note => note.id) }); }
  function copySelected() { if (!clip) return; const value = copyNotes(clip, selection); if (value) { copy(value); setMessage(`${value.notes.length} notes copied.`); } }
  function placeNotes(duplicate = false) {
    if (!clip) return;
    const result = duplicate ? duplicateNotes(clip, selection) : clipboard ? pasteNotes(clip, clipboard, session.cursor) : null;
    if (!result) return;
    if (!result.ok) { setMessage(result.error); return; }
    if (mutate(() => result.clip, duplicate ? "Duplicate notes" : "Paste notes")) update({ selection: result.selectedIds });
  }
  function removeSelected(ids = selection) { const selected = new Set(ids); mutate(current => ({ ...current, notes: current.notes.filter(note => !selected.has(note.id)) }), "Delete notes"); }
  function startTransform(kind: Proposal["kind"]) {
    if (!clip || !track || mutationDisabled || pending || (selectedScope !== "all" && !selectedScope.length) || !s.finishEdit()) return;
    const owner = `note-transform:${context}`;
    if (!s.beginEdit(owner)) return;
    try {
      const candidate = kind === "quantize" ? quantizeNotes(clip, selectedScope, grid, swing) : humanizeNotes(clip, selectedScope, s.project.seed, { timingTicks: Math.round(PPQ * .024), velocity: .12 });
      s.updateClip(track.id, clip.id, () => candidate, kind === "quantize" ? "Quantize notes" : "Humanize notes");
      setProposal({ context, owner, kind, scope, count: selectedScope === "all" ? clip.notes.length : selectedScope.length }); setMessage("");
    } catch (error) { s.cancelEdit(owner); musicError(error); }
  }
  function applyProposal() { terminate(); if (pending && s.finishEdit(pending.owner)) setProposal(null); }
  function cancelProposal() { terminate(); if (pending) s.cancelEdit(pending.owner); setProposal(null); }
  function publish(current: NoteGesture) {
    if (!track || !s.ownsGesture(current.owner)) return;
    try {
      const selected = new Set(current.ids);
      const velocityNotes = current.kind === "velocity" && current.deltaVelocity !== 0 ? current.baseline.notes.map(note => {
        const value = selected.has(note.id) ? clamp(note.velocity + current.deltaVelocity, 0, 1) : note.velocity;
        return value === note.velocity ? note : { ...note, velocity: value };
      }) : current.baseline.notes;
      const next = current.kind === "move" ? moveNotes(current.baseline, current.ids, current.deltaTick, current.deltaPitch)
        : current.kind === "velocity" ? velocityNotes.every((note, index) => note === current.baseline.notes[index]) ? current.baseline : { ...current.baseline, notes: velocityNotes }
          : resizeNotes(current.baseline, current.ids, current.kind, current.deltaTick);
      s.invalidateGesture(null, current.owner); s.updateClip(track.id, current.baseline.id, () => next, current.kind === "move" ? "Move notes" : current.kind === "velocity" ? "Change note velocities" : "Resize notes");
    } catch (error) { musicError(error); s.invalidateGesture(error instanceof Error ? error.message : String(error), current.owner); }
  }
  function beginNote(event: PointerEvent<HTMLElement>, note: NoteEvent, edge?: "left" | "right" | "velocity") {
    if (!active || event.button !== 0 || !clip) return;
    event.preventDefault(); event.stopPropagation(); terminate();
    if (!canSelect()) return;
    if (event.shiftKey && !edge) { update({ selection: selection.includes(note.id) ? selection.filter(id => id !== note.id) : [...selection, note.id] }); return; }
    const ids = selection.includes(note.id) ? selection : [note.id]; update({ selection: ids });
    if (mutationDisabled) return;
    const owner = `note-gesture:${context}:${++serial.current}`; if (!s.beginGesture(owner)) return;
    const target = event.currentTarget; target.setPointerCapture(event.pointerId);
    const rect = roll.current?.querySelector<HTMLElement>(".piano-roll")?.getBoundingClientRect() ?? target.getBoundingClientRect();
    gesture.current = { owner, baseline: clip, ids, pitchRows: rows, kind: edge ?? "move", x: event.clientX, y: event.clientY, row: rows.indexOf(note.pitch), pitch: note.pitch, deltaTick: 0, deltaPitch: 0, deltaVelocity: 0, target, pointerId: event.pointerId, rect };
    setHeldPitchRows({ context, rows });
  }
  function movePointer(event: PointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (current && event.pointerId === current.pointerId && s.ownsGesture(current.owner)) {
      event.stopPropagation();
      current.deltaTick = Math.round((event.clientX - current.x) / width * current.baseline.sourceLengthTick / grid) * grid;
      const row = clamp(current.row + Math.round((event.clientY - current.y) / NOTE_ROW), 0, current.pitchRows.length - 1);
      current.deltaPitch = current.pitchRows[row] - current.pitch; current.deltaVelocity = (current.y - event.clientY) / 34; publish(current); return;
    }
    const box = marqueeGesture.current; if (!box || event.pointerId !== box.pointerId || !clip) return;
    const x = clamp(event.clientX - box.rect.left, NOTE_GUTTER, NOTE_GUTTER + width), y = clamp(event.clientY - box.rect.top, NOTE_RULER, NOTE_RULER + rows.length * NOTE_ROW - 1);
    if (Math.hypot(x - box.x, y - box.y) < 2 && !box.moved) return;
    box.moved = true;
    const start = Math.min(box.x, x), top = Math.min(box.y, y);
    setMarquee({ x: start, y: top, width: Math.abs(x - box.x), height: Math.abs(y - box.y) });
    const first = rows[clamp(Math.floor((top - NOTE_RULER) / NOTE_ROW), 0, rows.length - 1)], last = rows[clamp(Math.floor((Math.max(y, box.y) - NOTE_RULER) / NOTE_ROW), 0, rows.length - 1)];
    const ids = marqueeNoteIds(clip, { startTick: (start - NOTE_GUTTER) / width * clip.sourceLengthTick, endTick: (Math.max(x, box.x) - NOTE_GUTTER) / width * clip.sourceLengthTick, lowPitch: last, highPitch: first });
    update({ selection: box.extend ? [...new Set([...box.original, ...ids])] : ids });
  }
  function endPointer(event: PointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (current && event.pointerId === current.pointerId) { event.stopPropagation(); movePointer(event); gesture.current = null; setHeldPitchRows(null); if (!s.finishGesture(current.owner)) s.cancelGesture(current.owner); releaseCapture(current.target, current.pointerId); return; }
    const box = marqueeGesture.current; if (box && box.pointerId === event.pointerId) { movePointer(event); marqueeGesture.current = null; releaseCapture(box.target, box.pointerId); setMarquee(null); }
  }
  function cancelPointer(event: PointerEvent<HTMLElement>) {
    if (gesture.current?.pointerId === event.pointerId || marqueeGesture.current?.pointerId === event.pointerId) { event.stopPropagation(); terminate(); }
  }
  function beginGrid(event: PointerEvent<HTMLDivElement>) {
    if (!clip || !active || event.button !== 0 || (event.target as Element).closest(".roll-note,.note-edge")) return;
    event.preventDefault(); terminate();
    if (!canSelect()) return;
    const rect = event.currentTarget.getBoundingClientRect(), x = clamp(event.clientX - rect.left, NOTE_GUTTER, NOTE_GUTTER + width), y = clamp(event.clientY - rect.top, NOTE_RULER, NOTE_RULER + rows.length * NOTE_ROW - 1);
    update({ cursor: clamp(Math.floor((x - NOTE_GUTTER) / width * clip.sourceLengthTick / grid) * grid, 0, clip.sourceLengthTick - 1), selection: event.shiftKey ? selection : [] });
    event.currentTarget.setPointerCapture(event.pointerId);
    marqueeGesture.current = { context, target: event.currentTarget, pointerId: event.pointerId, rect, x, y, original: selection, extend: event.shiftKey, moved: false };
  }
  function addNote(event: MouseEvent<HTMLDivElement>) {
    if (!clip || mutationDisabled || pending || (event.target as Element).closest(".roll-note,.note-edge")) return;
    const rect = event.currentTarget.getBoundingClientRect(), row = clamp(Math.floor((event.clientY - rect.top - NOTE_RULER) / NOTE_ROW), 0, rows.length - 1);
    if (event.clientX - rect.left < NOTE_GUTTER || event.clientY - rect.top < NOTE_RULER) return;
    const tick = clamp(Math.floor((event.clientX - rect.left - NOTE_GUTTER) / width * clip.sourceLengthTick / grid) * grid, 0, clip.sourceLengthTick - 1);
    const note = { id: uid(), tick, pitch: rows[row], duration: grid, velocity: .75 };
    if (mutate(current => ({ ...current, notes: [...current.notes, note] }), "Add note")) update({ selection: [note.id], cursor: tick });
  }
  function keys(event: KeyboardEvent<HTMLElement>, note?: NoteEvent, edge?: "left" | "right" | "velocity") {
    if (!active || (event.target as Element).closest("input,textarea,select,[contenteditable=true]")) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (gesture.current || marqueeGesture.current) terminate(); else if (pending) cancelProposal(); return; }
    const primary = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    if (primary && ["a","c","v","d"].includes(key)) { event.preventDefault(); event.stopPropagation(); if (key === "a") selectAll(); if (key === "c") copySelected(); if (key === "v") placeNotes(); if (key === "d") placeNotes(true); return; }
    const ids = note && !selection.includes(note.id) ? [note.id] : selection;
    if (note && !primary && !event.altKey && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); event.stopPropagation(); terminate(); if (canSelect()) update({ selection: event.shiftKey ? selection.includes(note.id) ? selection.filter(id => id !== note.id) : [...selection, note.id] : [note.id] }); return; }
    if (["Delete","Backspace"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); removeSelected(ids); return; }
    if (!event.key.startsWith("Arrow") || mutationDisabled || !clip || !ids.length) return;
    event.preventDefault(); event.stopPropagation();
    if (gesture.current?.pointerId !== undefined) return;
    if (!gesture.current || !s.ownsGesture(gesture.current.owner)) { terminate(); if (!canSelect()) return; }
    update({ selection: ids });
    if (!gesture.current) {
      const owner = `note-gesture:${context}:key:${++serial.current}`; if (!s.beginGesture(owner)) return;
      const selected = note ?? clip.notes.find(item => item.id === ids[0])!;
      gesture.current = { owner, baseline: clip, ids, pitchRows: rows, kind: edge ?? "move", x: 0, y: 0, row: rows.indexOf(selected.pitch), pitch: selected.pitch, deltaTick: 0, deltaPitch: 0, deltaVelocity: 0, target: event.currentTarget, rect: event.currentTarget.getBoundingClientRect() };
    }
    const current = gesture.current;
    if (current.pointerId !== undefined) return;
    if (current.kind === "velocity") current.deltaVelocity += event.key === "ArrowUp" || event.key === "ArrowRight" ? .01 : -.01;
    else { current.deltaTick += event.key === "ArrowLeft" ? -grid : event.key === "ArrowRight" ? grid : 0; if (current.kind === "move") current.deltaPitch += event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0; }
    publish(current);
  }
  function keyUp(event: KeyboardEvent<HTMLElement>) { const current = gesture.current; if (event.key.startsWith("Arrow") && current && current.pointerId === undefined) { gesture.current = null; if (!s.finishGesture(current.owner)) s.cancelGesture(current.owner); } }
  function finishKeyboard() { const current = gesture.current; if (current && current.pointerId === undefined) { gesture.current = null; if (!s.finishGesture(current.owner)) s.cancelGesture(current.owner); } }
  function changeEditor(next: "notes" | "drums") { terminate(); if (s.finishEdit()) update({ editor: next }); }
  if (!clip || !track) return null;
  return <div className="precise-note-editor" data-edit-policy="bypass">
    <div className="editor-tabs precise-note-toolbar">
      <button data-edit-policy="bypass" className={editor === "notes" ? "active" : ""} onClick={() => changeEditor("notes")}>Piano roll</button>
      <button data-edit-policy="bypass" disabled={!isDrumInstrument(instrumentFor(s.project,track))} className={editor === "drums" ? "active" : ""} onClick={() => changeEditor("drums")}>Drum steps</button>
      <button data-edit-policy="bypass" onClick={() => s.setDetailTool("automation")}>Automation</button>
      <select aria-label="Quantization grid" value={grid} disabled={!!pending} onChange={event => setGrid(Number(event.target.value))}>{[[PPQ,"1/4"],[PPQ/2,"1/8"],[PPQ/4,"1/16"],[PPQ/8,"1/32"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
      <label>Swing<input aria-label="Swing" type="range" min={0} max={.6} step={.01} value={swing} disabled={!!pending} onChange={event => setSwing(Number(event.target.value))}/></label>
      <label><input aria-label="Loop note source" type="checkbox" checked={clip.loop} disabled={mutationDisabled || !!pending} onChange={event => { terminate(); if (s.finishEdit()) s.updateClip(track.id, clip.id, current => ({ ...current, loop: event.target.checked }), "Loop note source"); }}/>Loop</label>
      <label>Source bars<DraftInput aria-label="Note loop source bars" type="number" min={.25} max={512} step={.25} value={clip.sourceLengthTick / bar} disabled={mutationDisabled || !!pending} onChange={event => s.updateClip(track.id, clip.id, current => ({ ...current, sourceLengthTick: Math.round(Number(event.target.value) * bar) }), "Resize loop source")}/></label>
      <label>Scope<select aria-label="Note transform scope" value={scope} disabled={!!pending} onChange={event => setScope(event.target.value as typeof scope)}><option value="selected">Selected notes</option><option value="phrase">Phrase</option></select></label>
      <button disabled={mutationDisabled || !!pending || scope === "selected" && !selection.length} onClick={() => startTransform("quantize")}>Quantize</button>
      <button disabled={mutationDisabled || !!pending || scope === "selected" && !selection.length} onClick={() => startTransform("humanize")}>Humanize</button>
      <label><input aria-label="Fold to used notes" type="checkbox" checked={session.fold} onChange={event => update({ fold: event.target.checked, top: null })}/>Fold</label>
      <label><input aria-label="Highlight scale" type="checkbox" checked={session.highlight} onChange={event => update({ highlight: event.target.checked })}/>Scale</label>
      <select aria-label="Note scale" value={session.scale} onChange={event => update({ scale: event.target.value })}><option value="song">Song scale</option>{KEYS.flatMap(key => (Object.keys(MODES) as Mode[]).map(mode => <option key={`${key}:${mode}`} value={`${key}:${mode}`}>{key} {mode}</option>))}</select>
    </div>
    {pending && <div className="note-transform-proposal" role="status"><span>{pending.kind === "quantize" ? "Quantize" : "Humanize"} preview · {pending.scope === "phrase" ? `${pending.count} phrase notes` : `${pending.count} selected notes`}</span><button aria-label="Apply note transform" onClick={applyProposal}>Apply</button><button aria-label="Cancel note transform" onClick={cancelProposal}>Cancel</button></div>}
    <div className="precise-note-actions">
      <button onClick={selectAll}>Select all notes</button><span className="tiny">{selection.length} selected</span>
      <button disabled={!selection.length} onClick={copySelected}>Copy notes</button>
      <button disabled={mutationDisabled || !!pending || !clipboard} onClick={() => placeNotes()}>Paste notes</button>
      <button disabled={mutationDisabled || !!pending || !selection.length} onClick={() => placeNotes(true)}>Duplicate notes</button>
      <button disabled={mutationDisabled || !!pending || !selection.length} onClick={() => removeSelected()}>Delete selected notes</button>
      <label>Paste tick<input aria-label="Paste at tick" type="number" min={0} max={clip.sourceLengthTick - 1} step={1} value={session.cursor} onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value)) update({ cursor: clamp(value, 0, clip.sourceLengthTick - 1) }); }}/></label>
      <label>Semitones<input aria-label="Transpose selected notes" type="number" min={-127} max={127} step={1} value={transpose} onChange={event => setTranspose(event.target.value)}/></label>
      <button disabled={mutationDisabled || !!pending || !selection.length || transpose.trim() === "" || !Number.isInteger(Number(transpose))} onClick={() => mutate(current => moveNotes(current, selection, 0, Number(transpose)), "Transpose notes")}>Apply transpose</button>
      <label>Velocity<input aria-label="Selected note velocity" type="number" min={0} max={1} step={.01} value={groupVelocity} onChange={event => setGroupVelocity(event.target.value)}/></label>
      <button disabled={mutationDisabled || !!pending || !selection.length || groupVelocity.trim() === "" || !Number.isFinite(Number(groupVelocity)) || Number(groupVelocity) < 0 || Number(groupVelocity) > 1} onClick={() => { const selected = new Set(selection); mutate(current => ({ ...current, notes: current.notes.map(note => selected.has(note.id) ? { ...note, velocity: Number(groupVelocity) } : note) }), "Change note velocities"); }}>Apply velocity</button>
    </div>
    {editor === "notes" ? <>
      <NoteEditorCanvas active={active} clip={clip} rows={rows} selection={selection} keyName={s.project.key} scale={scale} highlight={session.highlight} width={width} grid={grid} bar={bar} cursor={session.cursor} marquee={marquee}
        roll={roll} velocity={velocity} onScroll={() => { if (roll.current) { rememberScroll(roll.current.scrollLeft, roll.current.scrollTop); if (velocity.current) velocity.current.scrollLeft = roll.current.scrollLeft; } }}
        onAdd={addNote} onGridPointer={beginGrid} onNotePointer={beginNote} onMove={movePointer} onEnd={endPointer} onCancel={cancelPointer} onKeys={keys} onKeyUp={keyUp} onBlur={finishKeyboard}/>
      {chosen && <div className="note-inspector precise-note-inspector">
        <label>Pitch<DraftInput aria-label="Note MIDI pitch" type="number" min={0} max={127} value={chosen.pitch} disabled={mutationDisabled || !!pending} onChange={event => editNote({ pitch: clamp(Number(event.target.value),0,127) })}/></label>
        <label>Beat<DraftInput aria-label="Note beat" type="number" min={1} step={grid / PPQ} value={chosen.tick / PPQ + 1} disabled={mutationDisabled || !!pending} onChange={event => editNote({ tick: clamp(Math.round((Number(event.target.value)-1)*PPQ),0,clip.sourceLengthTick-1) })}/></label>
        <label>Duration<DraftInput aria-label="Note duration beats" type="number" min={1 / PPQ} step={grid / PPQ} value={chosen.duration / PPQ} disabled={mutationDisabled || !!pending} onChange={event => editNote({ duration: Math.max(1, Math.round(Number(event.target.value)*PPQ)) })}/></label>
        <fieldset disabled={mutationDisabled || !!pending}><Range label="Note velocity" min={.01} value={chosen.velocity} onChange={value => editNote({ velocity:value })}/></fieldset>
        <IconButton label="Delete note" disabled={mutationDisabled || !!pending} onClick={() => removeSelected([chosen.id])}><Trash2 size={14}/></IconButton>
      </div>}
    </> : <div className="drum-editor">{([[36,"Kick"],[38,"Snare"],[42,"Closed hat"],[46,"Open hat"],[49,"Crash"]] as const).map(([pitch,name]) => <div className="drum-row" key={pitch}><span>{name}</span>{Array.from({length:16},(_,index) => { const tick=index*PPQ/4,note=clip.notes.find(item=>item.pitch===pitch&&Math.abs(item.tick-tick)<10);return <button key={index} className={(note?"on ":"")+(index%4===0?"beat":"")} aria-label={`${name} step ${index+1}`} aria-pressed={!!note} disabled={mutationDisabled || !!pending} onClick={() => mutate(current=>({...current,notes:note?current.notes.filter(item=>item.id!==note.id):[...current.notes,{id:uid(),pitch,tick,duration:PPQ/8,velocity:index%4===0?.9:.65}]}),"Edit drum step")}/>; })}</div>)}<p className="helper">First bar pattern. Turn on Loop to repeat this phrase after setting its length.</p></div>}
    {message && <p className="note-editor-status" role="status">{message}</p>}
  </div>;
}
