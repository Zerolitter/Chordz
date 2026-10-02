"use client";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { ProjectDocument, AssetReference } from "../../lib/music/types";
import { planTrackBounce, applyTrackBounce } from "../../lib/music/track-bounce";
import { TrackBounceRevisions, type TrackBounceToken } from "../../lib/client/bounce-operations";
import { activateProjectAssets, discardProjectAssets, stageProjectAssets } from "../../lib/client/storage";
import { checkExportActive, waitForExport } from "../../lib/audio/export-range";
import type { StudioEngine } from "../../lib/audio/engine";
import { AudioProcessor } from "../../lib/audio/worker-client";

interface BounceContext {
  owner: string; project: ProjectDocument; hydrated: boolean;
  document(): ProjectDocument; currentOwner(): string;
  revisions: TrackBounceRevisions; finishEdit(): boolean; hasDraft(): boolean; recording(): boolean;
  busy(): string; setBusy(value: string): void; commit(document: ProjectDocument, label: string): boolean;
  select(trackId: string, clipId: string): void; getEngine(): Promise<StudioEngine>;
  persistDraft(document: ProjectDocument, owner: string): Promise<void>; notify(message: string): void; report(error: unknown): void;
}
type BounceJob = { owner: string; projectId: string; controller: AbortController; label: string; committed: boolean; inserting: boolean; token: TrackBounceToken };
const idle = { busy: false, committed: false, sourceName: "", message: "" };

export function useTrackBounce(context: BounceContext) {
  const current = useRef(context), mounted = useRef(true), job = useRef<BounceJob | null>(null);
  const scope = JSON.stringify([context.owner, context.project.id]);
  const [state, setStateValue] = useState({ ...idle, scope });
  if (state.scope !== scope) setStateValue({ ...idle, scope });
  function setState(value: typeof idle) { setStateValue({ ...value, scope: JSON.stringify([current.current.owner, current.current.project.id]) }); }
  useLayoutEffect(() => { current.current = context; });
  function end(value: BounceJob) {
    if (job.current !== value) return;
    job.current = null;
    if (current.current.busy() === value.label) current.current.setBusy("");
  }
  function cancelBounce() {
    const value = job.current;
    if (!value || value.committed) return;
    value.controller.abort(); end(value);
    if (mounted.current) {
      const message = "Bounce cancelled. The song is unchanged.";
      setState({ ...idle, message }); current.current.notify(message);
    }
  }
  function invalidateBounceScope() {
    const value = job.current;
    if (value) { value.controller.abort(); end(value); }
    setState(idle);
  }
  function observeBounceDocument(document: ProjectDocument) {
    const value = job.current;
    if (!value || value.committed || value.inserting || current.current.revisions.matches(document, value.token)) return;
    value.controller.abort(); end(value);
    const message = "The source changed. Bounce again from the current instrument part.";
    if (mounted.current) { setState({ ...idle, message }); current.current.notify(message); }
  }
  const scopeChanged = useEffectEvent(() => {
    const value = job.current;
    if (value) { value.controller.abort(); end(value); }
  });
  useLayoutEffect(() => { scopeChanged(); }, [context.owner, context.project.id]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; job.current?.controller.abort(); };
  }, []);
  async function startBounce(trackId: string, options: { includeTails: boolean; muteSource: boolean }) {
    const ctx = current.current;
    if (job.current || ctx.busy() || !ctx.hydrated || ctx.recording() || !ctx.finishEdit()) return false;
    if (ctx.hasDraft()) { ctx.report(new Error("Apply or cancel the current proposal before bouncing.")); return false; }
    let plan: ReturnType<typeof planTrackBounce>;
    try { plan = planTrackBounce(ctx.document(), trackId, options); }
    catch (error) { ctx.report(error); return false; }
    const token = ctx.revisions.capture(ctx.document(), trackId),
      value: BounceJob = { owner: ctx.currentOwner(), projectId: plan.projectId, controller: new AbortController(), label: "Bouncing track…", committed: false, inserting: false, token };
    job.current = value; ctx.setBusy(value.label);
    const sourceName = plan.renderProject.tracks.find(track => track.id === trackId)!.name;
    setState({ busy: true, committed: false, sourceName, message: "Rendering the instrument and its track effects…" });
    const ownsScope = () => mounted.current && current.current.currentOwner() === value.owner && current.current.document().id === value.projectId;
    const active = () => {
      checkExportActive(value.controller.signal);
      if (job.current !== value || !ownsScope() || current.current.recording() || !current.current.revisions.matches(current.current.document(), token))
        throw new DOMException("The source changed. Bounce again from the current instrument part.", "AbortError");
    };
    const progress = (message: string) => { active(); setState({ busy: true, committed: false, sourceName, message }); };
    const wait = <T,>(promise: Promise<T>) => waitForExport(promise, value.controller.signal);
    let staged = false;
    const encoder = new AudioProcessor();
    const disposeEncoder = () => encoder.dispose();
    value.controller.signal.addEventListener("abort", disposeEncoder, { once: true });
    try {
      const engine = await wait(ctx.getEngine()); active();
      const buffer = await wait(engine.render(plan.renderProject, trackId, undefined,
        { range: plan.range, includeTails: plan.includeTails, preMaster: true, signal: value.controller.signal })); active();
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const samples = buffer.getChannelData(channel);
        for (let i = 0; i < samples.length; i++) {
          if (!Number.isFinite(samples[i]) || Math.abs(samples[i]) > 1)
            throw new Error("The source output clips or is not finite. Lower its level and bounce again.");
        }
      }
      progress("Encoding stereo WAV…");
      const blob = await wait(encoder.encode(buffer, 24)); active();
      const asset: AssetReference = { id: plan.assetId, name: `${sourceName} bounce.wav`, mime: "audio/wav", byteLength: blob.size,
        duration: buffer.duration, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels };
      // Validate both encoded output and the current song before retaining any bytes.
      applyTrackBounce(current.current.document(), plan, asset);
      progress("Preserving the audio copy…");
      // Await staging itself: even a cancelled operation must own and clean its late stage.
      await stageProjectAssets(value.owner, value.projectId, plan.operationId, [{ owner: value.owner, projectId: value.projectId, asset, blob }]); staged = true;
      active();
      if (current.current.hasDraft()) throw new Error("An edit is unfinished. Finish it and bounce again; the song is unchanged.");
      const result = applyTrackBounce(current.current.document(), plan, asset);
      active();
      value.inserting = true;
      try {
        if (!current.current.commit(result.document, `Bounce ${sourceName} to audio`)) throw new Error("The audio copy was not inserted. The song is unchanged.");
      } finally { value.inserting = false; }
      // Activation must follow the checked musical commit synchronously.
      value.committed = true;
      const promotion = activateProjectAssets(value.owner, plan.operationId);
      setState({ busy: true, committed: true, sourceName, message: "Saving the device draft…" });
      current.current.select(result.trackId, result.clipId);
      // Activated stages also promote through saveDraft; that retry supplies the receipt.
      await promotion.catch(() => {});
      const ownsJob = () => job.current === value && ownsScope() && !value.controller.signal.aborted;
      // saveDraft can retry promotion of activated bytes and records a truthful retry receipt.
      if (ownsJob()) await current.current.persistDraft(current.current.document(), value.owner);
      if (ownsJob()) {
        const inserted = current.current.document().tracks.some(track => track.id === result.trackId && track.clips.some(clip => clip.id === result.clipId));
        const message = inserted ? "Audio copy saved. The original instrument is retained."
          : "Bounce undone. Audio is retained for Redo; the current song is saved.";
        setState({ busy: false, committed: true, sourceName, message });
        current.current.notify(inserted ? "Audio copy saved to this device. The original instrument is retained; later changes need a new bounce." : message);
      }
      return true;
    } catch (error) {
      if (ownsScope() && job.current === value) {
        const message = value.committed ? "Bounced audio retained. Device save needs retry."
          : error instanceof Error ? error.message : "Bounce could not finish. The song is unchanged.";
        setState({ busy: false, committed: value.committed, sourceName, message });
        if (!(error instanceof DOMException && error.name === "AbortError")) current.current.report(error);
      }
      return false;
    } finally {
      value.controller.signal.removeEventListener("abort", disposeEncoder); disposeEncoder();
      if (staged && !value.committed) {
        try { await discardProjectAssets(value.owner, plan.operationId); }
        catch (error) { if (ownsScope()) current.current.report(error); }
      }
      end(value);
    }
  }
  return { bounceState: state.scope === scope ? state : idle, startBounce, cancelBounce, observeBounceDocument, invalidateBounceScope };
}
