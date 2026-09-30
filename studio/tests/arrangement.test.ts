import { describe, expect, it } from "vitest";
import { createProject, createTrack, emptyClip } from "../lib/music/project";
import { PPQ } from "../lib/music/types";
import { historyReducer, type History } from "../lib/music/edit";
import { applyPreview, commitTransaction, previewEdit, type EditTransaction } from "../lib/music/transactions";
import { projectSchema } from "../lib/music/schema";
import { projectBackup, restoreBackup } from "../lib/audio/export";
import { encodeWav } from "../lib/audio/wav";
import {
  moveClipOnGrid,
  resizeClipOnGrid,
  automationPointAt,
  putAutomationPoint,
  moveAutomationPoint,
} from "../lib/music/arrangement";

describe("arrangement clip gestures", () => {
  it("moves on the chosen grid, clamps the start, and keeps source material intact", () => {
    const clip = { ...emptyClip(960, 3840), loop: true, sourceLengthTick: 1920,
      notes: [{ id: "note", tick: 120, duration: 720, pitch: 64, velocity: .7 }],
      audio: { assetId: "take", offsetSec: 1.25, gain: .8, fadeInSec: .1, fadeOutSec: .2 } };
    const moved = moveClipOnGrid(clip, 640, PPQ / 4);
    expect(moved.startTick).toBe(1680);
    expect({ ...moved, startTick: clip.startTick }).toEqual(clip);
    expect(moveClipOnGrid(clip, -10000, PPQ / 4).startTick).toBe(0);
    expect(moveClipOnGrid(clip, 0, PPQ / 4)).toBe(clip);
  });

  it("resizes the visible region without changing loop length, audio trim, notes, or expression", () => {
    const clip = { ...emptyClip(0, 3840), sourceLengthTick: 1920, loop: true,
      events: [{ tick: 100, type: "expression" as const, value: .6 }],
      audio: { assetId: "take", offsetSec: 3.5, gain: 1, fadeInSec: .2, fadeOutSec: .3 } };
    const resized = resizeClipOnGrid(clip, 550, PPQ / 4);
    expect(resized.lengthTick).toBe(4320);
    expect({ ...resized, lengthTick: clip.lengthTick }).toEqual(clip);
    expect(resizeClipOnGrid(clip, -10000, PPQ / 4).lengthTick).toBe(PPQ / 4);
    expect(resizeClipOnGrid(clip, 0, PPQ / 4)).toBe(clip);
  });

  it("many resize previews commit as one Undo and cancelling restores the complete source", () => {
    const project = createProject();
    const source = { ...emptyClip(0, 3840), sourceLengthTick: 1920, loop: true };
    project.tracks[0].clips = [source];
    let view = project;
    let transaction: EditTransaction = { owner: "clip", projectId: project.id, label: "Resize clip", patches: [], invalid: null };
    for (const delta of [240, 480, 960]) {
      const next = { ...view, tracks: view.tracks.map(track => ({ ...track, clips: [resizeClipOnGrid(source, delta, 240)] })) };
      transaction = previewEdit(transaction, view, next);
      view = applyPreview(project, transaction);
    }
    expect(view.tracks[0].clips[0].lengthTick).toBe(4800);
    expect(applyPreview(project, null)).toEqual(project);
    const result = commitTransaction(project, transaction);
    if (!result.ok) throw Error(result.error);
    let history: History = { present: project, past: [], future: [], label: "" };
    history = historyReducer(history, { type: "commit", project: result.document, label: "Resize clip" });
    expect(history.past).toHaveLength(1);
    history = historyReducer(history, { type: "undo" });
    expect(history.present).toEqual(project);
    history = historyReducer(history, { type: "redo" });
    expect(history.present.tracks[0].clips[0]).toEqual({ ...source, lengthTick: 4800 });
  });
});

describe("editable automation curves", () => {
  it("snaps time and clamps coordinates to the visible song and parameter range", () => {
    expect(automationPointAt(.53, .5, 3840, PPQ / 4, "pan")).toEqual({ tick: 1920, value: 0 });
    expect(automationPointAt(-.5, 2, 3840, PPQ / 4, "volume")).toEqual({ tick: 0, value: -60 });
    expect(automationPointAt(2, -1, 3840, PPQ / 4, "cutoff")).toEqual({ tick: 3840, value: 18000 });
  });

  it("inserts a sorted point and replaces a same-tick point without mutating the source", () => {
    const source = [{ tick: 960, value: .2 }, { tick: 0, value: -.5 }];
    expect(putAutomationPoint(source, { tick: 960, value: 2 }, "pan", 3840))
      .toEqual([{ tick: 0, value: -.5 }, { tick: 960, value: 1 }]);
    expect(source).toEqual([{ tick: 960, value: .2 }, { tick: 0, value: -.5 }]);
    expect(putAutomationPoint([{ tick: 0, value: .1 }, { tick: 0, value: .2 }], { tick: 960, value: .5 }, "pan", 3840))
      .toEqual([{ tick: 0, value: .2 }, { tick: 960, value: .5 }]);
  });

  it("moving a point onto another time replaces the collision and leaves one point per tick", () => {
    const source = [{ tick: 0, value: 0 }, { tick: 960, value: .3 }, { tick: 1920, value: .6 }];
    expect(moveAutomationPoint(source, 0, { tick: 1920, value: -.4 }, "pan", 3840))
      .toEqual([{ tick: 960, value: .3 }, { tick: 1920, value: -.4 }]);
    expect(moveAutomationPoint(source, 960, { tick: 99999, value: 99 }, "expression", 3840))
      .toEqual([{ tick: 0, value: 0 }, { tick: 1920, value: .6 }, { tick: 3840, value: 1 }]);
  });

  it("keeps a legacy point's time when only its value changes beyond the current song end", () => {
    const source = [{ tick: 0, value: -.5 }, { tick: 96000, value: .3 }];
    expect(moveAutomationPoint(source, 96000, { tick: 96000, value: 2 }, "pan", 3840))
      .toEqual([{ tick: 0, value: -.5 }, { tick: 96000, value: 1 }]);
    expect(source).toEqual([{ tick: 0, value: -.5 }, { tick: 96000, value: .3 }]);
    expect(moveAutomationPoint(source, 96000, { tick: 96001, value: .2 }, "pan", 3840))
      .toEqual([{ tick: 0, value: -.5 }, { tick: 3840, value: .2 }]);
  });

  it("maps the graph to supported ticks even when a valid clip extends the song beyond that bound", () => {
    const middle = automationPointAt(.5, .5, 2_000_000_000, 1000, "pan");
    expect(middle).toEqual({ tick: 500_000_000, value: 0 });
    const edge = automationPointAt(2, -1, 2_000_000_000, 240, "pan");
    expect(edge).toEqual({ tick: 1_000_000_000, value: 1 });
    expect(putAutomationPoint([], edge, "pan", 2_000_000_000)).toEqual([edge]);
  });
});

describe("arrangement persistence compatibility", () => {
  it("round trips edited regions and automation through v1 JSON and a portable backup with its take", async () => {
    const project = createProject("Arrangement round trip");
    const musical = { ...emptyClip(0, 3840), sourceLengthTick: 1920, loop: true,
      notes: [{ id: "note", tick: 480, duration: 720, pitch: 64, velocity: .7 }],
      events: [{ tick: 120, type: "expression" as const, value: .6 }] };
    project.tracks[0].clips = [resizeClipOnGrid(moveClipOnGrid(musical, 960, 240), 960, 240)];
    const take = new Blob([encodeWav([new Float32Array(240000)], 48000, 16)], { type: "audio/wav" });
    const audioTrack = createTrack("piano", "Recorded take", "#8d9190", "audio");
    const region = { ...emptyClip(0, 3840), audio: { assetId: "take", offsetSec: 1.25, gain: .8, fadeInSec: .1, fadeOutSec: .2 } };
    audioTrack.clips = [resizeClipOnGrid(moveClipOnGrid(region, 1920, 240), -960, 240)];
    project.tracks.push(audioTrack);
    project.assets = [{ id: "take", name: "Take.wav", mime: "audio/wav", byteLength: take.size, duration: 5, sampleRate: 48000, channels: 1 }];
    let points = putAutomationPoint([], { tick: 0, value: -12 }, "volume", 30720);
    points = putAutomationPoint(points, { tick: 1920, value: -6 }, "volume", 30720);
    points = moveAutomationPoint(points, 0, { tick: 960, value: -9 }, "volume", 30720);
    project.tracks[0].automation = [{ parameter: "volume", points }];
    const reloaded = projectSchema.parse(JSON.parse(JSON.stringify(project)));
    expect(reloaded).toEqual(project);
    const bytes = await projectBackup(reloaded, async id => {
      expect(id).toBe("take"); return take;
    });
    const restored = restoreBackup(bytes);
    expect(restored.document).toEqual(project);
    expect(restored.assets.get("take"))
      .toEqual(new Uint8Array(await take.arrayBuffer()));
    expect(restored.document.tracks[0].clips[0]).toEqual({ ...musical, startTick: 960, lengthTick: 4800 });
    expect(restored.document.tracks[1].clips[0]).toEqual({ ...region, startTick: 1920, lengthTick: 2880 });
  });

  it("clip gesture extremes stay within the existing v1 per-field tick bounds", () => {
    const project = createProject(), clip = emptyClip(0, 3840);
    project.tracks[0].clips = [resizeClipOnGrid(moveClipOnGrid(clip, 2_000_000_000, 240), 2_000_000_000, 240)];
    expect(project.tracks[0].clips[0].startTick).toBe(1_000_000_000);
    expect(project.tracks[0].clips[0].lengthTick).toBe(1_000_000_000);
    expect(projectSchema.safeParse(project).success).toBe(true);
  });
});
