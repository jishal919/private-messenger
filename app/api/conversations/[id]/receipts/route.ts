import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { getContentShard } from "@/lib/content/router";

type ConversationDirectoryRow = {
  conversation_id: string;
  user1_id: string;
  user2_id: string;
  shard_id: string;
};

async function loadAuthorizedConversation(
  conversationId: string,
  userId: string
): Promise<ConversationDirectoryRow | null> {
  const db = getDb();

  const result = await db.execute({
    sql: `
      SELECT
        conversation_id,
        user1_id,
        user2_id,
        shard_id
      FROM conversation_directory
      WHERE conversation_id = ?
      LIMIT 1
    `,
    args: [conversationId],
  });

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  const user1Id = String(row.user1_id);
  const user2Id = String(row.user2_id);

  if (userId !== user1Id && userId !== user2Id) {
    return null;
  }

  return {
    conversation_id: String(row.conversation_id),
    user1_id: user1Id,
    user2_id: user2Id,
    shard_id: String(row.shard_id),
  };
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json(
      { error: "Not authenticated." },
      { status: 401 }
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

  /*
   * The recipient is the other participant.
   *
   * Example:
   *
   * Current user = A
   * Recipient    = B
   *
   * We need B's read-receipt setting because B controls
   * whether A is allowed to see B's read status.
   */
  const recipientUserId =
    currentUser.id === conversation.user1_id
      ? conversation.user2_id
      : conversation.user1_id;

  /*
   * Read the recipient's read-receipt preference from
   * the small Core DB.
   *
   * If there is no settings row yet, read receipts are
   * enabled by default.
   */
  const db = getDb();

  let readReceiptsEnabled = true;

  try {
    const settingsResult = await db.execute({
      sql: `
        SELECT read_receipts_enabled
        FROM user_settings
        WHERE user_id = ?
        LIMIT 1
      `,
      args: [recipientUserId],
    });

    if (settingsResult.rows[0]) {
      readReceiptsEnabled =
        Number(
          settingsResult.rows[0].read_receipts_enabled
        ) === 1;
    }
  } catch {
    /*
     * If settings cannot be read, fail closed for the
     * privacy-sensitive read receipt.
     *
     * Delivery status will still work.
     */
    readReceiptsEnabled = false;
  }

  let shard;

  try {
    shard = getContentShard(conversation.shard_id);
  } catch {
    return NextResponse.json(
      { error: "Conversation storage unavailable." },
      { status: 503 }
    );
  }

  try {
    const readState = await shard.reads.get(
      conversationId,
      recipientUserId
    );

    if (!readState) {
      return NextResponse.json({
        delivered: null,
        read: null,
      });
    }

    let delivered: {
      id: string;
      createdAt: number;
    } | null = null;

    let read: {
      id: string;
      createdAt: number;
    } | null = null;

    /*
     * Delivery status is ALWAYS visible.
     *
     * Read receipts setting does not affect delivery.
     */
    if (readState.lastDeliveredMessageId) {
      const message = await shard.messages.get(
        readState.lastDeliveredMessageId
      );

      if (
        message &&
        message.conversationId === conversationId
      ) {
        delivered = {
          id: message.id,
          createdAt: message.createdAt,
        };
      }
    }

    /*
     * Read status is only exposed when the recipient
     * has read receipts enabled.
     */
    if (
      readReceiptsEnabled &&
      readState.lastReadMessageId
    ) {
      const message = await shard.messages.get(
        readState.lastReadMessageId
      );

      if (
        message &&
        message.conversationId === conversationId
      ) {
        read = {
          id: message.id,
          createdAt: message.createdAt,
        };
      }
    }

    return NextResponse.json({
      delivered,
      read,
    });
  } catch {
    return NextResponse.json(
      { error: "Could not load receipt status." },
      { status: 500 }
    );
  }
}