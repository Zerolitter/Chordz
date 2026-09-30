import type {
  CloudProject,
  ProjectDocument,
  ProjectSummary,
} from "../music/types";
import { projectSchema } from "../music/schema";
import { STUDIO_FEATURE_HEADER, STUDIO_MODULATION_FEATURE } from "../music/performance";
export class CloudError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: { current: CloudProject; conflictId: string },
  ) {
    super(message);
  }
}
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const result = (await response.json()) as {
    error?: string;
    details?: { current: CloudProject; conflictId: string };
  };
  if (!response.ok)
    throw new CloudError(
      response.status,
      result.error ?? "Cloud storage is unavailable.",
      result.details,
    );
  return result as T;
}
export const listProjects = () => request<ProjectSummary[]>("/api/projects");
export async function loadProject(id: string) {
  const value = await request<CloudProject>(
    "/api/projects/" + encodeURIComponent(id),
    { headers: { [STUDIO_FEATURE_HEADER]: STUDIO_MODULATION_FEATURE } },
  );
  return { ...value, document: projectSchema.parse(value.document) };
}
export const createCloudProject = (document: ProjectDocument) =>
  request<CloudProject>("/api/projects", {
    method: "POST",
    headers: { [STUDIO_FEATURE_HEADER]: STUDIO_MODULATION_FEATURE },
    body: JSON.stringify(document),
  });
export const saveCloudProject = (
  document: ProjectDocument,
  expectedRevision: number,
) =>
  request<CloudProject>("/api/projects/" + encodeURIComponent(document.id), {
    method: "PUT",
    headers: { [STUDIO_FEATURE_HEADER]: STUDIO_MODULATION_FEATURE },
    body: JSON.stringify({ document, expectedRevision }),
  });
export const deleteCloudProject = (id: string) =>
  request<{ deleted: true }>("/api/projects/" + encodeURIComponent(id), {
    method: "DELETE",
  });
export const loadVersions = (id: string) =>
  request<
    { id: string; document: ProjectDocument; kind: string; createdAt: string }[]
  >("/api/projects/" + encodeURIComponent(id) + "/versions", {
    headers: { [STUDIO_FEATURE_HEADER]: STUDIO_MODULATION_FEATURE },
  });
