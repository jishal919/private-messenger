import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { getAvatarUrl } from "@/lib/profile-avatar";
import { normalizeUsername } from "@/lib/validation";

const MAX_RESULTS = 20;

export async function GET(request: Request) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json(
      { error: "Not authenticated." },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const rawQuery = url.searchParams.get("q") ?? "";

  const query = normalizeUsername(rawQuery).trim();

  if (!query || query.length > 50) {
    return NextResponse.json({
      users: [],
    });
  }

  const db = getDb();

  try {
    const result = await db.execute({
      sql: `
        SELECT
          id,
          username,
          avatar_key,
          is_verified
        FROM users
        WHERE username LIKE ? COLLATE NOCASE
          AND id != ?
        ORDER BY username COLLATE NOCASE ASC
        LIMIT ?
      `,
      args: [
        `${query}%`,
        currentUser.id,
        MAX_RESULTS,
      ],
    });

    const users = result.rows.map((row) => ({
      id: String(row.id),
      username: String(row.username),
      isVerified: Number(row.is_verified) === 1,
      avatarUrl: getAvatarUrl(
        row.avatar_key == null
          ? null
          : String(row.avatar_key)
      ),
    }));

    return NextResponse.json({ users });
  } catch (error) {
    console.error("User search failed:", error);

    return NextResponse.json(
      { error: "Could not search users." },
      { status: 500 }
    );
  }
}
