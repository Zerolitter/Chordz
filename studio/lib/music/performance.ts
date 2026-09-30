import type { PerformanceEvent, ProjectDocument } from "./types";
export const STUDIO_FEATURE_HEADER = "X-Chordz-Features";
export const STUDIO_MODULATION_FEATURE = "modulation-v1";
export function supportsStudioExtensions(headers: Headers): boolean {
  return (headers.get(STUDIO_FEATURE_HEADER) ?? "").split(",").some(feature => feature.trim() === STUDIO_MODULATION_FEATURE);
}
export function performanceKey(event: PerformanceEvent): string {
  return event.type === "macro" ? `macro:${event.macroId}` : event.type === "controlChange" ? `cc:${event.channel}:${event.cc}` : event.type;
}
export function hasStudioExtensions(document: ProjectDocument): boolean {
  return document.tracks.some(track => !!track.modulation || !!track.chordMovement || track.clips.some(clip => clip.events.some(event => event.type === "macro" || event.type === "controlChange")));
}
/** Older clients must not replace an enhanced track with a legacy snapshot. */
export function omitsStudioExtensions(before: ProjectDocument, next: ProjectDocument): boolean {
  return before.tracks.some(previous=>{
    const track=next.tracks.find(t=>t.id===previous.id);
    if(!track)return false;
    if(previous.modulation&&!track.modulation || previous.chordMovement&&!track.chordMovement)return true;
    return previous.clips.some(clip=>{
      const incoming=track.clips.find(c=>c.id===clip.id);
      return !!incoming && clip.events.some(e=>e.type==="macro"||e.type==="controlChange") && !track.modulation && !incoming.events.some(e=>e.type==="macro"||e.type==="controlChange");
    });
  });
}
