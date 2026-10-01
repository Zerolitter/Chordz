import { describe, expect, it } from "vitest";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { createDemo } from "../lib/music/project";
import { createPhraseEntry } from "../lib/music/reusable-library";
import { decodeLibraryArchive, encodeLibraryArchive } from "../lib/client/library-archive";

function snapshot() {
  const project = createDemo(), track = project.tracks[0], entry = createPhraseEntry(project, track, track.clips[0], "Saved phrase");
  const asset = {id: "sample-one", name: "One", mime: "audio/wav", byteLength: 4, duration: 1, sampleRate: 48000, channels: 1};
  entry.assets = [asset];
  entry.sound.instrument.zones = [{assetId: asset.id, root: 60, low: 0, high: 127, velocityLow: 0, velocityHigh: 1, roundRobin: 0, articulation: "sustain"}];
  return {entry, blobs: new Map([[asset.id, new Blob([new Uint8Array([0,1,2,3])], {type: asset.mime})]])};
}
describe("bounded portable library archives", () => {
  it("round trips complete phrases and exact original sample bytes", async () => {
    const original = snapshot(), bytes = await encodeLibraryArchive([original]), restored = await decodeLibraryArchive(bytes);
    expect(restored[0].entry).toEqual(original.entry);
    expect(await restored[0].blobs.get("sample-one")!.arrayBuffer()).toEqual(await original.blobs.get("sample-one")!.arrayBuffer());
  });
  it("rejects missing, undeclared and same-length corrupted files before import", async () => {
    const bytes = await encodeLibraryArchive([snapshot()]);
    const missing = unzipSync(bytes); delete missing["assets/sample-one"];
    await expect(decodeLibraryArchive(zipSync(missing))).rejects.toThrow(/missing|exact/i);
    const extra = unzipSync(bytes); extra["assets/unused"] = new Uint8Array([7]);
    await expect(decodeLibraryArchive(zipSync(extra))).rejects.toThrow(/exact|undeclared/i);
    const damaged = unzipSync(bytes); damaged["assets/sample-one"][1] = 9;
    await expect(decodeLibraryArchive(zipSync(damaged))).rejects.toThrow(/damaged|integrity/i);
  });
  it("rejects malformed versions and duplicate identities", async () => {
    const files = unzipSync(await encodeLibraryArchive([snapshot()]));
    const manifest = JSON.parse(strFromU8(files["library.json"]));
    manifest.version = 2; files["library.json"] = strToU8(JSON.stringify(manifest));
    await expect(decodeLibraryArchive(zipSync(files))).rejects.toThrow();
    manifest.version = 1; manifest.entries.push(manifest.entries[0]); files["library.json"] = strToU8(JSON.stringify(manifest));
    await expect(decodeLibraryArchive(zipSync(files))).rejects.toThrow(/duplicate/i);
  });
  it("rejects path traversal and oversized declared contents before inflation", async () => {
    const files = unzipSync(await encodeLibraryArchive([snapshot()])); files["../outside"] = new Uint8Array([0]);
    await expect(decodeLibraryArchive(zipSync(files))).rejects.toThrow(/unsupported/i);
    const bytes = await encodeLibraryArchive([snapshot()]), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < bytes.length - 46; i++) if (view.getUint32(i, true) === 0x02014b50) {view.setUint32(i + 24, 0xffffffff, true); break;}
    await expect(decodeLibraryArchive(bytes)).rejects.toThrow(/unsupported|size/i);
  });
  it("rejects incomplete export snapshots instead of producing an unrestorable backup", async () => {
    const original = snapshot(); original.blobs.clear();
    await expect(encodeLibraryArchive([original])).rejects.toThrow(/missing|exact/i);
  });
  it("uses the validated EOCD when a standard ZIP comment contains a misleading signature", async () => {
    const bytes = await encodeLibraryArchive([snapshot()]), comment = new Uint8Array(22), commentView = new DataView(comment.buffer);
    commentView.setUint32(0, 0x06054b50, true); commentView.setUint16(20, 1, true); // fflate's scanner ignores the invalid comment length.
    const commented = new Uint8Array(bytes.length + comment.length); commented.set(bytes); commented.set(comment, bytes.length);
    new DataView(commented.buffer).setUint16(bytes.length - 2, comment.length, true);
    const restored = await decodeLibraryArchive(commented);
    expect(restored[0].entry.name).toBe("Saved phrase");
    expect(await restored[0].blobs.get("sample-one")!.arrayBuffer()).toEqual(await snapshot().blobs.get("sample-one")!.arrayBuffer());
  });
  it("rejects ZIP64 locator signatures that could redirect the unzip parser", async () => {
    const bytes = await encodeLibraryArchive([snapshot()]), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), end = bytes.length - 22;
    let last = view.getUint32(end + 16, true);
    for (let i = 1; i < view.getUint16(end + 10, true); i++) last += 46 + view.getUint16(last + 28, true) + view.getUint16(last + 30, true) + view.getUint16(last + 32, true);
    const modified = new Uint8Array(bytes.length + 20); modified.set(bytes.subarray(0, end)); modified.set(bytes.subarray(end), end + 20);
    const modifiedView = new DataView(modified.buffer); modifiedView.setUint16(last + 32, 20, true); modifiedView.setUint32(end, 0x07064b50, true); modifiedView.setUint32(end + 20 + 12, view.getUint32(end + 12, true) + 20, true);
    await expect(decodeLibraryArchive(modified)).rejects.toThrow(/ZIP64|unsupported/i);
  });
  it("rejects stored files whose compressed and expanded declarations disagree", async () => {
    const bytes = zipSync(unzipSync(await encodeLibraryArchive([snapshot()])), {level: 0}), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < bytes.length - 46; i++) if (view.getUint32(i, true) === 0x02014b50 && view.getUint16(i + 10, true) === 0) {view.setUint32(i + 24, view.getUint32(i + 20, true) - 1, true); break;}
    await expect(decodeLibraryArchive(bytes)).rejects.toThrow(/declaration|invalid|unsupported/i);
  });
  it("rejects contradictory local file sizes instead of trusting only central metadata", async () => {
    const bytes = await encodeLibraryArchive([snapshot()]), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(22, 0xffffffff, true);
    await expect(decodeLibraryArchive(bytes)).rejects.toThrow(/declaration|invalid|unsupported/i);
  });
  it("rejects extra expanded bytes even when forged declarations and prefix hashes match", async () => {
    const files = unzipSync(await encodeLibraryArchive([snapshot()])); files["assets/sample-one"] = new Uint8Array([0,1,2,3,9,9,9,9]);
    const bytes = zipSync(files), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(22, 4, true);
    for (let i = 0; i < bytes.length - 46; i++) if (view.getUint32(i, true) === 0x02014b50) {view.setUint32(i + 24, 4, true); break;}
    await expect(decodeLibraryArchive(bytes)).rejects.toThrow(/expanded|declaration|damaged|size/i);
  });
  it("decodes original bytes across multiple bounded compressed chunks", async () => {
    const original = snapshot(), data = new Uint8Array(65_537); let state = 29;
    for (let i = 0; i < data.length; i++) {state = (Math.imul(state, 1664525) + 1013904223) >>> 0; data[i] = state >>> 24;}
    original.entry.assets[0].byteLength = data.length; original.blobs.set("sample-one", new Blob([data]));
    const restored = await decodeLibraryArchive(await encodeLibraryArchive([original]));
    expect(new Uint8Array(await restored[0].blobs.get("sample-one")!.arrayBuffer())).toEqual(data);
  });
});
