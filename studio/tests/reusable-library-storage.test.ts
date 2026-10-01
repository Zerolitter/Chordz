import { describe, expect, it } from "vitest";
import { createDemo } from "../lib/music/project";
import { createPhraseEntry } from "../lib/music/reusable-library";
import { LibraryStorage, type LibraryDatabase, type LibraryMutation, type LibraryPreferences } from "../lib/client/reusable-library-storage";

class DeviceDatabase implements LibraryDatabase {
  values = new Map<string, unknown>();
  quota = false;
  private preferenceJob: Promise<void> = Promise.resolve();
  async read<T>(store: string, key: string) { return structuredClone(this.values.get(store + key)) as T | undefined; }
  async scan<T>(store: string, prefix: string) {
    return [...this.values].filter(([key]) => key.startsWith(store + prefix)).map(([,value]) => structuredClone(value) as T);
  }
  async snapshot(owner: string, id: string) {
    const prefix = encodeURIComponent(owner) + ":", record = this.values.get("entries" + prefix + encodeURIComponent(id)) as {owner: string; entry: ReturnType<typeof createPhraseEntry>} | undefined;
    if (!record || record.owner !== owner) return undefined;
    return {entry: structuredClone(record.entry), blobs: new Map(record.entry.assets.map(asset => [asset.id, structuredClone(this.values.get("blobs" + prefix + encodeURIComponent(asset.id))) as Blob]))};
  }
  async atomic(mutations: LibraryMutation[], signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (this.quota) throw new DOMException("Full", "QuotaExceededError");
    const next = new Map(this.values);
    for (const mutation of mutations) {
      const key = mutation.store + mutation.key;
      if (mutation.type === "put") next.set(key, structuredClone(mutation.value));
      else next.delete(key);
    }
    this.values = next;
  }
  modifyPreferences(owner: string, update: (preferences: LibraryPreferences) => LibraryPreferences, mutations: LibraryMutation[] = []) {
    const job = this.preferenceJob.catch(() => {}).then(async () => {
      const key = encodeURIComponent(owner) + ":discovery", preferences = await this.read<LibraryPreferences>("preferences", key) ?? {version: 1, favorites: [], recents: []};
      await this.atomic([...mutations, {store: "preferences", key, type: "put", value: update(preferences)}]);
    });
    this.preferenceJob = job; return job;
  }
}
function source() {
  const project = createDemo(), track = project.tracks[0];
  const entry = createPhraseEntry(project, track, track.clips[0], "Four chords");
  const asset = { id: "original-audio", name: "My sample", mime: "audio/wav", byteLength: 4, duration: 1, sampleRate: 48000, channels: 1 };
  entry.assets = [asset];
  entry.sound.instrument.zones = [{ assetId: asset.id, root: 60, low: 0, high: 127, velocityLow: 0, velocityHigh: 1, roundRobin: 0, articulation: "sustain" }];
  return { entry, blobs: new Map([[asset.id, new Blob([new Uint8Array([1,2,3,4])], {type: asset.mime})]]) };
}

describe("independent device library", () => {
  it("isolates owners and stores fresh entry, clip, note, manifest and asset identities", async () => {
    const storage = new LibraryStorage(new DeviceDatabase()), original = source();
    const saved = await storage.save("owner:a", original.entry, original.blobs);
    expect(saved.id).not.toBe(original.entry.id);
    expect(saved.clip!.id).not.toBe(original.entry.clip!.id);
    expect(saved.clip!.notes[0].id).not.toBe(original.entry.clip!.notes[0].id);
    expect(saved.sound.instrument.id).not.toBe(original.entry.sound.instrument.id);
    expect(saved.assets[0].id).not.toBe("original-audio");
    expect(saved.sound.instrument.zones[0].assetId).toBe(saved.assets[0].id);
    expect(await storage.list("owner")).toEqual([]);
    expect(await storage.acquire("other", saved.id)).toBeUndefined();
    original.entry.clip!.notes[0].pitch = 100;
    const lease = (await storage.acquire("owner:a", saved.id))!;
    expect(lease.entry.clip!.notes[0].pitch).not.toBe(100);
    expect(Object.isFrozen(lease.entry.clip!.notes)).toBe(true);
    expect(await lease.blobs.get(saved.assets[0].id)!.arrayBuffer()).toEqual(await original.blobs.get("original-audio")!.arrayBuffer());
    await lease.release();
  });
  it("deleting a library entry retains leased bytes until the job releases them", async () => {
    const db = new DeviceDatabase(), storage = new LibraryStorage(db), original = source();
    const saved = await storage.save("a", original.entry, original.blobs);
    const first = (await storage.acquire("a", saved.id))!, second = (await storage.acquire("a", saved.id))!;
    await storage.remove("a", saved.id);
    expect(await storage.list("a")).toEqual([]);
    expect(await storage.acquire("a", saved.id)).toBeUndefined();
    expect([...db.values.keys()].some(key => key.includes(saved.assets[0].id))).toBe(true);
    await first.release();
    expect(await second.blobs.get(saved.assets[0].id)!.arrayBuffer()).toEqual(await original.blobs.get("original-audio")!.arrayBuffer());
    await second.release();
    await second.release();
    expect([...db.values.keys()].some(key => key.includes(saved.assets[0].id))).toBe(false);
  });
  it("commits imports atomically and leaves no rows after quota failure or cancellation", async () => {
    const db = new DeviceDatabase(), storage = new LibraryStorage(db), original = source();
    db.quota = true;
    await expect(storage.saveMany("a", [original, original])).rejects.toThrow();
    expect(db.values.size).toBe(0);
    db.quota = false;
    const controller = new AbortController(); controller.abort();
    await expect(storage.saveMany("a", [original], {signal: controller.signal})).rejects.toThrow();
    expect(db.values.size).toBe(0);
    const saved = await storage.saveMany("a", [original, original]);
    expect(saved[0].assets[0].id).not.toBe(saved[1].assets[0].id);
    expect(await storage.list("a")).toHaveLength(2);
  });
  it("rejects missing and extra blobs before storing any reusable content", async () => {
    const db = new DeviceDatabase(), storage = new LibraryStorage(db), original = source();
    await expect(storage.save("a", original.entry, new Map())).rejects.toThrow(/missing|exact/i);
    original.blobs.set("unused", new Blob(["x"]));
    await expect(storage.save("a", original.entry, original.blobs)).rejects.toThrow(/exact|unexpected/i);
    expect(db.values.size).toBe(0);
  });
  it("keeps discovery preferences scoped and updates recents only through explicit successful use", async () => {
    const storage = new LibraryStorage(new DeviceDatabase());
    await storage.setFavorite("a", "factory:piano", true);
    await storage.setFavorite("a", "idea:bass", true);
    expect((await storage.preferences("a")).recents).toEqual([]);
    await storage.markRecent("a", "factory:piano");
    await storage.markRecent("a", "idea:bass");
    await storage.markRecent("a", "factory:piano");
    expect(await storage.preferences("a")).toEqual({ version: 1, favorites: ["factory:piano", "idea:bass"], recents: ["factory:piano", "idea:bass"] });
    expect(await storage.preferences("b")).toEqual({ version: 1, favorites: [], recents: [] });
  });
  it("removes a deleted saved item from favorites and recents atomically while retaining other items and leases", async () => {
    const storage = new LibraryStorage(new DeviceDatabase()), original = source(), saved = await storage.save("a", original.entry, original.blobs);
    await storage.setFavorite("a", saved.id, true); await storage.setFavorite("a", "factory:piano", true);
    await storage.markRecent("a", "idea:bass"); await storage.markRecent("a", saved.id);
    const lease = (await storage.acquire("a", saved.id))!;
    await storage.remove("a", saved.id);
    expect(await storage.preferences("a")).toEqual({version: 1, favorites: ["factory:piano"], recents: ["idea:bass"]});
    expect(await lease.blobs.get(saved.assets[0].id)!.arrayBuffer()).toEqual(await original.blobs.get("original-audio")!.arrayBuffer());
    await lease.release();
  });
  it("preserves simultaneous favorites, recents and deletion from independent tabs", async () => {
    const db = new DeviceDatabase(), first = new LibraryStorage(db), second = new LibraryStorage(db), owner = "shared-device-owner";
    await Promise.all([first.setFavorite(owner, "factory:piano", true), second.setFavorite(owner, "factory:lead", true)]);
    expect(new Set((await first.preferences(owner)).favorites)).toEqual(new Set(["factory:piano", "factory:lead"]));
    await Promise.all([first.markRecent(owner, "idea:bass"), second.markRecent(owner, "idea:drums")]);
    expect(new Set((await first.preferences(owner)).recents)).toEqual(new Set(["idea:bass", "idea:drums"]));
    const original = source(), saved = await first.save(owner, original.entry, original.blobs);
    await first.setFavorite(owner, saved.id, true); await first.markRecent(owner, saved.id);
    await Promise.all([first.remove(owner, saved.id), second.setFavorite(owner, "factory:pad", true)]);
    const preferences = await second.preferences(owner);
    expect(new Set(preferences.favorites)).toEqual(new Set(["factory:piano", "factory:lead", "factory:pad"]));
    expect(new Set(preferences.recents)).toEqual(new Set(["idea:bass", "idea:drums"]));
  });
});
