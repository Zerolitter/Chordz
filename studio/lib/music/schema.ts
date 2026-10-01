import { sampleProvenanceSchema } from "./sample-provenance";
import { z } from "zod";
import type { ProjectDocument } from "./types";
import {modulationSchema,chordMovementSchema} from "./modulation-schema";

export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,96}$/);
const tick = z.number().int().min(0).max(1_000_000_000);
const length = tick.min(1);
const unit = z.number().min(0).max(1);
const pitch = z.number().int().min(0).max(127);
const note = z
  .object({
    id: idSchema,
    pitch,
    tick,
    duration: length,
    velocity: unit,
    articulation: z.string().max(40).optional(),
  })
  .strict();
const event = z
  .object({
    tick,
    type: z.enum([
      "noteOn",
      "noteOff",
      "sustain",
      "pitchBend",
      "modulation",
      "expression",
      "pressure",
      "macro",
      "controlChange",
    ]),
    value: z.number().min(-1).max(127),
    note: pitch.optional(),
    macroId:z.enum(["M1","M2","M3","M4"]).optional(),
    cc:z.number().int().min(0).max(119).optional(),
    channel:z.number().int().min(0).max(15).optional(),
  })
  .strict()
  .superRefine((event,ctx)=>{
    if(event.type==="macro"&&(!event.macroId||event.value<0||event.value>1))ctx.addIssue({code:"custom",message:"Macro events need an identifier and normalized value."});
    if(event.type==="controlChange"&&(event.cc===undefined||event.channel===undefined||event.value<0||event.value>1))ctx.addIssue({code:"custom",message:"CC events need a controller, channel and normalized value."});
    if(event.type!=="macro"&&event.macroId!==undefined||event.type!=="controlChange"&&(event.cc!==undefined||event.channel!==undefined))ctx.addIssue({code:"custom",message:"Unexpected performance event identity."});
  });
export const soundSchema = z
  .object({
    algorithm: z.enum(["subtractive", "fm"]),
    wave: z.enum(["sine", "triangle", "sawtooth", "square"]),
    detune: z.number().min(-1200).max(1200),
    attack: z.number().min(0.001).max(10),
    decay: z.number().min(0.001).max(10),
    sustain: unit,
    release: z.number().min(0.01).max(15),
    cutoff: z.number().min(20).max(20000),
    resonance: z.number().min(0).max(24),
    filterEnvelope: unit,
    lfoRate: z.number().min(0).max(30),
    lfoDepth: unit,
    fmRatio: z.number().min(0.1).max(20),
    fmIndex: z.number().min(0).max(30),
    articulation: z.string().max(40),
  })
  .strict();
const audio = z
  .object({
    assetId: idSchema,
    offsetSec: z.number().min(0).max(86400),
    gain: z.number().min(0).max(4),
    fadeInSec: z.number().min(0).max(300),
    fadeOutSec: z.number().min(0).max(300),
  })
  .strict();
export const clipSchema = z
  .object({
    id: idSchema,
    name: z.string().max(120),
    startTick: tick,
    lengthTick: length,
    sourceLengthTick: length,
    loop: z.boolean(),
    transpose: z.number().int().min(-48).max(48),
    notes: z.array(note).max(32000),
    events: z.array(event).max(64000),
    audio: audio.optional(),
  })
  .strict();
const track = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(120),
    kind: z.enum(["instrument", "audio"]),
    instrumentId: idSchema,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    volume: z.number().min(-60).max(12),
    pan: z.number().min(-1).max(1),
    mute: z.boolean(),
    solo: z.boolean(),
    reverb: unit,
    delay: unit,
    low: z.number().min(-18).max(18),
    mid: z.number().min(-18).max(18),
    high: z.number().min(-18).max(18),
    drive: unit,
    sound: soundSchema,
    modulation:modulationSchema.optional(),
    chordMovement:chordMovementSchema.optional(),
    clips: z.array(clipSchema).max(1000),
    automation: z
      .array(
        z
          .object({
            parameter: z.enum([
              "volume",
              "pan",
              "cutoff",
              "expression",
              "modulation",
              "pitchBend",
              "reverb",
              "delay",
              "M1","M2","M3","M4",
            ]),
            points: z
              .array(
                z
                  .object({ tick, value: z.number().min(-10000).max(20000) })
                  .strict(),
              )
              .max(10000),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
const zone = z
  .object({
    url: z
      .string()
      .regex(/^\/sounds\/[a-zA-Z0-9_.\/-]+$/)
      .optional(),
    assetId: idSchema.optional(),
    root: pitch,
    low: pitch,
    high: pitch,
    velocityLow: unit,
    velocityHigh: unit,
    roundRobin: z.number().int().min(0).max(128),
    articulation: z.string().max(40),
    loopStart: z.number().min(0).max(300).optional(),
    loopEnd: z.number().min(0).max(300).optional(),
  })
  .strict()
  .refine((v) => !!v.url || !!v.assetId, "A sample zone needs a source");
export const instrumentSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(120),
    family: z.string().max(60),
    description: z.string().max(500),
    kind: z.enum(["sample", "synth", "drums"]),
    zones: z.array(zone).max(4096),
    articulations: z.array(z.string().max(40)).max(24),
    license: z.string().max(120),
    source: z.string().max(300),
    defaults: soundSchema.partial(),
  })
  .strict();
export const assetSchema = z.object({
  provenance: sampleProvenanceSchema.optional(),
  id: idSchema,
  name: z.string().min(1).max(200),
  mime: z.string().max(100),
  byteLength: z.number().int().min(1).max(100 * 1024 * 1024),
  duration: z.number().min(0).max(86400),
  sampleRate: z.number().min(8000).max(192000),
  channels: z.number().int().min(1).max(8),
}).strict();
export const projectSchema: z.ZodType<ProjectDocument> = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema,
    title: z.string().min(1).max(160),
    key: z.enum([
      "C",
      "C#",
      "Db",
      "D",
      "D#",
      "Eb",
      "E",
      "F",
      "F#",
      "Gb",
      "G",
      "G#",
      "Ab",
      "A",
      "A#",
      "Bb",
      "B",
    ]),
    mode: z.enum([
      "major",
      "minor",
      "dorian",
      "mixolydian",
      "harmonic-minor",
      "pentatonic",
    ]),
    tempo: z.number().min(20).max(400),
    timeSignature: z.tuple([
      z.number().int().min(1).max(16),
      z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(16)]),
    ]),
    seed: z.number().int().min(0).max(4294967295),
    notes: z.string().max(20000),
    sections: z
      .array(
        z
          .object({
            id: idSchema,
            name: z.string().min(1).max(80),
            startTick: tick,
            lengthTick: length,
            lyrics: z.string().max(20000),
          })
          .strict(),
      )
      .min(1)
      .max(256),
    chords: z
      .array(
        z
          .object({
            id: idSchema,
            sectionId: idSchema,
            tick,
            duration: length,
            symbol: z.string().min(1).max(24),
            notes: z.array(pitch).min(2).max(12),
          })
          .strict(),
      )
      .max(10000),
    tracks: z.array(track).max(64),
    assets: z.array(assetSchema).max(1000),
    userInstruments: z.array(instrumentSchema).max(128),
    master: z
      .object({
        volume: z.number().min(-60).max(6),
        limiter: z.boolean(),
        reverbDecay: z.number().min(0.2).max(8),
      })
      .strict(),
  })
  .strict()
  .superRefine((project, ctx) => {
    const ids = [
      ...project.tracks.map((t) => t.id),
      ...project.sections.map((s) => s.id),
      ...project.assets.map((a) => a.id),
      ...project.userInstruments.map((i) => i.id),
      ...project.tracks.flatMap((t) => t.clips.map((c) => c.id)),
    ];
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: "custom",
        message: "Duplicate project identifiers",
      });
    const assetIds = new Set(project.assets.map((a) => a.id));
    const sectionIds = new Set(project.sections.map((s) => s.id));
    if (project.chords.some((c) => !sectionIds.has(c.sectionId)))
      ctx.addIssue({
        code: "custom",
        message: "Chord refers to an unknown section",
      });
    if (
      project.tracks.some((t) =>
        t.clips.some((c) => c.audio && !assetIds.has(c.audio.assetId)),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Audio clip refers to an unknown asset",
      });
    if (
      project.userInstruments.some((i) =>
        i.zones.some((z) => z.assetId && !assetIds.has(z.assetId)),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Instrument refers to an unknown asset",
      });
  });
