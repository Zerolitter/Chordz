"use client";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { noteName, recognizeChords, scaleNotes } from "../../lib/music/theory";
import { useStudio } from "./use-studio";
import { IconButton } from "./primitives";

export function Piano() {
  const s = useStudio();
  const base = (s.octave + 1) * 12;
  const scale = scaleNotes(s.project.key, s.project.mode);
  const recognized = recognizeChords(s.selectedNotes, s.project.key)[0];
  const notes = Array.from({ length: 25 }, (_, i) => base + i),
    white = notes.filter((n) => ![1, 3, 6, 8, 10].includes(n % 12));
  return (
    <section className="piano-dock" aria-label="Performance keyboard">
      <div className="piano-info">
        <div>
          <span className="eyebrow">Live keys</span>
          <strong>
            {recognized?.symbol ??
              (s.selectedNotes.length
                ? `${s.selectedNotes.length} notes`
                : "Play an idea")}
          </strong>
          <span className="tiny">
            {s.selectedTrack?.kind === "audio"
              ? "Select an instrument track"
              : (s.selectedTrack?.name ?? "Add an instrument")}
          </span>
        </div>
        <div className="piano-tools">
          <IconButton
            label="Lower keyboard octave"
            onClick={() => s.setOctave(Math.max(0, s.octave - 1))}
          >
            <ChevronLeft size={16} />
          </IconButton>
          <span className="mono">C{s.octave}</span>
          <IconButton
            label="Raise keyboard octave"
            onClick={() => s.setOctave(Math.min(7, s.octave + 1))}
          >
            <ChevronRight size={16} />
          </IconButton>
          <IconButton
            label="Clear selected notes"
            onClick={() => s.setSelectedNotes([])}
          >
            <RotateCcw size={15} />
          </IconButton>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            checked={s.latch}
            onChange={(e) => s.setLatch(e.target.checked)}
          />
          Keep chord notes
        </label>
      </div>
      <div className="piano-scroll">
        <div className="piano-keybed">
          {white.map((pitch) => (
            <button
              key={pitch}
              type="button"
              aria-label={"Play " + noteName(pitch, s.project.key)}
              aria-pressed={s.selectedNotes.includes(pitch)}
              className={
                "piano-key white " +
                (s.selectedNotes.includes(pitch) ? "selected " : "") +
                (s.heldNotes.has(pitch) ? "held" : "")
              }
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                void s.noteOn(pitch,0.75,"pointer:"+e.pointerId+":"+pitch);
              }}
              onPointerUp={(e) => s.noteOff(pitch,"pointer:"+e.pointerId+":"+pitch)}
              onPointerCancel={(e) => s.releaseSource("pointer:"+e.pointerId+":")}
              onBlur={()=>s.releaseSource("button:")}
              onLostPointerCapture={e=>s.releaseHeld("pointer:"+e.pointerId+":")}
              onKeyDown={(e) => {
                if ((e.key === "Enter"||e.key === " ")&&!e.repeat) {
                  e.preventDefault();
                  void s.noteOn(pitch,0.75,"button:"+e.code+":"+pitch);
                }
              }}
              onKeyUp={(e) => {
                if (e.key === "Enter"||e.key===" ") s.noteOff(pitch,"button:"+e.code+":"+pitch);
              }}
            >
              <span>
                {pitch % 12 === 0
                  ? noteName(pitch, s.project.key)
                  : noteName(pitch, s.project.key, false)}
              </span>
              {scale.includes(pitch % 12) && <i className="scale-dot" />}
            </button>
          ))}
          {notes
            .filter((n) => [1, 3, 6, 8, 10].includes(n % 12))
            .map((pitch) => {
              const preceding = white.filter((n) => n < pitch).length;
              return (
                <button
                  key={pitch}
                  type="button"
                  aria-label={"Play " + noteName(pitch, s.project.key)}
                  aria-pressed={s.selectedNotes.includes(pitch)}
                  className={
                    "piano-key black " +
                    (s.selectedNotes.includes(pitch) ? "selected " : "") +
                    (s.heldNotes.has(pitch) ? "held" : "")
                  }
                  style={{
                    left: `calc(${(preceding / white.length) * 100}% - ${(100 / white.length) * 0.32}%)`,
                    width: `${(100 / white.length) * 0.64}%`,
                  }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    void s.noteOn(pitch,0.75,"pointer:"+e.pointerId+":"+pitch);
                  }}
                  onPointerUp={(e) => s.noteOff(pitch,"pointer:"+e.pointerId+":"+pitch)}
                  onPointerCancel={(e) => s.releaseSource("pointer:"+e.pointerId+":")}
                  onBlur={()=>s.releaseSource("button:")}
                  onLostPointerCapture={e=>s.releaseHeld("pointer:"+e.pointerId+":")}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter"||e.key === " ")&&!e.repeat) {
                      e.preventDefault();
                      void s.noteOn(pitch,0.75,"button:"+e.code+":"+pitch);
                    }
                  }}
                  onKeyUp={(e) => {
                    if (e.key === "Enter"||e.key === " ") s.noteOff(pitch,"button:"+e.code+":"+pitch);
                  }}
                >
                  <span>{noteName(pitch, s.project.key, false)}</span>
                </button>
              );
            })}
        </div>
      </div>
      <div className="keyboard-hint">
        <kbd>A</kbd>
        <kbd>W</kbd>
        <kbd>S</kbd>
        <span>Play with your keyboard</span>
      </div>
    </section>
  );
}
