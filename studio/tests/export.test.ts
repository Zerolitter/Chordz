import { describe, it, expect } from "vitest";
import { Midi } from "@tonejs/midi";
import {
  createProject,
  emptyClip,
  createDemo,
  projectEnd,
  tickToSeconds,
} from "../lib/music/project";
import { encodeWav, waveformPeaks } from "../lib/audio/wav";
import { exportMidi, projectBackup, restoreBackup } from "../lib/audio/export";
import { compileSong, automationValue } from "../lib/audio/compile";

describe("musical exports", () => {
  it("writes correctly sized 24-bit stereo WAV with finite clamped samples", () => {
    const buffer = encodeWav(
      [new Float32Array([0, 0.5, -1, 2]), new Float32Array([0, -0.5, 1, NaN])],
      48000,
    );
    const view = new DataView(buffer);
    expect(buffer.byteLength).toBe(68);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(24);
    expect(view.getUint32(40, true)).toBe(24);
    expect(waveformPeaks([new Float32Array([0, 0.5, -0.9, 0.1])], 2)).toEqual([
      0.5,
      expect.closeTo(0.9),
    ]);
  });
  it("exports notes with the correct tempo, channels and duration", () => {
    const p = createProject();
    const clip = emptyClip(0, 3840);
    clip.notes = [
      { id: "note", pitch: 60, tick: 960, duration: 480, velocity: 0.7 },
    ];
    p.tracks[0].clips = [clip];
    const midi = new Midi(exportMidi(p));
    expect(midi.header.tempos[0].bpm).toBe(120);
    expect(midi.tracks[0].notes[0].time).toBe(0.5);
    expect(midi.tracks[0].notes[0].duration).toBe(0.25);
    expect(midi.tracks[0].notes[0].midi).toBe(60);
  });
  it("round trips backup data and refuses missing assets", async () => {
    const p = createDemo();
    const bytes = await projectBackup(p, async () => new Blob());
    const restored = restoreBackup(bytes);
    expect(restored.document).toEqual(p);
    expect(restored.assets.size).toBe(0);
  });
  it("compiles repetitions, sustain and interpolated automation", () => {
    const p = createProject();
    const clip = emptyClip(0, 3840);
    clip.sourceLengthTick = 1920;
    clip.loop = true;
    clip.notes = [
      { id: "n", pitch: 60, tick: 0, duration: 480, velocity: 0.6 },
    ];
    clip.events = [
      { tick: 0, type: "sustain", value: 1 },
      { tick: 1440, type: "sustain", value: 0 },
    ];
    p.tracks[0].clips = [clip];
    p.tracks[0].automation = [
      {
        parameter: "volume",
        points: [
          { tick: 0, value: -20 },
          { tick: 3840, value: 0 },
        ],
      },
    ];
    const song = compileSong(p);
    expect(song.notes.map((n) => n.tick)).toEqual([0, 1920]);
    expect(song.notes[0].duration).toBe(1440);
    expect(automationValue(p.tracks[0], "volume", 1920, -12)).toBe(-10);
  });
  it("builds a five-minute 16-track reference project", () => {
    const p = createDemo(true);
    expect(p.tracks).toHaveLength(16);
    expect(tickToSeconds(projectEnd(p), p.tempo)).toBe(300);
    expect(compileSong(p).notes.length).toBeGreaterThan(10000);
  });
  it("preserves sample variations between full mix and stems", () => {
    const p = createDemo(),
      track = p.tracks[1];
    const mix = compileSong(p).notes.filter((n) => n.trackId === track.id),
      stem = compileSong(p, track.id).notes;
    expect(stem.map((n) => n.index)).toEqual(mix.map((n) => n.index));
  });
  it("exports muted MIDI tracks without losing the composition", () => {
    const p = createDemo();
    p.tracks.forEach((t) => (t.mute = true));
    const midi = new Midi(exportMidi(p));
    expect(midi.tracks.flatMap((t) => t.notes).length).toBeGreaterThan(100);
  });
  it("rejects oversized declared ZIP contents before decompression", async () => {
    const backup = await projectBackup(createProject(), async () => new Blob());
    const view = new DataView(
      backup.buffer,
      backup.byteOffset,
      backup.byteLength,
    );
    for (let i = 0; i < backup.length - 46; i++)
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 0xffffffff, true);
        break;
      }
    expect(() => restoreBackup(backup)).toThrow("Unsupported");
  });
});
