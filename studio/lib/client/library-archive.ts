import { Inflate, strFromU8, strToU8 } from "fflate";
import { z } from "zod";
import { zipFiles } from "../audio/export";
import { idSchema } from "../music/schema";
import { libraryEntrySchema, type LibraryEntry } from "../music/reusable-library";
import { deviceLibrary, type LibrarySnapshot, type LibraryWriteOptions } from "./reusable-library-storage";

const MAX_TOTAL = 512 * 1024 * 1024, MAX_ASSET = 100 * 1024 * 1024, MAX_MANIFEST = 1_800_000;
const manifestSchema = z.object({
  format: z.literal("chordz-library"), version: z.literal(1),
  entries: z.array(libraryEntrySchema).max(500),
  files: z.array(z.object({id: idSchema, byteLength: z.number().int().min(1).max(MAX_ASSET), sha256: z.string().regex(/^[0-9a-f]{64}$/)}).strict()).max(1000),
}).strict();
async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, "0")).join("");
}
interface ArchiveFile { name: string; start: number; compressedSize: number; expandedSize: number; method: number; }
/** Inspect central and local declarations before any ZIP data is inflated. */
function inspectArchive(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_TOTAL) throw new Error("This library archive exceeds the supported size.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) {end = i; break;}
  if (end < 0 || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0)
    throw new Error("Invalid library archive.");
  if (end >= 20 && view.getUint32(end - 20, true) === 0x07064b50) throw new Error("ZIP64 library archives are unsupported.");
  const count = view.getUint16(end + 10, true), directory = view.getUint32(end + 16, true);
  if (count > 1001 || count !== view.getUint16(end + 8, true) || directory > end || view.getUint32(end + 12, true) !== end - directory)
    throw new Error("This library archive contains too much data.");
  let position = directory, total = 0;
  const names = new Set<string>(), files: ArchiveFile[] = [], ranges: {start: number; end: number}[] = [];
  for (let i = 0; i < count; i++) {
    if (position + 46 > end || view.getUint32(position, true) !== 0x02014b50) throw new Error("Invalid library archive.");
    const size = view.getUint32(position + 24, true), compressedSize = view.getUint32(position + 20, true),
      nameLength = view.getUint16(position + 28, true), extra = view.getUint16(position + 30, true), comment = view.getUint16(position + 32, true),
      flags = view.getUint16(position + 8, true), method = view.getUint16(position + 10, true), local = view.getUint32(position + 42, true);
    if (position + 46 + nameLength + extra + comment > end) throw new Error("Invalid library archive.");
    const name = strFromU8(bytes.subarray(position + 46, position + 46 + nameLength));
    if (names.has(name) || !(name === "library.json" || /^assets\/[a-zA-Z0-9_-]{1,96}$/.test(name)) ||
      size > (name === "library.json" ? MAX_MANIFEST : MAX_ASSET) || (flags & 1) || (method !== 0 && method !== 8) || view.getUint16(position + 34, true) !== 0)
      throw new Error("Unsupported file in library archive.");
    if (method === 0 && compressedSize !== size) throw new Error("Invalid stored-file size declarations in library archive.");
    if (local + 30 > directory || view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method)
      throw new Error("Invalid library archive.");
    const localNameLength = view.getUint16(local + 26, true), localExtra = view.getUint16(local + 28, true), dataStart = local + 30 + localNameLength + localExtra;
    if (dataStart + compressedSize > directory || strFromU8(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name)
      throw new Error("Invalid library archive.");
    const crc = view.getUint32(position + 16, true), localCrc = view.getUint32(local + 14, true), localCompressed = view.getUint32(local + 18, true), localExpanded = view.getUint32(local + 22, true);
    if (flags & 8) {
      if ((localCrc !== 0 && localCrc !== crc) || (localCompressed !== 0 && localCompressed !== compressedSize) || (localExpanded !== 0 && localExpanded !== size))
        throw new Error("Contradictory local file declarations in library archive.");
    } else if (localCrc !== crc || localCompressed !== compressedSize || localExpanded !== size)
      throw new Error("Contradictory local file declarations in library archive.");
    let dataEnd = dataStart + compressedSize;
    if (flags & 8) {
      if (dataEnd + 12 > directory) throw new Error("Invalid library data descriptor.");
      const descriptor = view.getUint32(dataEnd, true) === 0x08074b50 ? dataEnd + 4 : dataEnd;
      if (descriptor + 12 > directory || view.getUint32(descriptor, true) !== crc || view.getUint32(descriptor + 4, true) !== compressedSize || view.getUint32(descriptor + 8, true) !== size)
        throw new Error("Contradictory library data descriptor.");
      dataEnd = descriptor + 12;
    }
    ranges.push({start: local, end: dataEnd});
    files.push({name, start: dataStart, compressedSize, expandedSize: size, method});
    names.add(name); total += size;
    if (total > MAX_TOTAL) throw new Error("This library archive contains too much data.");
    position += 46 + nameLength + extra + comment;
  }
  if (position !== end || !names.has("library.json")) throw new Error("This file is not a Chordz library archive.");
  ranges.sort((a,b) => a.start - b.start);
  if (ranges.some((range, i) => i > 0 && range.start < ranges[i - 1].end)) throw new Error("Overlapping file ranges in library archive.");
  return files;
}

function expandFile(bytes: Uint8Array, file: ArchiveFile): Uint8Array {
  const compressed = bytes.subarray(file.start, file.start + file.compressedSize);
  if (file.method === 0) return new Uint8Array(compressed);
  const output = new Uint8Array(file.expandedSize);
  let written = 0;
  const inflater = new Inflate(chunk => {
    if (written + chunk.byteLength > file.expandedSize) throw new Error("A library file exceeds its declared expanded size.");
    output.set(chunk, written); written += chunk.byteLength;
  });
  // Small compressed pushes bound each temporary decoder allocation. Checking
  // every emitted chunk also rejects forged sizes rather than truncating bytes.
  for (let offset = 0; offset < compressed.byteLength; offset += 4096)
    inflater.push(compressed.subarray(offset, Math.min(offset + 4096, compressed.byteLength)), offset + 4096 >= compressed.byteLength);
  if (written !== file.expandedSize) throw new Error("A library file does not match its declared expanded size.");
  return output;
}

export async function encodeLibraryArchive(snapshots: LibrarySnapshot[]): Promise<Uint8Array> {
  const entries = snapshots.map(snapshot => libraryEntrySchema.parse(structuredClone(snapshot.entry)));
  if (entries.length > 500 || new Set(entries.map(e => e.id)).size !== entries.length) throw new Error("Too many or duplicate library entries.");
  const files: Record<string, Uint8Array> = {}, descriptors: z.infer<typeof manifestSchema>["files"] = [];
  let total = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i], blobs = snapshots[i].blobs;
    if (blobs.size !== entry.assets.length) throw new Error("A library backup requires exactly its declared audio files.");
    for (const asset of entry.assets) {
      const blob = blobs.get(asset.id);
      if (!blob || blob.size !== asset.byteLength) throw new Error("A declared library audio file is missing or damaged.");
      const bytes = new Uint8Array(await blob.arrayBuffer()), sha256 = await digest(bytes), previous = descriptors.find(file => file.id === asset.id);
      if (previous) {
        if (previous.byteLength !== bytes.length || previous.sha256 !== sha256) throw new Error("Conflicting library asset identities.");
        continue;
      }
      total += bytes.length;
      if (total > MAX_TOTAL || bytes.length > MAX_ASSET || descriptors.length >= 1000) throw new Error("This library archive exceeds the supported size.");
      files["assets/" + asset.id] = bytes;
      descriptors.push({id: asset.id, byteLength: bytes.length, sha256});
    }
  }
  const manifest = strToU8(JSON.stringify(manifestSchema.parse({format: "chordz-library", version: 1, entries, files: descriptors})));
  if (manifest.byteLength > MAX_MANIFEST || total + manifest.byteLength > MAX_TOTAL) throw new Error("This library manifest exceeds the supported size.");
  files["library.json"] = manifest;
  return zipFiles(files);
}

export async function decodeLibraryArchive(bytes: Uint8Array): Promise<LibrarySnapshot[]> {
  const inspected = inspectArchive(bytes);
  const files = Object.fromEntries(inspected.map(file => [file.name, expandFile(bytes, file)]));
  const manifest = manifestSchema.parse(JSON.parse(strFromU8(files["library.json"])));
  if (new Set(manifest.entries.map(e => e.id)).size !== manifest.entries.length || new Set(manifest.files.map(file => file.id)).size !== manifest.files.length)
    throw new Error("Duplicate identity in library archive.");
  const refs = new Map(manifest.entries.flatMap(entry => entry.assets).map(asset => [asset.id, asset]));
  if (manifest.files.length !== refs.size || inspected.length !== refs.size + 1)
    throw new Error("A library archive requires exactly its declared audio files; missing or undeclared files were found.");
  const blobs = new Map<string, Blob>();
  for (const file of manifest.files) {
    const ref = refs.get(file.id), data = files["assets/" + file.id];
    if (!ref || !data || file.byteLength !== ref.byteLength || data.byteLength !== ref.byteLength || await digest(data) !== file.sha256)
      throw new Error("A library audio file is missing or damaged; integrity validation failed.");
    blobs.set(file.id, new Blob([new Uint8Array(data)], {type: ref.mime}));
  }
  // Every entry references a validated independent source; storage gives each import fresh copies.
  return manifest.entries.map(entry => ({entry, blobs: new Map(entry.assets.map(asset => [asset.id, blobs.get(asset.id)!]))}));
}

export async function exportLibraryArchive(owner: string, ids?: string[]): Promise<Uint8Array> {
  const entries = ids ?? (await deviceLibrary.list(owner)).map(entry => entry.id), leases = [];
  try {
    for (const id of entries) {
      const lease = await deviceLibrary.acquire(owner, id);
      if (!lease) throw new Error("A library entry was removed before the backup could be prepared.");
      leases.push(lease);
    }
    return await encodeLibraryArchive(leases);
  } finally { await Promise.all(leases.map(lease => lease.release())); }
}
export async function importLibraryArchive(owner: string, bytes: Uint8Array, options?: LibraryWriteOptions): Promise<LibraryEntry[]> {
  if (options?.signal?.aborted) throw new DOMException("Library import cancelled.", "AbortError");
  const snapshots = await decodeLibraryArchive(bytes);
  return deviceLibrary.saveMany(owner, snapshots, options);
}
