"use client";
import { AudioLines, Drum, Guitar, Music2, Piano, Waves, Wind } from "lucide-react";
import { useStudio } from "./use-studio";
import { instrumentFor } from "../../lib/audio/catalog";
import { trackDisplayColor } from "../../lib/client/appearance";
import type { CSSProperties } from "react";
import type { Track } from "../../lib/music/types";

export function TrackFamilyIcon({ track, size = 17 }: { track: Track; size?: number }) {
  const s = useStudio();
  const family = track.kind === "audio" ? "audio" : instrumentFor(s.project, track).family.toLowerCase();
  const Icon = track.kind === "audio" ? AudioLines : /percussion|drum/.test(family) ? Drum
    : /guitar|bass/.test(family) ? Guitar : /key|piano/.test(family) ? Piano
      : /synth/.test(family) ? Waves : /wind|brass/.test(family) ? Wind : Music2;
  return <Icon size={size} aria-hidden="true" />;
}

/** The same track controls serve the discovery drawer and the song's aligned rows. */
export function TrackHeader({ track, index, onNavigate, compact = false }: {
  track: Track; index: number; onNavigate?: () => void; compact?: boolean;
}) {
  const s = useStudio();
  const detail = track.mute ? "Muted" : track.solo ? "Soloed" : track.kind === "audio"
    ? "Audio take" : instrumentFor(s.project, track).family;
  return <div className={`track-row${compact ? " song-track-header" : ""}${track.id === s.selectedTrack?.id ? " selected" : ""}`}
    style={{ "--track-color": trackDisplayColor(s.project, track) } as CSSProperties}>
    <button type="button" className="track-select" data-edit-policy="bypass" onClick={() => { if (s.selectTrack(track.id)) onNavigate?.(); }}
      aria-label={`Select ${track.name}`} aria-pressed={track.id === s.selectedTrack?.id}>
      <span className="track-number mono">{String(index + 1).padStart(2, "0")}</span>
      <span className="track-icon"><TrackFamilyIcon track={track} /></span>
      <span className="track-text"><strong>{track.name}</strong>
        <small className={track.mute ? "muted-state" : track.solo ? "solo-state" : ""}>{detail}</small>
      </span>
    </button>
    <div className="track-switches">
      <button type="button" aria-label={`Mute ${track.name}`} aria-pressed={track.mute} className={track.mute ? "on" : ""}
        disabled={s.recordingPhase !== "idle"} onClick={() => s.updateTrack(track.id, { mute: !track.mute }, "Mute track")}>M</button>
      <button type="button" aria-label={`Solo ${track.name}`} aria-pressed={track.solo} className={track.solo ? "on" : ""}
        disabled={s.recordingPhase !== "idle"} onClick={() => s.updateTrack(track.id, { solo: !track.solo }, "Solo track")}>S</button>
    </div>
  </div>;
}
