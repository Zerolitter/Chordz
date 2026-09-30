import { Midi } from "@tonejs/midi";
import { zip, unzipSync, strToU8, strFromU8, type Zippable } from "fflate";
import { PPQ, type ProjectDocument } from "../music/types";
import { projectSchema } from "../music/schema";
import { compileSong } from "./compile";

export type ExportFormat = "wav" | "mp3" | "stems" | "midi" | "backup";

export function exportMidi(project: ProjectDocument): Uint8Array {
  const midi = new Midi();
  midi.name = project.title;
  midi.header.setTempo(project.tempo);
  midi.header.timeSignatures = [
    { ticks: 0, timeSignature: project.timeSignature },
  ];
  const { notes, events } = compileSong(
      {
        ...project,
        tracks: project.tracks.map((t) => ({ ...t, mute: false, solo: false })),
      },
      undefined,
      false,
    ),
    ratio = midi.header.ppq / PPQ;
  const programs: Record<string, number> = {
    piano: 0,
    strings: 48,
    cello: 42,
    horn: 60,
    flute: 73,
    glock: 9,
    pad: 89,
    bass: 38,
    lead: 80,
  };
  project.tracks
    .filter((t) => t.kind === "instrument")
    .forEach((track, index) => {
      const out = midi.addTrack();
      out.name = track.name;
      out.channel = ["drums", "percussion"].includes(track.instrumentId)
        ? 9
        : index % 15 >= 9
          ? (index % 15) + 1
          : index % 15;
      out.instrument.number = programs[track.instrumentId] ?? 0;
      for (const n of notes.filter((n) => n.trackId === track.id))
        out.addNote({
          midi: n.pitch,
          ticks: Math.round(n.tick * ratio),
          durationTicks: Math.max(1, Math.round(n.duration * ratio)),
          velocity: n.velocity,
        });
      for (const e of events.filter((e) => e.trackId === track.id)) {
        if (e.type === "pitchBend")
          out.addPitchBend({
            ticks: Math.round(e.tick * ratio),
            value: e.value,
          });
        else if(e.type==="controlChange"&&e.cc!==undefined) {
          out.addCC({number:e.cc,ticks:Math.round(e.tick*ratio),value:Math.max(0,Math.min(1,e.value))});
        } else {
          const number = {
            sustain: 64,
            modulation: 1,
            expression: 11,
            pressure: 11,
          }[e.type as "sustain" | "modulation" | "expression" | "pressure"];
          if (number !== undefined)
            out.addCC({
              number,
              ticks: Math.round(e.tick * ratio),
              value: Math.max(0, Math.min(1, e.value)),
            });
        }
      }
    });
  return midi.toArray();
}
export const safeFilename = (title: string) =>
  title
    .replace(/[^\p{L}\p{N}._ -]/gu, "")
    .trim()
    .slice(0, 100) || "Chordz song";
export async function zipFiles(
  files: Record<string, Uint8Array>,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    zip(files as Zippable, { level: 1 }, (error, result) =>
      error ? reject(error) : resolve(result),
    ),
  );
}
export async function projectBackup(
  project: ProjectDocument,
  resolveAsset: (id: string) => Promise<Blob>,
): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {
    "project.json": strToU8(JSON.stringify(project)),
  };
  let total = 0;
  for (const asset of project.assets) {
    const blob = await resolveAsset(asset.id);
    total += blob.size;
    if (total > 512 * 1024 * 1024)
      throw new Error(
        "This backup exceeds 512 MB. Export the recordings separately or split the project.",
      );
    files["assets/" + asset.id] = new Uint8Array(await blob.arrayBuffer());
  }
  return zipFiles(files);
}
export function restoreBackup(bytes: Uint8Array): {
  document: ProjectDocument;
  assets: Map<string, Uint8Array>;
} {
  if (bytes.byteLength > 512 * 1024 * 1024)
    throw new Error("This backup exceeds the supported size.");
  // Inspect declared sizes before inflation so compressed archives cannot exhaust memory.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      view.getUint32(i, true) === 0x06054b50 &&
      i + 22 + view.getUint16(i + 20, true) === bytes.length
    ) {
      end = i;
      break;
    }
  if (
    end < 0 ||
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0
  )
    throw new Error("Invalid project archive.");
  const count = view.getUint16(end + 10, true),
    directory = view.getUint32(end + 16, true);
  if (count > 1001 || count === 65535 || directory >= end)
    throw new Error("This backup contains too much data.");
  let position = directory,
    total = 0;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (position + 46 > end || view.getUint32(position, true) !== 0x02014b50)
      throw new Error("Invalid project archive.");
    const size = view.getUint32(position + 24, true),
      nameLength = view.getUint16(position + 28, true),
      extra = view.getUint16(position + 30, true),
      comment = view.getUint16(position + 32, true);
    if (position + 46 + nameLength + extra + comment > end)
      throw new Error("Invalid project archive.");
    const name = strFromU8(
      bytes.subarray(position + 46, position + 46 + nameLength),
    );
    if (
      names.has(name) ||
      !(
        name === "project.json" || /^assets\/[a-zA-Z0-9_-]{1,96}$/.test(name)
      ) ||
      size > (name === "project.json" ? 1_800_000 : 100 * 1024 * 1024)
    )
      throw new Error("Unsupported file in project backup.");
    names.add(name);
    total += size;
    if (total > 512 * 1024 * 1024)
      throw new Error("This backup contains too much data.");
    position += 46 + nameLength + extra + comment;
  }
  if (position !== end) throw new Error("Invalid project archive.");
  const files = unzipSync(bytes, {
    filter: (file) =>
      file.originalSize <=
      (file.name === "project.json" ? 1_800_000 : 100 * 1024 * 1024),
  });
  if (!files["project.json"])
    throw new Error("This file is not a Chordz project backup.");
  if (
    Object.keys(files).length > 1001 ||
    Object.values(files).reduce((s, f) => s + f.length, 0) > 512 * 1024 * 1024
  )
    throw new Error("This backup contains too much data.");
  const document = projectSchema.parse(
    JSON.parse(strFromU8(files["project.json"])),
  );
  const assets = new Map<string, Uint8Array>();
  for (const ref of document.assets) {
    const data = files["assets/" + ref.id];
    if (!data || data.length !== ref.byteLength)
      throw new Error("An audio file is missing or damaged in this backup.");
    assets.set(ref.id, data);
  }
  return { document, assets };
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
