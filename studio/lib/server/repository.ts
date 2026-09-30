import type {
  AssetReference,
  CloudProject,
  ProjectDocument,
  ProjectSummary,
} from "../music/types";
import { projectSchema } from "../music/schema";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (
    (origin &&
      origin !== new URL(request.url).origin &&
      origin !== "https://chordz-studio.pdekker24.chatgpt.site") ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new ApiError(403, "This action must come from the Chordz studio.");
}
type ProjectRow = {
  id: string;
  owner_id: string;
  document: string;
  revision: number;
  updated_at: string;
};
export type AssetRow = {
  id: string;
  owner_id: string;
  project_id: string;
  name: string;
  mime: string;
  byte_length: number;
  duration: number;
  sample_rate: number;
  channels: number;
  object_key: string;
  status: string;
};
export class ProjectRepository {
  constructor(private db: D1Database) {}
  async list(owner: string): Promise<ProjectSummary[]> {
    const result = await this.db
      .prepare(
        "SELECT id,title,json_extract(document,'$.tempo') tempo,json_extract(document,'$.key') key,json_extract(document,'$.mode') mode,json_array_length(document,'$.tracks') track_count,revision,updated_at FROM projects WHERE owner_id=? ORDER BY updated_at DESC LIMIT 1000",
      )
      .bind(owner)
      .all<{
        id: string;
        title: string;
        tempo: number;
        key: string;
        mode: ProjectDocument["mode"];
        track_count: number;
        revision: number;
        updated_at: string;
      }>();
    return result.results.map((row) => ({
      id: row.id,
      title: row.title,
      tempo: row.tempo,
      key: row.key,
      mode: row.mode,
      trackCount: row.track_count,
      revision: row.revision,
      updatedAt: row.updated_at,
    }));
  }
  async get(owner: string, id: string): Promise<CloudProject> {
    const row = await this.db
      .prepare(
        "SELECT id,document,revision,updated_at FROM projects WHERE id=? AND owner_id=?",
      )
      .bind(id, owner)
      .first<ProjectRow>();
    if (!row) throw new ApiError(404, "This project is unavailable.");
    return {
      document: JSON.parse(row.document),
      revision: row.revision,
      updatedAt: row.updated_at,
    };
  }
  async validateAssets(owner: string, document: ProjectDocument) {
    projectSchema.parse(document);
    if (
      new TextEncoder().encode(JSON.stringify(document)).byteLength > 1_800_000
    )
      throw new ApiError(
        413,
        "This song has more edit data than one project can save. Split it into smaller projects.",
      );
    for (const asset of document.assets) {
      const row = await this.db
        .prepare("SELECT id FROM assets WHERE id=? AND owner_id=? AND status=?")
        .bind(asset.id, owner, "ready")
        .first();
      if (!row)
        throw new ApiError(
          400,
          "A project asset is unavailable or belongs to another musician.",
        );
    }
  }
  async create(
    owner: string,
    document: ProjectDocument,
  ): Promise<CloudProject> {
    await this.validateAssets(owner, document);
    const exists = await this.db
      .prepare("SELECT id,owner_id,document FROM projects WHERE id=?")
      .bind(document.id)
      .first<{ id: string; owner_id: string; document: string }>();
    if (exists?.owner_id === owner) {
      const current = await this.get(owner, document.id);
      if (JSON.stringify(current.document) === JSON.stringify(document))
        return current;
      const conflictId = crypto.randomUUID();
      await this.db
        .prepare(
          "INSERT INTO project_versions(id,project_id,owner_id,document,revision,kind,created_at) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(
          conflictId,
          document.id,
          owner,
          JSON.stringify(document),
          0,
          "conflict",
          new Date().toISOString(),
        )
        .run();
      throw new ApiError(
        409,
        "This project already has a cloud version. Both edits have been kept.",
        { current, conflictId },
      );
    }
    if (exists)
      throw new ApiError(409, "This project identifier is already in use.");
    const now = new Date().toISOString();
    await this.db
      .prepare(
        "INSERT INTO projects(id,owner_id,title,document,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(
        document.id,
        owner,
        document.title,
        JSON.stringify(document),
        1,
        now,
        now,
      )
      .run();
    return { document, revision: 1, updatedAt: now };
  }
  async save(
    owner: string,
    id: string,
    document: ProjectDocument,
    expectedRevision: number,
  ): Promise<CloudProject> {
    if (document.id !== id)
      throw new ApiError(400, "The project identifier does not match.");
    await this.get(owner, id);
    await this.validateAssets(owner, document);
    const now = new Date().toISOString();
    const result = await this.db
      .prepare(
        "UPDATE projects SET title=?,document=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=?",
      )
      .bind(
        document.title,
        JSON.stringify(document),
        now,
        id,
        owner,
        expectedRevision,
      )
      .run();
    if (!result.meta.changes) {
      const current = await this.get(owner, id);
      const conflictId = crypto.randomUUID();
      await this.db
        .prepare(
          "INSERT INTO project_versions(id,project_id,owner_id,document,revision,kind,created_at) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(
          conflictId,
          id,
          owner,
          JSON.stringify(document),
          expectedRevision,
          "conflict",
          now,
        )
        .run();
      throw new ApiError(
        409,
        "This project changed on another device. Both versions have been kept.",
        { current, conflictId },
      );
    }
    return { document, revision: expectedRevision + 1, updatedAt: now };
  }
  async versions(
    owner: string,
    id: string,
  ): Promise<
    {
      id: string;
      document: ProjectDocument;
      revision: number;
      kind: string;
      createdAt: string;
    }[]
  > {
    await this.get(owner, id);
    const result = await this.db
      .prepare(
        "SELECT id,document,revision,kind,created_at FROM project_versions WHERE project_id=? AND owner_id=? ORDER BY created_at DESC LIMIT 50",
      )
      .bind(id, owner)
      .all<{
        id: string;
        document: string;
        revision: number;
        kind: string;
        created_at: string;
      }>();
    return result.results.map((r) => ({
      id: r.id,
      document: JSON.parse(r.document),
      revision: r.revision,
      kind: r.kind,
      createdAt: r.created_at,
    }));
  }
  async remove(owner: string, id: string): Promise<string[]> {
    const removed = await this.get(owner, id),
      versions = await this.versions(owner, id);
    const linked = [
      ...new Set(
        [
          ...removed.document.assets,
          ...versions.flatMap((v) => v.document.assets),
        ].map((a) => a.id),
      ),
    ];
    await this.db.batch([
      this.db
        .prepare(
          "DELETE FROM project_versions WHERE project_id=? AND owner_id=?",
        )
        .bind(id, owner),
      this.db
        .prepare("DELETE FROM projects WHERE id=? AND owner_id=?")
        .bind(id, owner),
    ]);
    const remaining = await this.db
      .prepare(
        "SELECT document FROM projects WHERE owner_id=? UNION ALL SELECT document FROM project_versions WHERE owner_id=?",
      )
      .bind(owner, owner)
      .all<{ document: string }>();
    const used = new Set(
      remaining.results.flatMap((r) =>
        (JSON.parse(r.document) as ProjectDocument).assets.map((a) => a.id),
      ),
    );
    const candidate = await this.db
      .prepare(
        "SELECT id,object_key FROM assets WHERE owner_id=? AND (project_id=? OR id IN (SELECT value FROM json_each(?)))",
      )
      .bind(owner, id, JSON.stringify(linked))
      .all<{ id: string; object_key: string }>();
    const orphaned = candidate.results.filter((a) => !used.has(a.id));
    for (const asset of orphaned)
      await this.db
        .prepare("DELETE FROM assets WHERE id=? AND owner_id=?")
        .bind(asset.id, owner)
        .run();
    return orphaned.map((a) => a.object_key);
  }
  async reserveAsset(
    owner: string,
    projectId: string,
    asset: AssetReference,
  ): Promise<string> {
    await this.get(owner, projectId);
    const key = owner + "/" + projectId + "/" + asset.id;
    await this.db
      .prepare(
        "INSERT INTO assets(id,owner_id,project_id,name,mime,byte_length,duration,sample_rate,channels,object_key,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
      )
      .bind(
        asset.id,
        owner,
        projectId,
        asset.name,
        asset.mime,
        asset.byteLength,
        asset.duration,
        asset.sampleRate,
        asset.channels,
        key,
        "pending",
        new Date().toISOString(),
      )
      .run();
    const reserved = await this.db
      .prepare("SELECT * FROM assets WHERE id=? AND owner_id=?")
      .bind(asset.id, owner)
      .first<AssetRow>();
    if (
      !reserved ||
      reserved.status !== "pending" ||
      reserved.name !== asset.name ||
      reserved.mime !== asset.mime ||
      reserved.byte_length !== asset.byteLength ||
      reserved.duration !== asset.duration ||
      reserved.sample_rate !== asset.sampleRate ||
      reserved.channels !== asset.channels
    )
      throw new ApiError(
        409,
        "This audio identifier is already in use. Retry the save to recover its upload.",
      );
    return reserved.object_key;
  }
  async completeAsset(owner: string, id: string) {
    await this.db
      .prepare("UPDATE assets SET status=? WHERE id=? AND owner_id=?")
      .bind("ready", id, owner)
      .run();
  }
  async discardAsset(owner: string, id: string) {
    await this.db
      .prepare("DELETE FROM assets WHERE id=? AND owner_id=?")
      .bind(id, owner)
      .run();
  }
  async asset(owner: string, id: string): Promise<AssetRow> {
    const row = await this.db
      .prepare("SELECT * FROM assets WHERE id=? AND owner_id=? AND status=?")
      .bind(id, owner, "ready")
      .first<AssetRow>();
    if (!row) throw new ApiError(404, "This audio file is unavailable.");
    return row;
  }
  async removeAsset(owner: string, id: string) {
    const asset = await this.asset(owner, id);
    const references = await this.db
      .prepare(
        "SELECT p.id FROM projects p,json_each(p.document,'$.assets') a WHERE p.owner_id=? AND json_extract(a.value,'$.id')=? UNION ALL SELECT p.id FROM project_versions p,json_each(p.document,'$.assets') a WHERE p.owner_id=? AND json_extract(a.value,'$.id')=? LIMIT 1",
      )
      .bind(owner, id, owner, id)
      .first();
    if (references)
      throw new ApiError(
        409,
        "Remove this audio from your projects and recovery versions before deleting it.",
      );
    await this.discardAsset(owner, id);
    return asset.object_key;
  }
}
