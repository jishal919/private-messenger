-- Safe additive migration for existing content shards.
ALTER TABLE messages ADD COLUMN reply_to_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_reply_to
ON messages(conversation_id, reply_to_message_id);
