import { context, handler, json } from "../../../../../lib/server/http";
import { idSchema } from "../../../../../lib/music/schema";
import { hasStudioExtensions, supportsStudioExtensions } from "../../../../../lib/music/performance";
import { ApiError } from "../../../../../lib/server/repository";
export const dynamic = "force-dynamic";
export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handler(async () => {
    const { user, repo } = await context(request);
    const versions = await repo.versions(user.userId, idSchema.parse((await params).id));
    if (versions.some(version => hasStudioExtensions(version.document)) && !supportsStudioExtensions(request.headers))
      throw new ApiError(409, "These versions use newer Studio controls. Reload Chordz before opening them; your cloud versions are preserved.");
    return json(versions);
  });
}
