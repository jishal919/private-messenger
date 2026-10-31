-- Migration 003: Message deletion support
ALTER TABLE messages ADD COLUMN deleted_for_everyone INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS message_deletions (
    message_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    deleted_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_deletions_message
ON message_deletions(message_id);
