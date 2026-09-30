import {
  PPQ,
  uid,
  type Clip,
  type ProjectDocument,
  type SoundSettings,
  type Track,
} from "./types";
import { chordNotes } from "./theory";
import { generatePart } from "./generate";

export const TRACK_COLORS = [
  "#c6ad7e",
  "#8cae9c",
  "#a998bc",
  "#ce947e",
  "#829fb9",
  "#b9b584",
  "#b6849a",
  "#91afa9",
];
export const DEFAULT_SOUND: SoundSettings = {
  algorithm: "subtractive",
  wave: "triangle",
  detune: 7,
  attack: 0.015,
  decay: 0.3,
  sustain: 0.65,
  release: 0.9,
  cutoff: 6400,
  resonance: 1,
  filterEnvelope: 0.25,
  lfoRate: 1.2,
  lfoDepth: 0,
  fmRatio: 2,
  fmIndex: 2,
  articulation: "sustain",
};
export function ticksPerBar(project: Pick<ProjectDocument, "timeSignature">) {
  return (PPQ * project.timeSignature[0] * 4) / project.timeSignature[1];
}
export const tickToSeconds = (tick: number, tempo: number) =>
  ((tick / PPQ) * 60) / tempo;
export const secondsToTick = (seconds: number, tempo: number) =>
  Math.round(((seconds * tempo) / 60) * PPQ);
export function projectEnd(project: ProjectDocument) {
  return Math.max(
    ticksPerBar(project),
    ...project.sections.map((s) => s.startTick + s.lengthTick),
    ...project.tracks.flatMap((t) =>
      t.clips.map((c) => c.startTick + c.lengthTick),
    ),
  );
}
export function createTrack(
  instrumentId = "piano",
  name = "Grand piano",
  color = TRACK_COLORS[0],
  kind: Track["kind"] = "instrument",
): Track {
  const sound = { ...DEFAULT_SOUND };
  if (!["pad", "bass", "lead", "drums"].includes(instrumentId))
    sound.detune = 0;
  if (instrumentId === "pad")
    Object.assign(sound, {
      wave: "sawtooth",
      attack: 0.65,
      release: 2.2,
      cutoff: 1600,
      lfoDepth: 0.15,
      detune: 12,
    });
  if (instrumentId === "bass")
    Object.assign(sound, {
      wave: "sawtooth",
      attack: 0.006,
      decay: 0.2,
      sustain: 0.45,
      release: 0.12,
      cutoff: 900,
      detune: 0,
    });
  if (instrumentId === "lead")
    Object.assign(sound, {
      algorithm: "fm",
      attack: 0.02,
      decay: 0.6,
      sustain: 0.4,
      release: 0.45,
      fmRatio: 2,
      fmIndex: 3,
    });
  if (["strings", "cello", "horn", "flute"].includes(instrumentId))
    Object.assign(sound, { attack: 0.055, release: 0.5, cutoff: 13000 });
  return {
    id: uid(),
    name,
    kind,
    instrumentId,
    color,
    volume: instrumentId === "drums" ? -10 : -12,
    pan: 0,
    mute: false,
    solo: false,
    reverb: instrumentId === "bass" || instrumentId === "drums" ? 0.06 : 0.25,
    delay: 0,
    low: 0,
    mid: 0,
    high: 0,
    drive: 0,
    sound,
    clips: [],
    automation: [],
  };
}
export function emptyClip(
  startTick: number,
  lengthTick: number,
  name = "New phrase",
): Clip {
  return {
    id: uid(),
    name,
    startTick,
    lengthTick,
    sourceLengthTick: lengthTick,
    loop: false,
    transpose: 0,
    notes: [],
    events: [],
  };
}
export function createProject(title = "Untitled song"): ProjectDocument {
  const section = {
    id: uid(),
    name: "Verse",
    startTick: 0,
    lengthTick: PPQ * 4 * 8,
    lyrics: "",
  };
  return {
    schemaVersion: 1,
    id: uid(),
    title,
    key: "C",
    mode: "major",
    tempo: 120,
    timeSignature: [4, 4],
    seed: 73021,
    notes: "",
    sections: [section],
    chords: [],
    tracks: [createTrack()],
    assets: [],
    userInstruments: [],
    master: { volume: -3, limiter: true, reverbDecay: 2.4 },
  };
}
export function createDemo(reference = false): ProjectDocument {
  const project = createProject(
    reference ? "Five minutes · reference session" : "Where the light returns",
  );
  project.key = "D";
  project.mode = "minor";
  project.seed = 81427;
  const lengths = reference
    ? [8, 24, 24, 24, 24, 24, 22]
    : [4, 8, 8, 8, 8, 8, 4];
  const names = [
    "Intro",
    "Verse 1",
    "Chorus",
    "Verse 2",
    "Chorus 2",
    "Bridge",
    "Outro",
  ];
  let startTick = 0;
  project.sections = lengths.map((bars, i) => {
    const section = {
      id: uid(),
      name: names[i],
      startTick,
      lengthTick: bars * PPQ * 4,
      lyrics:
        i === 1
          ? "Leave a light in the window\nLet it find me on the way\nAll the words I held in silence\nHave a place to land today"
          : "",
    };
    startTick += section.lengthTick;
    return section;
  });
  project.notes =
    "An original hybrid sketch in D minor. Try moving the chorus earlier, opening the pad filter, or writing a new melody over the bridge.";
  const progression = ["Dm", "Bbmaj7", "F", "C"];
  for (const section of project.sections)
    for (
      let local = 0, bar = 0;
      local < section.lengthTick;
      local += PPQ * 4, bar++
    ) {
      const symbol =
        section.name === "Bridge"
          ? ["Gm7", "Bb", "Dm", "A7"][bar % 4]
          : progression[bar % 4];
      project.chords.push({
        id: uid(),
        sectionId: section.id,
        tick: section.startTick + local,
        duration: PPQ * 4,
        symbol,
        notes: chordNotes(symbol, 3),
      });
    }
  const instruments: [
    string,
    string,
    Parameters<typeof generatePart>[2]["role"],
  ][] = [
    ["piano", "Grand piano", "chords"],
    ["strings", "Chamber strings", "strings"],
    ["cello", "Cello ostinato", "bass"],
    ["horn", "French horn", "melody"],
    ["flute", "Flute motif", "melody"],
    ["pad", "Analog horizon", "strings"],
    ["bass", "Warm sub bass", "bass"],
    ["drums", "Hybrid drums", "drums"],
  ];
  if (reference)
    instruments.push(
      ["piano", "Piano echoes", "arpeggio"],
      ["strings", "Strings · high", "strings"],
      ["cello", "Cello · long", "strings"],
      ["horn", "Horn harmony", "chords"],
      ["flute", "Flute answering", "melody"],
      ["lead", "Glass FM", "arpeggio"],
      ["percussion", "Orchestral percussion", "drums"],
      ["pad", "Distant texture", "strings"],
    );
  project.tracks = instruments.map(([id, name, role], i) => {
    const track = createTrack(id, name, TRACK_COLORS[i % TRACK_COLORS.length]);
    track.volume = reference
      ? -21 - (i % 3)
      : [-11, -18, -16, -22, -21, -23, -17, -15][i];
    track.pan = [0, -0.18, 0.12, -0.28, 0.3, 0.06, 0, 0][i % 8];
    for (let j = 0; j < project.sections.length; j++) {
      const section = project.sections[j];
      if (
        !reference &&
        ((j === 0 && i > 1) ||
          (j === 6 && i > 2) ||
          (role === "melody" && j !== 2 && j !== 4 && j !== 5))
      )
        continue;
      const energy =
        j === 2 || j === 4 ? 0.78 : j === 0 || j === 6 ? 0.25 : 0.5;
      const clip = emptyClip(
        section.startTick,
        section.lengthTick,
        section.name,
      );
      clip.notes = generatePart(project, section, {
        role,
        energy,
        density: role === "arpeggio" ? 0.85 : 0.55,
        register: role === "bass" ? 2 : role === "melody" ? 5 : i === 1 ? 4 : 3,
        tension: 0.2,
        seed: project.seed + i * 77 + j * 17,
      });
      track.clips.push(clip);
    }
    if (id === "pad")
      track.automation = [
        {
          parameter: "cutoff",
          points: [
            { tick: 0, value: 650 },
            { tick: startTick * 0.4, value: 2400 },
            { tick: startTick, value: 750 },
          ],
        },
        {
          parameter: "volume",
          points: [
            { tick: 0, value: track.volume - 5 },
            { tick: startTick * 0.3, value: track.volume },
            { tick: startTick, value: track.volume - 9 },
          ],
        },
      ];
    return track;
  });
  return project;
}
