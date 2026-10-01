import type { AssetReference, ProjectDocument } from "../music/types";

export interface RecoveryDraft {
  owner: string;
  document: ProjectDocument;
  revision: number;
  savedFingerprint: string;
  updatedAt: string;
}
/** A pending-copy warning never blocks restoring an already durable song. */
export interface RecoveredDraft extends RecoveryDraft { recoveryWarning?: string; }
export interface PendingAsset {
  owner: string;
  projectId: string;
  asset: AssetReference;
  blob: Blob;
}
const memory = new Map<string, unknown>();
interface StagedAsset extends PendingAsset { stagingOperation: string; }
interface AssetStage { owner: string; projectId: string; operationId: string; assetIds: string[]; }
const activatedStages = new Set<string>();
const discardingStages = new Map<string, IDBTransaction>();
const stageKey = (owner: string, operationId: string) => encodeURIComponent(owner) + ":" + encodeURIComponent(operationId);
const eligibleAsset = (pending: PendingAsset): PendingAsset => ({owner: pending.owner, projectId: pending.projectId, asset: pending.asset, blob: pending.blob});
let database: Promise<IDBDatabase> | null = null;
function open() {
  if (!database)
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open("chordz-recovery-v1", 2);
      let blocked = false;
      request.onupgradeneeded = () => {
        for (const name of ["drafts", "assets", "pending", "staging"])
          if (!request.result.objectStoreNames.contains(name))
            request.result.createObjectStore(name);
      };
      request.onsuccess = () => {
        if (blocked) {request.result.close(); return;}
        request.result.onversionchange = () => {request.result.close(); database = null;};
        resolve(request.result);
      };
      request.onblocked = () => {
        blocked = true;
        database = null;
        reject(new Error("Reload other open Chordz tabs to finish updating device recovery storage."));
      };
      request.onerror = () => {
        database = null;
        reject(
          new Error(
            "Device recovery storage is unavailable. Export a project backup before closing this tab.",
          ),
        );
      };
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
      const tx = db.transaction(["drafts", "pending", "staging"], "readwrite");
      tx.objectStore("drafts").put(draft, ownerKey(draft.owner, draft.document.id));
      tx.objectStore("drafts").put(draft.document.id, draft.owner + ":latest");
      // A committed recovery document is durable evidence of insertion even if
      // the tab closed between the checked commit and pending-asset promotion.
      promoteDraftStages(tx, draft);
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
): Promise<RecoveredDraft | undefined> {
  const id = await get<string>("drafts", owner + ":latest");
  const draft = id ? await get<RecoveryDraft>("drafts", ownerKey(owner, id)) : undefined;
  if (draft) try {await recoverProjectAssets(draft);} catch {
    return {...draft, recoveryWarning: "Your saved song is available. Copied audio remains on this device; preparing pending uploads needs retrying."};
  }
  return draft;
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
  const pending = await get<StagedAsset | PendingAsset>("pending", ownerKey(owner, id));
  if (pending && "stagingOperation" in pending) {
    if (!activatedStages.has(stageKey(owner, pending.stagingOperation))) return undefined;
    return eligibleAsset(pending);
  }
  return pending;
}
export async function completePending(owner: string, id: string) {
  await remove("pending", ownerKey(owner, id));
}
export async function uploadPending(pending: PendingAsset) {
  const stored = await get<StagedAsset | PendingAsset>("pending", ownerKey(pending.owner, pending.asset.id));
  if (stored && "stagingOperation" in stored && !activatedStages.has(stageKey(pending.owner, stored.stagingOperation)))
    throw new Error("This audio copy is awaiting a successful insertion and cannot be uploaded.");
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

function promoteStage(tx: IDBTransaction, stage: AssetStage) {
  const pending = tx.objectStore("pending");
  for (const id of stage.assetIds) {
    const key = ownerKey(stage.owner, id), request = pending.get(key);
    request.onsuccess = () => {
      const value = request.result as StagedAsset | undefined;
      if (!value || value.stagingOperation !== stage.operationId) return;
      try {pending.put(eligibleAsset(value), key);} catch {tx.abort();}
    };
  }
  tx.objectStore("staging").delete(stageKey(stage.owner, stage.operationId));
}
function promoteDraftStages(tx: IDBTransaction, draft: RecoveryDraft) {
  const ids = new Set(draft.document.assets.map(asset => asset.id));
  const request = tx.objectStore("staging").getAll(IDBKeyRange.bound(encodeURIComponent(draft.owner) + ":", encodeURIComponent(draft.owner) + ":\uffff"));
  request.onsuccess = () => {
    for (const stage of request.result as AssetStage[])
      if (stage.owner === draft.owner && stage.projectId === draft.document.id && stage.assetIds.every(id => ids.has(id))) {
        activatedStages.add(stageKey(stage.owner, stage.operationId));
        promoteStage(tx, stage);
      }
  };
}
async function recoverProjectAssets(draft: RecoveryDraft) {
  await ordered(draft.owner, async () => {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["pending", "staging"], "readwrite");
      promoteDraftStages(tx, draft);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Copied audio recovery could not be completed."));
    });
  });
}

/** Atomically retain operation-owned copies, excluded from cloud uploads. */
export async function stageProjectAssets(owner: string, projectId: string, operationId: string, copies: PendingAsset[]) {
  if (!owner || !projectId || !operationId || !copies.length || copies.length > 1000)
    throw new Error("Invalid audio insertion operation.");
  const captured = copies.map(copy => ({...copy, asset: structuredClone(copy.asset), blob: copy.blob.slice(0, copy.blob.size, copy.asset.mime)}));
  if (new Set(captured.map(copy => copy.asset.id)).size !== captured.length || captured.some(copy => copy.owner !== owner || copy.projectId !== projectId || copy.blob.size !== copy.asset.byteLength))
    throw new Error("Audio copies do not match their insertion destination.");
  const key = stageKey(owner, operationId);
  if (activatedStages.has(key)) throw new Error("This insertion operation has already committed.");
  await ordered(owner, async () => {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["assets", "pending", "staging"], "readwrite");
      let conflict = false;
      const existingStage = tx.objectStore("staging").get(key);
      existingStage.onsuccess = () => {
        if (existingStage.result) {conflict = true; tx.abort();}
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(new Error(conflict ? "An audio insertion identity already exists." : "Audio copies could not be preserved on this device. The song is unchanged."));
      try {
        tx.objectStore("staging").put({owner, projectId, operationId, assetIds: captured.map(copy => copy.asset.id)} satisfies AssetStage, key);
        for (const copy of captured) {
          const assetKey = ownerKey(owner, copy.asset.id), request = tx.objectStore("assets").get(assetKey);
          request.onsuccess = () => {
            if (request.result) {conflict = true; tx.abort(); return;}
            try {
              tx.objectStore("assets").put(copy.blob, assetKey);
              tx.objectStore("pending").put({...copy, stagingOperation: operationId} satisfies StagedAsset, assetKey);
            } catch {tx.abort();}
          };
        }
      } catch {tx.abort();}
    });
    for (const copy of captured) memory.set(ownerKey(owner, copy.asset.id), copy.blob);
  });
}

/** Call synchronously immediately after the checked musical commit. A failed
 * durable promotion retains copies and eligibility; retry, never roll back the song. */
export function activateProjectAssets(owner: string, operationId: string): Promise<void> {
  const key = stageKey(owner, operationId);
  activatedStages.add(key);
  // Activation can arrive while discard's IDB callbacks are queued. Abort the
  // whole discard so its marker and blobs cannot be partially removed.
  const discarding = discardingStages.get(key);
  if (discarding) try { discarding.abort(); } catch { /* Already completed. */ }
  return ordered(owner, async () => {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["pending", "staging"], "readwrite"), request = tx.objectStore("staging").get(key);
      request.onsuccess = () => {
        const stage = request.result as AssetStage | undefined;
        if (stage?.owner === owner && stage.operationId === operationId) promoteStage(tx, stage);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Inserted audio is retained on this device; pending-upload preparation needs retrying."));
    });
  });
}

/** Cancel only unused copies belonging to this never-committed operation. */
export async function discardProjectAssets(owner: string, operationId: string): Promise<void> {
  const key = stageKey(owner, operationId);
  if (activatedStages.has(key)) return;
  await ordered(owner, async () => {
    if (activatedStages.has(key)) return;
    const db = await open(), removed: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["assets", "pending", "staging"], "readwrite"), request = tx.objectStore("staging").get(key);
      discardingStages.set(key, tx);
      request.onsuccess = () => {
        const stage = request.result as AssetStage | undefined;
        if (!stage || stage.owner !== owner || stage.operationId !== operationId || activatedStages.has(key)) return;
        for (const id of stage.assetIds) {
          const assetKey = ownerKey(owner, id), pendingRequest = tx.objectStore("pending").get(assetKey);
          pendingRequest.onsuccess = () => {
            const value = pendingRequest.result as StagedAsset | undefined;
            if (value?.stagingOperation !== operationId || activatedStages.has(key)) return;
            tx.objectStore("assets").delete(assetKey);
            tx.objectStore("pending").delete(assetKey);
            removed.push(id);
          };
        }
        tx.objectStore("staging").delete(key);
      };
      tx.oncomplete = () => {discardingStages.delete(key); resolve();};
      tx.onabort = tx.onerror = () => {
        discardingStages.delete(key);
        if (activatedStages.has(key)) {removed.length = 0; resolve();}
        else reject(tx.error ?? new Error("Unused audio copies could not be removed from this device."));
      };
    });
    for (const id of removed) memory.delete(ownerKey(owner, id));
  });
}
