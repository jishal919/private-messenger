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

export async function POST(
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

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }

  const { messageId } = (body ?? {}) as {
    messageId?: unknown;
  };

  if (
    typeof messageId !== "string" ||
    !messageId ||
    messageId.length > 100
  ) {
    return NextResponse.json(
      { error: "Invalid message id." },
      { status: 400 }
    );
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
    const message = await shard.messages.get(messageId);

    if (
      !message ||
      message.conversationId !== conversationId
    ) {
      return NextResponse.json(
        { error: "Message not found." },
        { status: 404 }
      );
    }

    /*
     * Only the recipient can mark a message as read.
     *
     * IMPORTANT:
     * We update the read cursor even when the user has
     * disabled read receipts.
     *
     * This clears the recipient's own unread indicator.
     *
     * Whether the sender is allowed to SEE this read state
     * is handled separately by the receipts API.
     */
    if (message.senderId !== currentUser.id) {
      await shard.reads.markRead(
        conversationId,
        currentUser.id,
        messageId
      );
    }

    return NextResponse.json({
      success: true,
    });
  } catch {
    return NextResponse.json(
      { error: "Could not update read status." },
      { status: 500 }
    );
  }
}