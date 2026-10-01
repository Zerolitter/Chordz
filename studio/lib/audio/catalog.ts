import samples from "./factory-samples.json";
import type {
  InstrumentManifest,
  ProjectDocument,
  Track,
} from "../music/types";
import { DEFAULT_SOUND } from "../music/project";

const synths: InstrumentManifest[] = [
  {
    id: "pad",
    name: "Analog horizon",
    family: "Synthesizers",
    description: "A wide, slowly moving subtractive pad.",
    kind: "synth",
    zones: [],
    articulations: ["sustain"],
    license: "Chordz synthesis",
    source: "Built-in synthesis",
    defaults: {
      wave: "sawtooth",
      attack: 0.65,
      release: 2.2,
      cutoff: 1600,
      detune: 12,
      lfoDepth: 0.15,
    },
  },
  {
    id: "bass",
    name: "Warm sub bass",
    family: "Synthesizers",
    description: "Solid low end with a resonant analog filter.",
    kind: "synth",
    zones: [],
    articulations: ["sustain"],
    license: "Chordz synthesis",
    source: "Built-in synthesis",
    defaults: {
      wave: "sawtooth",
      attack: 0.006,
      decay: 0.2,
      sustain: 0.45,
      release: 0.12,
      cutoff: 900,
      detune: 0,
    },
  },
  {
    id: "lead",
    name: "Glass FM",
    family: "Synthesizers",
    description: "Bell-like FM tones with an editable modulation index.",
    kind: "synth",
    zones: [],
    articulations: ["sustain"],
    license: "Chordz synthesis",
    source: "Built-in synthesis",
    defaults: {
      algorithm: "fm",
      attack: 0.01,
      decay: 0.6,
      sustain: 0.4,
      release: 0.45,
      fmRatio: 2,
      fmIndex: 3,
    },
  },
  {
    id: "drums",
    name: "Hybrid drum machine",
    family: "Percussion",
    description:
      "Synthesized kick, snare, clap and cymbals with velocity response.",
    kind: "drums",
    zones: [],
    articulations: ["sustain"],
    license: "Chordz synthesis",
    source: "Built-in synthesis",
    defaults: { attack: 0.001, release: 0.15, cutoff: 18000 },
  },
];
export const FACTORY_INSTRUMENTS: InstrumentManifest[] = [
  ...(samples as InstrumentManifest[]),
  ...synths,
];
export function instruments(project: ProjectDocument) {
  return [...FACTORY_INSTRUMENTS, ...project.userInstruments];
}
export function instrumentFor(project: ProjectDocument, track: Track) {
  return (
    instruments(project).find((i) => i.id === track.instrumentId) ??
    FACTORY_INSTRUMENTS[0]
  );
}
export const isDrumInstrument=(instrument:InstrumentManifest)=>instrument.kind==="drums"||instrument.id==="percussion"||instrument.id.startsWith("percussion_");
export function instrumentSettings(manifest: InstrumentManifest) {
  return { ...DEFAULT_SOUND, ...manifest.defaults };
}
