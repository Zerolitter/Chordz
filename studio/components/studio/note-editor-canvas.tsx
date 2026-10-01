"use client";
import { Fragment, memo, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { noteName } from "../../lib/music/theory";
import { PPQ, type Clip, type NoteEvent } from "../../lib/music/types";

export const NOTE_ROW = 18, NOTE_GUTTER = 44, NOTE_RULER = 22;
export type NoteMarquee = { x: number; y: number; width: number; height: number };
type Props = {
  active: boolean; clip: Clip; rows: number[]; selection: string[]; keyName: string; scale: number[];
  highlight: boolean; width: number; grid: number; bar: number; cursor: number; marquee: NoteMarquee | null;
  roll: RefObject<HTMLDivElement | null>; velocity: RefObject<HTMLDivElement | null>;
  onScroll: () => void; onAdd: (event: React.MouseEvent<HTMLDivElement>) => void;
  onGridPointer: (event: PointerEvent<HTMLDivElement>) => void;
  onNotePointer: (event: PointerEvent<HTMLElement>, note: NoteEvent, edge?: "left" | "right" | "velocity") => void;
  onMove: (event: PointerEvent<HTMLElement>) => void; onEnd: (event: PointerEvent<HTMLElement>) => void;
  onCancel: (event: PointerEvent<HTMLElement>) => void; onKeys: (event: KeyboardEvent<HTMLElement>, note?: NoteEvent, edge?: "left" | "right" | "velocity") => void;
  onKeyUp: (event: KeyboardEvent<HTMLElement>) => void; onBlur: () => void;
};

/** Keep hidden DOM stable without rebuilding a potentially large note surface. */
export const NoteEditorCanvas = memo(function NoteEditorCanvas(props: Props) {
  const { clip, rows, selection, keyName, scale, highlight, width, grid, bar, cursor } = props;
  const selected = new Set(selection), rowIndex = new Map(rows.map((pitch, index) => [pitch, index]));
  const label = (note: NoteEvent) => `${noteName(note.pitch, keyName)} note at beat ${note.tick / PPQ + 1}`;
  const callbacks = { onPointerMove: props.onMove, onPointerUp: props.onEnd, onPointerCancel: props.onCancel, onLostPointerCapture: props.onCancel };
  return <>
    <div ref={props.roll} className="piano-roll-scroll precise-note-scroll" tabIndex={0} role="region" aria-label="Piano roll grid"
      onScroll={props.onScroll} onKeyDown={event => props.onKeys(event)} onKeyUp={props.onKeyUp} onBlur={props.onBlur}>
      <div className="piano-roll precise-note-roll" style={{ width: width + NOTE_GUTTER, height: rows.length * NOTE_ROW + NOTE_RULER }}
        onDoubleClick={props.onAdd} onPointerDown={props.onGridPointer} {...callbacks}>
        <div className="note-time-ruler" style={{ width: width + NOTE_GUTTER }}><span className="note-ruler-gutter">Source</span>
          {Array.from({ length: Math.ceil(clip.sourceLengthTick / bar) }, (_, index) => <span key={index} style={{ left: NOTE_GUTTER + index * bar / clip.sourceLengthTick * width }}> {index + 1}</span>)}
        </div>
        <div className="note-grid-lines" style={{ left: NOTE_GUTTER, width, height: rows.length * NOTE_ROW, top: NOTE_RULER, backgroundSize: `${grid / clip.sourceLengthTick * width}px ${NOTE_ROW}px` }} />
        {rows.map((pitch, index) => <div key={pitch} className={`note-pitch-row${highlight && scale.includes(pitch % 12) ? " in-scale" : ""}${[1,3,6,8,10].includes(pitch % 12) ? " black-key" : ""}`}
          style={{ top: NOTE_RULER + index * NOTE_ROW, width: width + NOTE_GUTTER }}><span className="roll-note-label">{noteName(pitch, keyName)}</span></div>)}
        <div className="note-insert-cursor" aria-hidden="true" style={{ left: NOTE_GUTTER + cursor / clip.sourceLengthTick * width, top: NOTE_RULER, height: rows.length * NOTE_ROW }} />
        {clip.notes.map(note => {
          const row = rowIndex.get(note.pitch); if (row === undefined) return null;
          const left = NOTE_GUTTER + note.tick / clip.sourceLengthTick * width, top = NOTE_RULER + row * NOTE_ROW;
          const length = Math.max(3, note.duration / clip.sourceLengthTick * width), text = label(note), short = length < 16;
          return <Fragment key={note.id}>
            <button type="button" className={`roll-note${selected.has(note.id) ? " selected" : ""}`} data-note-id={note.id}
              style={{ left, top, width: length, height: 16, opacity: .35 + note.velocity * .65 }} aria-label={text} aria-pressed={selected.has(note.id)}
              onPointerDown={event => props.onNotePointer(event, note)} {...callbacks}
              onKeyDown={event => props.onKeys(event, note)} onKeyUp={props.onKeyUp} onBlur={props.onBlur} />
            {(["left", "right"] as const).map(edge => <button type="button" key={edge} className={`note-edge note-edge-${edge}${short ? " note-edge-short" : ""}${selected.has(note.id) ? " selected" : ""}`}
              data-note-id={note.id} data-note-edge={edge === "left" ? "start" : "end"} aria-label={`Resize ${text} ${edge === "left" ? "start" : "end"}`}
              style={{ left: edge === "left" ? left : left + length - 1, top: edge === "right" ? top + 10 : top, height: 6 }} onPointerDown={event => props.onNotePointer(event, note, edge)} {...callbacks}
              onKeyDown={event => props.onKeys(event, note, edge)} onKeyUp={props.onKeyUp} onBlur={props.onBlur} />)}
          </Fragment>;
        })}
        {props.marquee && <div className="note-marquee" aria-hidden="true" style={props.marquee} />}
      </div>
    </div>
    <div ref={props.velocity} className="note-velocity-scroll" role="region" aria-label="Note velocity lane" tabIndex={0}
      onScroll={() => { if (props.roll.current && props.velocity.current) { props.roll.current.scrollLeft = props.velocity.current.scrollLeft; props.onScroll(); } }}
      onKeyDown={event => props.onKeys(event)} onKeyUp={props.onKeyUp} onBlur={props.onBlur}>
      <div className="note-velocity-lane" style={{ width: width + NOTE_GUTTER }}><span className="note-velocity-label">Velocity</span>
        {clip.notes.map(note => <button type="button" key={note.id} className={`note-velocity-bar${selected.has(note.id) ? " selected" : ""}`} data-note-id={note.id}
          style={{ left: NOTE_GUTTER + note.tick / clip.sourceLengthTick * width, height: Math.max(3, note.velocity * 34) }}
          aria-label={`Velocity ${label(note)}`} aria-pressed={selected.has(note.id)} onPointerDown={event => props.onNotePointer(event, note, "velocity")} {...callbacks}
          onKeyDown={event => props.onKeys(event, note, "velocity")} onKeyUp={props.onKeyUp} onBlur={props.onBlur} />)}
      </div>
    </div>
  </>;
}, (previous, next) => !previous.active && !next.active);
