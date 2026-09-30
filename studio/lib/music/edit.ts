import { PPQ, uid, clamp, type Clip, type ProjectDocument } from "./types";
import { randomGenerator } from "./generate";
import { tickToSeconds } from "./project";
import { performanceKey } from "./performance";

export interface History {
  present: ProjectDocument;
  past: ProjectDocument[];
  future: ProjectDocument[];
  label: string;
}
export type HistoryAction =
  | { type: "commit"; project: ProjectDocument; label: string }
  | { type: "undo" | "redo" }
  | { type: "load"; project: ProjectDocument };
export function historyReducer(state: History, action: HistoryAction): History {
  if (action.type === "load")
    return { present: action.project, past: [], future: [], label: "" };
  if (action.type === "commit")
    return {
      present: action.project,
      past: [...state.past, state.present].slice(-100),
      future: [],
      label: action.label,
    };
  if (action.type === "undo" && state.past.length)
    return {
      present: state.past[state.past.length - 1],
      past: state.past.slice(0, -1),
      future: [state.present, ...state.future],
      label: "Undo",
    };
  if (action.type === "redo" && state.future.length)
    return {
      present: state.future[0],
      past: [...state.past, state.present],
      future: state.future.slice(1),
      label: "Redo",
    };
  return state;
}
export function expandClip(clip: Clip) {
  const notes: Clip["notes"] = [],
    events: Clip["events"] = [];
  const iterations = clip.loop
    ? Math.ceil(clip.lengthTick / clip.sourceLengthTick)
    : 1;
  for (let i = 0; i < iterations; i++) {
    const offset = i * clip.sourceLengthTick;
    for (const note of clip.notes)
      if (
        (!clip.loop || note.tick < clip.sourceLengthTick) &&
        note.tick + offset < clip.lengthTick
      )
        notes.push({
          ...note,
          tick: note.tick + offset,
          duration: Math.min(
            note.duration,
            clip.lengthTick - note.tick - offset,
          ),
        });
    for (const event of clip.events)
      if (
        (!clip.loop || event.tick < clip.sourceLengthTick) &&
        event.tick + offset < clip.lengthTick
      )
        events.push({ ...event, tick: event.tick + offset });
  }
  return { notes, events };
}
export function splitClip(
  clip: Clip,
  absoluteTick: number,
  tempo = 120,
): [Clip, Clip] {
  const split = clamp(
    Math.round(absoluteTick - clip.startTick),
    1,
    clip.lengthTick - 1,
  );
  const { notes, events } = expandClip(clip);
  const left = {
    ...clip,
    sourceLengthTick: split,
    lengthTick: split,
    loop: false,
    notes: notes
      .filter((n) => n.tick < split)
      .map((n) => ({
        ...n,
        id: uid(),
        duration: Math.min(n.duration, split - n.tick),
      })),
    events: events.filter((e) => e.tick < split),
  };
  const right = {
    ...clip,
    id: uid(),
    name: clip.name + " · split",
    startTick: clip.startTick + split,
    lengthTick: clip.lengthTick - split,
    sourceLengthTick: clip.lengthTick - split,
    loop: false,
    notes: notes
      .filter((n) => n.tick + n.duration > split)
      .map((n) => ({
        ...n,
        id: uid(),
        tick: Math.max(0, n.tick - split),
        duration: n.tick < split ? n.tick + n.duration - split : n.duration,
      })),
    events: events
      .filter((e) => e.tick >= split)
      .map((e) => ({ ...e, tick: e.tick - split })),
  };
  for (const key of new Set(events.filter(e=>e.type!=="noteOn"&&e.type!=="noteOff").map(performanceKey))) {
    const previous = events
      .filter((e) => performanceKey(e) === key && e.tick < split)
      .sort((a, b) => b.tick - a.tick)[0];
    if (previous) right.events.unshift({ ...previous, tick: 0 });
  }
  if (clip.audio) {
    left.audio = { ...clip.audio, fadeOutSec: 0 };
    right.audio = {
      ...clip.audio,
      offsetSec: clip.audio.offsetSec + tickToSeconds(split, tempo),
      fadeInSec: 0,
    };
  }
  return [left, right];
}
export function duplicateClip(clip: Clip): Clip {
  return {
    ...structuredClone(clip),
    id: uid(),
    startTick: clip.startTick + clip.lengthTick,
    notes: clip.notes.map((n) => ({ ...n, id: uid() })),
  };
}
export function transposeClip(clip: Clip, semitones: number): Clip {
  return { ...clip, transpose: clamp(clip.transpose + semitones, -48, 48) };
}
export function quantizeClip(clip: Clip, grid = PPQ / 4, swing = 0): Clip {
  return {
    ...clip,
    notes: clip.notes.map((n) => {
      const step = Math.round(n.tick / grid);
      return {
        ...n,
        tick: clamp(
          Math.round(step * grid + (step % 2 ? swing * grid : 0)),
          0,
          clip.sourceLengthTick - 1,
        ),
        duration: Math.max(1, Math.round(n.duration / grid) * grid),
      };
    }),
  };
}
export function humanizeClip(clip: Clip, seed: number, amount = 0.3): Clip {
  const random = randomGenerator(seed);
  return {
    ...clip,
    notes: clip.notes.map((n) => ({
      ...n,
      tick: clamp(
        Math.round(n.tick + (random() - 0.5) * PPQ * 0.08 * amount),
        0,
        clip.sourceLengthTick - 1,
      ),
      velocity: clamp(n.velocity + (random() - 0.5) * 0.2 * amount, 0.08, 1),
    })),
  };
}
export function moveSection(
  project: ProjectDocument,
  sectionId: string,
  newStart: number,
): ProjectDocument {
  const section = project.sections.find((s) => s.id === sectionId);
  if (!section) return project;
  const delta = newStart - section.startTick;
  return {
    ...project,
    sections: project.sections.map((s) =>
      s.id === sectionId ? { ...s, startTick: newStart } : s,
    ),
    chords: project.chords.map((c) =>
      c.sectionId === sectionId ? { ...c, tick: c.tick + delta } : c,
    ),
    tracks: project.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) =>
        c.startTick >= section.startTick &&
        c.startTick < section.startTick + section.lengthTick
          ? { ...c, startTick: Math.max(0, c.startTick + delta) }
          : c,
      ),
    })),
  };
}
