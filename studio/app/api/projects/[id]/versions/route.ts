import { context, handler, json } from "../../../../../lib/server/http";
import { idSchema } from "../../../../../lib/music/schema";
export const dynamic = "force-dynamic";
export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handler(async () => {
    const { user, repo } = await context(request);
    return json(
      await repo.versions(user.userId, idSchema.parse((await params).id)),
    );
  });
}
