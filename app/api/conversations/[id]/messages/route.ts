import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { validateMessageContent } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { getContentShard } from "@/lib/content/router";
import type { ContentMessage, ContentShard } from "@/lib/content/types";
import { sendMessagePush } from "@/lib/push";
import { MEDIA_RETENTION_DAYS } from "@/lib/media/config";
import { getMediaStorage } from "@/lib/media/router";
import type { MediaCategory } from "@/lib/media/types";
import { loadReplyPreviews, type ReplyPreview } from "@/lib/content/replies";

const PAGE_SIZE = 50;

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

function toApiMessage(
  message: ContentMessage,
  receiptStatus?: "sent" | "delivered" | "read",
  replyPreviews?: Map<string, ReplyPreview>
) {
  return {
    id: message.id,
    senderId: message.senderId,
    type: message.type,
    content: message.content,
    mediaKey: message.mediaKey,
    mediaSize: message.mediaSize,
    durationMs: message.durationMs,
    mediaProvider: message.mediaProvider ?? null,
    mediaCategory: message.mediaCategory ?? null,
    mediaMimeType: message.mediaMimeType ?? null,
    mediaOriginalSize: message.mediaOriginalSize ?? null,
    mediaName: message.mediaName ?? null,
    mediaExpiresAt: message.mediaExpiresAt ?? null,
    mediaWidth: message.mediaWidth ?? null,
    mediaHeight: message.mediaHeight ?? null,
    mediaObjectId: message.mediaObjectId ?? null,
    replyToMessageId: message.replyToMessageId ?? null,
    ...(message.replyToMessageId
      ? {
          replyTo: replyPreviews?.get(message.replyToMessageId) ?? {
            id: message.replyToMessageId,
            senderId: "",
            senderUsername: "Message unavailable",
            type: "text" as const,
            preview: "Message unavailable",
            available: false,
          },
        }
      : {}),
    clientId: message.clientId ?? null,
    isForwarded: Boolean(message.isForwarded),
    deletedForEveryone: Boolean(message.deletedForEveryone),
    createdAt: message.createdAt,
    receiptStatus: receiptStatus ?? "sent",
  };
}

async function filterHiddenMessages(
  shard: ContentShard,
  conversationId: string,
  userId: string,
  messages: ContentMessage[]
): Promise<ContentMessage[]> {
  if (messages.length === 0) return messages;
  try {
    const hiddenIds = await shard.messages.getHiddenMessageIds(
      conversationId,
      userId
    );
    if (hiddenIds.length === 0) return messages;
    const hiddenSet = new Set(hiddenIds);
    return messages.filter((m) => !hiddenSet.has(m.id));
  } catch {
    return messages;
  }
}

async function toApiMessages(
  shard: ContentShard,
  conversationId: string,
  messages: ContentMessage[],
  receiptStatuses: Map<string, "sent" | "delivered" | "read"> = new Map()
) {
  const replyPreviews = await loadReplyPreviews(
    shard,
    conversationId,
    messages
  );
  return messages.map((message) =>
    toApiMessage(message, receiptStatuses.get(message.id), replyPreviews)
  );
}

/**
 * GET /api/conversations/[id]/messages
 *
 * No cursor:
 *   Load latest PAGE_SIZE messages.
 *
 * ?before=<id>:
 *   Load older messages.
 *
 * ?after=<id>:
 *   Load messages newer than the cursor.
 */
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

  let shard;

  try {
    shard = getContentShard(conversation.shard_id);
  } catch {
    return NextResponse.json(
      { error: "Conversation storage unavailable." },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(request.url);

  const beforeParam = searchParams.get("before");
  const afterParam = searchParams.get("after");
  const aroundParam = searchParams.get("around");

  if (aroundParam !== null) {
    if (!aroundParam || aroundParam.length > 100) {
      return NextResponse.json(
        { error: "Invalid message id." },
        { status: 400 }
      );
    }

    try {
      const target = await shard.messages.get(aroundParam);
      if (!target || target.conversationId !== conversationId) {
        return NextResponse.json(
          { error: "Message unavailable." },
          { status: 404 }
        );
      }

      const [older, newer, latest] = await Promise.all([
        shard.messages.before(conversationId, target.id, 26),
        shard.messages.after(conversationId, target.id, 26),
        shard.messages.latest(conversationId, 1),
      ]);
      const hasMoreBefore = older.length > 25;
      const hasMoreAfter = newer.length > 25;
      let messages = [
        ...older.slice(-25),
        target,
        ...newer.slice(0, 25),
      ];
      messages = await filterHiddenMessages(
        shard,
        conversationId,
        currentUser.id,
        messages
      );

      if (target.senderId !== currentUser.id) {
        await shard.reads.markDelivered(
          conversationId,
          currentUser.id,
          target.id
        );
      }

      const otherUserId =
        currentUser.id === conversation.user1_id
          ? conversation.user2_id
          : conversation.user1_id;
      const receiptStatuses = new Map<
        string,
        "sent" | "delivered" | "read"
      >();
      await Promise.all(
        messages
          .filter((message) => message.senderId === currentUser.id)
          .map(async (message) => {
            receiptStatuses.set(
              message.id,
              await shard.getMessageReceiptStatus(
                conversationId,
                message.id,
                otherUserId
              )
            );
          })
      );

      const deletedMessageIds =
        await shard.messages.getDeletedForEveryoneIds(conversationId);

      return NextResponse.json({
        messages: await toApiMessages(
          shard,
          conversationId,
          messages,
          receiptStatuses
        ),
        hasMoreBefore,
        hasMoreAfter,
        latestMessageId: latest[0]?.id ?? null,
        deletedMessageIds,
      });
    } catch {
      return NextResponse.json(
        { error: "Could not load the replied-to message." },
        { status: 500 }
      );
    }
  }

  /*
   * Incremental polling.
   */
  if (afterParam !== null) {
    if (!afterParam || afterParam.length > 100) {
      return NextResponse.json(
        { error: "Invalid cursor." },
        { status: 400 }
      );
    }

    try {
      const fetchedMessages = await shard.messages.after(
        conversationId,
        afterParam,
        PAGE_SIZE + 1
      );
      const hasMore = fetchedMessages.length > PAGE_SIZE;
      const messages = await filterHiddenMessages(
        shard,
        conversationId,
        currentUser.id,
        fetchedMessages.slice(0, PAGE_SIZE)
      );

      if (messages.length > 0) {
        await shard.reads.markDelivered(
          conversationId,
          currentUser.id,
          messages[messages.length - 1].id
        );
      }

      const otherUserId =
        currentUser.id === conversation.user1_id
          ? conversation.user2_id
          : conversation.user1_id;

      const replyPreviews = await loadReplyPreviews(
        shard,
        conversationId,
        messages
      );

      const apiMessages = await Promise.all(
        messages.map(async (message) => {
          if (message.senderId !== currentUser.id) {
            return toApiMessage(message, undefined, replyPreviews);
          }

          const receiptStatus =
            await shard.getMessageReceiptStatus(
              conversationId,
              message.id,
              otherUserId
            );

          return toApiMessage(
            message,
            receiptStatus,
            replyPreviews
          );
        })
      );

      const deletedMessageIds =
        await shard.messages.getDeletedForEveryoneIds(conversationId);

      return NextResponse.json({
        messages: apiMessages,
        hasMore,
        deletedMessageIds,
      });
    } catch {
      return NextResponse.json(
        { error: "Could not load new messages." },
        { status: 500 }
      );
    }
  }

  /*
   * Older messages.
   */
  if (beforeParam !== null) {
    if (!beforeParam || beforeParam.length > 100) {
      return NextResponse.json(
        { error: "Invalid cursor." },
        { status: 400 }
      );
    }

    try {
      const messages = await shard.messages.before(
        conversationId,
        beforeParam,
        PAGE_SIZE + 1
      );

      const hasMore = messages.length > PAGE_SIZE;

      const page = await filterHiddenMessages(
        shard,
        conversationId,
        currentUser.id,
        messages.slice(0, PAGE_SIZE).reverse()
      );

      const otherUserId =
        currentUser.id === conversation.user1_id
          ? conversation.user2_id
          : conversation.user1_id;

      const replyPreviews = await loadReplyPreviews(
        shard,
        conversationId,
        page
      );

      const apiMessages = await Promise.all(
        page.map(async (message) => {
          if (message.senderId !== currentUser.id) {
            return toApiMessage(message, undefined, replyPreviews);
          }

          const receiptStatus =
            await shard.getMessageReceiptStatus(
              conversationId,
              message.id,
              otherUserId
            );

          return toApiMessage(
            message,
            receiptStatus,
            replyPreviews
          );
        })
      );

      const deletedMessageIds =
        await shard.messages.getDeletedForEveryoneIds(conversationId);

      return NextResponse.json({
        messages: apiMessages,
        hasMore,
        deletedMessageIds,
      });
    } catch {
      return NextResponse.json(
        { error: "Could not load older messages." },
        { status: 500 }
      );
    }
  }

  /*
   * Initial page load.
   */
  try {
    const messages = await shard.messages.latest(
      conversationId,
      PAGE_SIZE + 1
    );

    const hasMore = messages.length > PAGE_SIZE;

    const page = await filterHiddenMessages(
      shard,
      conversationId,
      currentUser.id,
      messages.slice(0, PAGE_SIZE)
    );

    if (page.length > 0) {
      await shard.reads.markDelivered(
        conversationId,
        currentUser.id,
        page[page.length - 1].id
      );
    }

    const otherUserId =
      currentUser.id === conversation.user1_id
        ? conversation.user2_id
        : conversation.user1_id;

    const replyPreviews = await loadReplyPreviews(
      shard,
      conversationId,
      page
    );

    const apiMessages = await Promise.all(
      page.map(async (message) => {
        if (message.senderId !== currentUser.id) {
          return toApiMessage(message, undefined, replyPreviews);
        }

        const receiptStatus =
          await shard.getMessageReceiptStatus(
            conversationId,
            message.id,
            otherUserId
          );

        return toApiMessage(
          message,
          receiptStatus,
          replyPreviews
        );
      })
    );

    const deletedMessageIds =
      await shard.messages.getDeletedForEveryoneIds(conversationId);

    return NextResponse.json({
      messages: apiMessages,
      hasMore,
      deletedMessageIds,
    });
  } catch {
    return NextResponse.json(
      { error: "Could not load messages." },
      { status: 500 }
    );
  }
}

/**
 * POST /api/conversations/[id]/messages
 *
 * Supports both standard text messages and media messages (image, video, document).
 */
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

  if (
    !checkRateLimit(
      `send-message:${currentUser.id}`,
      60,
      60_000
    )
  ) {
    return NextResponse.json(
      { error: "You're sending messages too quickly." },
      { status: 429 }
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

  const payload = (body ?? {}) as {
    type?: string;
    content?: unknown;
    clientId?: unknown;
    mediaKey?: unknown;
    mediaSize?: unknown;
    mediaOriginalSize?: unknown;
    mediaCategory?: unknown;
    mediaMimeType?: unknown;
    mediaName?: unknown;
    mediaWidth?: unknown;
    mediaHeight?: unknown;
    durationMs?: unknown;
    replyToMessageId?: unknown;
    isForwarded?: unknown;
  };

  if (
    payload.replyToMessageId !== undefined &&
    payload.replyToMessageId !== null &&
    (typeof payload.replyToMessageId !== "string" ||
      payload.replyToMessageId.length > 100)
  ) {
    return NextResponse.json(
      { error: "Invalid reply target." },
      { status: 400 }
    );
  }

  const replyToMessageId =
    typeof payload.replyToMessageId === "string" &&
    payload.replyToMessageId.length > 0
      ? payload.replyToMessageId
      : null;

  const isForwarded = Boolean(payload.isForwarded);
  const messageType = payload.type || "text";

  if (
    payload.clientId !== undefined &&
    payload.clientId !== null &&
    (typeof payload.clientId !== "string" || payload.clientId.length > 64)
  ) {
    return NextResponse.json(
      { error: "Invalid client id." },
      { status: 400 }
    );
  }

  const idempotencyKey =
    typeof payload.clientId === "string" && payload.clientId.length > 0
      ? payload.clientId
      : null;

  let shard;
  try {
    shard = getContentShard(conversation.shard_id);
  } catch {
    return NextResponse.json(
      { error: "Conversation storage unavailable." },
      { status: 503 }
    );
  }

  /*
   * Idempotent retry.
   */
  if (idempotencyKey) {
    try {
      const existingMessages = await shard.messages.latest(
        conversationId,
        PAGE_SIZE
      );

      const existing = existingMessages.find(
        (message) => message.clientId === idempotencyKey
      );

      if (existing) {
        return NextResponse.json(
          {
            message: (await toApiMessages(
              shard,
              conversationId,
              [existing],
              new Map([[existing.id, "sent"]])
            ))[0],
          },
          { status: 200 }
        );
      }
    } catch {
      // Continue to insertion attempt.
    }
  }

  if (replyToMessageId) {
    try {
      const replyTarget = await shard.messages.get(replyToMessageId);
      if (!replyTarget || replyTarget.conversationId !== conversationId) {
        return NextResponse.json(
          { error: "Reply target must be a message in this conversation." },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Could not validate the reply target." },
        { status: 503 }
      );
    }
  }

  const recipientId =
    conversation.user1_id === currentUser.id
      ? conversation.user2_id
      : conversation.user1_id;

  // ==========================================
  // FORWARDED VOICE MESSAGE CREATION
  // ==========================================
  if (messageType === "voice" && isForwarded) {
    const mediaKey =
      typeof payload.mediaKey === "string" ? payload.mediaKey.trim() : "";

    if (!mediaKey || mediaKey.includes("..") || mediaKey.includes("\\")) {
      return NextResponse.json(
        { error: "Valid voice media key is required." },
        { status: 400 }
      );
    }

    const durationMs =
      typeof payload.durationMs === "number" && payload.durationMs > 0
        ? Math.round(payload.durationMs)
        : null;

    const expiresAt =
      Date.now() + MEDIA_RETENTION_DAYS * 86_400_000;

    try {
      const message = await shard.messages.create({
        conversationId,
        senderId: currentUser.id,
        type: "voice",
        content: null,
        mediaKey,
        mediaSize: Number(payload.mediaSize) || null,
        durationMs,
        mediaProvider: "imagekit",
        mediaCategory: null,
        mediaMimeType: "audio/webm",
        mediaExpiresAt: expiresAt,
        replyToMessageId: null,
        clientId: idempotencyKey,
        isForwarded: true,
      });

      await sendMessagePush(
        recipientId,
        conversationId,
        currentUser.username,
        `${currentUser.username} sent a voice message`
      );

      return NextResponse.json(
        {
          message: (await toApiMessages(
            shard,
            conversationId,
            [message],
            new Map([[message.id, "sent"]])
          ))[0],
        },
        { status: 201 }
      );
    } catch (voiceErr) {
      console.error("Failed to forward voice message:", voiceErr);
      return NextResponse.json(
        { error: "Failed to forward voice message." },
        { status: 500 }
      );
    }
  }

  // ==========================================
  // MEDIA MESSAGE CREATION (IMAGE/VIDEO/DOC)
  // ==========================================
  if (
    messageType === "image" ||
    messageType === "video" ||
    messageType === "document"
  ) {
    const mediaKey =
      typeof payload.mediaKey === "string" ? payload.mediaKey.trim() : "";

    if (!mediaKey) {
      return NextResponse.json(
        { error: "Media key is required." },
        { status: 400 }
      );
    }

    // Verify key belongs to this conversation (or is a valid forwarded media key)
    if (!isForwarded) {
      const expectedPrefix = `media/${messageType}s/${conversationId}/`;
      if (!mediaKey.startsWith(expectedPrefix)) {
        return NextResponse.json(
          { error: "Invalid media key for this conversation." },
          { status: 403 }
        );
      }
    } else {
      if (mediaKey.includes("..") || mediaKey.includes("\\")) {
        return NextResponse.json(
          { error: "Invalid forwarded media key." },
          { status: 400 }
        );
      }
    }

    const mediaSize = Number(payload.mediaSize) || 0;
    const mediaOriginalSize =
      Number(payload.mediaOriginalSize) || mediaSize;
    const mediaMimeType =
      typeof payload.mediaMimeType === "string"
        ? payload.mediaMimeType
        : "";
    const mediaName =
      typeof payload.mediaName === "string" ? payload.mediaName : "file";
    const mediaWidth =
      typeof payload.mediaWidth === "number" ? payload.mediaWidth : null;
    const mediaHeight =
      typeof payload.mediaHeight === "number" ? payload.mediaHeight : null;
    const durationMs =
      typeof payload.durationMs === "number"
        ? Math.round(payload.durationMs)
        : null;
    const caption =
      typeof payload.content === "string" && payload.content.trim()
        ? payload.content.trim().slice(0, 1000)
        : null;

    const expiresAt =
      Date.now() + MEDIA_RETENTION_DAYS * 86_400_000;

    try {
      const message = await shard.messages.create({
        conversationId,
        senderId: currentUser.id,
        type: messageType,
        content: caption,
        mediaKey,
        mediaSize,
        durationMs,
        mediaProvider: "backblaze",
        mediaCategory: messageType as MediaCategory,
        mediaMimeType,
        mediaOriginalSize,
        mediaName,
        mediaExpiresAt: expiresAt,
        mediaWidth,
        mediaHeight,
        replyToMessageId,
        clientId: idempotencyKey,
        isForwarded,
      });

      // Push notification
      const pushNotificationBody =
        messageType === "image"
          ? `${currentUser.username} sent a photo`
          : messageType === "video"
          ? `${currentUser.username} sent a video`
          : `${currentUser.username} sent a document`;

      await sendMessagePush(
        recipientId,
        conversationId,
        currentUser.username,
        pushNotificationBody
      );

      return NextResponse.json(
        {
          message: (await toApiMessages(
            shard,
            conversationId,
            [message],
            new Map([[message.id, "sent"]])
          ))[0],
        },
        { status: 201 }
      );
    } catch (createErr) {
      console.error("Failed to create media message in shard:", createErr);

      // Attempt orphan recovery: delete the uploaded B2 object (only if not forwarded)
      if (!isForwarded) {
        try {
          const storage = getMediaStorage(messageType as MediaCategory);
          await storage.delete(mediaKey);
        } catch (cleanupErr) {
          console.warn("Orphan cleanup failed for key:", mediaKey, cleanupErr);
        }
      }

      return NextResponse.json(
        { error: "Failed to create media message." },
        { status: 500 }
      );
    }
  }

  // ==========================================
  // TEXT MESSAGE CREATION
  // ==========================================
  const contentError = validateMessageContent(payload.content);

  if (contentError) {
    return NextResponse.json(
      { error: contentError },
      { status: 400 }
    );
  }

  const trimmedContent = (payload.content as string).trim();

  try {
    const message = await shard.messages.create({
      conversationId,
      senderId: currentUser.id,
      type: "text",
      content: trimmedContent,
      replyToMessageId,
      clientId: idempotencyKey,
      isForwarded,
    });

    await sendMessagePush(
      recipientId,
      conversationId,
      currentUser.username,
      trimmedContent
    );

    return NextResponse.json(
      {
        message: (await toApiMessages(
          shard,
          conversationId,
          [message],
          new Map([[message.id, "sent"]])
        ))[0],
      },
      { status: 201 }
    );
  } catch {
    /*
     * A duplicate clientId may have won a concurrent race.
     * Search recent messages and return it if found.
     */
    if (idempotencyKey) {
      try {
        const recent = await shard.messages.latest(
          conversationId,
          PAGE_SIZE
        );

        const existing = recent.find(
          (message) => message.clientId === idempotencyKey
        );

        if (existing) {
          return NextResponse.json(
            {
              message: (await toApiMessages(
                shard,
                conversationId,
                [existing],
                new Map([[existing.id, "sent"]])
              ))[0],
            },
            { status: 200 }
          );
        }
      } catch {
        // Fall through to 500.
      }
    }

    return NextResponse.json(
      { error: "Message could not be sent." },
      { status: 500 }
    );
  }
}
