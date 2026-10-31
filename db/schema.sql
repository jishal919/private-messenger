-- Lite Messenger Core Database
-- Turso / libSQL
--
-- User IDs are random 18-digit positive integers.
-- They are NOT sequential AUTOINCREMENT IDs.

PRAGMA foreign_keys = ON;


-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  username        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  avatar_key      TEXT,
  avatar_file_id  TEXT,
  is_verified     INTEGER NOT NULL DEFAULT 0,
  last_seen_at    INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase
  ON users (username COLLATE NOCASE);

-- The verified flag belongs to the account record, not its displayed name.
UPDATE users
SET is_verified = 1
WHERE username = 'Jishal' COLLATE NOCASE;


-- ============================================================
-- SESSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,

  user_id    TEXT NOT NULL
    REFERENCES users (id) ON DELETE CASCADE,

  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id
  ON sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
  ON sessions (expires_at);


-- ============================================================
-- CONTENT SHARDS
-- ============================================================

CREATE TABLE IF NOT EXISTS storage_shards (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  priority    INTEGER NOT NULL DEFAULT 100,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_storage_shards_status
  ON storage_shards (status);


-- ============================================================
-- CONVERSATION DIRECTORY
-- ============================================================

CREATE TABLE IF NOT EXISTS conversation_directory (
  conversation_id TEXT PRIMARY KEY,

  user1_id TEXT NOT NULL
    REFERENCES users (id) ON DELETE CASCADE,

  user2_id TEXT NOT NULL
    REFERENCES users (id) ON DELETE CASCADE,

  shard_id TEXT NOT NULL
    REFERENCES storage_shards (id),

  created_at INTEGER NOT NULL,

  CHECK (user1_id < user2_id),

  UNIQUE (user1_id, user2_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_directory_user1
  ON conversation_directory (user1_id);

CREATE INDEX IF NOT EXISTS idx_conversation_directory_user2
  ON conversation_directory (user2_id);

CREATE INDEX IF NOT EXISTS idx_conversation_directory_shard
  ON conversation_directory (shard_id);


-- ============================================================
-- USER SETTINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY
    REFERENCES users (id) ON DELETE CASCADE,
  read_receipts_enabled INTEGER NOT NULL DEFAULT 1,
  notifications_enabled INTEGER NOT NULL DEFAULT 0,
  show_last_seen_enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);


-- ============================================================
-- PRESENCE
-- ============================================================

CREATE TABLE IF NOT EXISTS presence_sessions (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL
    REFERENCES users (id) ON DELETE CASCADE,
  last_heartbeat_at     INTEGER NOT NULL,
  expires_at            INTEGER NOT NULL,
  created_at            INTEGER NOT NULL,
  active_conversation_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_presence_sessions_user_id
  ON presence_sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_presence_sessions_expires_at
  ON presence_sessions (expires_at);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id              TEXT PRIMARY KEY,
  user_id         INTEGER NOT NULL
    REFERENCES users (id) ON DELETE CASCADE,
  endpoint        TEXT NOT NULL UNIQUE,
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
  ON push_subscriptions (user_id);
