import { NextResponse } from "next/server";
import { getAvailableContentShards } from "@/lib/content/router";
import { getMediaStorage } from "@/lib/media/router";
import { parseStorageKey } from "@/lib/media/validation";
import type { MediaCategory } from "@/lib/media/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/media/cleanup
 *
 * Automated cron endpoint for expiring and deleting old media files
 * from Backblaze B2 across all content shards.
 */
export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "") || request.headers.get("x-cron-secret");

    if (token !== cronSecret) {
      return NextResponse.json(
        { error: "Unauthorized cron request." },
        { status: 401 }
      );
    }
  }

  const startTime = Date.now();
  const now = Date.now();
  const BATCH_SIZE = 100;

  let totalProcessed = 0;
  let totalDeleted = 0;
  let totalFailed = 0;

  try {
    const shards = getAvailableContentShards();

    for (const shard of shards) {
      try {
        const expiredMessages = await shard.messages.getExpired(now, BATCH_SIZE);

        for (const message of expiredMessages) {
          totalProcessed++;

          if (!message.mediaKey) {
            continue;
          }

          const parsed = parseStorageKey(message.mediaKey);
          const category: MediaCategory =
            parsed?.category ||
            (message.mediaCategory as MediaCategory) ||
            (message.type === "video"
              ? "video"
              : message.type === "document"
              ? "document"
              : "image");

          try {
            const storage = getMediaStorage(category);
            await storage.delete(message.mediaKey);
            await shard.messages.markMediaExpired(message.id);
            totalDeleted++;
          } catch (delErr) {
            console.error(
              `Failed to delete expired media ${message.mediaKey}:`,
              delErr
            );
            totalFailed++;
            // Still mark as expired in DB so it doesn't perpetually block future runs
            try {
              await shard.messages.markMediaExpired(message.id);
            } catch {
              // Ignore secondary failure
            }
          }
        }
      } catch (shardErr) {
        console.error(`Error processing shard ${shard.id} for cleanup:`, shardErr);
      }
    }

    return NextResponse.json({
      success: true,
      processed: totalProcessed,
      deleted: totalDeleted,
      failed: totalFailed,
      durationMs: Date.now() - startTime,
    });
  } catch (err: unknown) {
    console.error("Media cleanup cron failed:", err);
    return NextResponse.json(
      {
        error: "Media cleanup failed.",
        processed: totalProcessed,
        deleted: totalDeleted,
        failed: totalFailed,
      },
      { status: 500 }
    );
  }
}
