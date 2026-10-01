import { libraryEntrySchema, materializeLibraryEntry, type LibraryEntry } from "../music/reusable-library";

export type LibraryStore = "entries" | "blobs" | "preferences" | "deletions";
export type LibraryMutation = { store: LibraryStore; key: string; type: "delete" } | { store: LibraryStore; key: string; type: "put"; value: unknown };
/** Atomic boundary also used by device-storage regression tests. */
export interface LibraryDatabase {
  read<T>(store: LibraryStore, key: string): Promise<T | undefined>;
  scan<T>(store: LibraryStore, prefix: string): Promise<T[]>;
  snapshot(owner: string, id: string): Promise<LibrarySnapshot | undefined>;
  atomic(mutations: LibraryMutation[], signal?: AbortSignal): Promise<void>;
  modifyPreferences(owner: string, update: (preferences: LibraryPreferences) => LibraryPreferences, mutations?: LibraryMutation[]): Promise<void>;
}
export interface LibraryPreferences { version: 1; favorites: string[]; recents: string[]; }
export interface LibrarySnapshot { entry: LibraryEntry; blobs: Map<string, Blob>; }
export interface LibraryLease extends LibrarySnapshot { release(): Promise<void>; }
interface EntryRecord { owner: string; entry: LibraryEntry; }
interface DeletionRecord { owner: string; id: string; assets: string[]; }
export interface LibraryWriteOptions { signal?: AbortSignal; }

function ownerPrefix(owner: string) {
  if (!owner || owner.length > 512) throw new Error("A library owner is required.");
  return encodeURIComponent(owner) + ":";
}
const keyFor = (owner: string, id: string) => ownerPrefix(owner) + encodeURIComponent(id);
function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Library operation cancelled.", "AbortError");
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
const emptyPreferences = (): LibraryPreferences => ({ version: 1, favorites: [], recents: [] });
function normalizePreferences(stored?: LibraryPreferences): LibraryPreferences {
  if (!stored || stored.version !== 1) return emptyPreferences();
  const valid = (items: unknown) => Array.isArray(items) ? [...new Set(items.filter((item): item is string => typeof item === "string" && !!item && item.length <= 256))] : [];
  return {version: 1, favorites: valid(stored.favorites).slice(0, 1000), recents: valid(stored.recents).slice(0, 100)};
}
function preferenceId(id: string) {
  if (!id || id.length > 256) throw new Error("Invalid library item identifier.");
  return id;
}

class IndexedLibraryDatabase implements LibraryDatabase {
  private database: Promise<IDBDatabase> | undefined;
  private open() {
    if (!this.database) this.database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("chordz-library-v1", 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        for (const name of ["entries", "blobs", "preferences", "deletions"])
          if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      };
      request.onsuccess = () => {
        if (blocked) {request.result.close(); return;}
        request.result.onversionchange = () => {request.result.close(); this.database = undefined;};
        resolve(request.result);
      };
      request.onblocked = () => {blocked = true; this.database = undefined; reject(new Error("Reload other open Chordz tabs to finish opening the device library."));};
      request.onerror = () => { this.database = undefined; reject(new Error("The device library is unavailable. Your song is unchanged.")); };
    });
    return this.database;
  }
  async read<T>(store: LibraryStore, key: string): Promise<T | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(store, "readonly").objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async scan<T>(store: LibraryStore, prefix: string): Promise<T[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(store, "readonly").objectStore(store).getAll(IDBKeyRange.bound(prefix, prefix + "\uffff"));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async snapshot(owner: string, id: string): Promise<LibrarySnapshot | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["entries", "blobs"], "readonly"), request = tx.objectStore("entries").get(keyFor(owner, id));
      let snapshot: LibrarySnapshot | undefined, invalid = false;
      request.onsuccess = () => {
        const record = request.result as EntryRecord | undefined;
        if (!record || record.owner !== owner) return;
        snapshot = {entry: record.entry, blobs: new Map()};
        for (const asset of record.entry.assets) {
          const blobRequest = tx.objectStore("blobs").get(keyFor(owner, asset.id));
          blobRequest.onsuccess = () => {
            const blob = blobRequest.result as Blob | undefined;
            if (!blob || blob.size !== asset.byteLength) {invalid = true; tx.abort(); return;}
            snapshot!.blobs.set(asset.id, blob);
          };
        }
      };
      tx.oncomplete = () => resolve(snapshot);
      tx.onabort = tx.onerror = () => reject(invalid ? new Error("A saved library audio file is unavailable. Restore your library backup.") : tx.error);
    });
  }
  async atomic(mutations: LibraryMutation[], signal?: AbortSignal) {
    cancelled(signal);
    if (!mutations.length) return;
    const db = await this.open();
    cancelled(signal);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([...new Set(mutations.map(m => m.store))], "readwrite");
      const abort = () => tx.abort();
      signal?.addEventListener("abort", abort, {once: true});
      const detach = () => signal?.removeEventListener("abort", abort);
      tx.oncomplete = () => { detach(); resolve(); };
      tx.onabort = tx.onerror = () => {
        detach();
        reject(signal?.aborted ? new DOMException("Library operation cancelled.", "AbortError") : new Error("The device library could not be saved. Check available storage and export a backup."));
      };
      try {
        for (const mutation of mutations) {
          const store = tx.objectStore(mutation.store);
          if (mutation.type === "delete") store.delete(mutation.key);
          else store.put(mutation.value, mutation.key);
        }
      } catch (error) { tx.abort(); reject(error); }
    });
  }
  async modifyPreferences(owner: string, update: (preferences: LibraryPreferences) => LibraryPreferences, mutations: LibraryMutation[] = []) {
    if (mutations.some(mutation => mutation.store === "preferences")) throw new Error("Preference writes require the atomic update callback.");
    const db = await this.open(), key = keyFor(owner, "discovery");
    await new Promise<void>((resolve, reject) => {
      const stores = new Set<LibraryStore>(["preferences", ...mutations.map(mutation => mutation.store)]), tx = db.transaction([...stores], "readwrite"),
        preferences = tx.objectStore("preferences"), request = preferences.get(key);
      let failure: unknown;
      request.onsuccess = () => {
        try {
          const next = update(normalizePreferences(request.result));
          for (const mutation of mutations) {
            const store = tx.objectStore(mutation.store);
            if (mutation.type === "delete") store.delete(mutation.key); else store.put(mutation.value, mutation.key);
          }
          preferences.put(next, key);
        } catch (error) {failure = error; tx.abort();}
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(failure ?? new Error("Library preferences could not be saved on this device."));
    });
  }
}

export class LibraryStorage {
  private jobs = new Map<string, Promise<unknown>>();
  private leases = new Map<string, number>();
  constructor(private db: LibraryDatabase = new IndexedLibraryDatabase()) {}
  private ordered<T>(owner: string, work: () => Promise<T>): Promise<T> {
    ownerPrefix(owner);
    const job = (this.jobs.get(owner) ?? Promise.resolve()).catch(() => {}).then(work);
    this.jobs.set(owner, job);
    return job;
  }
  list(owner: string): Promise<LibraryEntry[]> {
    return this.ordered(owner, async () => {
      // A closed tab releases its Blob handles. Finish only library deletions,
      // never inspect or collect project-owned audio.
      const deleted = await this.db.scan<DeletionRecord>("deletions", ownerPrefix(owner));
      for (const record of deleted) if (record.owner === owner) await this.cleanDeleted(owner, record.id);
      const records = await this.db.scan<EntryRecord>("entries", ownerPrefix(owner));
      return records.filter(record => record.owner === owner).map(record => structuredClone(record.entry)).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    });
  }
  save(owner: string, entry: LibraryEntry, blobs: Map<string, Blob>, options?: LibraryWriteOptions): Promise<LibraryEntry> {
    return this.saveMany(owner, [{entry, blobs}], options).then(entries => entries[0]);
  }
  saveMany(owner: string, snapshots: LibrarySnapshot[], options?: LibraryWriteOptions): Promise<LibraryEntry[]> {
    // Capture before any await: edits to caller-owned arrays cannot change a save in flight.
    const captured = snapshots.map(({entry, blobs}) => ({entry: libraryEntrySchema.parse(structuredClone(entry)), blobs: new Map(blobs)}));
    return this.ordered(owner, async () => {
      cancelled(options?.signal);
      const mutations: LibraryMutation[] = [], saved: LibraryEntry[] = [];
      for (const snapshot of captured) {
        const sourceAssets = snapshot.entry.assets;
        if (snapshot.blobs.size !== sourceAssets.length || new Set(sourceAssets.map(a => a.id)).size !== sourceAssets.length)
          throw new Error("A library entry requires exactly its declared audio files.");
        const materialized = materializeLibraryEntry(snapshot.entry);
        for (const asset of sourceAssets) {
          const blob = snapshot.blobs.get(asset.id);
          if (!blob || blob.size !== asset.byteLength) throw new Error("A declared library audio file is missing or damaged.");
          const id = materialized.assetIds[asset.id];
          mutations.push({store: "blobs", key: keyFor(owner, id), type: "put", value: blob.slice(0, blob.size, asset.mime)});
        }
        const entry = materialized.entry;
        mutations.push({store: "entries", key: keyFor(owner, entry.id), type: "put", value: {owner, entry} satisfies EntryRecord});
        saved.push(entry);
      }
      cancelled(options?.signal);
      await this.db.atomic(mutations, options?.signal);
      return saved.map(entry => structuredClone(entry));
    });
  }
  acquire(owner: string, id: string): Promise<LibraryLease | undefined> {
    return this.ordered(owner, async () => {
      const key = keyFor(owner, id), snapshot = await this.db.snapshot(owner, id);
      if (!snapshot) return undefined;
      this.leases.set(key, (this.leases.get(key) ?? 0) + 1);
      let released = false;
      return {entry: freeze(structuredClone(snapshot.entry)), blobs: new Map(snapshot.blobs), release: () => this.ordered(owner, async () => {
        if (released) return;
        released = true;
        const count = (this.leases.get(key) ?? 1) - 1;
        if (count) this.leases.set(key, count); else this.leases.delete(key);
        await this.cleanDeleted(owner, id);
      })};
    });
  }
  private async cleanDeleted(owner: string, id: string) {
    const key = keyFor(owner, id);
    if (this.leases.has(key)) return;
    const deleted = await this.db.read<DeletionRecord>("deletions", key);
    if (!deleted || deleted.owner !== owner) return;
    await this.db.atomic([
      ...deleted.assets.map(assetId => ({store: "blobs" as const, key: keyFor(owner, assetId), type: "delete" as const})),
      {store: "deletions", key, type: "delete"},
    ]);
  }
  remove(owner: string, id: string): Promise<void> {
    return this.ordered(owner, async () => {
      const key = keyFor(owner, id), record = await this.db.read<EntryRecord>("entries", key);
      if (record?.owner === owner) {
        await this.db.modifyPreferences(owner, preferences => ({version: 1,
          favorites: preferences.favorites.filter(item => item !== id), recents: preferences.recents.filter(item => item !== id)}), [
          {store: "entries", key, type: "delete"},
          {store: "deletions", key, type: "put", value: {owner, id, assets: record.entry.assets.map(a => a.id)} satisfies DeletionRecord},
        ]);
      }
      await this.cleanDeleted(owner, id);
    });
  }
  async preferences(owner: string): Promise<LibraryPreferences> {
    const stored = await this.db.read<LibraryPreferences>("preferences", keyFor(owner, "discovery"));
    return normalizePreferences(stored);
  }
  setFavorite(owner: string, id: string, favorite: boolean): Promise<void> {
    preferenceId(id);
    return this.ordered(owner, async () => {
      await this.db.modifyPreferences(owner, preferences => {
        const favorites = preferences.favorites.filter(item => item !== id);
        if (favorite) favorites.push(id);
        if (favorites.length > 1000) throw new Error("The device library supports up to 1,000 favorites.");
        return {...preferences, favorites};
      });
    });
  }
  markRecent(owner: string, id: string): Promise<void> {
    preferenceId(id);
    return this.ordered(owner, async () => {
      await this.db.modifyPreferences(owner, preferences => ({...preferences, recents: [id, ...preferences.recents.filter(item => item !== id)].slice(0, 100)}));
    });
  }
}

export const deviceLibrary = new LibraryStorage();
export const listLibrary = (owner: string) => deviceLibrary.list(owner);
export const saveLibraryEntry = (owner: string, entry: LibraryEntry, blobs: Map<string, Blob>, options?: LibraryWriteOptions) => deviceLibrary.save(owner, entry, blobs, options);
export const acquireLibraryEntry = (owner: string, id: string) => deviceLibrary.acquire(owner, id);
export const deleteLibraryEntry = (owner: string, id: string) => deviceLibrary.remove(owner, id);
export const readLibraryPreferences = (owner: string) => deviceLibrary.preferences(owner);
export const setLibraryFavorite = (owner: string, id: string, favorite: boolean) => deviceLibrary.setFavorite(owner, id, favorite);
/** Call only after successful explicit preview or committed placement. */
export const markLibraryRecent = (owner: string, id: string) => deviceLibrary.markRecent(owner, id);
