import { MOD_TARGETS, type ModTarget, type ModulationPatch } from "./modulation-types";
import { modulationSchema } from "./modulation-schema";

/** Validates parameter drops against the same routing schema used by the matrix. */
export function assignModulationRoute(patch: ModulationPatch, sourceId: string, target: ModTarget,
  routeId: string, capability: { audio: boolean; synth: boolean; fm: boolean },
  trackId: string, sourceTrackId?: string): { ok: true; patch: ModulationPatch } | { ok: false; error: string } {
  if (sourceTrackId && sourceTrackId !== trackId) return { ok: false, error: "Assign a source from this track." };
  if (patch.routes.length >= 32) return { ok: false, error: "Each track supports up to 32 modulation routes." };
  const descriptor = MOD_TARGETS[target as keyof typeof MOD_TARGETS];
  if (descriptor && (descriptor.scope === "voice" && capability.audio || descriptor.synthOnly && !capability.synth ||
    target.startsWith("voice.fm") && !capability.fm)) return { ok: false, error: "This destination is unavailable for the selected instrument." };
  const depth = target.startsWith("source:") ? target.endsWith(":rate") ? 3 : 1 : descriptor?.depth;
  if (depth === undefined) return { ok: false, error: "Choose an available modulation destination." };
  const next = { ...patch, enabled: true, routes: [...patch.routes,
    { id: routeId, sourceId, target, amount: depth * .1, curve: "linear" as const, slew: .01, enabled: true }] };
  const checked = modulationSchema.safeParse(next);
  return checked.success ? { ok: true, patch: checked.data } : { ok: false, error: checked.error.issues[0]?.message ?? "This modulation route is invalid." };
}
