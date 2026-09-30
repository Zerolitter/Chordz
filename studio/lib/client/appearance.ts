import { instrumentFor } from "../audio/catalog";
import type { ProjectDocument, Track } from "../music/types";

export const ACCENT_PRESETS = ["#e8b968", "#eab775", "#e5a95c", "#d8b184"] as const;
export interface AppearancePreferences {
  accent: (typeof ACCENT_PRESETS)[number];
  railWidth: number;
  density: "compact" | "comfortable";
}
export const DEFAULT_APPEARANCE: AppearancePreferences = {
  accent: "#e8b968", railWidth: 5, density: "comfortable",
};
export function isAppearance(value: unknown): value is AppearancePreferences {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return ACCENT_PRESETS.some(accent => accent === candidate.accent)
    && typeof candidate.railWidth === "number" && Number.isInteger(candidate.railWidth)
    && candidate.railWidth >= 2 && candidate.railWidth <= 10
    && (candidate.density === "compact" || candidate.density === "comfortable");
}
const FAMILY_COLORS: Record<string, string> = {
  Keys: "#cf9a6b", Strings: "#c8788f", Brass: "#c2a04f",
  Woodwinds: "#79b98f", Synthesizers: "#8a93dd", Percussion: "#8d9190",
};
/** Presentation only: older songs and user-defined colours remain intact. */
export function trackDisplayColor(project: ProjectDocument, track: Track) {
  return track.kind === "audio" ? track.color
    : FAMILY_COLORS[instrumentFor(project, track).family] ?? track.color;
}
