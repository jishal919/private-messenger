import { NextResponse } from "next/server";
import { deleteSession } from "@/lib/auth";
import { readSessionCookie, clearSessionCookie } from "@/lib/session";

import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export async function POST() {
  const currentUser = await getCurrentUser();
  if (currentUser) {
    try {
      const db = getDb();
      const now = Date.now();
      await db.execute({
        sql: `UPDATE users SET last_seen_at = ? WHERE id = ?`,
        args: [now, currentUser.id],
      });
      await db.execute({
        sql: `UPDATE presence_sessions SET expires_at = ? WHERE user_id = ?`,
        args: [now, currentUser.id],
      });
    } catch {
      // Non-fatal
    }
  }

  const sessionId = readSessionCookie();
  await deleteSession(sessionId);
  clearSessionCookie();
  return NextResponse.json({ ok: true });
}
