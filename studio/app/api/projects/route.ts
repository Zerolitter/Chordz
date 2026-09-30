import { context, handler, json, readJson } from "../../../lib/server/http";
import { projectSchema } from "../../../lib/music/schema";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return handler(async () => {
    const { user, repo } = await context(request);
    return json(await repo.list(user.userId));
  });
}
export function POST(request: Request) {
  return handler(async () => {
    const { user, repo } = await context(request, true);
    const document = projectSchema.parse(await readJson(request));
    return json(await repo.create(user.userId, document), 201);
  });
}
