import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  getOtherParticipantId,
  loadAuthorizedConversation,
} from "@/lib/conversations";
import {
  cleanupExpiredPresence,
  ensurePresenceSchema,
} from "@/lib/presence";
import { getContentShard } from "@/lib/content/router";
import { getCurrentUser } from "@/lib/session";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json(
      { error: "Not authenticated." },
      { status: 401 }
    );
  }

  if (
    !checkRateLimit(
      `conversation-status:${currentUser.id}`,
      180,
      60_000
    )
  ) {
    return NextResponse.json(
      { error: "Too many status requests." },
      { status: 429 }
    );
  }

  const conversationId = params.id;

  if (!conversationId || conversationId.length > 100) {
    return NextResponse.json(
      { error: "Invalid conversation." },
      { status: 400 }
    );
  }

  const conversation = await loadAuthorizedConversation(
    conversationId,
    currentUser.id
  );

  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found." },
      { status: 404 }
    );
  }

  await ensurePresenceSchema();

  const db = getDb();
  const now = Date.now();
  const otherUserId = getOtherParticipantId(
    conversation,
    currentUser.id
  );

  await cleanupExpiredPresence(now);

  let presenceVisible = true;
  let online = false;
  let lastSeenAt: number | null = null;
  let composerState: "typing" | "recording" | null = null;

  try {
    const settings = await db.execute({
      sql: `
        SELECT show_last_seen_enabled
        FROM user_settings
        WHERE user_id = ?
        LIMIT 1
      `,
      args: [otherUserId],
    });

    presenceVisible =
      Number(settings.rows[0]?.show_last_seen_enabled ?? 1) === 1;

    if (presenceVisible) {
      const presence = await db.execute({
        sql: `
          SELECT
            MAX(CASE WHEN expires_at > ? THEN 1 ELSE 0 END) AS online,
            MAX(last_heartbeat_at) AS session_last_seen
          FROM presence_sessions
          WHERE user_id = ?
        `,
        args: [now, otherUserId],
      });

      const userRow = await db.execute({
        sql: `
          SELECT last_seen_at
          FROM users
          WHERE id = ?
          LIMIT 1
        `,
        args: [otherUserId],
      });

      online =
        Number(presence.rows[0]?.online ?? 0) === 1;

      const sessionLastSeen =
        presence.rows[0]?.session_last_seen == null
          ? null
          : Number(presence.rows[0].session_last_seen);

      const userLastSeen =
        userRow.rows[0]?.last_seen_at == null
          ? null
          : Number(userRow.rows[0].last_seen_at);

      if (sessionLastSeen != null && userLastSeen != null) {
        lastSeenAt = Math.max(sessionLastSeen, userLastSeen);
      } else {
        lastSeenAt = sessionLastSeen ?? userLastSeen ?? null;
      }
    }
  } catch {
    presenceVisible = false;
    online = false;
    lastSeenAt = null;
  }

  try {
    const shardId = conversation.shardId ?? (conversation as any).shard_id;
    const shard = getContentShard(shardId);
    const states = await shard.typing.get(conversationId);
    const otherState = states.find(
      (state) => String(state.userId).trim() === String(otherUserId).trim()
    );

    composerState = otherState?.state ?? null;
  } catch (err) {
    console.error("Status composer check failed:", err);
    composerState = null;
  }

  return NextResponse.json({
    presence: presenceVisible
      ? {
          visible: true,
          online,
          lastSeenAt,
        }
      : {
          visible: false,
          online: false,
          lastSeenAt: null,
        },
    composerState,
    state: composerState,
    typing: composerState === "typing",
    recording: composerState === "recording",
    isTyping: composerState === "typing",
    isRecording: composerState === "recording",
    typingUserId: composerState === "typing" ? otherUserId : null,
    recordingUserId: composerState === "recording" ? otherUserId : null,
  });
}
