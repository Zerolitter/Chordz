import {
  clamp,
  type Clip,
  type PerformanceEvent,
  type ProjectDocument,
  type Track,
} from "../music/types";
import { tickToSeconds } from "../music/project";
import { expandClip } from "../music/edit";

export interface ScheduledNote {
  id?: string;
  trackId: string;
  pitch: number;
  tick: number;
  duration: number;
  velocity: number;
  articulation?: string;
  index: number;
}
export interface ScheduledExpression extends PerformanceEvent {
  trackId: string;
}
export interface ScheduledAudio {
  clipId: string;
  trackId: string;
  tick: number;
  duration: number;
  region: NonNullable<Clip["audio"]>;
}
function variation(seed: number, key: string) {
  let hash = seed >>> 0;
  for (let i = 0; i < key.length; i++)
    hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return hash >>> 0;
}
export function audibleTracks(
  project: ProjectDocument,
  onlyTrack?: string,
): Track[] {
  const solo = project.tracks.some((t) => t.solo && !t.mute);
  return project.tracks.filter(
    (t) =>
      (!onlyTrack || t.id === onlyTrack) &&
      !t.mute &&
      (!solo || t.solo || !!onlyTrack),
  );
}
export function compileSong(
  project: ProjectDocument,
  onlyTrack?: string,
  extendSustain = true,
) {
  const notes: ScheduledNote[] = [],
    events: ScheduledExpression[] = [],
    audio: ScheduledAudio[] = [];
  for (const track of audibleTracks(project, onlyTrack))
    for (const clip of track.clips) {
      if (clip.audio) {
        audio.push({
          clipId: clip.id,
          trackId: track.id,
          tick: clip.startTick,
          duration: clip.lengthTick,
          region: clip.audio,
        });
        continue;
      }
      const expanded = expandClip(clip);
      const pedal = expanded.events
        .filter((e) => e.type === "sustain")
        .sort((a, b) => a.tick - b.tick);
      for (const n of expanded.notes) {
        let duration = Math.min(n.duration, clip.lengthTick - n.tick);
        if (extendSustain) {
          const end = n.tick + duration;
          const state = pedal.filter((e) => e.tick <= end).at(-1);
          if (state && state.value >= 0.5) {
            const up = pedal.find((e) => e.tick > end && e.value < 0.5);
            duration = (up?.tick ?? clip.lengthTick) - n.tick;
          }
        }
        notes.push({
          id:n.id,
          trackId: track.id,
          pitch: clamp(n.pitch + clip.transpose, 0, 127),
          tick: clip.startTick + n.tick,
          duration,
          velocity: n.velocity,
          articulation: n.articulation,
          index: variation(
            project.seed,
            track.id + clip.id + n.id + ":" + n.tick,
          ),
        });
      }
      for (const e of expanded.events)
        if (e.type !== "noteOn" && e.type !== "noteOff")
          events.push({
            ...e,
            trackId: track.id,
            tick: clip.startTick + e.tick,
          });
    }
  return {
    notes: notes.sort((a, b) => a.tick - b.tick),
    events: events.sort((a, b) => a.tick - b.tick),
    audio: audio.sort((a, b) => a.tick - b.tick),
  };
}
export function automationValue(
  track: Track,
  parameter: string,
  tick: number,
  defaultValue: number,
) {
  const lane = track.automation.find((a) => a.parameter === parameter);
  if (!lane?.points.length) return defaultValue;
  const points = [...lane.points].sort((a, b) => a.tick - b.tick);
  const next = points.findIndex((p) => p.tick > tick);
  if (next === 0) return points[0].value;
  if (next === -1) return points[points.length - 1].value;
  const a = points[next - 1],
    b = points[next];
  return a.value + ((b.value - a.value) * (tick - a.tick)) / (b.tick - a.tick);
}
export function compileDuration(project: ProjectDocument, note: ScheduledNote) {
  return tickToSeconds(note.duration, project.tempo);
}
