import { z } from "zod";
import { context, handler, json, readJson } from "../../../../lib/server/http";
import { idSchema, projectSchema } from "../../../../lib/music/schema";
import { hasStudioExtensions, supportsStudioExtensions } from "../../../../lib/music/performance";
import { ApiError } from "../../../../lib/server/repository";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };
export function GET(request: Request, { params }: RouteContext) {
  return handler(async () => {
    const { user, repo } = await context(request);
    const id = idSchema.parse((await params).id);
    const project = await repo.get(user.userId, id);
    if (hasStudioExtensions(project.document) && !supportsStudioExtensions(request.headers))
      throw new ApiError(409, "This song uses newer Studio controls. Reload Chordz before opening it; your cloud version is preserved.");
    return json(project);
  });
}
export function PUT(request: Request, { params }: RouteContext) {
  return handler(async () => {
    const { user, repo } = await context(request, true);
    const id = idSchema.parse((await params).id);
    const input = z
      .object({
        document: projectSchema,
        expectedRevision: z.number().int().min(1),
      })
      .strict()
      .parse(await readJson(request));
    return json(
      await repo.save(user.userId, id, input.document, input.expectedRevision, supportsStudioExtensions(request.headers)),
    );
  });
}
export function DELETE(request: Request, { params }: RouteContext) {
  return handler(async () => {
    const { user, repo, bucket } = await context(request, true);
    const id = idSchema.parse((await params).id);
    const keys = await repo.remove(user.userId, id);
    if (keys.length) await bucket.delete(keys);
    return json({ deleted: true });
  });
}
