import { getDb } from "@/lib/db";
import type { ContentMessage, ContentShard } from "@/lib/content/types";

export type ReplyPreview = {
  id: string;
  senderId: string;
  senderUsername: string;
  type: ContentMessage["type"];
  preview: string;
  available: boolean;
};

export async function loadReplyPreviews(
  shard: ContentShard,
  conversationId: string,
  messages: ContentMessage[]
): Promise<Map<string, ReplyPreview>> {
  const replyIds = Array.from(
    new Set(
      messages
        .map((message) => message.replyToMessageId)
        .filter((id): id is string => Boolean(id))
    )
  );
  if (replyIds.length === 0) return new Map();

  const originals = await shard.messages.getMany(conversationId, replyIds);
  const senderIds = Array.from(new Set(originals.map((message) => message.senderId)));
  const usernames = new Map<string, string>();

  if (senderIds.length > 0) {
    const placeholders = senderIds.map(() => "?").join(", ");
    const users = await getDb().execute({
      sql: `SELECT id, username FROM users WHERE id IN (${placeholders})`,
      args: senderIds,
    });
    for (const user of users.rows) {
      usernames.set(String(user.id), String(user.username));
    }
  }

  const byId = new Map<string, ReplyPreview>();
  for (const replyId of replyIds) {
    const original = originals.find((message) => message.id === replyId);
    if (!original || original.deletedForEveryone) {
      byId.set(replyId, {
        id: replyId,
        senderId: "",
        senderUsername: "Message unavailable",
        type: "text",
        preview: "This message was deleted",
        available: false,
      });
      continue;
    }

    const preview =
      original.type === "image"
        ? "Photo"
        : original.type === "video"
        ? "Video"
        : original.type === "voice"
        ? "Voice message"
        : original.type === "document" || original.type === "file"
        ? original.mediaName || "Document"
        : original.content?.trim() || "Message unavailable";

    byId.set(replyId, {
      id: original.id,
      senderId: original.senderId,
      senderUsername: usernames.get(original.senderId) || "Unknown",
      type: original.type,
      preview,
      available: true,
    });
  }

  return byId;
}
