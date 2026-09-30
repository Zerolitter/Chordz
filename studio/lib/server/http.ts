import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../app/chatgpt-auth";
import { ZodError } from "zod";
import { ApiError, assertSameOrigin, ProjectRepository } from "./repository";

export const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export async function context(request: Request, mutation = false) {
  const user = await getChatGPTUser();
  if (!user) throw new ApiError(401, "Sign in to save and open your songs.");
  if (mutation) assertSameOrigin(request);
  if (!env.DB || !env.BUCKET)
    throw new ApiError(
      503,
      "Cloud storage is temporarily unavailable. Your recovery draft remains on this device.",
    );
  return { user, repo: new ProjectRepository(env.DB), bucket: env.BUCKET };
}
export async function readJson(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new ApiError(415, "Send a JSON project document.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "A project document is required.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 1_800_000) {
      await reader.cancel();
      throw new ApiError(
        413,
        "This project is too large to save as a single document.",
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, "This project document is not valid JSON.");
  }
}
export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: privateHeaders });
}
export function handler(run: () => Promise<Response>) {
  return run().catch((error) => {
    if (error instanceof ApiError)
      return json(
        { error: error.message, details: error.details },
        error.status,
      );
    if (error instanceof ZodError)
      return json(
        {
          error: "The song contains invalid data.",
          issues: error.issues.slice(0, 3).map((i) => i.message),
        },
        400,
      );
    console.error(
      "Chordz request failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return json(
      {
        error:
          "This action could not be completed. Try again; your edits remain on this device.",
      },
      503,
    );
  });
}
