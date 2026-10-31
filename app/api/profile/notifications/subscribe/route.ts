import { NextResponse } from "next/server";
import crypto from "crypto";

import { getCurrentUser } from "@/lib/session";
import { getDb } from "@/lib/db";

type PushSubscriptionBody = {
  endpoint?: unknown;
  keys?: {
    p256dh?: unknown;
    auth?: unknown;
  };
};

function createSubscriptionId(endpoint: string): string {
  return crypto
    .createHash("sha256")
    .update(endpoint)
    .digest("hex");
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Not authenticated." },
        { status: 401 }
      );
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 }
      );
    }

    const subscription =
      body as PushSubscriptionBody;

    const endpoint = subscription.endpoint;

    const p256dh =
      subscription.keys?.p256dh;

    const auth =
      subscription.keys?.auth;

    if (
      typeof endpoint !== "string" ||
      !endpoint ||
      typeof p256dh !== "string" ||
      !p256dh ||
      typeof auth !== "string" ||
      !auth
    ) {
      return NextResponse.json(
        { error: "Invalid push subscription." },
        { status: 400 }
      );
    }

    const db = getDb();
    const id = createSubscriptionId(endpoint);
    const now = Date.now();

    await db.execute({
      sql: `
        INSERT INTO push_subscriptions (
          id,
          user_id,
          endpoint,
          p256dh,
          auth,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(endpoint)
        DO UPDATE SET
          user_id = excluded.user_id,
          p256dh = excluded.p256dh,
          auth = excluded.auth,
          updated_at = excluded.updated_at
      `,
      args: [
        id,
        user.id,
        endpoint,
        p256dh,
        auth,
        now,
        now,
      ],
    });

    await db.execute({
      sql: `
        INSERT INTO user_settings (
          user_id,
          read_receipts_enabled,
          notifications_enabled,
          created_at
        )
        VALUES (?, 1, 1, ?)
        ON CONFLICT(user_id)
        DO UPDATE SET
          notifications_enabled = 1
      `,
      args: [user.id, now],
    });

    return NextResponse.json({
      ok: true,
    });
  } catch (error) {
    console.error(
      "Save push subscription error:",
      error
    );

    return NextResponse.json(
      { error: "Could not save push subscription." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Not authenticated." },
        { status: 401 }
      );
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 }
      );
    }

    const endpoint =
      body &&
      typeof body === "object" &&
      "endpoint" in body
        ? (body as { endpoint?: unknown }).endpoint
        : undefined;

    if (
      typeof endpoint !== "string" ||
      !endpoint
    ) {
      return NextResponse.json(
        { error: "Endpoint is required." },
        { status: 400 }
      );
    }

    const db = getDb();

    await db.execute({
      sql: `
        DELETE FROM push_subscriptions
        WHERE user_id = ?
          AND endpoint = ?
      `,
      args: [user.id, endpoint],
    });

    /*
     * Do not globally disable another device's
     * notification subscription. The actual push
     * subscription is device/browser specific.
     */
    const remaining = await db.execute({
      sql: `
        SELECT id
        FROM push_subscriptions
        WHERE user_id = ?
        LIMIT 1
      `,
      args: [user.id],
    });

    await db.execute({
      sql: `
        INSERT INTO user_settings (
          user_id,
          read_receipts_enabled,
          notifications_enabled,
          created_at
        )
        VALUES (?, 1, ?, ?)
        ON CONFLICT(user_id)
        DO UPDATE SET
          notifications_enabled = excluded.notifications_enabled
      `,
      args: [
        user.id,
        remaining.rows.length > 0 ? 1 : 0,
        Date.now(),
      ],
    });

    return NextResponse.json({
      ok: true,
    });
  } catch (error) {
    console.error(
      "Delete push subscription error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Could not remove push subscription.",
      },
      { status: 500 }
    );
  }
}