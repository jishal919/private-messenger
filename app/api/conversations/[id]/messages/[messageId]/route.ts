import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { getContentShard } from "@/lib/content/router";
import { getMediaStorage } from "@/lib/media/router";
import type { MediaCategory } from "@/lib/media/types";

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
      SELECT conversation_id, user1_id, user2_id, shard_id
      FROM conversation_directory
      WHERE conversation_id = ?
    `,
    args: [conversationId],
  });
  const row = result.rows[0];
  if (!row) return null;
  const user1Id = String(row.user1_id);
  const user2Id = String(row.user2_id);
  if (userId !== user1Id && userId !== user2Id) return null;
  return {
    conversation_id: String(row.conversation_id),
    user1_id: user1Id,
    user2_id: user2Id,
    shard_id: String(row.shard_id),
  };
}

/**
 * DELETE /api/conversations/[id]/messages/[messageId]
 * Body: { deleteFor: "everyone" | "me" | "undo" }
 */
export async function DELETE(
  request: Request,
  { params }: { params: { id: string; messageId: string } }
) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const conversationId = params.id;
  const messageId = params.messageId;

  if (
    !conversationId ||
    conversationId.length > 100 ||
    !messageId ||
    messageId.length > 100
  ) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
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

  const { deleteFor, action } = (body ?? {}) as {
    deleteFor?: unknown;
    action?: unknown;
  };

  const isUndo = deleteFor === "undo" || action === "undo";

  if (!isUndo && deleteFor !== "everyone" && deleteFor !== "me") {
    return NextResponse.json(
      { error: "deleteFor must be 'everyone' or 'me'." },
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

  if (isUndo) {
    try {
      await shard.messages.unhideForUser(messageId, currentUser.id);
      return NextResponse.json({ ok: true, undone: true });
    } catch {
      return NextResponse.json(
        { error: "Failed to undo message deletion." },
        { status: 500 }
      );
    }
  }

  const message = await shard.messages.get(messageId);
  if (!message || message.conversationId !== conversationId) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }

  if (deleteFor === "everyone") {
    if (message.senderId !== currentUser.id) {
      return NextResponse.json(
        { error: "Only the sender can delete a message for everyone." },
        { status: 403 }
      );
    }

    if (message.mediaKey) {
      try {
        await shard.messages.invalidateMediaKey(message.mediaKey);

        if (message.mediaCategory) {
          const storage = getMediaStorage(
            message.mediaCategory as MediaCategory
          );
          await storage.delete(message.mediaKey);
        }
      } catch (mediaErr) {
        console.error("Failed to invalidate/delete media storage object:", mediaErr);
      }
    }

    try {
      await shard.messages.deleteForEveryone(messageId);
    } catch (delErr) {
      console.error("Failed to delete message for everyone:", delErr);
      return NextResponse.json(
        { error: "Failed to delete message." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, deletedFor: "everyone" });
  }

  // deleteFor === "me"
  try {
    await shard.messages.hideForUser(messageId, currentUser.id, Date.now());
  } catch (hideErr) {
    console.error("Failed to hide message for user:", hideErr);
    return NextResponse.json(
      { error: "Failed to delete message." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, deletedFor: "me" });
}
