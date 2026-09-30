import { z } from "zod";
import { uid } from "../../../lib/music/types";
import { idSchema } from "../../../lib/music/schema";
import { context, handler, json } from "../../../lib/server/http";
import { ApiError } from "../../../lib/server/repository";
export const dynamic = "force-dynamic";
const metadata = z.object({
  projectId: idSchema,
  name: z.string().min(1).max(200),
  mime: z.enum([
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp4",
    "audio/ogg",
    "audio/webm",
    "audio/flac",
    "audio/aac",
  ]),
  byteLength: z
    .number()
    .int()
    .min(1)
    .max(100 * 1024 * 1024),
  duration: z.number().min(0).max(86400),
  sampleRate: z.number().int().min(8000).max(192000),
  channels: z.number().int().min(1).max(8),
});
export function POST(request: Request) {
  return handler(async () => {
    const { user, repo, bucket } = await context(request, true);
    const size = Number(request.headers.get("content-length"));
    if (!size || !request.body)
      throw new ApiError(411, "Choose an audio file with a known size.");
    let name: string;
    try {
      name = decodeURIComponent(
        request.headers.get("x-file-name") ?? "Audio take",
      );
    } catch {
      throw new ApiError(400, "This filename is invalid.");
    }
    const input = metadata.parse({
      projectId: request.headers.get("x-project-id"),
      name,
      mime: (request.headers.get("content-type") ?? "").split(";")[0],
      byteLength: size,
      duration: Number(request.headers.get("x-duration")),
      sampleRate: Number(request.headers.get("x-sample-rate")),
      channels: Number(request.headers.get("x-channels")),
    });
    const { projectId, ...asset } = input;
    await repo.get(user.userId, projectId);
    const requestedId = request.headers.get("x-asset-id");
    const result = {
      id: requestedId ? idSchema.parse(requestedId) : uid(),
      ...asset,
    };
    if (requestedId) {
      try {
        const existing = await repo.asset(user.userId, result.id);
        if (
          existing.byte_length !== asset.byteLength ||
          existing.name !== asset.name ||
          existing.mime !== asset.mime
        )
          throw new ApiError(
            409,
            "An audio upload with this identifier already exists.",
          );
        return json(result);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
      }
    }
    const key = await repo.reserveAsset(user.userId, projectId, result);
    try {
      const object = await bucket.put(key, request.body, {
        httpMetadata: { contentType: asset.mime },
      });
      if (object.size !== asset.byteLength)
        throw new ApiError(
          400,
          "The uploaded audio length does not match its metadata.",
        );
      await repo.completeAsset(user.userId, result.id);
    } catch (error) {
      await bucket.delete(key);
      await repo.discardAsset(user.userId, result.id);
      throw error;
    }
    return json(result, 201);
  });
}
