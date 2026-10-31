import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/session";
import { getDb } from "@/lib/db";
import {
  normalizeUsername,
  validateUsername,
} from "@/lib/validation";

export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Not authenticated." },
        { status: 401 }
      );
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 }
      );
    }

    const rawUsername = (body as { username?: unknown } | null)
      ?.username;

    const usernameError = validateUsername(rawUsername);

    if (usernameError) {
      return NextResponse.json(
        { error: usernameError },
        { status: 400 }
      );
    }

    const username = normalizeUsername(rawUsername as string);

    if (username === user.username) {
      return NextResponse.json({
        user: {
          id: user.id,
          username: user.username,
          isVerified: user.isVerified,
        },
      });
    }

    const db = getDb();

    const existing = await db.execute({
      sql: `
        SELECT id
        FROM users
        WHERE username = ? COLLATE NOCASE
          AND id != ?
        LIMIT 1
      `,
      args: [username, user.id],
    });

    if (existing.rows.length > 0) {
      return NextResponse.json(
        { error: "That username is already taken." },
        { status: 409 }
      );
    }

    await db.execute({
      sql: `
        UPDATE users
        SET username = ?
        WHERE id = ?
      `,
      args: [username, user.id],
    });

    return NextResponse.json({
      user: {
        id: user.id,
        username,
        isVerified: user.isVerified,
      },
    });
  } catch (error) {
    console.error("Username update error:", error);

    return NextResponse.json(
      { error: "Could not update username." },
      { status: 500 }
    );
  }
}
