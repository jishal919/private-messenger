import webpush from "web-push";
import { getDb } from "@/lib/db";

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT;

if (!publicKey || !privateKey || !subject) {
  throw new Error(
    "VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must be configured."
  );
}

webpush.setVapidDetails(
  subject,
  publicKey,
  privateKey
);

export async function sendMessagePush(
  recipientId: string,
  conversationId: string,
  senderUsername: string,
  messageContent: string
): Promise<void> {
  const db = getDb();

  try {
    const settingsResult = await db.execute({
      sql: `
        SELECT notifications_enabled
        FROM user_settings
        WHERE user_id = ?
        LIMIT 1
      `,
      args: [recipientId],
    });

    const notificationsEnabled =
      Number(
        settingsResult.rows[0]?.notifications_enabled ?? 0
      ) === 1;

    if (!notificationsEnabled) {
      return;
    }

    // Skip push if recipient currently has this conversation open
    const activeResult = await db.execute({
      sql: `
        SELECT 1 FROM presence_sessions
        WHERE user_id = ?
          AND expires_at > ?
          AND active_conversation_id = ?
        LIMIT 1
      `,
      args: [recipientId, Date.now(), conversationId],
    });

    if (activeResult.rows.length > 0) {
      return;
    }

    const subscriptionsResult = await db.execute({
      sql: `
        SELECT id, endpoint, p256dh, auth
        FROM push_subscriptions
        WHERE user_id = ?
      `,
      args: [recipientId],
    });

    if (subscriptionsResult.rows.length === 0) {
      return;
    }

    const body =
      messageContent.length > 120
        ? `${messageContent.slice(0, 117)}…`
        : messageContent;

    const payload = JSON.stringify({
      title: senderUsername,
      body,

      // Your app icon.
      icon: "/icon-192.png",
      badge: "/icon-192.png",

      // Clicking the notification opens this conversation.
      url: `/chat?conversation=${encodeURIComponent(
        conversationId
      )}`,

      conversationId,

      // Messages from the same conversation are grouped/replaced.
      tag: `conversation-${conversationId}`,
    });

    await Promise.all(
      subscriptionsResult.rows.map(
        async (row) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: String(row.endpoint),
                keys: {
                  p256dh: String(row.p256dh),
                  auth: String(row.auth),
                },
              },
              payload
            );
          } catch (error) {
            const statusCode =
              typeof error === "object" &&
              error !== null &&
              "statusCode" in error
                ? Number(
                    (error as {
                      statusCode?: unknown;
                    }).statusCode
                  )
                : 0;

            /*
             * 404/410 means the browser subscription
             * is no longer valid. Remove it so future
             * messages don't keep retrying it.
             */
            if (
              statusCode === 404 ||
              statusCode === 410
            ) {
              await db.execute({
                sql: `
                  DELETE FROM push_subscriptions
                  WHERE id = ?
                    AND user_id = ?
                `,
                args: [
                  String(row.id),
                  recipientId,
                ],
              });

              return;
            }

            console.error(
              "Push notification failed:",
              error
            );
          }
        }
      )
    );
  } catch (error) {
    /*
     * Push notification failure must NEVER cause
     * an otherwise successful message send to fail.
     */
    console.error(
      "Message push processing failed:",
      error
    );
  }
}

export { webpush };