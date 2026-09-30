"use client";
import { useEffect, useState } from "react";
import { applyModTarget, trackModulationBase, type ModSample } from "../../lib/audio/modulation";
import type { ModTarget } from "../../lib/music/modulation-types";
import type { Track } from "../../lib/music/types";
import { useStudio } from "./use-studio";
import { knobModulationBase, knobModulationBounds } from "../../lib/client/knob-modulation";

/** One output poll per panel; knobs share the actual audio evaluator's values. */
export function useKnobModulation(trackIds: readonly string[]) {
  const { engine, project } = useStudio(), trackKey = trackIds.join(",");
  type OutputSample = ModSample & { seconds: number; effectiveTargets?: Readonly<Record<string,number>> };
  const [samples, setSamples] = useState<{ engine: typeof engine; tracks: Record<string, OutputSample> } | null>(null);
  useEffect(() => {
    if (!engine) return;
    const ids = trackKey.split(",").filter(Boolean);
    const timer = setInterval(() => {
      const tracks: Record<string, OutputSample> = {};
      for (const id of ids) { const sample = engine.modulationSample(id); if (sample) tracks[id] = sample; }
      setSamples({ engine, tracks });
    }, 100);
    return () => clearInterval(timer);
  }, [engine, trackKey]);
  const effective = (track: Track, target: ModTarget): number | undefined => {
    const sample = samples?.engine === engine ? samples?.tracks[track.id] : undefined;
    if (sample?.effectiveTargets && target in sample.effectiveTargets) return sample.effectiveTargets[target];
    return sample && target in sample.targets ? applyModTarget(target, knobModulationBase(track, target, sample.seconds, project.tempo), sample.targets[target]) : undefined;
  };
  return Object.assign(effective, { range: (track: Track, target: ModTarget) => knobModulationBounds(track.modulation, target, trackModulationBase(track, target)) });
}
