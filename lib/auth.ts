import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { getDb } from "./db";
import { SESSION_COOKIE_NAME } from "./constants";
import { ensureVerifiedUserSchema } from "./verified-users";

export { SESSION_COOKIE_NAME };
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const BCRYPT_ROUNDS = 12;

export type SessionUser = {
  id: string;
  username: string;
  isVerified: boolean;
};

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

function generateSessionId(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Creates a server-side session row and returns its id (the value that
 * should be stored in the session cookie) plus its expiry.
 */
export async function createSession(userId: string): Promise<{
  sessionId: string;
  expiresAt: number;
}> {
  const db = getDb();
  const sessionId = generateSessionId();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;

  await db.execute({
    sql: "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    args: [sessionId, userId, expiresAt, now],
  });

  return { sessionId, expiresAt };
}

/**
 * Looks up a session id and returns the associated user if the session
 * exists and hasn't expired. Expired sessions are lazily deleted.
 */
export async function getUserForSession(
  sessionId: string | undefined
): Promise<SessionUser | null> {
  if (!sessionId) return null;

  await ensureVerifiedUserSchema();
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT users.id as id, users.username as username,
                 users.is_verified as is_verified, sessions.expires_at as expires_at
          FROM sessions
          JOIN users ON users.id = sessions.user_id
          WHERE sessions.id = ?`,
    args: [sessionId],
  });

  const row = result.rows[0];
  if (!row) return null;

  const expiresAt = Number(row.expires_at);
  if (expiresAt < Date.now()) {
    // Expired — clean it up and treat as logged out.
    await db.execute({
      sql: "DELETE FROM sessions WHERE id = ?",
      args: [sessionId],
    });
    return null;
  }

  return {
    id: String(row.id),
    username: String(row.username),
    isVerified: Number(row.is_verified) === 1,
  };
}

export async function deleteSession(sessionId: string | undefined): Promise<void> {
  if (!sessionId) return;
  const db = getDb();
  await db.execute({
    sql: "DELETE FROM sessions WHERE id = ?",
    args: [sessionId],
  });
}

export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;
