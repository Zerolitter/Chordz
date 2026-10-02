"use client";
import { useRef } from "react";
import { Play, Square } from "lucide-react";
import { audioRegionsOverlap } from "../../lib/music/take-review";
import { tickToSeconds } from "../../lib/music/project";
import { useStudio, useTransport } from "./use-studio";
import { useToolInputTermination, useToolVisibility } from "./tool-visibility";
import "./audio-take-review.css";

export function AudioTakeReview({ active = true }: { active?: boolean }) {
  const s = useStudio(), visible = useToolVisibility() && active;
  const transport = useTransport(visible), track = s.selectedTrack, clip = s.selectedClip;
  const identity = `take_${s.project.id}_${track?.id ?? ""}_${clip?.id ?? ""}`;
  const previewing = transport.previewId === identity;
  const pendingPreview = useRef<symbol | null>(null);
  useToolInputTermination(() => {
    if (pendingPreview.current || s.engine?.state.previewId === identity) {
      pendingPreview.current = null;
      s.cancelPreview();
    }
  });
  if (!track || !clip?.audio) return null;
  const regions = track.clips.filter(region => region.audio);
  const disabled = s.recording || !!s.busy;
  return <section className="audio-take-review" aria-label="Audio take comparison">
    <div className="audio-take-review-heading">
      <h3>Choose a take</h3>
      <span className="tiny">{regions.length} audio {regions.length === 1 ? "region" : "regions"}</span>
    </div>
    <div className="audio-take-review-controls">
      <label>
        <span className="sr-only">Choose a take</span>
        <select aria-label="Choose a take" value={clip.id} disabled={disabled}
          onChange={event => s.selectClip(track.id, event.target.value)}>
          {regions.map((region, index) => <option key={region.id} value={region.id}>
            {index + 1} · {region.name || "Untitled region"} · {tickToSeconds(region.lengthTick, s.project.tempo).toFixed(2)} s
          </option>)}
        </select>
      </label>
      <button type="button" className="secondary-button" aria-pressed={previewing}
        data-edit-policy={previewing ? "bypass" : undefined} disabled={!previewing && disabled}
        onClick={() => {
          if (previewing || pendingPreview.current) { pendingPreview.current = null; s.cancelPreview(); return; }
          const token = Symbol("take preview"); pendingPreview.current = token;
          void s.previewTake(track.id, clip.id).catch(s.report).finally(() => {
            if (pendingPreview.current === token) pendingPreview.current = null;
          });
        }}>
        {previewing ? <Square size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
        {previewing ? "Stop take preview" : "Preview take"}
      </button>
    </div>
    <p className="audio-take-review-status" role="status">
      {previewing && transport.loading ? "Loading take… · " : previewing ? "Playing take · " : ""}
      Region audition · no song automation
    </p>
    {audioRegionsOverlap(track) && <p className="audio-take-review-overlap">
      Overlapping regions still play together in the song. Move or delete unwanted regions explicitly.
    </p>}
  </section>;
}
