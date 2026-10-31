import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureVerifiedUserSchema } from "@/lib/verified-users";
import { verifyPassword, createSession } from "@/lib/auth";
import { writeSessionCookie } from "@/lib/session";
import { normalizeUsername } from "@/lib/validation";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`login:${ip}`, 15, 60_000)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { username: rawUsername, password } = (body ?? {}) as {
    username?: unknown;
    password?: unknown;
  };

  if (typeof rawUsername !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 400 });
  }

  const username = normalizeUsername(rawUsername);

  // Per-username limiting too, so an attacker can't just rotate IPs slowly
  // while still being blunted, and a shared IP (NAT) doesn't lock out
  // everyone from one bad actor targeting a different account.
  if (!checkRateLimit(`login:user:${username.toLowerCase()}`, 15, 60_000)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429 }
    );
  }

  const db = getDb();
  await ensureVerifiedUserSchema();
  const result = await db.execute({
    sql: "SELECT id, username, password_hash, is_verified FROM users WHERE username = ? COLLATE NOCASE",
    args: [username],
  });

  const row = result.rows[0];
  if (!row) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  const valid = await verifyPassword(password, String(row.password_hash));
  if (!valid) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  const userId = String(row.id);
  const { sessionId, expiresAt } = await createSession(userId);
  writeSessionCookie(sessionId, expiresAt);

  return NextResponse.json({
    user: {
      id: userId,
      username: String(row.username),
      isVerified: Number(row.is_verified) === 1,
    },
  });
}
