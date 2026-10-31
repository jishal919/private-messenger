import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { getAvatarUrl } from "@/lib/profile-avatar";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { error: "Not authenticated." },
      { status: 401 }
    );
  }

  const db = getDb();

  const result = await db.execute({
    sql: `
      SELECT avatar_key
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    args: [user.id],
  });

  const avatarKey = result.rows[0]?.avatar_key;

  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      isVerified: user.isVerified,
      avatarUrl: getAvatarUrl(
        avatarKey == null ? null : String(avatarKey)
      ),
    },
  });
}
