import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { getContentShard } from "@/lib/content/router";
import { getMediaStorage } from "@/lib/media/router";
import { parseStorageKey } from "@/lib/media/validation";
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
 * GET /api/conversations/[id]/media/[...key]
 *
 * Secure server-side media delivery endpoint.
 *
 * Requirements verified:
 *   1. Authenticated user
 *   2. User is an authorized member of this conversation
 *   3. Requested media key belongs to a message in this conversation
 *   4. Media has not expired (for B2 media)
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string; key: string[] } }
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

  const keySegments = params.key;
  if (!keySegments || !Array.isArray(keySegments) || keySegments.length === 0) {
    return NextResponse.json(
      { error: "Invalid media key." },
      { status: 400 }
    );
  }

  const mediaKey = keySegments.join("/");

  // Prevent path traversal
  if (mediaKey.includes("..") || mediaKey.includes("\\")) {
    return NextResponse.json(
      { error: "Invalid media key." },
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

  const cleanKey = mediaKey.replace(/^\/+/, "");

  // Verify that this media key belongs to an actual message in this conversation
  let message;
  try {
    message = await shard.messages.getByMediaKey(
      conversationId,
      cleanKey
    );

    if (!message) {
      // Also try with leading slash if stored differently
      message = await shard.messages.getByMediaKey(
        conversationId,
        `/${cleanKey}`
      );
    }

    if (!message) {
      return NextResponse.json(
        { error: "Media not found in this conversation." },
        { status: 404 }
      );
    }
  } catch (err) {
    console.error("Failed to verify media message ownership:", err);
    return NextResponse.json(
      { error: "Could not verify media access." },
      { status: 500 }
    );
  }

  // ==========================================
  // BACKBLAZE B2 MEDIA (IMAGE, VIDEO, DOCUMENT)
  // ==========================================
  const parsed = parseStorageKey(cleanKey);
  const isB2Media =
    Boolean(parsed) ||
    cleanKey.startsWith("media/images/") ||
    cleanKey.startsWith("media/videos/") ||
    cleanKey.startsWith("media/documents/") ||
    message.mediaProvider === "backblaze";

  if (isB2Media) {
    // Expiration check
    if (
      message.mediaExpiresAt &&
      message.mediaExpiresAt <= Date.now()
    ) {
      return NextResponse.json(
        { error: "Media has expired." },
        { status: 410 }
      );
    }

    const category: MediaCategory =
      parsed?.category ||
      (message.mediaCategory as MediaCategory) ||
      (message.type === "video"
        ? "video"
        : message.type === "document"
        ? "document"
        : "image");

    try {
      const storage = getMediaStorage(category);
      const downloadUrl = await storage.getDownloadUrl(cleanKey, 3600);

      // 307 Temporary Redirect directs browser directly to B2's CDN URL,
      // enabling native byte-range scrubbing without Vercel serverless load.
      return NextResponse.redirect(downloadUrl, {
        status: 307,
        headers: {
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch (b2Err) {
      console.error("Failed to generate B2 download URL:", b2Err);
      return NextResponse.json(
        { error: "Could not retrieve media file." },
        { status: 500 }
      );
    }
  }

  // ==========================================
  // IMAGEKIT MEDIA (VOICE MESSAGES & AVATARS)
  // ==========================================
  const isVoiceMedia = /^users\/[^/]+\/voicemessages\//.test(cleanKey);

  const imagekitEndpoint = isVoiceMedia
    ? process.env.IMAGEKIT_URL_ENDPOINT_VOICE
    : process.env.IMAGEKIT_URL_ENDPOINT;

  if (!imagekitEndpoint) {
    return NextResponse.json(
      { error: "Media storage is not configured." },
      { status: 503 }
    );
  }

  const cleanEndpoint = imagekitEndpoint.replace(/\/+$/, "");
  const upstreamUrl = `${cleanEndpoint}/${cleanKey}`;

  const upstreamHeaders: Record<string, string> = {};
  const rangeHeader = request.headers.get("range");
  if (rangeHeader) {
    upstreamHeaders["Range"] = rangeHeader;
  }

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      headers: upstreamHeaders,
    });

    if (!upstreamRes.ok && upstreamRes.status !== 206) {
      if (upstreamRes.status === 404) {
        return NextResponse.json(
          { error: "Media file not found." },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: "Failed to retrieve media file." },
        { status: upstreamRes.status }
      );
    }

    const responseHeaders = new Headers();

    const contentType = upstreamRes.headers.get("content-type");
    if (contentType) {
      responseHeaders.set("Content-Type", contentType);
    } else {
      responseHeaders.set("Content-Type", "audio/webm");
    }

    const contentLength = upstreamRes.headers.get("content-length");
    if (contentLength) {
      responseHeaders.set("Content-Length", contentLength);
    }

    const contentRange = upstreamRes.headers.get("content-range");
    if (contentRange) {
      responseHeaders.set("Content-Range", contentRange);
    }

    const acceptRanges = upstreamRes.headers.get("accept-ranges");
    if (acceptRanges) {
      responseHeaders.set("Accept-Ranges", acceptRanges);
    } else {
      responseHeaders.set("Accept-Ranges", "bytes");
    }

    responseHeaders.set("Cache-Control", "private, max-age=86400");

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: responseHeaders,
    });
  } catch (fetchError) {
    console.error("Failed to stream audio media:", fetchError);
    return NextResponse.json(
      { error: "Could not fetch media." },
      { status: 502 }
    );
  }
}
