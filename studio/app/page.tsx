import Studio from "../components/studio/studio";
import { createDemo } from "../lib/music/project";
import { getChatGPTUser } from "./chatgpt-auth";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await getChatGPTUser();
  return (
    <Studio
      initialProject={createDemo()}
      user={
        user ? { userId: user.userId, displayName: user.displayName } : null
      }
    />
  );
}
