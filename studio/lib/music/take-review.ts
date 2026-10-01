import type { ProjectDocument, Track } from "./types";

/** Isolated region audition; choosing a region never changes its song placement. */
export function buildTakePreview(project: ProjectDocument, trackId: string, clipId: string): ProjectDocument {
  const track = project.tracks.find(candidate => candidate.id === trackId);
  if (!track) throw new Error("This take's track is unavailable.");
  const clip = track.clips.find(candidate => candidate.id === clipId);
  if (!clip) throw new Error("This audio region is unavailable.");
  if (!clip.audio) throw new Error("Choose an audio region to compare.");
  const asset = project.assets.find(candidate => candidate.id === clip.audio!.assetId);
  if (!asset) throw new Error("This take's audio asset is unavailable.");
  return structuredClone({
    ...project,
    tracks: [{ ...track, kind: "audio", mute: false, solo: false, automation: [], clips: [{ ...clip, startTick: 0 }] }],
    assets: [asset],
    userInstruments: [],
    sections: [{ ...project.sections[0], name: "Region audition", startTick: 0, lengthTick: clip.lengthTick, lyrics: "" }],
    chords: [],
  });
}

/** Touching region edges are sequential, while any shared song time overlaps. */
export function audioRegionsOverlap(track: Track): boolean {
  const regions = track.clips.filter(clip => clip.audio).sort((a, b) => a.startTick - b.startTick);
  let end = 0;
  for (const clip of regions) {
    if (clip.startTick < end) return true;
    end = clip.startTick + clip.lengthTick;
  }
  return false;
}
