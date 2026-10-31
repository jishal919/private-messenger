import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { ensureVerifiedUserSchema } from "@/lib/verified-users";
import {
  hashPassword,
  createSession,
} from "@/lib/auth";
import { writeSessionCookie } from "@/lib/session";
import {
  validateUsername,
  validatePassword,
  normalizeUsername,
} from "@/lib/validation";
import {
  checkRateLimit,
  getClientIp,
} from "@/lib/rate-limit";
import { generateUserId } from "@/lib/user-id";

export async function POST(request: Request) {
  const ip = getClientIp(request);

  if (
    !checkRateLimit(
      `register:${ip}`,
      10,
      60_000
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Too many attempts. Try again shortly.",
      },
      { status: 429 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: "Invalid request body.",
      },
      { status: 400 }
    );
  }

  const {
    username: rawUsername,
    password,
  } = (body ?? {}) as {
    username?: unknown;
    password?: unknown;
  };

  const usernameError =
    validateUsername(rawUsername);

  if (usernameError) {
    return NextResponse.json(
      { error: usernameError },
      { status: 400 }
    );
  }

  const passwordError =
    validatePassword(password);

  if (passwordError) {
    return NextResponse.json(
      { error: passwordError },
      { status: 400 }
    );
  }

  const username = normalizeUsername(
    rawUsername as string
  );

  const db = getDb();
  await ensureVerifiedUserSchema();

  const existing = await db.execute({
    sql: `
      SELECT id
      FROM users
      WHERE username = ? COLLATE NOCASE
    `,
    args: [username],
  });

  if (existing.rows.length > 0) {
    return NextResponse.json(
      {
        error:
          "Username already exists.",
      },
      { status: 409 }
    );
  }

  const passwordHash =
    await hashPassword(
      password as string
    );

  const now = Date.now();

  let userId = "";
  let userCreated = false;

  for (let attempt = 0; attempt < 5; attempt++) {
    const candidateId = generateUserId();

    try {
      await db.execute({
        sql: `
          INSERT INTO users (
            id,
            username,
            password_hash,
            created_at
          )
          VALUES (?, ?, ?, ?)
        `,
        args: [
          candidateId,
          username,
          passwordHash,
          now,
        ],
      });

      userId = candidateId;
      userCreated = true;
      break;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      // A duplicate primary key means this random UID was already taken.
      // Generate another UID and retry.
      if (
        message.toLowerCase().includes("unique") ||
        message.toLowerCase().includes("primary key") ||
        message.toLowerCase().includes("constraint")
      ) {
        continue;
      }

      console.error("User registration failed:", error);

      return NextResponse.json(
        {
          error: "Could not create account. Please try again.",
        },
        { status: 500 }
      );
    }
  }

  if (!userCreated) {
    return NextResponse.json(
      {
        error: "Could not generate a unique user ID. Please try again.",
      },
      { status: 500 }
    );
  }

  const {
    sessionId,
    expiresAt,
  } = await createSession(userId);

  writeSessionCookie(
    sessionId,
    expiresAt
  );

  return NextResponse.json(
    {
      user: {
        id: userId,
        username,
        isVerified: false,
      },
    },
    { status: 201 }
  );
}
