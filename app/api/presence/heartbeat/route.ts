import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";
import {
  cleanupExpiredPresence,
  ensurePresenceSchema,
  isValidPresenceId,
  PRESENCE_TTL_MS,
} from "@/lib/presence";

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json(
      { error: "Not authenticated." },
      { status: 401 }
    );
  }

  if (
    !checkRateLimit(
      `presence-heartbeat:${currentUser.id}`,
      40,
      60_000
    )
  ) {
    return NextResponse.json(
      { error: "Too many presence updates." },
      { status: 429 }
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

  const presenceId =
    body &&
    typeof body === "object" &&
    "presenceId" in body
      ? (body as { presenceId?: unknown }).presenceId
      : null;

  const conversationId =
    body &&
    typeof body === "object" &&
    "conversationId" in body
      ? (body as { conversationId?: unknown }).conversationId
      : null;

  const activeConversationId =
    typeof conversationId === "string" &&
    conversationId.length > 0 &&
    conversationId.length <= 100
      ? conversationId
      : null;

  if (!isValidPresenceId(presenceId)) {
    return NextResponse.json(
      { error: "Invalid presence session." },
      { status: 400 }
    );
  }

  await ensurePresenceSchema();

  const now = Date.now();
  const expiresAt = now + PRESENCE_TTL_MS;
  const presenceSessionId = `${currentUser.id}:${presenceId}`;
  const db = getDb();

  await cleanupExpiredPresence(now);

  await db.execute({
    sql: `
      INSERT INTO presence_sessions (
        id,
        user_id,
        last_heartbeat_at,
        expires_at,
        created_at,
        active_conversation_id
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id)
      DO UPDATE SET
        user_id = excluded.user_id,
        last_heartbeat_at = excluded.last_heartbeat_at,
        expires_at = excluded.expires_at,
        active_conversation_id = excluded.active_conversation_id
    `,
    args: [
      presenceSessionId,
      currentUser.id,
      now,
      expiresAt,
      now,
      activeConversationId,
    ],
  });

  try {
    await db.execute({
      sql: `
        UPDATE users
        SET last_seen_at = ?
        WHERE id = ?
      `,
      args: [now, currentUser.id],
    });
  } catch {
    // Non-fatal
  }

  return NextResponse.json({ ok: true });
}
