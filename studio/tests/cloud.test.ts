import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  ProjectRepository,
  ApiError,
  assertSameOrigin,
} from "../lib/server/repository";
import { createProject } from "../lib/music/project";

let repo: ProjectRepository;
beforeEach(() => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    "CREATE TABLE projects(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,title TEXT NOT NULL,document TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE project_versions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,owner_id TEXT NOT NULL,document TEXT NOT NULL,revision INTEGER NOT NULL,kind TEXT NOT NULL,created_at TEXT NOT NULL); CREATE TABLE assets(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,project_id TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,byte_length INTEGER NOT NULL,duration REAL NOT NULL,sample_rate INTEGER NOT NULL,channels INTEGER NOT NULL,object_key TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);",
  );
  const db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const stmt = sqlite.prepare(sql);
      const self = {
        bind(...args: unknown[]) {
          values = args;
          return self;
        },
        async first() {
          return stmt.get(...(values as never[])) ?? null;
        },
        async all() {
          return { results: stmt.all(...(values as never[])) };
        },
        async run() {
          const result = stmt.run(...(values as never[]));
          return { meta: { changes: Number(result.changes) } };
        },
      };
      return self;
    },
    async batch(statements: { run: () => Promise<unknown> }[]) {
      return Promise.all(statements.map((s) => s.run()));
    },
  };
  repo = new ProjectRepository(db as never);
});

describe("owner-isolated cloud persistence", () => {
  it("retries an interrupted pending upload without leaving its asset stuck", async () => {
    const doc = createProject();
    await repo.create("alice", doc);
    const asset = {
      id: "pending-take",
      name: "take.wav",
      mime: "audio/wav",
      byteLength: 128,
      duration: 1,
      sampleRate: 48000,
      channels: 1,
    };
    const key = await repo.reserveAsset("alice", doc.id, asset);
    expect(await repo.reserveAsset("alice", doc.id, asset)).toBe(key);
    await expect(
      repo.reserveAsset("alice", doc.id, { ...asset, byteLength: 129 }),
    ).rejects.toMatchObject({ status: 409 });
    await repo.completeAsset("alice", asset.id);
    expect((await repo.asset("alice", asset.id)).object_key).toBe(key);
  });
  it("recovers an interrupted create without duplicating or overwriting it", async () => {
    const doc = createProject("Retry");
    const first = await repo.create("alice", doc);
    const retry = await repo.create("alice", doc);
    expect(retry.revision).toBe(first.revision);
    await expect(
      repo.create("alice", { ...doc, title: "New edit" }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await repo.get("alice", doc.id)).document.title).toBe("Retry");
    expect((await repo.versions("alice", doc.id))[0].document.title).toBe(
      "New edit",
    );
  });
  it("rejects another musician reading, saving, deleting or attaching assets", async () => {
    const doc = createProject("Private song");
    await repo.create("alice", doc);
    expect(await repo.list("bob")).toEqual([]);
    await expect(repo.get("bob", doc.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(repo.save("bob", doc.id, doc, 1)).rejects.toMatchObject({
      status: 404,
    });
    await expect(repo.remove("bob", doc.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      repo.reserveAsset("bob", doc.id, {
        id: "take",
        name: "take.wav",
        mime: "audio/wav",
        byteLength: 128,
        duration: 1,
        sampleRate: 48000,
        channels: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("atomically checks revisions and retains both sides of a conflict", async () => {
    const doc = createProject("Original");
    await repo.create("alice", doc);
    const first = await repo.save(
      "alice",
      doc.id,
      { ...doc, title: "Cloud edit" },
      1,
    );
    expect(first.revision).toBe(2);
    await expect(
      repo.save("alice", doc.id, { ...doc, title: "Other device" }, 1),
    ).rejects.toMatchObject({ status: 409 });
    expect((await repo.get("alice", doc.id)).document.title).toBe("Cloud edit");
    const versions = await repo.versions("alice", doc.id);
    expect(
      versions.some(
        (v) => v.kind === "conflict" && v.document.title === "Other device",
      ),
    ).toBe(true);
  });
  it("rejects assets belonging to a different owner", async () => {
    const alice = createProject(),
      bob = createProject();
    await repo.create("alice", alice);
    await repo.create("bob", bob);
    await repo.reserveAsset("alice", alice.id, {
      id: "alice-take",
      name: "voice.wav",
      mime: "audio/wav",
      byteLength: 128,
      duration: 1,
      sampleRate: 48000,
      channels: 1,
    });
    await repo.completeAsset("alice", "alice-take");
    const asset = {
      id: "alice-take",
      name: "voice.wav",
      mime: "audio/wav",
      byteLength: 128,
      duration: 1,
      sampleRate: 48000,
      channels: 1,
    };
    await expect(
      repo.save("bob", bob.id, { ...bob, assets: [asset] }, 1),
    ).rejects.toMatchObject({ status: 400 });
    await expect(repo.asset("bob", "alice-take")).rejects.toMatchObject({
      status: 404,
    });
    await expect(repo.removeAsset("bob", "alice-take")).rejects.toMatchObject({
      status: 404,
    });
  });
  it("does not allow cross-site mutations", () => {
    expect(() =>
      assertSameOrigin(
        new Request("https://chordz.test/api/projects", {
          method: "POST",
          headers: { Origin: "https://attacker.test" },
        }),
      ),
    ).toThrow(ApiError);
    expect(() =>
      assertSameOrigin(
        new Request("https://chordz.test/api/projects", {
          method: "POST",
          headers: { Origin: "https://chordz.test" },
        }),
      ),
    ).not.toThrow();
  });
  it("keeps shared audio until the final recovered project is removed", async () => {
    const first = createProject(),
      copy = { ...createProject(), title: "Recovered" };
    await repo.create("alice", first);
    const asset = {
      id: "shared-take",
      name: "take.wav",
      mime: "audio/wav",
      byteLength: 128,
      duration: 1,
      sampleRate: 48000,
      channels: 1,
    };
    await repo.reserveAsset("alice", first.id, asset);
    await repo.completeAsset("alice", asset.id);
    await repo.save("alice", first.id, { ...first, assets: [asset] }, 1);
    await repo.create("alice", { ...copy, assets: [asset] });
    expect(await repo.remove("alice", first.id)).toEqual([]);
    expect(await repo.asset("alice", asset.id)).toBeTruthy();
    expect(await repo.remove("alice", copy.id)).toHaveLength(1);
    await expect(repo.asset("alice", asset.id)).rejects.toMatchObject({
      status: 404,
    });
  });
});
