import { NextResponse } from "next/server";
import ImageKit from "@imagekit/nodejs";

import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { getContentShard } from "@/lib/content/router";
import type { ContentMessage } from "@/lib/content/types";
import { loadReplyPreviews, type ReplyPreview } from "@/lib/content/replies";
import { sendMessagePush } from "@/lib/push";
import { validateVoiceUpload } from "@/lib/voice";

// Dedicated ImageKit instance for voice message storage (separate from avatar db)
const imagekitVoice = new ImageKit({
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY_VOICE,
});

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
    replyToMessageId: message.replyToMessageId,
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
    createdAt: message.createdAt,
    receiptStatus: receiptStatus ?? "sent",
  };
}

/**
 * POST /api/conversations/[id]/voice
 *
 * Upload and create a voice message in the conversation.
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
      `send-voice:${currentUser.id}`,
      30,
      60_000
    )
  ) {
    return NextResponse.json(
      { error: "You're sending voice messages too quickly." },
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

  if (
    !process.env.IMAGEKIT_PRIVATE_KEY_VOICE ||
    !process.env.IMAGEKIT_URL_ENDPOINT_VOICE
  ) {
    return NextResponse.json(
      { error: "Voice media storage is not configured." },
      { status: 503 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid form data." },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  const durationRaw = formData.get("durationMs");
  const clientIdRaw = formData.get("clientId");
  const replyToMessageIdRaw = formData.get("replyToMessageId");
  if (
    replyToMessageIdRaw !== null &&
    (typeof replyToMessageIdRaw !== "string" ||
      replyToMessageIdRaw.length > 100)
  ) {
    return NextResponse.json(
      { error: "Invalid reply target." },
      { status: 400 }
    );
  }
  const replyToMessageId =
    typeof replyToMessageIdRaw === "string" && replyToMessageIdRaw
      ? replyToMessageIdRaw
      : null;

  if (!file || typeof file === "string") {
    return NextResponse.json(
      { error: "Voice audio file is required." },
      { status: 400 }
    );
  }

  const durationMs = Number(durationRaw);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return NextResponse.json(
      { error: "Invalid duration value." },
      { status: 400 }
    );
  }

  const clientId =
    typeof clientIdRaw === "string" && clientIdRaw.length <= 64
      ? clientIdRaw.trim()
      : null;

  let buffer: Buffer;
  try {
    const arrayBuffer = await (file as Blob).arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } catch {
    return NextResponse.json(
      { error: "Could not read audio file." },
      { status: 400 }
    );
  }

  const validation = validateVoiceUpload({
    buffer,
    mimeType: (file as Blob).type || "audio/webm",
    durationMs,
  });

  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.error || "Invalid voice audio upload." },
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

  if (replyToMessageId) {
    try {
      const target = await shard.messages.get(replyToMessageId);
      if (!target || target.conversationId !== conversationId) {
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

  /*
   * Idempotent retry check.
   */
  if (clientId) {
    try {
      const existingMessages = await shard.messages.latest(
        conversationId,
        50
      );

      const existing = existingMessages.find(
        (message) => message.clientId === clientId
      );

      if (existing) {
        const replyPreviews = await loadReplyPreviews(
          shard,
          conversationId,
          [existing]
        );
        return NextResponse.json(
          {
            message: toApiMessage(existing, "sent", replyPreviews),
          },
          { status: 200 }
        );
      }
    } catch {
      // Continue to upload attempt
    }
  }

  const ext = validation.extension || "webm";
  const uniqueFileName = `voice_${crypto.randomUUID()}.${ext}`;
  const folder = `/users/${currentUser.id}/voicemessages`;

  let uploadResult;
  try {
    uploadResult = await imagekitVoice.files.upload({
      file: buffer.toString("base64"),
      fileName: uniqueFileName,
      folder,
      useUniqueFileName: false,
    });
  } catch (uploadError) {
    console.error("ImageKit voice upload failed:", uploadError);
    return NextResponse.json(
      { error: "Voice message upload failed. Please try again." },
      { status: 502 }
    );
  }

  const mediaKey =
    uploadResult.filePath?.replace(/^\/+/, "") ||
    `users/${currentUser.id}/voicemessages/${uniqueFileName}`;
  const mediaSize = buffer.byteLength;
  const roundedDurationMs = Math.round(durationMs);

  try {
    const message = await shard.messages.create({
      conversationId,
      senderId: currentUser.id,
      type: "voice",
      content: null,
      mediaKey,
      mediaSize,
      durationMs: roundedDurationMs,
      replyToMessageId,
      clientId,
    });

    const recipientId =
      conversation.user1_id === currentUser.id
        ? conversation.user2_id
        : conversation.user1_id;

    await sendMessagePush(
      recipientId,
      conversationId,
      currentUser.username,
      "🎤 Voice message"
    );

    const replyPreviews = await loadReplyPreviews(
      shard,
      conversationId,
      [message]
    );
    return NextResponse.json(
      {
        message: toApiMessage(message, "sent", replyPreviews),
      },
      { status: 201 }
    );
  } catch (createError) {
    console.error(
      "Failed to insert voice message in Content DB:",
      createError
    );

    /*
     * Orphan file cleanup: remove uploaded file from ImageKit.
     */
    if (uploadResult?.fileId) {
      try {
        await imagekitVoice.files.delete(uploadResult.fileId);
      } catch (cleanupError) {
        console.error(
          "Failed to clean up orphan voice media:",
          cleanupError
        );
      }
    }

    return NextResponse.json(
      { error: "Voice message could not be saved." },
      { status: 500 }
    );
  }
}
