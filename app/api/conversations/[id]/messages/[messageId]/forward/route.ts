import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { getContentShard } from "@/lib/content/router";
import { sendMessagePush } from "@/lib/push";
import { MEDIA_RETENTION_DAYS } from "@/lib/media/config";

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

/**
 * POST /api/conversations/[id]/messages/[messageId]/forward
 *
 * Forwards an existing message to one or more target conversations.
 * Reuses existing media keys without downloading or re-uploading attachments.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string; messageId: string } }
) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json(
      { error: "Not authenticated." },
      { status: 401 }
    );
  }

  const sourceConversationId = params.id;
  const messageId = params.messageId;

  if (!sourceConversationId || !messageId) {
    return NextResponse.json(
      { error: "Invalid conversation or message ID." },
      { status: 400 }
    );
  }

  if (
    !checkRateLimit(
      `forward-message:${currentUser.id}`,
      30,
      60_000
    )
  ) {
    return NextResponse.json(
      { error: "You are forwarding messages too quickly. Please wait a moment." },
      { status: 429 }
    );
  }

  // 1. Authorize user membership in source conversation
  const sourceConv = await loadAuthorizedConversation(
    sourceConversationId,
    currentUser.id
  );

  if (!sourceConv) {
    return NextResponse.json(
      { error: "Source conversation not found or access denied." },
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

  const { targetConversationIds } = (body ?? {}) as {
    targetConversationIds?: unknown;
  };

  if (
    !Array.isArray(targetConversationIds) ||
    targetConversationIds.length === 0 ||
    !targetConversationIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 100)
  ) {
    return NextResponse.json(
      { error: "Please select at least one valid recipient conversation." },
      { status: 400 }
    );
  }

  // Deduplicate target conversation IDs
  const uniqueTargetIds = Array.from(new Set(targetConversationIds as string[]));

  // 2. Load the source message from source shard
  let sourceShard;
  try {
    sourceShard = getContentShard(sourceConv.shard_id);
  } catch {
    return NextResponse.json(
      { error: "Source storage unavailable." },
      { status: 503 }
    );
  }

  const sourceMessage = await sourceShard.messages.get(messageId);

  if (!sourceMessage || sourceMessage.conversationId !== sourceConversationId) {
    return NextResponse.json(
      { error: "Message not found." },
      { status: 404 }
    );
  }

  // If the source message has expired media, do not allow forwarding
  if (sourceMessage.mediaExpiresAt && sourceMessage.mediaExpiresAt <= Date.now()) {
    return NextResponse.json(
      { error: "Cannot forward expired media." },
      { status: 410 }
    );
  }

  // Calculate new media retention if applicable
  const newMediaExpiresAt =
    sourceMessage.mediaKey && sourceMessage.mediaExpiresAt
      ? Date.now() + MEDIA_RETENTION_DAYS * 86_400_000
      : sourceMessage.mediaExpiresAt ?? null;

  let successCount = 0;
  const errors: string[] = [];

  for (const targetId of uniqueTargetIds) {
    try {
      const targetConv = await loadAuthorizedConversation(
        targetId,
        currentUser.id
      );

      if (!targetConv) {
        errors.push(`Not authorized for conversation ${targetId}`);
        continue;
      }

      const targetShard = getContentShard(targetConv.shard_id);

      // Create new message reusing media references with isForwarded flag
      await targetShard.messages.create({
        conversationId: targetId,
        senderId: currentUser.id,
        type: sourceMessage.type,
        content: sourceMessage.content,
        mediaKey: sourceMessage.mediaKey,
        mediaSize: sourceMessage.mediaSize,
        durationMs: sourceMessage.durationMs,
        mediaProvider: sourceMessage.mediaProvider,
        mediaCategory: sourceMessage.mediaCategory,
        mediaMimeType: sourceMessage.mediaMimeType,
        mediaOriginalSize: sourceMessage.mediaOriginalSize,
        mediaName: sourceMessage.mediaName,
        mediaExpiresAt: newMediaExpiresAt,
        mediaWidth: sourceMessage.mediaWidth,
        mediaHeight: sourceMessage.mediaHeight,
        mediaObjectId: sourceMessage.mediaObjectId,
        replyToMessageId: null, // Forwarded message doesn't carry reply context
        clientId: null,
        isForwarded: true,
      });

      // Send push notification to target recipient
      const recipientId =
        targetConv.user1_id === currentUser.id
          ? targetConv.user2_id
          : targetConv.user1_id;

      const pushBody =
        sourceMessage.type === "voice"
          ? "🎤 Voice message"
          : sourceMessage.type === "image"
          ? "📷 Photo"
          : sourceMessage.type === "video"
          ? "🎥 Video"
          : sourceMessage.type === "document" || sourceMessage.type === "file"
          ? "📄 Document"
          : sourceMessage.content || "Forwarded message";

      await sendMessagePush(
        recipientId,
        targetId,
        currentUser.username,
        pushBody
      );

      successCount++;
    } catch (err) {
      console.error(`Failed to forward message to conversation ${targetId}:`, err);
      errors.push(`Failed for conversation ${targetId}`);
    }
  }

  if (successCount === 0 && errors.length > 0) {
    return NextResponse.json(
      { error: "Failed to forward message to the selected recipient(s)." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    forwarded: successCount,
    errors: errors.length > 0 ? errors : undefined,
  });
}
