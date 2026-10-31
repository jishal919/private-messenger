import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getDb } from "@/lib/db";
import { getContentShard } from "@/lib/content/router";

export async function POST() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const db = getDb();

    const result = await db.execute({
      sql: `
        SELECT
          conversation_id,
          user1_id,
          user2_id,
          shard_id
        FROM conversation_directory
        WHERE user1_id = ? OR user2_id = ?
      `,
      args: [user.id, user.id],
    });

    let deliveredCount = 0;

    for (const row of result.rows) {
      const conversationId = String(row.conversation_id);
      const user1Id = Number(row.user1_id);
      const user2Id = Number(row.user2_id);
      const shardId = String(row.shard_id);

      const shard = getContentShard(shardId);

      const latestMessages = await shard.messages.latest(
        conversationId,
        1
      );

      const latestMessage = latestMessages[0];

      if (!latestMessage) {
        continue;
      }

      // Only acknowledge messages sent by the other user.
      if (latestMessage.senderId === user.id) {
        continue;
      }

      await shard.reads.markDelivered(
        conversationId,
        user.id,
        latestMessage.id
      );

      deliveredCount++;
    }

    return NextResponse.json({
      success: true,
      deliveredCount,
    });
  } catch (error) {
    console.error(
      "Background delivery error:",
      error
    );

    return NextResponse.json(
      { error: "Failed to update delivery status" },
      { status: 500 }
    );
  }
}