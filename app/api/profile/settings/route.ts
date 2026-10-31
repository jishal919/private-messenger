import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/session";
import { getDb } from "@/lib/db";
import { ensurePresenceSchema } from "@/lib/presence";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Not authenticated." },
        { status: 401 }
      );
    }

    const db = getDb();
    await ensurePresenceSchema();

    let result = await db.execute({
      sql: `
        SELECT
          read_receipts_enabled,
          notifications_enabled,
          show_last_seen_enabled
        FROM user_settings
        WHERE user_id = ?
      `,
      args: [user.id],
    });

    if (!result.rows[0]) {
      await db.execute({
        sql: `
          INSERT INTO user_settings (
            user_id,
            read_receipts_enabled,
            notifications_enabled,
            show_last_seen_enabled,
            created_at
          )
          VALUES (?, 1, 0, 1, ?)
        `,
        args: [user.id, Date.now()],
      });

      result = await db.execute({
        sql: `
          SELECT
            read_receipts_enabled,
            notifications_enabled,
            show_last_seen_enabled
          FROM user_settings
          WHERE user_id = ?
        `,
        args: [user.id],
      });
    }

    return NextResponse.json({
      settings: {
        readReceiptsEnabled:
          Number(
            result.rows[0]?.read_receipts_enabled ?? 1
          ) === 1,

        notificationsEnabled:
          Number(
            result.rows[0]?.notifications_enabled ?? 0
          ) === 1,

        showLastSeenEnabled:
          Number(
            result.rows[0]?.show_last_seen_enabled ?? 1
          ) === 1,
      },
    });
  } catch (error) {
    console.error("Get profile settings error:", error);

    return NextResponse.json(
      { error: "Could not load settings." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
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

    if (
      !body ||
      typeof body !== "object"
    ) {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 }
      );
    }

    const data = body as {
      readReceiptsEnabled?: unknown;
      notificationsEnabled?: unknown;
      showLastSeenEnabled?: unknown;
    };

    const hasReadReceipts =
      typeof data.readReceiptsEnabled === "boolean";

    const hasNotifications =
      typeof data.notificationsEnabled === "boolean";

    const hasShowLastSeen =
      typeof data.showLastSeenEnabled === "boolean";

    if (
      !hasReadReceipts &&
      !hasNotifications &&
      !hasShowLastSeen
    ) {
      return NextResponse.json(
        {
          error:
            "Provide readReceiptsEnabled, notificationsEnabled, or showLastSeenEnabled.",
        },
        { status: 400 }
      );
    }

    const db = getDb();
    await ensurePresenceSchema();

    const currentResult = await db.execute({
      sql: `
        SELECT
          read_receipts_enabled,
          notifications_enabled,
          show_last_seen_enabled
        FROM user_settings
        WHERE user_id = ?
      `,
      args: [user.id],
    });

    const current = currentResult.rows[0];

    const readReceiptsEnabled = hasReadReceipts
      ? data.readReceiptsEnabled
      : Number(
          current?.read_receipts_enabled ?? 1
        ) === 1;

    const notificationsEnabled = hasNotifications
      ? data.notificationsEnabled
      : Number(
          current?.notifications_enabled ?? 0
        ) === 1;

    const showLastSeenEnabled = hasShowLastSeen
      ? data.showLastSeenEnabled
      : Number(
          current?.show_last_seen_enabled ?? 1
        ) === 1;

    await db.execute({
      sql: `
        INSERT INTO user_settings (
          user_id,
          read_receipts_enabled,
          notifications_enabled,
          show_last_seen_enabled,
          created_at
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id)
        DO UPDATE SET
          read_receipts_enabled =
            excluded.read_receipts_enabled,
          notifications_enabled =
            excluded.notifications_enabled,
          show_last_seen_enabled =
            excluded.show_last_seen_enabled
      `,
      args: [
        user.id,
        readReceiptsEnabled ? 1 : 0,
        notificationsEnabled ? 1 : 0,
        showLastSeenEnabled ? 1 : 0,
        Date.now(),
      ],
    });

    return NextResponse.json({
      settings: {
        readReceiptsEnabled,
        notificationsEnabled,
        showLastSeenEnabled,
      },
    });
  } catch (error) {
    console.error("Update profile settings error:", error);

    return NextResponse.json(
      { error: "Could not update settings." },
      { status: 500 }
    );
  }
}
