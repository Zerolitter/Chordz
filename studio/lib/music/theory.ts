import type { Mode } from "./types";

const SHARPS = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
export const KEYS = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];
export const MODES: Record<Mode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  "harmonic-minor": [0, 2, 3, 5, 7, 8, 11],
  pentatonic: [0, 2, 4, 7, 9],
};
export const CHORDS: Record<string, number[]> = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  "5": [0, 7],
  "6": [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  mMaj7: [0, 3, 7, 11],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  "9": [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14],
  "11": [0, 4, 7, 10, 14, 17],
  m11: [0, 3, 7, 10, 14, 17],
  "13": [0, 4, 7, 10, 14, 21],
  maj13: [0, 4, 7, 11, 14, 21],
  "7sus4": [0, 5, 7, 10],
  "7b9": [0, 4, 7, 10, 13],
  "7#9": [0, 4, 7, 10, 15],
  "7#11": [0, 4, 7, 10, 18],
  "maj7#11": [0, 4, 7, 11, 18],
};
export function pitchClass(note: string): number {
  const match = /^([A-G])([#b]?)/.exec(note);
  if (!match)
    throw new Error("Use a note from A to G, with an optional sharp or flat.");
  return (
    (SHARPS.indexOf(match[1]) +
      (match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0) +
      12) %
    12
  );
}
export function noteName(midi: number, key = "C", octave = true) {
  const names = key.includes("b") || key === "F" ? FLATS : SHARPS;
  return (
    names[((Math.round(midi) % 12) + 12) % 12] +
    (octave ? Math.floor(midi / 12) - 1 : "")
  );
}
export function chordNotes(symbol: string, octave = 4): number[] {
  const match = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(
    symbol.trim().replace(/♭/g, "b").replace(/♯/g, "#").replace(/Δ/g, "maj"),
  );
  if (!match) throw new Error("Enter a chord such as C, Am7, Bbmaj7 or C/E.");
  const suffix =
    (
      { min: "m", maj: "", M7: "maj7", "-": "m", ø: "m7b5" } as Record<
        string,
        string
      >
    )[match[2]] ?? match[2];
  const intervals = CHORDS[suffix];
  if (!intervals)
    throw new Error(
      "This chord extension is not recognized. Try maj7, m7, sus4, add9 or 9.",
    );
  const notes = intervals.map(
    (i) => (octave + 1) * 12 + pitchClass(match[1]) + i,
  );
  if (match[3]) {
    const bass = pitchClass(match[3]);
    const index = notes.findIndex((n) => n % 12 === bass);
    if (index >= 0)
      return [
        ...notes.slice(index),
        ...notes.slice(0, index).map((n) => n + 12),
      ].sort((a, b) => a - b);
    return [(octave + 1) * 12 + bass - 12, ...notes];
  }
  return notes;
}
export function scaleNotes(root: string, mode: Mode) {
  return MODES[mode].map((n) => (n + pitchClass(root)) % 12);
}
export interface RecognizedChord {
  symbol: string;
  root: number;
  quality: string;
  score: number;
}
export function recognizeChords(notes: number[], key = "C"): RecognizedChord[] {
  const pcs = [...new Set(notes.map((n) => n % 12))].sort((a, b) => a - b);
  if (pcs.length < 2) return [];
  const bass = Math.min(...notes) % 12;
  const matches: RecognizedChord[] = [];
  for (const root of pcs) {
    for (const [quality, intervals] of Object.entries(CHORDS)) {
      const expected = [...new Set(intervals.map((i) => (i + root) % 12))].sort(
        (a, b) => a - b,
      );
      if (
        expected.length !== pcs.length ||
        expected.some((n, i) => n !== pcs[i])
      )
        continue;
      const symbol =
        noteName(root, key, false) +
        quality +
        (bass !== root ? "/" + noteName(bass, key, false) : "");
      matches.push({
        symbol,
        root,
        quality,
        score:
          (root === bass ? 10 : 0) +
          (root === pitchClass(key) ? 2 : 0) +
          (quality.length < 4 ? 1 : 0) -
          intervals.length * 0.01,
      });
    }
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, 6);
}
export function diatonicChords(
  root: string,
  mode: Mode,
  seventh = false,
): string[] {
  const scale = scaleNotes(root, mode);
  if (scale.length < 7) return diatonicChords(root, "major", seventh);
  return scale.map((pc, i) => {
    const triad = [
      pc,
      scale[(i + 2) % 7],
      scale[(i + 4) % 7],
      ...(seventh ? [scale[(i + 6) % 7]] : []),
    ];
    const intervals = triad
      .map((p) => (p - pc + 12) % 12)
      .sort((a, b) => a - b);
    const quality =
      Object.entries(CHORDS).find(
        ([, formula]) =>
          formula.length === intervals.length &&
          formula.every((p, j) => p % 12 === intervals[j]),
      )?.[0] ?? "";
    return noteName(pc, root, false) + quality;
  });
}
export function voiceLead(previous: number[], destination: number[]) {
  const pcs = [...new Set(destination.map((n) => n % 12))];
  if (!previous.length)
    return { notes: destination, common: [] as number[], movement: 0 };
  const source = [...previous].sort((a, b) => a - b);
  let best = [...destination].sort((a, b) => a - b),
    bestMovement = Infinity;
  for (let inversion = 0; inversion < pcs.length; inversion++) {
    const rotated = [...pcs.slice(inversion), ...pcs.slice(0, inversion)];
    for (let base = 36; base <= 72; base++) {
      if (base % 12 !== rotated[0]) continue;
      const voicing = [base];
      for (let i = 1; i < rotated.length; i++) {
        let n = base - (base % 12) + rotated[i];
        while (n <= voicing[i - 1]) n += 12;
        voicing.push(n);
      }
      const movement = voicing.reduce(
        (sum, n, i) =>
          sum + Math.abs(n - source[Math.min(i, source.length - 1)]),
        0,
      );
      if (movement < bestMovement) {
        bestMovement = movement;
        best = voicing;
      }
    }
  }
  return {
    notes: best,
    common: best.filter((n) => source.includes(n)),
    movement: bestMovement,
  };
}
export function suggestChords(
  current: number[],
  root: string,
  mode: Mode,
  tension = 0.25,
) {
  const base = diatonicChords(root, mode, tension > 0.45);
  const borrowed =
    tension > 0.25
      ? [
          noteName((pitchClass(root) + 8) % 12, root, false),
          noteName((pitchClass(root) + 10) % 12, root, false),
        ]
      : [];
  const dominant = noteName((pitchClass(root) + 7) % 12, root, false) + "7";
  return [...new Set([...base, dominant, ...borrowed])]
    .map((symbol) => ({
      symbol,
      ...voiceLead(current, chordNotes(symbol, 4)),
      borrowed: !base.includes(symbol),
    }))
    .sort((a, b) => a.movement - b.movement);
}
