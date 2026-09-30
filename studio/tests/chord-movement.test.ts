import { describe, expect, it } from "vitest";
import { DEFAULT_CHORD_MOVEMENT, evaluateMovement, evaluateMovementStep, MAX_GENERATED_NOTES, movementVoicing } from "../lib/music/chord-movement";
import { generatePart } from "../lib/music/generate";
import { createProject } from "../lib/music/project";
const settings = { ...DEFAULT_CHORD_MOVEMENT, enabled: true };
const withoutIds = (notes: ReturnType<typeof evaluateMovement>) => notes.map(({ id, ...note }) => { void id; return note; });

describe("chord movement", () => {
  it("inverts and spreads voices without changing the input, and keeps pitches in MIDI bounds", () => {
    const chord = [60, 64, 67];
    expect(movementVoicing(chord, { ...settings, inversion: 1 })).toEqual([64, 67, 72]);
    expect(movementVoicing(chord, { ...settings, inversion: -1 })).toEqual([55, 60, 64]);
    expect(movementVoicing(chord, { ...settings, spread: 1 })).toEqual([60, 64, 79]);
    expect(chord).toEqual([60, 64, 67]);
    const extended = movementVoicing([0, 123, 127], { ...settings, inversion: 4, spread: 3, octaves: 4 });
    expect(extended.every(p => p >= 0 && p <= 127)).toBe(true);
    expect(new Set(extended).size).toBe(extended.length);
  });
  it("makes predictable up/down/up-down patterns with absolute ticks", () => {
    const span = { startTick: 960, lengthTick: 1920, velocity: .7 };
    expect(evaluateMovement([60, 64, 67], { ...settings, pattern: "up" }, span).map(n => [n.tick, n.pitch])).toEqual([[960, 60], [1440, 64], [1920, 67], [2400, 60]]);
    expect(evaluateMovement([60, 64, 67], { ...settings, pattern: "down" }, span).map(n => n.pitch)).toEqual([67, 64, 60, 67]);
    expect(evaluateMovement([60, 64, 67], { ...settings, pattern: "upDown" }, span).map(n => n.pitch)).toEqual([60, 64, 67, 64]);
  });
  it("swings and strums within the requested span, including a tiny final pulse", () => {
    const notes = evaluateMovement([60, 64, 67], { ...settings, swing: .5, strum: 480, gate: 1 }, { startTick: 120, lengthTick: 1000, velocity: .7 });
    expect(notes.some(n => n.tick === 840)).toBe(true);
    expect(notes.every(n => n.tick >= 120 && n.tick < 1120 && n.duration >= 1 && n.tick + n.duration <= 1120)).toBe(true);
    expect(evaluateMovement([], settings, { startTick: 0, lengthTick: 1000, velocity: .7 })).toEqual([]);
    expect(evaluateMovement([60], settings, { startTick: 0, lengthTick: 0, velocity: .7 })).toEqual([]);
  });
  it("repeats a random pattern for the same seed and changes it with another seed", () => {
    const span = { startTick: 0, lengthTick: 9600, velocity: .8 };
    const random = { ...settings, pattern: "random" as const, octaves: 2 };
    const a = withoutIds(evaluateMovement([60, 64, 67], random, span));
    expect(withoutIds(evaluateMovement([60, 64, 67], random, span))).toEqual(a);
    expect(withoutIds(evaluateMovement([60, 64, 67], { ...random, seed: 42 }, span))).not.toEqual(a);
  });
  it("evaluates a late live step without earlier steps and matches generated onsets", () => {
    const movement = { ...settings, pattern: "random" as const, swing: .3, strum: 120 };
    const span = { startTick: 960, lengthTick: 9600, velocity: .8, seed: 34 };
    const whole = evaluateMovement([60, 64, 67], movement, span);
    const late = evaluateMovementStep([60, 64, 67], movement, { step: 9, originTick: 960, velocity: .8, seed: 34 });
    expect(withoutIds(late)).toEqual(withoutIds(whole.filter(n => n.tick === late[0].tick)));
    expect(late[0].tick).toBe(960 + 9 * 480 + 144);
  });
  it("generation preserves rests and chord boundaries and disabled settings preserve legacy output", () => {
    const project = createProject(), section = project.sections[0];
    section.startTick = 960; section.lengthTick = 3840;
    project.chords = [{ id: "C", sectionId: section.id, symbol: "C", tick: 960, duration: 960, notes: [60, 64, 67] }, { id: "D", sectionId: section.id, symbol: "D", tick: 3840, duration: 960, notes: [62, 66, 69] }];
    const options = { role: "arpeggio" as const, energy: .8, density: 1, register: 4, tension: .3, seed: 42 };
    expect(withoutIds(generatePart(project, section, { ...options, chordMovement: DEFAULT_CHORD_MOVEMENT }))).toEqual(withoutIds(generatePart(project, section, options)));
    const notes = generatePart(project, section, { ...options, chordMovement: { ...settings, pattern: "up", gate: 1 } });
    expect(notes.some(n => n.tick >= 960 && n.tick < 2880)).toBe(false);
    expect(notes.every(n => n.tick < 960 ? n.tick + n.duration <= 960 : n.tick + n.duration <= 3840)).toBe(true);
  });
  it("accepts the exact clip note limit and rejects excess without silently truncating", () => {
    const movement = { ...settings, division: 60, pattern: "up" as const };
    expect(evaluateMovement([60], movement, { startTick: 0, lengthTick: MAX_GENERATED_NOTES * 60, velocity: .7 })).toHaveLength(MAX_GENERATED_NOTES);
    expect(() => evaluateMovement([60], movement, { startTick: 0, lengthTick: (MAX_GENERATED_NOTES + 1) * 60, velocity: .7 })).toThrow(/Reduce octaves/);
  });
  it("enforces one phrase budget across multiple individually valid harmony spans", () => {
    const project = createProject(), section = project.sections[0];
    section.startTick = 0; section.lengthTick = 64 * 3840;
    project.chords = [0, 1].map(index => ({ id: `chord${index}`, sectionId: section.id, symbol: "C", tick: index * section.lengthTick / 2, duration: section.lengthTick / 2, notes: [60, 64, 67] }));
    const options = { role: "chords" as const, energy: .8, density: 1, register: 4, tension: .3, seed: 42, chordMovement: { ...settings, division: 60, octaves: 4 } };
    expect(() => generatePart(project, section, options)).toThrow(/32,000 notes/);
    expect(generatePart(project, section, { ...options, chordMovement: { ...options.chordMovement, division: 120 } }).length).toBeLessThanOrEqual(MAX_GENERATED_NOTES);
  });
});
