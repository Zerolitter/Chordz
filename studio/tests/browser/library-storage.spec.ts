import { test, expect } from "@playwright/test";

test("device library isolates owners, leases removed entries, and atomically imports fresh exact copies", async ({page}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const storage = await import("/lib/client/reusable-library-storage.ts" as string), archive = await import("/lib/client/library-archive.ts" as string),
      {createDemo} = await import("/lib/music/project.ts" as string), {createPhraseEntry} = await import("/lib/music/reusable-library.ts" as string);
    const project = createDemo(), track = project.tracks[0], entry = createPhraseEntry(project, track, track.clips[0], "Portable phrase");
    const asset = {id: "storage-source", name: "Source", mime: "audio/wav", byteLength: 4, duration: 1, sampleRate: 48000, channels: 1};
    entry.assets = [asset]; entry.sound.instrument.zones = [{assetId: asset.id, root: 60, low: 0, high: 127, velocityLow: 0, velocityHigh: 1, roundRobin: 0, articulation: "sustain"}];
    const saved = await storage.saveLibraryEntry("library-owner:a", entry, new Map([[asset.id, new Blob([new Uint8Array([1,2,3,4])], {type: asset.mime})]]));
    await storage.setLibraryFavorite("library-owner:a", "factory:piano", true);
    const preferences = await storage.readLibraryPreferences("library-owner:a"), other = await storage.readLibraryPreferences("library-owner");
    const lease = await storage.acquireLibraryEntry("library-owner:a", saved.id), backup = await archive.exportLibraryArchive("library-owner:a");
    await storage.deleteLibraryEntry("library-owner:a", saved.id);
    const deleted = await storage.listLibrary("library-owner:a"), unavailable = await storage.acquireLibraryEntry("library-owner:a", saved.id), heldBytes = [...new Uint8Array(await lease.blobs.get(saved.assets[0].id).arrayBuffer())];
    await lease.release();
    const first = await archive.importLibraryArchive("library-owner:a", backup), second = await archive.importLibraryArchive("library-owner:a", backup), fresh = await storage.acquireLibraryEntry("library-owner:a", first[0].id);
    const importedBytes = [...new Uint8Array(await fresh.blobs.get(first[0].assets[0].id).arrayBuffer())]; await fresh.release();
    return {preferences, other, deleted, unavailable: unavailable === undefined, heldBytes, importedBytes,
      imported: (await storage.listLibrary("library-owner:a")).length, isolated: (await storage.listLibrary("library-owner")).length,
      identities: first[0].id !== second[0].id && first[0].clip.id !== second[0].clip.id && first[0].assets[0].id !== second[0].assets[0].id};
  });
  expect(result).toEqual({preferences: {version: 1, favorites: ["factory:piano"], recents: []}, other: {version: 1, favorites: [], recents: []},
    deleted: [], unavailable: true, heldBytes: [1,2,3,4], importedBytes: [1,2,3,4], imported: 2, isolated: 0, identities: true});
});

test("staged audio is excluded from uploads, cancelled copies alone are removed, and committed copies survive discard", async ({page}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const storage = await import("/lib/client/storage.ts" as string);
    const owner = "staged-owner", projectId = "staged-project", asset = (id: string) => ({id, name: id, mime: "audio/wav", byteLength: 4, duration: 1, sampleRate: 48000, channels: 1});
    const copy = (id: string) => ({owner, projectId, asset: asset(id), blob: new Blob([new Uint8Array([1,2,3,4])], {type: "audio/wav"})});
    await storage.keepPendingAsset(copy("existing-copy"));
    await storage.stageProjectAssets(owner, projectId, "cancelled-operation", [copy("unused-copy")]);
    const blocked = await storage.pendingAsset(owner, "unused-copy") === undefined;
    let uploadBlocked = false; try {await storage.uploadPending(copy("unused-copy"));} catch {uploadBlocked = true;}
    await storage.discardProjectAssets(owner, "cancelled-operation");
    const existing = !!await storage.pendingAsset(owner, "existing-copy");
    await storage.stageProjectAssets(owner, projectId, "committed-operation", [copy("inserted-copy")]);
    const promotion = storage.activateProjectAssets(owner, "committed-operation");
    const eligible = !!await storage.pendingAsset(owner, "inserted-copy"); await promotion;
    await storage.discardProjectAssets(owner, "committed-operation");
    const retained = [...new Uint8Array(await (await storage.resolveAsset(owner, "inserted-copy")).arrayBuffer())];
    const db = await new Promise<IDBDatabase>((resolve, reject) => {const request = indexedDB.open("chordz-recovery-v1"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
    const unused = await new Promise(resolve => {const request = db.transaction("assets").objectStore("assets").get(owner + ":unused-copy"); request.onsuccess = () => resolve(request.result);}); db.close();
    return {blocked, uploadBlocked, existing, eligible, retained, unused: unused === undefined};
  });
  expect(result).toEqual({blocked: true, uploadBlocked: true, existing: true, eligible: true, retained: [1,2,3,4], unused: true});
});

test("reopening a durable committed draft promotes interrupted audio copies while unused groups stay staged", async ({page}) => {
  await page.goto("/");
  const projectId = await page.evaluate(async () => {
    const storage = await import("/lib/client/storage.ts" as string), {createProject} = await import("/lib/music/project.ts" as string);
    const document = createProject(), owner = "recovery-copy-owner", asset = {id: "recovered-copy", name: "Recover", mime: "audio/wav", byteLength: 4, duration: 1, sampleRate: 48000, channels: 1};
    await storage.stageProjectAssets(owner, document.id, "interrupted-operation", [{owner, projectId: document.id, asset, blob: new Blob([new Uint8Array([5,6,7,8])])}]);
    const unused = {...asset, id: "uncommitted-copy"};
    await storage.stageProjectAssets(owner, document.id, "never-committed-operation", [{owner, projectId: document.id, asset: unused, blob: new Blob([new Uint8Array([9,9,9,9])])}]);
    document.assets = [asset];
    // Simulate the persisted draft from an interrupted older promotion path.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {const request = indexedDB.open("chordz-recovery-v1"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
    await new Promise<void>((resolve, reject) => {const tx = db.transaction("drafts", "readwrite"); tx.objectStore("drafts").put({owner, document, revision: 0, savedFingerprint: "", updatedAt: new Date().toISOString()}, owner + ":" + document.id); tx.objectStore("drafts").put(document.id, owner + ":latest"); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);}); db.close();
    return document.id;
  });
  await page.reload();
  const result = await page.evaluate(async () => {
    const storage = await import("/lib/client/storage.ts" as string), owner = "recovery-copy-owner", draft = await storage.latestDraft(owner);
    return {id: draft.document.id, pending: !!await storage.pendingAsset(owner, "recovered-copy"), unused: await storage.pendingAsset(owner, "uncommitted-copy") === undefined,
      bytes: [...new Uint8Array(await (await storage.resolveAsset(owner, "recovered-copy")).arrayBuffer())]};
  });
  expect(result).toEqual({id: projectId, pending: true, unused: true, bytes: [5,6,7,8]});
});

test("a failed staged transaction retains no partial copies and never overwrites an existing asset", async ({page}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const storage = await import("/lib/client/storage.ts" as string), owner = "quota-copy-owner", projectId = "quota-project";
    const copy = (id: string, byte: number) => ({owner, projectId, asset: {id, name: id, mime: "audio/wav", byteLength: 4, duration: 1, sampleRate: 48000, channels: 1}, blob: new Blob([new Uint8Array([byte,byte,byte,byte])])});
    await storage.keepPendingAsset(copy("original-copy", 1));
    let failed = false; try {await storage.stageProjectAssets(owner, projectId, "collision-operation", [copy("first-copy", 2), copy("original-copy", 9)]);} catch {failed = true;}
    const original = [...new Uint8Array(await (await storage.resolveAsset(owner, "original-copy")).arrayBuffer())];
    const db = await new Promise<IDBDatabase>((resolve, reject) => {const request = indexedDB.open("chordz-recovery-v1"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
    const rows = await new Promise<unknown[]>(resolve => {const request = db.transaction("assets").objectStore("assets").getAll(IDBKeyRange.bound(owner + ":", owner + ":\uffff")); request.onsuccess = () => resolve(request.result);});
    const stages = await new Promise<unknown[]>(resolve => {const request = db.transaction("staging").objectStore("staging").getAll(IDBKeyRange.bound(owner + ":", owner + ":\uffff")); request.onsuccess = () => resolve(request.result);}); db.close();
    return {failed, original, rows: rows.length, stages: stages.length};
  });
  expect(result).toEqual({failed: true, original: [1,1,1,1], rows: 1, stages: 0});
});

test("quota failures abort entire library and project-copy transactions without partial state", async ({page}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const library = await import("/lib/client/reusable-library-storage.ts" as string), storage = await import("/lib/client/storage.ts" as string),
      {createDemo} = await import("/lib/music/project.ts" as string), {createPhraseEntry} = await import("/lib/music/reusable-library.ts" as string);
    const project = createDemo(), entry = createPhraseEntry(project, project.tracks[0], project.tracks[0].clips[0], "Quota phrase"),
      asset = {id: "quota-asset", name: "Quota", mime: "audio/wav", byteLength: 4, duration: 1, sampleRate: 48000, channels: 1}, blob = new Blob([new Uint8Array([1,2,3,4])]);
    entry.assets = [asset]; entry.sound.instrument.zones = [{assetId: asset.id, root: 60, low: 0, high: 127, velocityLow: 0, velocityHigh: 1, roundRobin: 0, articulation: "sustain"}];
    const nativePut = IDBObjectStore.prototype.put;
    let libraryFailed = false, stageFailed = false;
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      if (this.name === "entries" || this.name === "pending") throw new DOMException("Injected storage quota", "QuotaExceededError");
      return nativePut.call(this, value, key);
    };
    try {
      try {await library.saveLibraryEntry("quota-library-owner", entry, new Map([[asset.id, blob]]));} catch {libraryFailed = true;}
      try {await storage.stageProjectAssets("quota-stage-owner", project.id, "quota-operation", [{owner: "quota-stage-owner", projectId: project.id, asset, blob}]);} catch {stageFailed = true;}
    } finally {IDBObjectStore.prototype.put = nativePut;}
    const db = await new Promise<IDBDatabase>((resolve, reject) => {const request = indexedDB.open("chordz-recovery-v1"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
    const rows = await new Promise<unknown[]>(resolve => {const request = db.transaction("assets").objectStore("assets").getAll(IDBKeyRange.bound("quota-stage-owner:", "quota-stage-owner:\uffff")); request.onsuccess = () => resolve(request.result);}); db.close();
    return {libraryFailed, stageFailed, entries: (await library.listLibrary("quota-library-owner")).length, assets: rows.length};
  });
  expect(result).toEqual({libraryFailed: true, stageFailed: true, entries: 0, assets: 0});
});

test("promotion failure returns the durable song and retained copies, then retries on the next recovery read", async ({page}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const storage = await import("/lib/client/storage.ts" as string), {createProject} = await import("/lib/music/project.ts" as string),
      document = createProject(), owner = "promotion-failure-owner", asset = {id: "promotion-failure-copy", name: "Keep", mime: "audio/wav", byteLength: 4, duration: 1, sampleRate: 48000, channels: 1};
    document.title = "Durable song survives promotion failure";
    await storage.stageProjectAssets(owner, document.id, "promotion-failure-operation", [{owner, projectId: document.id, asset, blob: new Blob([new Uint8Array([4,3,2,1])])}]);
    document.assets = [asset];
    const db = await new Promise<IDBDatabase>((resolve, reject) => {const request = indexedDB.open("chordz-recovery-v1"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
    await new Promise<void>((resolve, reject) => {const tx = db.transaction("drafts", "readwrite"); tx.objectStore("drafts").put({owner, document, revision: 0, savedFingerprint: "", updatedAt: new Date().toISOString()}, owner + ":" + document.id); tx.objectStore("drafts").put(document.id, owner + ":latest"); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);}); db.close();
  });
  await page.reload();
  const result = await page.evaluate(async () => {
    const storage = await import("/lib/client/storage.ts" as string), owner = "promotion-failure-owner", nativePut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      if (this.name === "pending") throw new DOMException("Injected promotion quota", "QuotaExceededError");
      return nativePut.call(this, value, key);
    };
    let draft;
    try {draft = await storage.latestDraft(owner);} finally {IDBObjectStore.prototype.put = nativePut;}
    const retained = [...new Uint8Array(await (await storage.resolveAsset(owner, "promotion-failure-copy")).arrayBuffer())], eligible = !!await storage.pendingAsset(owner, "promotion-failure-copy"), retry = await storage.latestDraft(owner);
    return {title: draft.document.title, warning: !!draft.recoveryWarning, retained, eligible, retryTitle: retry.document.title, retryWarning: retry.recoveryWarning ?? ""};
  });
  expect(result).toEqual({title: "Durable song survives promotion failure", warning: true, retained: [4,3,2,1], eligible: true, retryTitle: "Durable song survives promotion failure", retryWarning: ""});
});

test("independent device-library connections retain simultaneous preference writes and deletion cleanup", async ({page}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const {LibraryStorage} = await import("/lib/client/reusable-library-storage.ts" as string), {createDemo} = await import("/lib/music/project.ts" as string),
      {createPhraseEntry} = await import("/lib/music/reusable-library.ts" as string), first = new LibraryStorage(), second = new LibraryStorage(), owner = "concurrent-preference-owner";
    await Promise.all([first.preferences(owner), second.preferences(owner)]);
    await Promise.all([first.setFavorite(owner, "factory:piano", true), second.setFavorite(owner, "factory:lead", true)]);
    await Promise.all([first.markRecent(owner, "idea:bass"), second.markRecent(owner, "idea:drums")]);
    const project = createDemo(), saved = await first.save(owner, createPhraseEntry(project, project.tracks[0], project.tracks[0].clips[0], "Delete concurrently"), new Map());
    await first.setFavorite(owner, saved.id, true); await first.markRecent(owner, saved.id);
    await Promise.all([first.remove(owner, saved.id), second.setFavorite(owner, "factory:pad", true)]);
    const preferences = await first.preferences(owner);
    return {favorites: preferences.favorites.sort(), recents: preferences.recents.sort(), entries: (await second.list(owner)).length};
  });
  expect(result).toEqual({favorites: ["factory:lead", "factory:pad", "factory:piano"], recents: ["idea:bass", "idea:drums"], entries: 0});
});
