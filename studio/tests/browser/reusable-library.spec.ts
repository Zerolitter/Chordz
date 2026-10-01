import { expect, test, type Page } from "@playwright/test";
import type { ProjectDocument } from "../../lib/music/types";
import { encodeWav } from "../../lib/audio/wav";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

const library = (page:Page) => page.locator(".library-browser");
async function ready(page:Page) {
  await page.goto("/");
  await expect(page.getByLabel("Song title")).toBeEnabled();
  await expect(library(page).getByRole("button",{name:"Favorite Glass FM",exact:true})).toBeEnabled();
}
async function readDocument(page:Page):Promise<ProjectDocument|null> {
  return page.evaluate(async () => {
    const {latestDraft} = await import("/lib/client/storage.ts" as string);
    return (await latestDraft("guest"))?.document ?? null;
  });
}
async function fm(page:Page) {
  await library(page).getByRole("button",{name:"Glass FM Synthesizers",exact:true}).click();
  await library(page).getByRole("button",{name:"Use on selected track",exact:true}).click();
  await expect(library(page).getByRole("status")).toContainText("Glass FM replaced.");
}
async function save(page:Page,kind:"sound"|"phrase",name:string) {
  const manage = library(page).locator(".library-manage");
  if (!await manage.evaluate(element => (element as HTMLDetailsElement).open)) await manage.locator("summary").click();
  await manage.getByRole("button",{name:`Save selected ${kind}`,exact:true}).click();
  await manage.getByLabel("Library name",{exact:true}).fill(name);
  await manage.getByRole("button",{name:"Save to library",exact:true}).click();
  await expect(library(page).getByRole("status")).toContainText(`${name} saved to your library.`);
}
async function sampledEntry(page:Page,name:string) {
  await page.evaluate(async ({name,bytes}) => {
    const {createProject,createTrack} = await import("/lib/music/project.ts" as string);
    const {createSoundEntry} = await import("/lib/music/reusable-library.ts" as string);
    const {deviceLibrary} = await import("/lib/client/reusable-library-storage.ts" as string);
    const project = createProject(), assetId = "sample_fixture_asset", manifestId = "sample_fixture_instrument";
    const blob = new Blob([new Uint8Array(bytes)],{type:"audio/wav"});
    project.assets.push({id:assetId,name:"fixture.wav",mime:"audio/wav",byteLength:blob.size,duration:.1,sampleRate:48000,channels:1});
    project.userInstruments.push({id:manifestId,name:"Fixture sampler",family:"Sampler",description:"Local browser fixture",kind:"sample",zones:[{assetId,root:60,low:0,high:127,velocityLow:0,velocityHigh:1,roundRobin:0,articulation:"sustain"}],articulations:["sustain"],license:"Test",source:"Local fixture",defaults:{}});
    await deviceLibrary.save("guest",createSoundEntry(project,createTrack(manifestId,name),name,"sample_fixture_entry"),new Map([[assetId,blob]]));
  },{name,bytes:[...new Uint8Array(encodeWav([new Float32Array(4800).fill(.1)],48000,24))]});
  await page.reload();
  await expect(library(page).getByRole("button",{name:`${name} Sampler`,exact:true})).toBeVisible();
  await library(page).getByRole("button",{name:`${name} Sampler`,exact:true}).click();
}
async function holdLibrarySnapshot(page:Page) {
  await page.evaluate(() => {
    const state = window as unknown as {libraryBlobHeld:boolean;releaseLibraryBlob:()=>void};
    state.libraryBlobHeld = false;
    let release!:()=>void;
    const gate = new Promise<void>(resolve => {release=resolve;});
    const original = IDBDatabase.prototype.transaction;
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype,"oncomplete")!;
    IDBDatabase.prototype.transaction = function(storeNames,mode,options) {
      const transaction = original.call(this,storeNames,mode,options);
      const stores = Array.from(transaction.objectStoreNames);
      if (this.name === "chordz-library-v1" && mode === "readonly" && stores.includes("entries") && stores.includes("blobs")) {
        IDBDatabase.prototype.transaction = original;
        Object.defineProperty(transaction,"oncomplete",{configurable:true,set(handler) {
          descriptor.set!.call(transaction,async (event:Event) => {
            state.libraryBlobHeld = true;
            await gate;
            handler?.call(transaction,event);
          });
        }});
      }
      return transaction;
    };
    state.releaseLibraryBlob = release;
  });
}
async function releaseLibraryBlob(page:Page) {
  await page.evaluate(() => (window as unknown as {releaseLibraryBlob:()=>void}).releaseLibraryBlob());
}
async function recentIds(page:Page) {
  return page.evaluate(async () => {
    const {readLibraryPreferences} = await import("/lib/client/reusable-library-storage.ts" as string);
    return (await readLibraryPreferences("guest")).recents as string[];
  });
}
async function assetDigest(page:Page,id:string) {
  return page.evaluate(async assetId => {
    const {resolveAsset} = await import("/lib/client/storage.ts" as string);
    const blob = await resolveAsset("guest",assetId);
    const digest = await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());
    return {bytes:blob.size,sha256:[...new Uint8Array(digest)].map(value => value.toString(16).padStart(2,"0")).join("")};
  },id);
}

test("search and favorites persist without entering music history or recents",async({page}) => {
  await ready(page);
  await expect.poll(async () => (await readDocument(page))?.tracks.length ?? 0).toBeGreaterThan(0);
  const before = await readDocument(page);
  const undo = await page.getByLabel("Undo",{exact:true}).isEnabled();
  await library(page).getByLabel("Search library").fill("glass");
  await expect(library(page).locator(".library-choice")).toHaveCount(1);
  await library(page).getByRole("button",{name:"Favorite Glass FM",exact:true}).click();
  await expect(library(page).getByRole("button",{name:"Unfavorite Glass FM",exact:true})).toHaveAttribute("aria-pressed","true");
  await library(page).getByRole("button",{name:"Favorites",exact:true}).click();
  await expect(library(page).getByRole("button",{name:"Glass FM Synthesizers",exact:true})).toBeVisible();
  await library(page).getByRole("button",{name:"Recent",exact:true}).click();
  await expect(library(page).locator(".library-choice")).toHaveCount(0);
  expect(await readDocument(page)).toEqual(before);
  expect(await page.getByLabel("Undo",{exact:true}).isEnabled()).toBe(undo);
  await page.reload();
  await expect(library(page).getByRole("button",{name:"Unfavorite Glass FM",exact:true})).toBeEnabled();
  await library(page).getByRole("button",{name:"Favorites",exact:true}).click();
  await expect(library(page).getByRole("button",{name:"Glass FM Synthesizers",exact:true})).toBeVisible();
});

test("explicit sound replacement retains clips and mixer identity while successful use enters Recent",async({page}) => {
  await ready(page);
  await expect.poll(async () => (await readDocument(page))?.tracks.length ?? 0).toBeGreaterThan(0);
  const before = (await readDocument(page))!, track = before.tracks[0];
  await page.locator(".timeline-clip").first().click();
  await fm(page);
  await expect.poll(async () => (await readDocument(page))?.tracks[0].sound.algorithm).toBe("fm");
  const changed = (await readDocument(page))!.tracks[0];
  expect({id:changed.id,name:changed.name,clips:changed.clips,automation:changed.automation,volume:changed.volume,pan:changed.pan,mute:changed.mute,solo:changed.solo}).toEqual({id:track.id,name:track.name,clips:track.clips,automation:track.automation,volume:track.volume,pan:track.pan,mute:track.mute,solo:track.solo});
  await library(page).getByRole("button",{name:"Recent",exact:true}).click();
  await expect(library(page).getByRole("button",{name:"Glass FM Synthesizers",exact:true})).toBeVisible();
  await page.getByLabel("Undo",{exact:true}).click();
  await expect.poll(async () => (await readDocument(page))?.tracks[0].sound.algorithm).toBe(track.sound.algorithm);
  await page.getByLabel("Redo",{exact:true}).click();
  await expect.poll(async () => (await readDocument(page))?.tracks[0].sound.algorithm).toBe("fm");
});

test("Preview enters Recent without changing the song and Stop preview leaves song playback running",async({page}) => {
  await ready(page);
  await expect.poll(async () => (await readDocument(page))?.tracks.length ?? 0).toBeGreaterThan(0);
  const before = await readDocument(page);
  expect(await recentIds(page)).not.toContain("factory_lead");
  const undo = await page.getByLabel("Undo",{exact:true}).isEnabled();
  await library(page).getByRole("button",{name:"Glass FM Synthesizers",exact:true}).click();
  await library(page).getByRole("button",{name:"Preview",exact:true}).click();
  await expect.poll(() => recentIds(page)).toContain("factory_lead");
  expect(await readDocument(page)).toEqual(before);
  expect(await page.getByLabel("Undo",{exact:true}).isEnabled()).toBe(undo);
  await library(page).getByRole("button",{name:"Recent",exact:true}).click();
  await expect(library(page).getByRole("button",{name:"Glass FM Synthesizers",exact:true})).toBeVisible();
  // A blank FM song avoids unrelated acoustic downloads while observing the live transport.
  await page.getByRole("button",{name:"Songs",exact:true}).click();
  await page.getByRole("button",{name:"Blank song",exact:true}).click();
  await library(page).getByRole("button",{name:"Sounds",exact:true}).click();
  await fm(page);
  await page.getByLabel("Play song",{exact:true}).click();
  await expect(page.getByLabel("Pause song",{exact:true})).toBeVisible();
  await library(page).getByRole("button",{name:"Preview",exact:true}).click();
  await library(page).getByRole("button",{name:"Stop preview",exact:true}).click();
  const position = Number(await page.getByLabel("Song playhead",{exact:true}).inputValue());
  await expect(page.getByLabel("Pause song",{exact:true})).toBeVisible();
  await expect.poll(async () => Number(await page.getByLabel("Song playhead",{exact:true}).inputValue())).toBeGreaterThan(position);
  await expect(library(page).getByText("Preview did not start. Review the library message and try again.",{exact:true})).toHaveCount(0);
});

test("an incompatible drum idea keeps its notes and has a direct complete-phrase new-track route",async({page}) => {
  await ready(page);
  await page.getByRole("button",{name:"Songs",exact:true}).click();
  await page.getByRole("button",{name:"Blank song",exact:true}).click();
  await library(page).getByRole("button",{name:"Ideas",exact:true}).click();
  await library(page).getByRole("button",{name:"Steady drums Percussion",exact:true}).click();
  await library(page).getByRole("button",{name:"Insert library entry",exact:true}).click();
  await expect(library(page).locator(".library-error").first()).toContainText("incompatible");
  await expect(page.locator(".timeline-clip")).toHaveCount(0);
  await library(page).getByRole("button",{name:"Insert complete phrase on a new track",exact:true}).click();
  await expect(library(page).getByRole("status")).toContainText("Steady drums inserted.");
  await expect.poll(async () => (await readDocument(page))?.tracks.find(track => track.name === "Steady drums")?.clips[0].notes.length ?? 0).toBeGreaterThan(0);
  const doc = (await readDocument(page))!, track = doc.tracks.find(track => track.name === "Steady drums")!;
  expect(doc.userInstruments.find(instrument => instrument.id === track.instrumentId)?.kind).toBe("drums");
  expect(track.clips[0].events).toEqual([]);
});

test("saved phrases retain rejected overlap proposals and repeated uses have independent identities",async({page}) => {
  await ready(page);
  await page.locator(".timeline-clip").first().click();
  await fm(page);
  const name = "Reusable melody";
  await save(page,"phrase",name);
  await library(page).getByRole("button",{name:"Ideas",exact:true}).click();
  await library(page).getByLabel("Search library").fill(name);
  await library(page).getByRole("button",{name:`${name} Synthesizers`,exact:true}).click();
  const before = await page.locator(".timeline-clip").count();
  await library(page).getByRole("button",{name:"Insert library entry",exact:true}).click();
  await expect(library(page).getByRole("status")).toContainText("overlaps existing material");
  await expect(page.locator(".timeline-clip")).toHaveCount(before);
  await expect(library(page).getByRole("button",{name:`${name} Synthesizers`,exact:true})).toHaveAttribute("aria-pressed","true");
  await library(page).getByRole("button",{name:"Insert on a new track",exact:true}).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(before+1);
  await expect(library(page).getByRole("status")).toContainText(`${name} inserted.`);
  await library(page).getByRole("button",{name:"Insert library entry",exact:true}).click();
  await expect(library(page).getByRole("button",{name:"Insert on a new track",exact:true})).toBeVisible();
  await library(page).getByRole("button",{name:"Insert on a new track",exact:true}).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(before+2);
  await expect.poll(async () => (await readDocument(page))?.tracks.filter(track => track.name === name).flatMap(track => track.clips).length ?? 0).toBe(2);
  const inserted = (await readDocument(page))!.tracks.filter(track => track.name === name).flatMap(track => track.clips);
  expect(inserted[0].id).not.toBe(inserted[1].id);
  expect(inserted[0].notes.length).toBeGreaterThan(0);
  expect(inserted[0].notes.map(note => note.id).some(id => inserted[1].notes.some(note => note.id === id))).toBe(false);
  const manage = library(page).locator(".library-manage");
  if (!await manage.evaluate(element => (element as HTMLDetailsElement).open)) await manage.locator("summary").click();
  await manage.getByRole("button",{name:"Delete selected library entry",exact:true}).click();
  await expect(library(page).getByRole("button",{name:`${name} Synthesizers`,exact:true})).toHaveCount(0);
  await expect(page.locator(".timeline-clip")).toHaveCount(before+2);
  await page.getByLabel("Undo",{exact:true}).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(before+1);
  await page.getByLabel("Redo",{exact:true}).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(before+2);
});

test("library backup restores fresh entries and malformed archives change no music",async({page}) => {
  await ready(page);
  await fm(page);
  const name = "Saved FM backup";
  await save(page,"sound",name);
  const downloadEvent = page.waitForEvent("download");
  await library(page).getByRole("button",{name:"Export library backup",exact:true}).click();
  const archive = await downloadEvent, archivePath = await archive.path();
  expect(archivePath).not.toBeNull();
  await library(page).getByLabel("Search library").fill(name);
  await library(page).getByRole("button",{name:`${name} Synthesizers`,exact:true}).click();
  await library(page).getByRole("button",{name:"Delete selected library entry",exact:true}).click();
  await expect(library(page).locator(".library-choice")).toHaveCount(0);
  await library(page).getByLabel("Import library archive").setInputFiles(archivePath!);
  await expect(library(page).getByRole("button",{name:`${name} Synthesizers`,exact:true})).toBeVisible();
  await expect.poll(async () => (await readDocument(page))?.tracks[0].sound.algorithm).toBe("fm");
  const before = await readDocument(page);
  await library(page).getByLabel("Import library archive").setInputFiles({name:"malformed.chordz-library",mimeType:"application/zip",buffer:Buffer.from("not a library archive")});
  await expect(library(page).locator(".library-error")).toContainText("archive");
  expect(await readDocument(page)).toEqual(before);
  await expect(library(page).getByRole("button",{name:`${name} Synthesizers`,exact:true})).toBeVisible();
});

test("a sampled sound target edit then Undo invalidates delayed placement without recents or success",async({page}) => {
  await ready(page);
  await sampledEntry(page,"Delayed sample");
  await expect.poll(async () => (await readDocument(page))?.tracks.length ?? 0).toBeGreaterThan(0);
  const before = (await readDocument(page))!, track = before.tracks[0];
  await holdLibrarySnapshot(page);
  await library(page).getByRole("button",{name:"Replace with library entry",exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as {libraryBlobHeld:boolean}).libraryBlobHeld)).toBe(true);
  await page.getByRole("button",{name:`Mute ${track.name}`,exact:true}).click();
  await expect(page.getByRole("button",{name:`Mute ${track.name}`,exact:true})).toHaveAttribute("aria-pressed","true");
  await page.getByLabel("Undo",{exact:true}).click();
  await expect(page.getByRole("button",{name:`Mute ${track.name}`,exact:true})).toHaveAttribute("aria-pressed","false");
  await releaseLibraryBlob(page);
  await expect(library(page)).toHaveAttribute("aria-busy","false");
  await expect(library(page).locator(".library-error").first()).toBeVisible();
  expect(await readDocument(page)).toEqual(before);
  await library(page).getByRole("button",{name:"Recent",exact:true}).click();
  await expect(library(page).getByRole("button",{name:"Delayed sample Sampler",exact:true})).toHaveCount(0);
  await expect(library(page).getByText("Delayed sample replaced.",{exact:true})).toHaveCount(0);
});

test("an unrelated title edit survives sampled sound placement assembled after loading",async({page}) => {
  await ready(page);
  await sampledEntry(page,"Independent sample");
  await holdLibrarySnapshot(page);
  await library(page).getByRole("button",{name:"Replace with library entry",exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as {libraryBlobHeld:boolean}).libraryBlobHeld)).toBe(true);
  await page.getByLabel("Song title").fill("Unrelated title survives");
  await page.getByLabel("Song title").press("Enter");
  await releaseLibraryBlob(page);
  await expect(library(page).getByRole("status")).toContainText("Independent sample replaced.");
  await expect(page.getByLabel("Song title")).toHaveValue("Unrelated title survives");
  await expect.poll(async () => (await readDocument(page))?.tracks[0].instrumentId).not.toBe("piano");
  expect((await readDocument(page))!.title).toBe("Unrelated title survives");
  await library(page).getByRole("button",{name:"Recent",exact:true}).click();
  await expect(library(page).getByRole("button",{name:"Independent sample Sampler",exact:true})).toBeVisible();
});

test("changing the destination and returning cannot revive a delayed sample insertion",async({page}) => {
  await ready(page);
  await sampledEntry(page,"Destination sample");
  await expect.poll(async () => (await readDocument(page))?.tracks.length ?? 0).toBeGreaterThan(1);
  const before = (await readDocument(page))!, recents = await recentIds(page);
  await holdLibrarySnapshot(page);
  await library(page).getByRole("button",{name:"Replace with library entry",exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as {libraryBlobHeld:boolean}).libraryBlobHeld)).toBe(true);
  await page.getByRole("button",{name:`Select ${before.tracks[1].name}`,exact:true}).click();
  await page.getByRole("button",{name:`Select ${before.tracks[0].name}`,exact:true}).click();
  await releaseLibraryBlob(page);
  await expect(library(page).locator(".library-error").first()).toContainText("destination changed");
  expect(await readDocument(page)).toEqual(before);
  expect(await recentIds(page)).toEqual(recents);
  await expect(library(page).getByText("Destination sample replaced.",{exact:true})).toHaveCount(0);
});

test("New Song cancels delayed placement and preserves the new document and recents",async({page}) => {
  await ready(page);
  await sampledEntry(page,"Project sample");
  const recents = await recentIds(page), before = (await readDocument(page))!;
  await holdLibrarySnapshot(page);
  await library(page).getByRole("button",{name:"Replace with library entry",exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as {libraryBlobHeld:boolean}).libraryBlobHeld)).toBe(true);
  await page.getByRole("button",{name:"Songs",exact:true}).click();
  await page.getByRole("button",{name:"Blank song",exact:true}).click();
  await expect(page.getByLabel("Song title")).toHaveValue("Untitled song");
  await expect.poll(async () => (await readDocument(page))?.id).not.toBe(before.id);
  const fresh = await readDocument(page);
  await releaseLibraryBlob(page);
  await expect(library(page)).toHaveAttribute("aria-busy","false");
  expect(await readDocument(page)).toEqual(fresh);
  expect(await recentIds(page)).toEqual(recents);
  await expect(library(page).getByText("Project sample replaced.",{exact:true})).toHaveCount(0);
});

test("deleting the explicit target phrase makes delayed placement stale while retaining the deletion",async({page}) => {
  await ready(page);
  await sampledEntry(page,"Deleted target sample");
  await page.locator(".timeline-clip").first().click();
  const count = await page.locator(".timeline-clip").count(), recents = await recentIds(page);
  const before = (await readDocument(page))!, instrument = before.tracks[0].instrumentId;
  await holdLibrarySnapshot(page);
  await library(page).getByRole("button",{name:"Replace with library entry",exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as {libraryBlobHeld:boolean}).libraryBlobHeld)).toBe(true);
  await page.getByLabel("Delete selected clip",{exact:true}).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(count-1);
  await releaseLibraryBlob(page);
  await expect(library(page).locator(".library-error").first()).toContainText("destination changed");
  await expect.poll(async () => (await readDocument(page))?.tracks.flatMap(track => track.clips).length ?? 0).toBe(count-1);
  expect((await readDocument(page))!.tracks[0].instrumentId).toBe(instrument);
  expect(await recentIds(page)).toEqual(recents);
});

test("local sign-in leaves a pending guest placement and guest library outside the signed-in owner",async({page}) => {
  await ready(page);
  await sampledEntry(page,"Guest owner sample");
  const before = (await readDocument(page))!, recents = await recentIds(page);
  await holdLibrarySnapshot(page);
  await library(page).getByRole("button",{name:"Replace with library entry",exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as {libraryBlobHeld:boolean}).libraryBlobHeld)).toBe(true);
  // The existing local test sign-in route is used unchanged, as in cloud round-trip tests.
  await page.getByRole("link",{name:"Sign in",exact:true}).click();
  await expect(page.locator("a.avatar")).toBeVisible();
  await expect(library(page).getByRole("button",{name:"Guest owner sample Sampler",exact:true})).toHaveCount(0);
  await expect(library(page).getByText("Guest owner sample replaced.",{exact:true})).toHaveCount(0);
  await page.locator("a.avatar").click();
  await expect(page.getByRole("link",{name:"Sign in",exact:true})).toBeVisible();
  await expect(library(page).getByRole("button",{name:"Guest owner sample Sampler",exact:true})).toBeVisible();
  expect(await readDocument(page)).toEqual(before);
  expect(await recentIds(page)).toEqual(recents);
});

test("saved audio retains seconds and independent bytes through insertion, deletion, Undo, Redo and reload",async({page}) => {
  await ready(page);
  await page.getByRole("button",{name:"Songs",exact:true}).click();
  await page.getByRole("button",{name:"Blank song",exact:true}).click();
  const samples = Float32Array.from({length:48000},(_,index) => Math.sin(index*2*Math.PI*220/48000)*.1);
  const bytes = new Uint8Array(encodeWav([samples],48000,16)), expectedBytes = {bytes:bytes.byteLength,sha256:createHash("sha256").update(bytes).digest("hex")};
  await library(page).getByRole("button",{name:"Import audio / Inputs",exact:true}).click();
  await page.getByLabel("Import audio file",{exact:true}).setInputFiles({name:"Original phrase.wav",mimeType:"audio/wav",buffer:Buffer.from(bytes)});
  await expect(page.locator(".clip-editor-metadata > summary")).toContainText("Original phrase.wav");
  await page.locator(".clip-editor-metadata > summary").click();
  await page.getByLabel("Clip length bars",{exact:true}).fill("0.25");
  await page.getByLabel("Clip length bars",{exact:true}).press("Enter");
  await page.getByLabel("Source offset",{exact:true}).fill("0.12");
  await save(page,"phrase","Saved audio phrase");
  await expect.poll(async () => (await readDocument(page))?.tracks.find(track => track.kind === "audio")?.clips[0].audio?.offsetSec).toBe(.12);
  const source = (await readDocument(page))!.tracks.find(track => track.kind === "audio")!.clips[0];
  await page.getByLabel("Tempo",{exact:true}).fill("180");
  await page.getByLabel("Tempo",{exact:true}).press("Enter");
  await library(page).getByRole("button",{name:"Ideas",exact:true}).click();
  await library(page).getByLabel("Search library").fill("Saved audio phrase");
  await library(page).getByRole("button",{name:"Saved audio phrase Keys",exact:true}).click();
  await expect(library(page).getByRole("button",{name:"Replace with library entry",exact:true})).toHaveCount(0);
  await library(page).getByRole("button",{name:"Insert library entry",exact:true}).click();
  await expect(library(page).getByRole("button",{name:"Insert on a new track",exact:true})).toBeVisible();
  await library(page).getByRole("button",{name:"Insert on a new track",exact:true}).click();
  await expect(library(page).getByRole("status")).toContainText("Saved audio phrase inserted.");
  await expect.poll(async () => (await readDocument(page))?.tracks.find(track => track.name === "Saved audio phrase")?.clips.length ?? 0).toBe(1);
  const inserted = (await readDocument(page))!.tracks.find(track => track.name === "Saved audio phrase")!.clips[0], assetId = inserted.audio!.assetId;
  expect(inserted.id).not.toBe(source.id);
  expect(assetId).not.toBe(source.audio!.assetId);
  expect(inserted.lengthTick).toBe(1440);
  expect(inserted.sourceLengthTick).toBe(1440);
  expect(inserted.audio).toEqual({...source.audio,assetId});
  expect(await assetDigest(page,assetId)).toEqual(expectedBytes);
  await library(page).getByRole("button",{name:"Delete selected library entry",exact:true}).click();
  await expect(library(page).getByRole("button",{name:"Saved audio phrase Keys",exact:true})).toHaveCount(0);
  expect(await assetDigest(page,assetId)).toEqual(expectedBytes);
  await page.getByLabel("Undo",{exact:true}).click();
  await expect.poll(async () => (await readDocument(page))?.tracks.filter(track => track.name === "Saved audio phrase").length ?? -1).toBe(0);
  expect(await assetDigest(page,assetId)).toEqual(expectedBytes);
  await page.getByLabel("Redo",{exact:true}).click();
  await expect.poll(async () => (await readDocument(page))?.tracks.find(track => track.name === "Saved audio phrase")?.clips[0].audio?.assetId).toBe(assetId);
  await page.reload();
  await expect(page.getByLabel("Tempo",{exact:true})).toHaveValue("180");
  expect((await readDocument(page))!.tracks.find(track => track.name === "Saved audio phrase")!.clips[0].audio).toEqual(inserted.audio);
  expect(await assetDigest(page,assetId)).toEqual(expectedBytes);
});

test("discovery remains internally scrollable beside the canvas and transport at laptop and narrow sizes",async({page}) => {
  const errors:string[] = []; page.on("pageerror",error => errors.push(error.message));
  await ready(page);
  mkdirSync("output/library-review",{recursive:true});
  for (const [width,height] of [[1366,768],[1920,1080],[1024,768],[390,844]]) {
    await page.setViewportSize({width,height});
    if (width < 1100 && !await page.getByLabel("Toggle assets panel").getAttribute("aria-expanded").then(value => value === "true"))
      await page.getByLabel("Toggle assets panel").click();
    await expect(library(page).getByLabel("Search library")).toBeVisible();
    await expect(page.getByLabel("Stop song",{exact:true})).toBeInViewport();
    await expect(page.getByRole("region",{name:"Song canvas",exact:true})).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const results = library(page).locator(".library-results");
    expect(await results.evaluate(element => getComputedStyle(element).overflowY)).toBe("auto");
    await library(page).getByRole("button",{name:"Ideas",exact:true}).click();
    await expect(library(page).getByRole("button",{name:"Chords & parts Develop the current progression.",exact:true})).toBeVisible();
    await library(page).getByRole("button",{name:"Chords & parts Develop the current progression.",exact:true}).click();
    await expect(page.getByRole("tabpanel",{name:"Writing",exact:true})).toBeVisible();
    if (width < 1100) await page.getByLabel("Toggle assets panel").click();
    await library(page).getByRole("button",{name:"Sounds",exact:true}).click();
    await expect.poll(() => results.evaluate(element => element.scrollTop)).toBe(0);
    if (width === 1366 || width === 390) await page.screenshot({path:`output/library-review/${width}-library.png`,animations:"disabled"});
  }
  expect(errors).toEqual([]);
});
