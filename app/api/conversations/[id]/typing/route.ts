import { NextResponse } from "next/server";

import { checkRateLimit } from "@/lib/rate-limit";
import { loadAuthorizedConversation } from "@/lib/conversations";
import { getContentShard } from "@/lib/content/router";
import { getCurrentUser } from "@/lib/session";

const TYPING_TTL_MS = 7_000;
const RECORDING_TTL_MS = 8_000;

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

  if (
    !checkRateLimit(
      `composer-state:${currentUser.id}`,
      180,
      60_000
    )
  ) {
    return NextResponse.json(
      { error: "Too many typing updates." },
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

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }

  let state: "typing" | "recording" | "idle" | null = null;
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (b.state === "typing" || b.state === "recording" || b.state === "idle") {
      state = b.state;
    } else if (b.recording === true) {
      state = "recording";
    } else if (b.typing === true) {
      state = "typing";
    } else if (b.typing === false || b.recording === false) {
      state = "idle";
    }
  }

  if (
    state !== "typing" &&
    state !== "recording" &&
    state !== "idle"
  ) {
    return NextResponse.json(
      { error: "Invalid composer state." },
      { status: 400 }
    );
  }

  try {
    const shardId = conversation.shardId ?? (conversation as any).shard_id;
    const shard = getContentShard(shardId);

    if (state === "idle") {
      await shard.typing.clear(
        conversationId,
        currentUser.id
      );
    } else {
      await shard.typing.set(
        conversationId,
        currentUser.id,
        Date.now() +
          (state === "recording"
            ? RECORDING_TTL_MS
            : TYPING_TTL_MS),
        state
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Composer state update failed:", err);
    return NextResponse.json(
      { error: "Could not update composer state." },
      { status: 500 }
    );
  }
}
