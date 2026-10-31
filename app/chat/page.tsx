import { redirect } from "next/navigation";

import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { getAvatarUrl } from "@/lib/profile-avatar";

import ChatApp from "@/components/ChatApp";

export default async function ChatPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const db = getDb();

  const result = await db.execute({
    sql: `
      SELECT avatar_key, is_verified
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    args: [user.id],
  });

  const avatarKey = result.rows[0]?.avatar_key;

  const currentUser = {
    id: user.id,
    username: user.username,
    isVerified: Number(result.rows[0]?.is_verified) === 1,
    avatarUrl: getAvatarUrl(
      avatarKey == null ? null : String(avatarKey)
    ),
  };

  return <ChatApp currentUser={currentUser} />;
}
