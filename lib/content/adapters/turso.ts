import { createClient, type Client, type InStatement } from "@libsql/client";

import type {
  ContentConversation,
  ContentMessage,
  ContentShard,
  CreateMessageInput,
  MessageReceiptStatus,
  ReadState,
  TypingState,
} from "../types";

export interface TursoShardOptions {
  id: string;
  url: string;
  authToken?: string;
}

export class TursoContentShard implements ContentShard {
  readonly id: string;
  readonly provider = "turso" as const;

  private readonly db: Client;
  private typingStateSchemaReady = false;
  private mediaSchemaReady = false;
  private deletionSchemaReady = false;

  constructor(options: TursoShardOptions) {
    this.id = options.id;

    this.db = createClient({
      url: options.url,
      authToken: options.authToken,
    });
  }

  conversations = {
    create: async (
      conversation: ContentConversation
    ): Promise<void> => {
      await this.db.execute({
        sql: `
          INSERT INTO conversations (
            id,
            user1_id,
            user2_id,
            created_at,
            last_message_at
          )
          VALUES (?, ?, ?, ?, ?)
        `,
        args: [
          conversation.id,
          conversation.user1Id,
          conversation.user2Id,
          conversation.createdAt,
          conversation.lastMessageAt,
        ],
      });
    },

    get: async (
      id: string
    ): Promise<ContentConversation | null> => {
      const result = await this.db.execute({
        sql: `
          SELECT
            id,
            user1_id,
            user2_id,
            created_at,
            last_message_at
          FROM conversations
          WHERE id = ?
          LIMIT 1
        `,
        args: [id],
      });

      const row = result.rows[0];

      if (!row) {
        return null;
      }

      return {
        id: String(row.id),
        user1Id: String(row.user1_id),
        user2Id: String(row.user2_id),
        createdAt: Number(row.created_at),
        lastMessageAt:
          row.last_message_at == null
            ? null
            : Number(row.last_message_at),
      };
        },

    deleteForUser: async (userId: string): Promise<void> => {
      /*
       * Delete all data belonging to this user from this
       * content shard.
       *
       * Order matters:
       *   1. messages
       *   2. read states
       *   3. typing states
       *   4. conversations
       */
      await this.db.batch(
        [
          {
            sql: `
              DELETE FROM messages
              WHERE conversation_id IN (
                SELECT id
                FROM conversations
                WHERE user1_id = ? OR user2_id = ?
              )
            `,
            args: [userId, userId],
          },
          {
            sql: `
              DELETE FROM conversation_reads
              WHERE conversation_id IN (
                SELECT id
                FROM conversations
                WHERE user1_id = ? OR user2_id = ?
              )
              OR user_id = ?
            `,
            args: [userId, userId, userId],
          },
          {
            sql: `
              DELETE FROM typing_states
              WHERE conversation_id IN (
                SELECT id
                FROM conversations
                WHERE user1_id = ? OR user2_id = ?
              )
              OR user_id = ?
            `,
            args: [userId, userId, userId],
          },
          {
            sql: `
              DELETE FROM conversations
              WHERE user1_id = ? OR user2_id = ?
            `,
            args: [userId, userId],
          },
        ],
        "write"
      );
    },
  };

  messages = {

    get: async (
        id: string
      ): Promise<ContentMessage | null> => {
        await this.ensureMediaSchema();
        const result = await this.db.execute({
          sql: `
            SELECT *
            FROM messages
            WHERE id = ?
            LIMIT 1
          `,
          args: [id],
        });

        const row = result.rows[0];

        if (!row) {
          return null;
        }

        return mapMessage(row);
      },

    getMany: async (
      conversationId: string,
      ids: string[]
    ): Promise<ContentMessage[]> => {
      if (ids.length === 0) return [];
      await this.ensureMediaSchema();
      const placeholders = ids.map(() => "?").join(", ");
      const result = await this.db.execute({
        sql: `
          SELECT *
          FROM messages
          WHERE conversation_id = ?
            AND id IN (${placeholders})
        `,
        args: [conversationId, ...ids],
      });
      return result.rows.map(mapMessage);
    },

    getByMediaKey: async (
      conversationId: string,
      mediaKey: string
    ): Promise<ContentMessage | null> => {
      await this.ensureMediaSchema();
      const cleanKey = mediaKey.replace(/^\/+/, "");
      const slashKey = `/${cleanKey}`;

      const result = await this.db.execute({
        sql: `
          SELECT *
          FROM messages
          WHERE conversation_id = ?
            AND (media_key = ? OR media_key = ?)
          LIMIT 1
        `,
        args: [conversationId, cleanKey, slashKey],
      });

      const row = result.rows[0];

      if (!row) {
        return null;
      }

      return mapMessage(row);
    },

    create: async (
      input: CreateMessageInput
    ): Promise<ContentMessage> => {
      await this.ensureMediaSchema();
      const id = crypto.randomUUID();
      const createdAt = Date.now();

      await this.db.execute({
        sql: `
          INSERT INTO messages (
            id,
            conversation_id,
            sender_id,
            type,
            content,
            media_key,
            media_size,
            duration_ms,
            media_provider,
            media_category,
            media_mime_type,
            media_original_size,
            media_name,
            media_expires_at,
            media_width,
            media_height,
            media_object_id,
            reply_to_message_id,
            client_id,
            is_forwarded,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          id,
          input.conversationId,
          input.senderId,
          input.type,
          input.content ?? null,
          input.mediaKey ?? null,
          input.mediaSize ?? null,
          input.durationMs ?? null,
          input.mediaProvider ?? null,
          input.mediaCategory ?? null,
          input.mediaMimeType ?? null,
          input.mediaOriginalSize ?? null,
          input.mediaName ?? null,
          input.mediaExpiresAt ?? null,
          input.mediaWidth ?? null,
          input.mediaHeight ?? null,
          input.mediaObjectId ?? null,
          input.replyToMessageId ?? null,
          input.clientId ?? null,
          input.isForwarded ? 1 : 0,
          createdAt,
        ],
      });

      await this.db.execute({
        sql: `
          UPDATE conversations
          SET last_message_id = ?, last_message_at = ?
          WHERE id = ?
        `,
        args: [id, createdAt, input.conversationId],
      });

      return {
        id,
        conversationId: input.conversationId,
        senderId: input.senderId,
        type: input.type,
        content: input.content ?? null,
        mediaKey: input.mediaKey ?? null,
        mediaSize: input.mediaSize ?? null,
        durationMs: input.durationMs ?? null,
        mediaProvider: input.mediaProvider ?? null,
        mediaCategory: input.mediaCategory ?? null,
        mediaMimeType: input.mediaMimeType ?? null,
        mediaOriginalSize: input.mediaOriginalSize ?? null,
        mediaName: input.mediaName ?? null,
        mediaExpiresAt: input.mediaExpiresAt ?? null,
        mediaWidth: input.mediaWidth ?? null,
        mediaHeight: input.mediaHeight ?? null,
        mediaObjectId: input.mediaObjectId ?? null,
        replyToMessageId: input.replyToMessageId ?? null,
        clientId: input.clientId ?? null,
        isForwarded: Boolean(input.isForwarded),
        createdAt,
      };
    },

    latest: async (
      conversationId: string,
      limit: number
    ): Promise<ContentMessage[]> => {
      await this.ensureMediaSchema();
      const result = await this.db.execute({
        sql: `
          SELECT *
          FROM messages
          WHERE conversation_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `,
        args: [conversationId, limit],
      });

      return result.rows.reverse().map(mapMessage);
    },

    before: async (
      conversationId: string,
      beforeId: string,
      limit: number
    ): Promise<ContentMessage[]> => {
      await this.ensureMediaSchema();
      const result = await this.db.execute({
        sql: `
          SELECT *
          FROM messages
          WHERE conversation_id = ?
            AND created_at < (
              SELECT created_at
              FROM messages
              WHERE id = ?
            )
          ORDER BY created_at DESC
          LIMIT ?
        `,
        args: [
          conversationId,
          beforeId,
          limit,
        ],
      });

      return result.rows.reverse().map(mapMessage);
    },

    after: async (
      conversationId: string,
      afterId: string,
      limit: number
    ): Promise<ContentMessage[]> => {
      await this.ensureMediaSchema();
      const result = await this.db.execute({
        sql: `
          SELECT *
          FROM messages
          WHERE conversation_id = ?
            AND created_at > (
              SELECT created_at
              FROM messages
              WHERE id = ?
            )
          ORDER BY created_at ASC
          LIMIT ?
        `,
        args: [
          conversationId,
          afterId,
          limit,
        ],
      });

      return result.rows.map(mapMessage);
    },

    getExpired: async (
      now: number,
      limit: number
    ): Promise<ContentMessage[]> => {
      await this.ensureMediaSchema();
      const result = await this.db.execute({
        sql: `
          SELECT *
          FROM messages
          WHERE media_expires_at IS NOT NULL
            AND media_expires_at <= ?
            AND media_key IS NOT NULL
          ORDER BY media_expires_at ASC
          LIMIT ?
        `,
        args: [now, limit],
      });

      return result.rows.map(mapMessage);
    },

    markMediaExpired: async (messageId: string): Promise<void> => {
      await this.ensureMediaSchema();
      await this.db.execute({
        sql: `
          UPDATE messages
          SET media_key = NULL
          WHERE id = ?
        `,
        args: [messageId],
      });
    },

    getMediaForUser: async (userId: string): Promise<ContentMessage[]> => {
      await this.ensureMediaSchema();
      const result = await this.db.execute({
        sql: `
          SELECT *
          FROM messages
          WHERE sender_id = ?
            AND media_key IS NOT NULL
        `,
        args: [userId],
      });

      return result.rows.map(mapMessage);
    },

    deleteForEveryone: async (messageId: string): Promise<void> => {
      await this.ensureMediaSchema();
      await this.db.execute({
        sql: `
          UPDATE messages
          SET
            deleted_for_everyone = 1,
            content = NULL,
            media_key = NULL,
            media_name = NULL,
            duration_ms = NULL,
            reply_to_message_id = NULL
          WHERE id = ?
        `,
        args: [messageId],
      });
    },

    deletePermanently: async (
      messageId: string,
      conversationId?: string
    ): Promise<void> => {
      await this.ensureMediaSchema();
      await this.ensureDeletionSchema();
      const stmts: InStatement[] = [
        {
          sql: `DELETE FROM messages WHERE id = ?`,
          args: [messageId],
        },
        {
          sql: `DELETE FROM message_deletions WHERE message_id = ?`,
          args: [messageId],
        },
      ];

      if (conversationId) {
        stmts.push({
          sql: `
            UPDATE conversations
            SET
              last_message_id = (
                SELECT id FROM messages
                WHERE conversation_id = ?
                ORDER BY created_at DESC
                LIMIT 1
              ),
              last_message_at = (
                SELECT created_at FROM messages
                WHERE conversation_id = ?
                ORDER BY created_at DESC
                LIMIT 1
              )
            WHERE id = ?
          `,
          args: [conversationId, conversationId, conversationId],
        });
      }

      await this.db.batch(stmts, "write");
    },

    invalidateMediaKey: async (mediaKey: string): Promise<void> => {
      await this.ensureMediaSchema();
      await this.db.execute({
        sql: `UPDATE messages SET media_key = NULL WHERE media_key = ?`,
        args: [mediaKey],
      });
    },

    hideForUser: async (
      messageId: string,
      userId: string,
      deletedAt: number
    ): Promise<void> => {
      await this.ensureDeletionSchema();
      await this.db.execute({
        sql: `
          INSERT OR IGNORE INTO message_deletions (message_id, user_id, deleted_at)
          VALUES (?, ?, ?)
        `,
        args: [messageId, userId, deletedAt],
      });
    },

    unhideForUser: async (
      messageId: string,
      userId: string
    ): Promise<void> => {
      await this.ensureDeletionSchema();
      await this.db.execute({
        sql: `DELETE FROM message_deletions WHERE message_id = ? AND user_id = ?`,
        args: [messageId, userId],
      });
    },

    isHiddenForUser: async (
      messageId: string,
      userId: string
    ): Promise<boolean> => {
      await this.ensureDeletionSchema();
      const result = await this.db.execute({
        sql: `
          SELECT 1
          FROM message_deletions
          WHERE message_id = ? AND user_id = ?
          LIMIT 1
        `,
        args: [messageId, userId],
      });
      return result.rows.length > 0;
    },

    getHiddenMessageIds: async (
      conversationId: string,
      userId: string
    ): Promise<string[]> => {
      await this.ensureDeletionSchema();
      const result = await this.db.execute({
        sql: `
          SELECT md.message_id
          FROM message_deletions md
          JOIN messages m ON m.id = md.message_id
          WHERE m.conversation_id = ? AND md.user_id = ?
        `,
        args: [conversationId, userId],
      });
      return result.rows.map((r) => String(r.message_id));
    },

    getDeletedForEveryoneIds: async (
      conversationId: string
    ): Promise<string[]> => {
      await this.ensureMediaSchema();
      const result = await this.db.execute({
        sql: `
          SELECT id
          FROM messages
          WHERE conversation_id = ? AND deleted_for_everyone = 1
        `,
        args: [conversationId],
      });
      return result.rows.map((r) => String(r.id));
    },
  };

  reads = {
    get: async (
      conversationId: string,
      userId: string
    ): Promise<ReadState | null> => {
      const result = await this.db.execute({
        sql: `
          SELECT
            conversation_id,
            user_id,
            last_delivered_message_id,
            last_read_message_id
          FROM conversation_reads
          WHERE conversation_id = ?
            AND user_id = ?
          LIMIT 1
        `,
        args: [
          conversationId,
          userId,
        ],
      });

      const row = result.rows[0];

      if (!row) {
        return null;
      }

      return {
        conversationId: String(row.conversation_id),
        userId: String(row.user_id),

        lastDeliveredMessageId:
          row.last_delivered_message_id == null
            ? null
            : String(row.last_delivered_message_id),

        lastReadMessageId:
          row.last_read_message_id == null
            ? null
            : String(row.last_read_message_id),
      };
    },

    markDelivered: async (
      conversationId: string,
      userId: string,
      messageId: string
    ): Promise<void> => {
      const current = await this.db.execute({
        sql: `
          SELECT
            m.created_at
          FROM conversation_reads r
          JOIN messages m
            ON m.id = r.last_delivered_message_id
          WHERE r.conversation_id = ?
            AND r.user_id = ?
          LIMIT 1
        `,
        args: [
          conversationId,
          userId,
        ],
      });

      const currentCreatedAt =
        current.rows[0]?.created_at == null
          ? null
          : Number(current.rows[0].created_at);

      const incoming = await this.db.execute({
        sql: `
          SELECT created_at
          FROM messages
          WHERE id = ?
            AND conversation_id = ?
          LIMIT 1
        `,
        args: [
          messageId,
          conversationId,
        ],
      });

      const incomingCreatedAt =
        incoming.rows[0]?.created_at == null
          ? null
          : Number(incoming.rows[0].created_at);

      if (incomingCreatedAt == null) {
        return;
      }

      if (
        currentCreatedAt != null &&
        incomingCreatedAt < currentCreatedAt
      ) {
        return;
      }

      await this.db.execute({
        sql: `
          INSERT INTO conversation_reads (
            conversation_id,
            user_id,
            last_delivered_message_id
          )
          VALUES (?, ?, ?)
          ON CONFLICT(conversation_id, user_id)
          DO UPDATE SET
            last_delivered_message_id =
              excluded.last_delivered_message_id
        `,
        args: [
          conversationId,
          userId,
          messageId,
        ],
      });
    },

    markRead: async (
      conversationId: string,
      userId: string,
      messageId: string
    ): Promise<void> => {
      const current = await this.db.execute({
        sql: `
          SELECT
            m.created_at
          FROM conversation_reads r
          JOIN messages m
            ON m.id = r.last_read_message_id
          WHERE r.conversation_id = ?
            AND r.user_id = ?
          LIMIT 1
        `,
        args: [
          conversationId,
          userId,
        ],
      });

      const currentCreatedAt =
        current.rows[0]?.created_at == null
          ? null
          : Number(current.rows[0].created_at);

      const incoming = await this.db.execute({
        sql: `
          SELECT created_at
          FROM messages
          WHERE id = ?
            AND conversation_id = ?
          LIMIT 1
        `,
        args: [
          messageId,
          conversationId,
        ],
      });

      const incomingCreatedAt =
        incoming.rows[0]?.created_at == null
          ? null
          : Number(incoming.rows[0].created_at);

      if (incomingCreatedAt == null) {
        return;
      }

      if (
        currentCreatedAt != null &&
        incomingCreatedAt < currentCreatedAt
      ) {
        return;
      }

      await this.db.execute({
        sql: `
          INSERT INTO conversation_reads (
            conversation_id,
            user_id,
            last_read_message_id
          )
          VALUES (?, ?, ?)
          ON CONFLICT(conversation_id, user_id)
          DO UPDATE SET
            last_read_message_id =
              excluded.last_read_message_id
        `,
        args: [
          conversationId,
          userId,
          messageId,
        ],
      });
    },
  };

  getMessageReceiptStatus = async (
    conversationId: string,
    messageId: string,
    recipientUserId: string
  ): Promise<MessageReceiptStatus> => {
    const message = await this.messages.get(messageId);

    if (!message || message.conversationId !== conversationId) {
      return "sent";
    }

    /*
    * The recipient's delivery/read cursors are stored in
    * conversation_reads.
    */
    const readState = await this.reads.get(
      conversationId,
      recipientUserId
    );

    if (!readState) {
      return "sent";
    }

    /*
    * The cursor IDs are UUIDs, so they cannot be compared
    * lexicographically. Resolve both cursor messages and
    * compare their creation timestamps.
    */
    let deliveredMessage: ContentMessage | null = null;
    let readMessage: ContentMessage | null = null;

    if (readState.lastDeliveredMessageId) {
      deliveredMessage = await this.messages.get(
        readState.lastDeliveredMessageId
      );
    }

    if (readState.lastReadMessageId) {
      readMessage = await this.messages.get(
        readState.lastReadMessageId
      );
    }

    if (
      readMessage &&
      isMessageAtOrAfter(readMessage, message)
    ) {
      return "read";
    }

    if (
      deliveredMessage &&
      isMessageAtOrAfter(deliveredMessage, message)
    ) {
      return "delivered";
    }

    return "sent";
  };

  typing = {
    set: async (
      conversationId: string,
      userId: string,
      expiresAt: number,
      state: "typing" | "recording" = "typing"
    ): Promise<void> => {
      await this.ensureTypingStateSchema();

      await this.db.execute({
        sql: `
          INSERT INTO typing_states (
            conversation_id,
            user_id,
            state,
            expires_at
          )
          VALUES (?, ?, ?, ?)
          ON CONFLICT(conversation_id, user_id)
          DO UPDATE SET
            state = excluded.state,
            expires_at = excluded.expires_at
        `,
        args: [
          conversationId,
          userId,
          state,
          expiresAt,
        ],
      });
    },

    clear: async (
      conversationId: string,
      userId: string
    ): Promise<void> => {
      await this.db.execute({
        sql: `
          DELETE FROM typing_states
          WHERE conversation_id = ?
            AND user_id = ?
        `,
        args: [conversationId, userId],
      });
    },

    get: async (
      conversationId: string
    ): Promise<TypingState[]> => {
      await this.ensureTypingStateSchema();

      const now = Date.now();

      try {
        await this.db.execute({
          sql: `DELETE FROM typing_states WHERE expires_at <= ?`,
          args: [now],
        });
      } catch {
        // Opportunistic cleanup; don't block reads
      }

      const result = await this.db.execute({
        sql: `
          SELECT user_id, state, expires_at
          FROM typing_states
          WHERE conversation_id = ?
            AND expires_at > ?
        `,
        args: [
          conversationId,
          now,
        ],
      });

      return result.rows.map((row) => ({
        userId: String(row.user_id),
        state:
          row.state === "recording"
            ? "recording"
            : "typing",
        expiresAt: Number(row.expires_at),
      }));
    },
  };

  private async ensureMediaSchema(): Promise<void> {
    if (this.mediaSchemaReady) {
      return;
    }

    const columns = [
      "ALTER TABLE messages ADD COLUMN media_provider TEXT",
      "ALTER TABLE messages ADD COLUMN media_category TEXT",
      "ALTER TABLE messages ADD COLUMN media_mime_type TEXT",
      "ALTER TABLE messages ADD COLUMN media_original_size INTEGER",
      "ALTER TABLE messages ADD COLUMN media_name TEXT",
      "ALTER TABLE messages ADD COLUMN media_expires_at INTEGER",
      "ALTER TABLE messages ADD COLUMN media_width INTEGER",
      "ALTER TABLE messages ADD COLUMN media_height INTEGER",
      "ALTER TABLE messages ADD COLUMN media_object_id TEXT",
      "ALTER TABLE messages ADD COLUMN reply_to_message_id TEXT",
      "ALTER TABLE messages ADD COLUMN is_forwarded INTEGER DEFAULT 0",
      "ALTER TABLE messages ADD COLUMN deleted_for_everyone INTEGER DEFAULT 0",
    ];

    for (const sql of columns) {
      try {
        await this.db.execute(sql);
      } catch {
        // Column already exists
      }
    }

    try {
      await this.db.execute(
        "CREATE INDEX IF NOT EXISTS idx_messages_media_expires_at ON messages(media_expires_at)"
      );
      await this.db.execute(
        "CREATE INDEX IF NOT EXISTS idx_messages_media_key ON messages(conversation_id, media_key)"
      );
      await this.db.execute(
        "CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(conversation_id, reply_to_message_id)"
      );
    } catch {
      // Index already exists
    }

    this.mediaSchemaReady = true;
  }

  private async ensureDeletionSchema(): Promise<void> {
    if (this.deletionSchemaReady) {
      return;
    }

    try {
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS message_deletions (
          message_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          deleted_at INTEGER NOT NULL,
          PRIMARY KEY (message_id, user_id)
        )
      `);
      await this.db.execute(
        "CREATE INDEX IF NOT EXISTS idx_message_deletions_message ON message_deletions(message_id)"
      );
    } catch {
      // Table or index already exists
    }

    this.deletionSchemaReady = true;
  }

  private async ensureTypingStateSchema(): Promise<void> {
    if (this.typingStateSchemaReady) {
      return;
    }

    try {
      await this.db.execute(`
        ALTER TABLE typing_states
        ADD COLUMN state TEXT NOT NULL DEFAULT 'typing'
      `);
    } catch {
      // Column already exists on upgraded shards.
    }

    this.typingStateSchemaReady = true;
  }
}

function mapMessage(
  row: Record<string, unknown>
): ContentMessage {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    senderId: String(row.sender_id),
    type: String(row.type) as ContentMessage["type"],
    content:
      row.content == null
        ? null
        : String(row.content),
    mediaKey:
      row.media_key == null
        ? null
        : String(row.media_key),
    mediaSize:
      row.media_size == null
        ? null
        : Number(row.media_size),
    durationMs:
      row.duration_ms == null
        ? null
        : Number(row.duration_ms),
    mediaProvider:
      row.media_provider == null
        ? null
        : String(row.media_provider),
    mediaCategory:
      row.media_category == null
        ? null
        : (String(row.media_category) as ContentMessage["mediaCategory"]),
    mediaMimeType:
      row.media_mime_type == null
        ? null
        : String(row.media_mime_type),
    mediaOriginalSize:
      row.media_original_size == null
        ? null
        : Number(row.media_original_size),
    mediaName:
      row.media_name == null
        ? null
        : String(row.media_name),
    mediaExpiresAt:
      row.media_expires_at == null
        ? null
        : Number(row.media_expires_at),
    mediaWidth:
      row.media_width == null
        ? null
        : Number(row.media_width),
    mediaHeight:
      row.media_height == null
        ? null
        : Number(row.media_height),
    mediaObjectId:
      row.media_object_id == null
        ? null
        : String(row.media_object_id),
    replyToMessageId:
      row.reply_to_message_id == null
        ? null
        : String(row.reply_to_message_id),
    clientId:
      row.client_id == null
        ? null
        : String(row.client_id),
    isForwarded: Boolean(row.is_forwarded),
    deletedForEveryone: Boolean(row.deleted_for_everyone),
    createdAt: Number(row.created_at),
  };
}

function isMessageAtOrAfter(
  candidate: ContentMessage,
  target: ContentMessage
): boolean {
  if (candidate.createdAt > target.createdAt) {
    return true;
  }

  if (candidate.createdAt < target.createdAt) {
    return false;
  }

  return candidate.id === target.id;
}
