import { z } from "zod";
import { modulationIssues, type ModulationPatch } from "./modulation-types";
const finite=z.number().finite(),unit=finite.min(0).max(1),id=z.string().regex(/^[a-zA-Z0-9_-]{1,96}$/);
export const modulationSchema:z.ZodType<ModulationPatch>=z.object({
  version:z.literal(1),enabled:z.boolean(),seed:finite.int().min(0).max(4294967295),
  macros:z.tuple([unit,unit,unit,unit]),macroNames:z.tuple([z.string().max(40),z.string().max(40),z.string().max(40),z.string().max(40)]),
  sources:z.array(z.object({
    id,name:z.string().min(1).max(80),kind:z.enum(["lfo","envelope","random","step","reference"]),scope:z.enum(["track","voice"]),enabled:z.boolean(),
    rate:finite.min(.01).max(30),sync:z.boolean(),division:finite.min(.03125).max(128),shape:z.enum(["sine","triangle","saw","square"]),phase:unit,amplitude:unit,
    attack:finite.min(.001).max(10),decay:finite.min(.001).max(10),sustain:unit,release:finite.min(.01).max(15),
    steps:z.array(finite.min(-1).max(1)).min(1).max(64),curve:z.array(finite.min(-1).max(1)).max(256),
  }).strict()).max(8),
  routes:z.array(z.object({id,sourceId:z.string().min(1).max(120),target:z.string().max(120).refine(v=>/^(track\.(cutoff|resonance|gain|pan|low|mid|high|reverb|delay)|voice\.(pitch|gain|cutoff|resonance|fmRatio|fmIndex|attack|decay|sustain|release)|source:[a-zA-Z0-9_-]{1,96}:(rate|amplitude))$/.test(v)),amount:finite.min(-2400).max(2400),curve:z.enum(["linear","exponential"]),slew:finite.min(0).max(2),enabled:z.boolean()}).strict()).max(32),
  reference:z.object({name:z.string().max(200),fingerprint:z.string().max(128),startSec:finite.min(0).max(600),endSec:finite.min(0).max(600),tempo:finite.min(20).max(400).optional(),key:z.string().max(4).optional(),mode:z.enum(["major","minor"]).optional()}).strict().refine(v=>v.endSec>v.startSec,"Reference range must have positive duration.").optional(),
}).strict().superRefine((patch,ctx)=>{for(const message of modulationIssues(patch as ModulationPatch))ctx.addIssue({code:"custom",message});}) as z.ZodType<ModulationPatch>;
export const chordMovementSchema=z.object({version:z.literal(1),enabled:z.boolean(),liveEnabled:z.boolean(),hold:z.boolean(),inversion:finite.int().min(-4).max(4),spread:finite.int().min(0).max(3),strum:finite.int().min(0).max(480),gate:finite.min(.05).max(1),octaves:finite.int().min(1).max(4),swing:finite.min(0).max(.75),division:finite.int().min(60).max(3840),pattern:z.enum(["chord","up","down","upDown","random"]),seed:finite.int().min(0).max(4294967295)}).strict();
