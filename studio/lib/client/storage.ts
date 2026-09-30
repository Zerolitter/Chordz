import type { AssetReference, ProjectDocument } from "../music/types";

export interface RecoveryDraft {
  owner: string;
  document: ProjectDocument;
  revision: number;
  savedFingerprint: string;
  updatedAt: string;
}
export interface PendingAsset {
  owner: string;
  projectId: string;
  asset: AssetReference;
  blob: Blob;
}
const memory = new Map<string, unknown>();
let database: Promise<IDBDatabase> | null = null;
function open() {
  if (!database)
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open("chordz-recovery-v1", 1);
      request.onupgradeneeded = () => {
        for (const name of ["drafts", "assets", "pending"])
          if (!request.result.objectStoreNames.contains(name))
            request.result.createObjectStore(name);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          new Error(
            "Device recovery storage is unavailable. Export a project backup before closing this tab.",
          ),
        );
    });
  return database;
}
async function get<T>(store: string, key: string): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(store, "readonly")
      .objectStore(store)
      .get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function put(store: string, key: string, value: unknown) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        new Error(
          "Device storage is full. Export a backup to keep your edits.",
        ),
      );
  });
}
async function remove(store: string, key: string) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
const ownerKey = (owner: string, id: string) => owner + ":" + id;
const writes = new Map<string, Promise<unknown>>();
function ordered<T>(owner: string, write: () => Promise<T>): Promise<T> {
  const job = (writes.get(owner) ?? Promise.resolve()).catch(() => {}).then(write);
  writes.set(owner, job);
  return job;
}
export async function saveDraft(draft: RecoveryDraft) {
  await ordered(draft.owner, async () => {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").put(draft, ownerKey(draft.owner, draft.document.id));
      tx.objectStore("drafts").put(draft.document.id, draft.owner + ":latest");
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Device recovery save failed."));
    });
  });
}
export interface TakeReceipt { takeId: string; projectId: string; clipId: string; }
export function preserveTake(draft: RecoveryDraft, receipt: TakeReceipt, pending?: PendingAsset) {
  return ordered(draft.owner, async () => {
    const db = await open();
    const result = await new Promise<{ already: boolean }>((resolve, reject) => {
      const tx = db.transaction(["drafts", "assets", "pending"], "readwrite");
      const drafts = tx.objectStore("drafts");
      const key = ownerKey(draft.owner, "take:" + receipt.takeId);
      let already = false;
      const request = drafts.get(key);
      request.onsuccess = () => {
        already = !!request.result;
        if (already) return;
        if (pending) {
          tx.objectStore("assets").put(pending.blob, ownerKey(pending.owner, pending.asset.id));
          tx.objectStore("pending").put(pending, ownerKey(pending.owner, pending.asset.id));
        }
        drafts.put(draft, ownerKey(draft.owner, draft.document.id));
        drafts.put(draft.document.id, draft.owner + ":latest");
        drafts.put(receipt, key);
      };
      tx.oncomplete = () => resolve({ already });
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Take recovery save failed."));
    });
    if (pending && !result.already) memory.set(ownerKey(pending.owner, pending.asset.id), pending.blob);
    return result;
  });
}
export async function latestDraft(
  owner: string,
): Promise<RecoveryDraft | undefined> {
  const id = await get<string>("drafts", owner + ":latest");
  return id ? get<RecoveryDraft>("drafts", ownerKey(owner, id)) : undefined;
}
export async function listDrafts(owner: string): Promise<RecoveryDraft[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("drafts", "readonly")
      .objectStore("drafts")
      .getAll(IDBKeyRange.bound(owner + ":", owner + ":\uffff"));
    request.onsuccess = () =>
      resolve(
        request.result
          .filter(
            (value): value is RecoveryDraft =>
              typeof value === "object" &&
              value?.owner === owner &&
              !!value.document,
          )
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      );
    request.onerror = () => reject(request.error);
  });
}
export async function clearDraft(owner: string, id: string) {
  await remove("drafts", ownerKey(owner, id));
  const latest = await get<string>("drafts", owner + ":latest");
  if (latest === id) await remove("drafts", owner + ":latest");
}
export async function cacheAsset(owner: string, id: string, blob: Blob) {
  memory.set(ownerKey(owner, id), blob);
  await put("assets", ownerKey(owner, id), blob);
}
export async function resolveAsset(owner: string, id: string): Promise<Blob> {
  const key = ownerKey(owner, id);
  const inMemory = memory.get(key) as Blob | undefined;
  if (inMemory) return inMemory;
  const cached = await get<Blob>("assets", key);
  if (cached) {
    memory.set(key, cached);
    return cached;
  }
  const response = await fetch("/api/assets/" + encodeURIComponent(id), {
    credentials: "same-origin",
  });
  if (!response.ok)
    throw new Error(
      "This audio file is unavailable. Reconnect or restore it from a project backup.",
    );
  const blob = await response.blob();
  memory.set(key, blob);
  await put("assets", key, blob);
  return blob;
}
export async function keepPendingAsset(pending: PendingAsset) {
  await cacheAsset(pending.owner, pending.asset.id, pending.blob);
  await put("pending", ownerKey(pending.owner, pending.asset.id), pending);
}
export async function pendingAsset(owner: string, id: string) {
  return get<PendingAsset>("pending", ownerKey(owner, id));
}
export async function completePending(owner: string, id: string) {
  await remove("pending", ownerKey(owner, id));
}
export async function uploadPending(pending: PendingAsset) {
  const a = pending.asset;
  const response = await fetch("/api/assets", {
    method: "POST",
    headers: {
      "Content-Type": a.mime,
      "X-Project-Id": pending.projectId,
      "X-Asset-Id": a.id,
      "X-File-Name": encodeURIComponent(a.name),
      "X-Duration": String(a.duration),
      "X-Sample-Rate": String(a.sampleRate),
      "X-Channels": String(a.channels),
    },
    body: pending.blob,
  });
  const result = (await response.json()) as AssetReference & { error?: string };
  if (!response.ok)
    throw new Error(result.error ?? "This audio file could not be uploaded.");
  await completePending(pending.owner, a.id);
  return result;
}
