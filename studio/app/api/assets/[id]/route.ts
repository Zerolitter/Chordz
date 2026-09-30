import {
  context,
  handler,
  json,
  privateHeaders,
} from "../../../../lib/server/http";
import { idSchema } from "../../../../lib/music/schema";
import { ApiError } from "../../../../lib/server/repository";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };
export function GET(request: Request, { params }: RouteContext) {
  return handler(async () => {
    const { user, repo, bucket } = await context(request);
    const asset = await repo.asset(
      user.userId,
      idSchema.parse((await params).id),
    );
    const object = await bucket.get(asset.object_key);
    if (!object) throw new ApiError(404, "This audio file could not be found.");
    return new Response(object.body, {
      headers: {
        ...privateHeaders,
        "Content-Type": asset.mime,
        "Content-Length": String(object.size),
        "Content-Disposition":
          "inline; filename*=UTF-8''" + encodeURIComponent(asset.name),
      },
    });
  });
}
export function DELETE(request: Request, { params }: RouteContext) {
  return handler(async () => {
    const { user, repo, bucket } = await context(request, true);
    const key = await repo.removeAsset(
      user.userId,
      idSchema.parse((await params).id),
    );
    await bucket.delete(key);
    return json({ deleted: true });
  });
}
