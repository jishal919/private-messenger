import { getDb } from "@/lib/db";

const PRESENCE_SCHEMA_KEY = "presence-core-v1";

const initialized = new Set<string>();

export const PRESENCE_HEARTBEAT_MS = 10_000;
export const PRESENCE_TTL_MS = 20_000;
export const PRESENCE_POLL_MS = 12_000;
const PRESENCE_STALE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export async function ensurePresenceSchema(): Promise<void> {
  if (initialized.has(PRESENCE_SCHEMA_KEY)) {
    return;
  }

  const db = getDb();

  try {
    await db.execute(`
      ALTER TABLE user_settings
      ADD COLUMN show_last_seen_enabled INTEGER NOT NULL DEFAULT 1
    `);
  } catch {
    // Column already exists.
  }

  try {
    await db.execute(`
      ALTER TABLE users
      ADD COLUMN last_seen_at INTEGER
    `);
  } catch {
    // Column already exists.
  }

  // Add active_conversation_id column to presence_sessions (tracks which chat the user has open)
  try {
    await db.execute(`
      ALTER TABLE presence_sessions
      ADD COLUMN active_conversation_id TEXT
    `);
  } catch {
    // Column already exists.
  }

  // Backfill existing last_seen_at from presence_sessions
  try {
    await db.execute(`
      UPDATE users
      SET last_seen_at = (
        SELECT MAX(last_heartbeat_at)
        FROM presence_sessions
        WHERE presence_sessions.user_id = users.id
      )
      WHERE last_seen_at IS NULL
    `);
  } catch {
    // Non-fatal backfill
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS presence_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      last_heartbeat_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_presence_sessions_user_id
    ON presence_sessions (user_id)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_presence_sessions_expires_at
    ON presence_sessions (expires_at)
  `);

  initialized.add(PRESENCE_SCHEMA_KEY);
}

export function isValidPresenceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 100 &&
    /^[a-zA-Z0-9:_-]+$/.test(value)
  );
}

export async function cleanupExpiredPresence(now = Date.now()): Promise<void> {
  const db = getDb();

  await db.execute({
    sql: `
      DELETE FROM presence_sessions
      WHERE expires_at <= ?
    `,
    args: [now - PRESENCE_STALE_RETENTION_MS],
  });
}
