import { getDb } from "@/lib/db";

export type ConversationDirectoryRow = {
  conversationId: string;
  user1Id: string;
  user2Id: string;
  shardId: string;
};

export async function loadAuthorizedConversation(
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

  const user1Id = String(row.user1_id).trim();
  const user2Id = String(row.user2_id).trim();
  const currentUserId = String(userId).trim();

  if (currentUserId !== user1Id && currentUserId !== user2Id) {
    return null;
  }

  return {
    conversationId: String(row.conversation_id),
    user1Id,
    user2Id,
    shardId: String(row.shard_id),
  };
}

export function getOtherParticipantId(
  conversation: any,
  userId: string
): string {
  const u1 = String(conversation.user1Id ?? conversation.user1_id ?? "").trim();
  const u2 = String(conversation.user2Id ?? conversation.user2_id ?? "").trim();
  const current = String(userId).trim();
  return current === u1 ? u2 : u1;
}
