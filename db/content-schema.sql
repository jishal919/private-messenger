PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,

    user1_id TEXT NOT NULL,
    user2_id TEXT NOT NULL,

    created_at INTEGER NOT NULL,

    last_message_id TEXT,
    last_message_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_conversations_user1
ON conversations(user1_id);

CREATE INDEX IF NOT EXISTS idx_conversations_user2
ON conversations(user2_id);

CREATE INDEX IF NOT EXISTS idx_conversations_last_message
ON conversations(last_message_at DESC);


CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,

    type TEXT NOT NULL DEFAULT 'text',

    content TEXT,

    media_key TEXT,
    media_size INTEGER,
    duration_ms INTEGER,

    media_provider TEXT,
    media_category TEXT,
    media_mime_type TEXT,
    media_original_size INTEGER,
    media_name TEXT,
    media_expires_at INTEGER,
    media_width INTEGER,
    media_height INTEGER,
    media_object_id TEXT,

    reply_to_message_id TEXT,

    client_id TEXT,

    is_forwarded INTEGER DEFAULT 0,
    deleted_for_everyone INTEGER DEFAULT 0,

    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_time
ON messages(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
ON messages(conversation_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_id
ON messages(conversation_id, client_id)
WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_media_expires_at
ON messages(media_expires_at);

CREATE INDEX IF NOT EXISTS idx_messages_media_key
ON messages(conversation_id, media_key);

CREATE INDEX IF NOT EXISTS idx_messages_reply_to
ON messages(conversation_id, reply_to_message_id);


CREATE TABLE IF NOT EXISTS conversation_reads (
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    last_delivered_message_id TEXT,
    last_read_message_id TEXT,

    PRIMARY KEY (
        conversation_id,
        user_id
    )
);


CREATE TABLE IF NOT EXISTS typing_states (
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'typing',
    expires_at INTEGER NOT NULL,

    PRIMARY KEY (
        conversation_id,
        user_id
    )
);

CREATE INDEX IF NOT EXISTS idx_typing_expiry
ON typing_states(expires_at);


CREATE INDEX IF NOT EXISTS idx_conversations_last_message_id
ON conversations(last_message_id);


CREATE TABLE IF NOT EXISTS message_deletions (
    message_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    deleted_at INTEGER NOT NULL,

    PRIMARY KEY (
        message_id,
        user_id
    )
);

CREATE INDEX IF NOT EXISTS idx_message_deletions_message
ON message_deletions(message_id);
