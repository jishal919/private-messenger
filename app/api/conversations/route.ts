import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { validateUsername, normalizeUsername } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAvatarUrl } from "@/lib/profile-avatar";
import {
  getAvailableContentShards,
  getContentShard,
} from "@/lib/content/router";

const PREVIEW_LENGTH = 80;

function previewOf(content: string | null): string | null {
  if (!content) return null;

  return content.length > PREVIEW_LENGTH
    ? content.slice(0, PREVIEW_LENGTH) + "…"
    : content;
}

/**
 * GET /api/conversations
 *
 * Core DB stores the conversation directory and user registry.
 * Content DB stores the actual messages/read state.
 */
export async function GET() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json(
      { error: "Not authenticated." },
      { status: 401 }
    );
  }

  const db = getDb();

  const result = await db.execute({
    sql: `
      SELECT
        d.conversation_id,
        d.user1_id,
        d.user2_id,
        d.shard_id,
        d.created_at,
        CASE
          WHEN d.user1_id = ? THEN u2.id
          ELSE u1.id
        END AS other_id,
        CASE
          WHEN d.user1_id = ? THEN u2.username
          ELSE u1.username
        END AS other_username,
        CASE
          WHEN d.user1_id = ? THEN u2.avatar_key
          ELSE u1.avatar_key
        END AS other_avatar_key,
        CASE
          WHEN d.user1_id = ? THEN u2.is_verified
          ELSE u1.is_verified
        END AS other_is_verified
      FROM conversation_directory d
      JOIN users u1 ON u1.id = d.user1_id
      JOIN users u2 ON u2.id = d.user2_id
      WHERE d.user1_id = ? OR d.user2_id = ?
      ORDER BY d.created_at DESC
    `,
    args: [
      currentUser.id,
      currentUser.id,
      currentUser.id,
      currentUser.id,
      currentUser.id,
      currentUser.id,
    ],
  });

  const conversations = await Promise.all(
    result.rows.map(async (row) => {
      const conversationId = String(row.conversation_id);
      const shardId = String(row.shard_id);

      try {
        const shard = getContentShard(shardId);

        const [conversation, messages, readState] = await Promise.all([
          shard.conversations.get(conversationId),
          shard.messages.latest(conversationId, 1),
          shard.reads.get(conversationId, currentUser.id),
        ]);

        const lastMessage = messages[0] ?? null;

        const lastReadId = readState?.lastReadMessageId ?? null;

        let unread = false;

        if (lastMessage && lastMessage.senderId !== currentUser.id) {
          unread = lastReadId !== lastMessage.id;
        }

        return {
          id: conversationId,

          otherUser: {
            id: String(row.other_id),
            username: String(row.other_username),
            isVerified: Number(row.other_is_verified) === 1,
            avatarUrl: getAvatarUrl(
              row.other_avatar_key == null
                ? null
                : String(row.other_avatar_key)
            ),
          },
          lastMessage: lastMessage
            ? lastMessage.type === "voice"
              ? "🎤 Voice message"
              : lastMessage.type === "image"
              ? "📷 Photo"
              : lastMessage.type === "video"
              ? "🎥 Video"
              : lastMessage.type === "document"
              ? "📄 Document"
              : previewOf(lastMessage.content)
            : null,

          lastMessageAt: lastMessage
            ? lastMessage.createdAt
            : conversation?.lastMessageAt ?? null,

          lastMessageFromMe: lastMessage
            ? lastMessage.senderId === currentUser.id
            : false,

          unread,
        };
      } catch {
        // A failed shard should not break the entire conversation list.
        return {
          id: conversationId,

          otherUser: {
            id: String(row.other_id),
            username: String(row.other_username),
            isVerified: Number(row.other_is_verified) === 1,
            avatarUrl: getAvatarUrl(
              row.other_avatar_key == null
                ? null
                : String(row.other_avatar_key)
            ),
          },

          lastMessage: null,
          lastMessageAt: null,
          lastMessageFromMe: false,
          unread: false,
        };
      }
    })
  );

  conversations.sort(
    (a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)
  );

  return NextResponse.json({ conversations });
}

/**
 * POST /api/conversations
 *
 * Open an existing 1:1 conversation or create a new one.
 *
 * Core DB:
 *   - users
 *   - conversation_directory
 *
 * Content DB:
 *   - conversations
 */
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
      `open-conversation:${currentUser.id}`,
      30,
      60_000
    )
  ) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
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

  const { username: rawUsername } = (body ?? {}) as {
    username?: unknown;
  };

  const usernameError = validateUsername(rawUsername);

  if (usernameError) {
    return NextResponse.json(
      { error: usernameError },
      { status: 400 }
    );
  }

  const username = normalizeUsername(rawUsername as string);

  const db = getDb();

  const targetResult = await db.execute({
    sql: `
      SELECT id, username, avatar_key, is_verified
      FROM users
      WHERE username = ? COLLATE NOCASE
    `,
    args: [username],
  });

  const target = targetResult.rows[0];

  if (!target) {
    return NextResponse.json(
      { error: "User not found." },
      { status: 404 }
    );
  }

  const otherId = String(target.id);

  if (otherId === currentUser.id) {
    return NextResponse.json(
      {
        error: "You can't start a conversation with yourself.",
      },
      { status: 400 }
    );
  }

  const [user1Id, user2Id] = [currentUser.id, otherId].sort();

  /*
   * First check the Core directory.
   *
   * This is now the authoritative mapping:
   *
   * user pair → conversation UUID → content shard
   */
  const existing = await db.execute({
    sql: `
      SELECT conversation_id, shard_id
      FROM conversation_directory
      WHERE user1_id = ? AND user2_id = ?
    `,
    args: [user1Id, user2Id],
  });

  if (existing.rows[0]) {
    return NextResponse.json({
      conversation: {
        id: String(existing.rows[0].conversation_id),
        otherUser: {
        id: otherId,
        username: String(target.username),
        isVerified: Number(target.is_verified) === 1,
        avatarUrl: getAvatarUrl(
          target.avatar_key == null
            ? null
            : String(target.avatar_key)
        ),
      },
      },
    });
  }

  /*
   * Select a content shard.
   *
   * For now the registry contains content-001.
   * Later this can use shard priority/load/health.
   */
  const shards = getAvailableContentShards();

  if (shards.length === 0) {
    return NextResponse.json(
      { error: "No content storage is available." },
      { status: 503 }
    );
  }

  const shard = shards[0];

  /*
   * Globally unique conversation ID.
   */
  const conversationId = crypto.randomUUID();
  const now = Date.now();

  /*
   * Insert the directory entry into Core first.
   */
  try {
    await db.execute({
      sql: `
        INSERT INTO conversation_directory (
          conversation_id,
          user1_id,
          user2_id,
          shard_id,
          created_at
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      args: [
        conversationId,
        user1Id,
        user2Id,
        shard.id,
        now,
      ],
    });
  } catch {
    /*
     * Another request may have created the conversation
     * concurrently. Fetch the winning row.
     */
    const retry = await db.execute({
      sql: `
        SELECT conversation_id
        FROM conversation_directory
        WHERE user1_id = ? AND user2_id = ?
      `,
      args: [user1Id, user2Id],
    });

    if (retry.rows[0]) {
      return NextResponse.json({
        conversation: {
          id: String(retry.rows[0].conversation_id),
        otherUser: {
          id: otherId,
          username: String(target.username),
          isVerified: Number(target.is_verified) === 1,
          avatarUrl: getAvatarUrl(
            target.avatar_key == null
              ? null
              : String(target.avatar_key)
          ),
        },
        },
      });
    }

    return NextResponse.json(
      { error: "Could not open conversation." },
      { status: 500 }
    );
  }

  /*
   * Create the matching conversation inside the content shard.
   */
  try {
    await shard.conversations.create({
      id: conversationId,
      user1Id,
      user2Id,
      createdAt: now,
      lastMessageAt: null,
    });
  } catch {
    /*
     * Core entry was created but content creation failed.
     * Remove the directory entry so we don't leave a broken mapping.
     */
    try {
      await db.execute({
        sql: `
          DELETE FROM conversation_directory
          WHERE conversation_id = ?
        `,
        args: [conversationId],
      });
    } catch {
      // Best effort cleanup.
    }

    return NextResponse.json(
      { error: "Could not create conversation storage." },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      conversation: {
        id: conversationId,
        otherUser: {
        id: otherId,
        username: String(target.username),
        isVerified: Number(target.is_verified) === 1,
        avatarUrl: getAvatarUrl(
          target.avatar_key == null
            ? null
            : String(target.avatar_key)
        ),
      },
      },
    },
    { status: 201 }
  );
}
