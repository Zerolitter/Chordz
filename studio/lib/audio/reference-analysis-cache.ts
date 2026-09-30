import { isReferenceProfile, REFERENCE_ALGORITHM, type ReferenceProfile, type ReferenceRange } from "./reference-analysis-data";
let database: Promise<IDBDatabase> | null = null;
const cacheKey = (owner: string, fingerprint: string, range: ReferenceRange) => JSON.stringify([owner, fingerprint, REFERENCE_ALGORITHM, range.startSec, range.endSec]);
function open() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open("chordz-reference-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("profiles");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(new Error("Reference caching is unavailable on this device.")); };
  });
  return database;
}
export async function cachedReference(owner: string, fingerprint: string, range: ReferenceRange): Promise<ReferenceProfile | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction("profiles", "readonly").objectStore("profiles").get(cacheKey(owner, fingerprint, range));
    request.onsuccess = () => { const profile: unknown = request.result?.profile; resolve(isReferenceProfile(profile) && profile.source.fingerprint === fingerprint && profile.coverage.startSec === range.startSec && profile.coverage.endSec === range.endSec ? profile : undefined); };
    request.onerror = () => reject(request.error);
  });
}
export async function cacheReference(owner: string, profile: ReferenceProfile) {
  if (!isReferenceProfile(profile)) throw new Error("The reference profile exceeds the local cache limit or is invalid.");
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("profiles", "readwrite"), store = tx.objectStore("profiles");
    store.put({ owner, savedAt: Date.now(), profile }, cacheKey(owner, profile.source.fingerprint, profile.coverage));
    const entries: { key: IDBValidKey; time: number }[] = [], cursor = store.openCursor();
    cursor.onsuccess = () => { const entry = cursor.result; if (entry) { if (entry.value.owner === owner) entries.push({ key: entry.key, time: entry.value.savedAt }); entry.continue(); } else { entries.sort((a, b) => b.time - a.time); for (const entry of entries.slice(10)) store.delete(entry.key); } };
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Reference cache is full."));
  });
}
