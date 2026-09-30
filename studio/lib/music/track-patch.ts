import { z } from "zod";
import { soundSchema } from "./schema";
import { chordMovementSchema, modulationSchema } from "./modulation-schema";

export const trackPatchSchema = z.object({
  sound: soundSchema,
  modulation: modulationSchema,
  chordMovement: chordMovementSchema,
}).strict();
export type TrackPatch = z.infer<typeof trackPatchSchema>;
export const storedSoundPresetSchema = z.object({ name: z.string().trim().min(1).max(80), patch: trackPatchSchema }).strict();
export const clipboardTrackPatchSchema = trackPatchSchema.extend({ chordzPatch: z.literal(1) }).strict();
