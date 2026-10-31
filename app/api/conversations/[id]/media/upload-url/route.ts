import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { getMediaStorage } from "@/lib/media/router";
import { validateMediaUploadRequest } from "@/lib/media/validation";

async function loadAuthorizedConversation(
  conversationId: string,
  userId: string
): Promise<{ id: string; user1Id: string; user2Id: string } | null> {
  const db = getDb();

  const result = await db.execute({
    sql: `
      SELECT
        conversation_id,
        user1_id,
        user2_id
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
    id: String(row.conversation_id),
    user1Id,
    user2Id,
  };
}

/**
 * POST /api/conversations/[id]/media/upload-url
 *
 * Generates an authenticated, short-lived presigned upload URL directly to the
 * appropriate Backblaze B2 account (image, video, or document).
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
      `upload-url:${currentUser.id}`,
      60,
      60_000
    )
  ) {
    return NextResponse.json(
      { error: "You're requesting uploads too quickly. Please wait." },
      { status: 429 }
    );
  }

  const conversation = await loadAuthorizedConversation(
    conversationId,
    currentUser.id
  );

  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found or unauthorized." },
      { status: 404 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request payload." },
      { status: 400 }
    );
  }

  let validated;
  try {
    validated = validateMediaUploadRequest({
      category: body.category,
      filename: body.filename,
      mimeType: body.mimeType,
      fileSize: body.fileSize,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Validation failed.";
    return NextResponse.json(
      { error: message },
      { status: 400 }
    );
  }

  try {
    const storage = getMediaStorage(validated.category);
    const authorization = await storage.getUploadAuthorization({
      conversationId,
      safeFilename: validated.safeFilename,
      mimeType: validated.mimeType,
      fileSize: validated.fileSize,
    });

    return NextResponse.json({
      authorization,
    });
  } catch (err: unknown) {
    console.error("Failed to generate B2 upload authorization:", err);
    const message =
      err instanceof Error
        ? err.message
        : "Failed to generate upload authorization.";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
