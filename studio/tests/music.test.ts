import { describe, expect, it } from "vitest";
import {
  chordNotes,
  recognizeChords,
  noteName,
  voiceLead,
  scaleNotes,
} from "../lib/music/theory";
import { generatePart } from "../lib/music/generate";
import { createProject, createDemo, ticksPerBar } from "../lib/music/project";
import {
  splitClip,
  duplicateClip,
  transposeClip,
  quantizeClip,
  historyReducer,
} from "../lib/music/edit";
import { projectSchema } from "../lib/music/schema";

describe("musical theory", () => {
  it("recognizes major/minor/extended chords and slash inversions", () => {
    expect(recognizeChords([60, 64, 67], "C")[0].symbol).toBe("C");
    expect(recognizeChords([57, 60, 64], "C")[0].symbol).toBe("Am");
    expect(recognizeChords([64, 67, 72], "C")[0].symbol).toBe("C/E");
    expect(recognizeChords([60, 64, 67, 71], "C")[0].symbol).toBe("Cmaj7");
  });
  it("keeps enharmonic labels and identifies incomplete selections honestly", () => {
    expect(noteName(61, "Db", false)).toBe("Db");
    expect(chordNotes("Bbmaj7", 3)).toEqual([58, 62, 65, 69]);
    expect(recognizeChords([60], "C")).toEqual([]);
    expect(scaleNotes("D", "dorian")).toEqual([2, 4, 5, 7, 9, 11, 0]);
  });
  it("voice leads without throwing away chord tones", () => {
    const result = voiceLead([60, 64, 67], chordNotes("F", 4));
    expect(result.notes.map((n) => n % 12).sort()).toEqual([0, 5, 9]);
    expect(result.common).toContain(60);
    expect(result.movement).toBeLessThanOrEqual(5);
  });
});

describe("project editing", () => {
  it("has validated blank and demo projects with editable meter", () => {
    const project = createProject("First light");
    expect(project.tempo).toBe(120);
    expect(ticksPerBar(project)).toBe(3840);
    expect(projectSchema.safeParse(createDemo()).success).toBe(true);
    expect(ticksPerBar({ ...project, timeSignature: [6, 8] })).toBe(2880);
  });
  it("splits crossing notes into two clips without losing duration", () => {
    const clip = {
      id: "clip",
      name: "Piano",
      startTick: 0,
      lengthTick: 3840,
      sourceLengthTick: 3840,
      loop: false,
      transpose: 0,
      notes: [
        { id: "n", pitch: 60, tick: 1440, duration: 1920, velocity: 0.8 },
      ],
      events: [],
    };
    const [left, right] = splitClip(clip, 1920);
    expect(left.notes[0].duration).toBe(480);
    expect(right.notes[0].duration).toBe(1440);
    expect(right.notes[0].tick).toBe(0);
    expect(right.startTick).toBe(1920);
    expect(duplicateClip(clip).startTick).toBe(3840);
    expect(transposeClip(clip, 12).transpose).toBe(12);
  });
  it("quantizes starts while preserving positive note lengths", () => {
    const clip = createDemo().tracks[0].clips[0];
    const quantized = quantizeClip(clip, 240, 0.2);
    expect(quantized.notes.every((n) => n.tick >= 0 && n.duration > 0)).toBe(
      true,
    );
  });
  it("undoes and redoes a real document edit", () => {
    const original = createProject("Before");
    const committed = historyReducer(
      { present: original, past: [], future: [], label: "" },
      {
        type: "commit",
        project: { ...original, title: "After" },
        label: "Rename",
      },
    );
    const undone = historyReducer(committed, { type: "undo" });
    expect(undone.present.title).toBe("Before");
    expect(historyReducer(undone, { type: "redo" }).present.title).toBe(
      "After",
    );
  });
  it("generates reproducible notes while leaving the input song alone", () => {
    const project = createDemo();
    const before = JSON.stringify(project);
    const options = {
      role: "melody" as const,
      energy: 0.6,
      density: 0.5,
      register: 5,
      tension: 0.3,
      seed: 42,
    };
    const first = generatePart(project, project.sections[0], options);
    const second = generatePart(project, project.sections[0], options);
    expect(first.map(({ pitch,tick,duration,velocity,articulation })=>({pitch,tick,duration,velocity,articulation}))).toEqual(
      second.map(({ pitch,tick,duration,velocity,articulation })=>({pitch,tick,duration,velocity,articulation})),
    );
    expect(JSON.stringify(project)).toBe(before);
    expect(first.length).toBeGreaterThan(0);
  });
  it("rejects malformed notes and unbounded documents", () => {
    const project = createDemo();
    project.tracks[0].clips[0].notes[0].pitch = 200;
    expect(projectSchema.safeParse(project).success).toBe(false);
  });
});
