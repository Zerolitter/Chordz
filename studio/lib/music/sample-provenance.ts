import { z } from "zod";

const range = z.object({ startSec: z.number().finite().min(0).max(600), endSec: z.number().finite().positive().max(600) }).strict()
  .refine(value => value.endSec > value.startSec, "The source range is empty.");
/** Review is a human decision, never a synonym for a separator confidence score. */
export const sampleProvenanceSchema = z.object({
  version: z.literal(1),
  sourceName: z.string().min(1).max(200),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  sourceRange: range,
  contextRange: range,
  method: z.enum(["trimmed", "separated", "refined"]),
  target: z.enum(["texture", "vocals", "drums", "bass", "piano", "guitar", "other"]),
  model: z.string().min(1).max(100),
  algorithm: z.literal("chordz-refine-1"),
  reductionDb: z.number().finite().min(0).max(6),
  status: z.enum(["needs-review", "mixed-texture", "approved"]),
  warnings: z.array(z.string().max(300)).max(16),
}).strict().superRefine((value, ctx) => {
  if (value.contextRange.startSec > value.sourceRange.startSec || value.contextRange.endSec < value.sourceRange.endSec)
    ctx.addIssue({ code: "custom", message: "Source selection must be inside retained context." });
  if (value.sourceRange.endSec - value.sourceRange.startSec > 20.001 || value.contextRange.endSec - value.contextRange.startSec > 24.001)
    ctx.addIssue({ code: "custom", message: "Refinement exceeds its bounded excerpt." });
  if ((value.method === "trimmed" || value.target === "other" || value.target === "texture") && value.status === "approved")
    ctx.addIssue({ code: "custom", message: "Mixed material cannot be certified as an isolated sound." });
});
export type SampleProvenance = z.infer<typeof sampleProvenanceSchema>;
