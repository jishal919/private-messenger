import { NextResponse } from "next/server";
import ImageKit from "@imagekit/nodejs";

import { getDb } from "@/lib/db";
import { deleteSession } from "@/lib/auth";
import {
  clearSessionCookie,
  getCurrentUser,
  readSessionCookie,
} from "@/lib/session";
import { getAvailableContentShards } from "@/lib/content/router";
import { getMediaStorage } from "@/lib/media/router";
import { parseStorageKey } from "@/lib/media/validation";
import type { MediaCategory } from "@/lib/media/types";

const imagekit = new ImageKit({
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
});

/**
 * Delete every ImageKit file belonging to this user.
 *
 * All user-owned media should live below:
 *
 *   /users/{userId}/
 *
 * This includes:
 *   /users/{userId}/avatar/
 *   /users/{userId}/voice/
 *   /users/{userId}/media/
 *   etc.
 */



async function deleteUserImageKitAssets(
  userId: string
): Promise<void> {
  const searchQuery = `path:"/users/${userId}/"`;

  /*
   * Keep track of file IDs that ImageKit's asset listing
   * still returns even though the actual files no longer exist.
   *
   * Without this, a stale ImageKit result can cause an
   * infinite deletion loop.
   */
  const ignoredMissingFileIds = new Set<string>();

  while (true) {
    const assets = await imagekit.assets.list({
      skip: 0,
      limit: 1000,
      searchQuery,
    });

    const fileIds: string[] = [];

    for (const asset of assets) {
      if (
        "fileId" in asset &&
        typeof asset.fileId === "string" &&
        asset.fileId.length > 0 &&
        !ignoredMissingFileIds.has(asset.fileId)
      ) {
        fileIds.push(asset.fileId);
      }
    }

    /*
     * No actual undeleted files remain.
     *
     * Folders are handled separately below.
     */
    if (fileIds.length === 0) {
      break;
    }

    for (let i = 0; i < fileIds.length; i += 100) {
      const batch = fileIds.slice(i, i + 100);

      try {
        await imagekit.files.bulk.delete({
          fileIds: batch,
        });
      } catch (error) {
        /*
         * ImageKit can return file IDs that are already gone
         * even though they still appear in the asset listing.
         */
        const missingFileIds =
          typeof error === "object" &&
          error !== null &&
          "error" in error &&
          typeof error.error === "object" &&
          error.error !== null &&
          "missingFileIds" in error.error &&
          Array.isArray(error.error.missingFileIds)
            ? error.error.missingFileIds.filter(
                (id): id is string => typeof id === "string"
              )
            : [];

        /*
         * This is a real error, not a stale-file situation.
         */
        if (missingFileIds.length === 0) {
          throw error;
        }

        /*
         * Ignore these stale IDs on the next listing pass.
         */
        for (const fileId of missingFileIds) {
          ignoredMissingFileIds.add(fileId);
        }

        console.warn(
          "Ignoring already-missing ImageKit files:",
          missingFileIds
        );

        /*
         * Retry the remaining valid files from this batch.
         */
        const remainingFileIds = batch.filter(
          (fileId) => !missingFileIds.includes(fileId)
        );

        if (remainingFileIds.length > 0) {
          await imagekit.files.bulk.delete({
            fileIds: remainingFileIds,
          });
        }
      }
    }
  }
}



async function deleteUserImageKitFolder(
  userId: string
): Promise<void> {
  const childFolders = [
    `/users/${userId}/avatar`,
    `/users/${userId}/voice`,
  ];

  /*
   * Delete known child folders first.
   */
  for (const folderPath of childFolders) {
    try {
      await imagekit.folders.delete({
        folderPath,
      });
    } catch (error) {
      const status =
        typeof error === "object" &&
        error !== null &&
        "status" in error
          ? error.status
          : undefined;

      /*
       * 404 means the folder is already gone.
       */
      if (status !== 404) {
        throw error;
      }
    }
  }

  /*
   * Then delete the user's root media folder.
   */
  try {
    await imagekit.folders.delete({
      folderPath: `/users/${userId}`,
    });
  } catch (error) {
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error
        ? error.status
        : undefined;

    if (status !== 404) {
      throw error;
    }
  }
}



export async function DELETE() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json(
      { error: "Not authenticated." },
      { status: 401 }
    );
  }

  const userId = currentUser.id;

  if (!process.env.IMAGEKIT_PRIVATE_KEY) {
    return NextResponse.json(
      { error: "Image storage is not configured." },
      { status: 500 }
    );
  }

  try {
    /*
     * ---------------------------------------------------------
     * 1. Delete content from every configured content shard.
     * ---------------------------------------------------------
     *
     * This removes:
     *   - messages
     *   - read states
     *   - typing states
     *   - conversations
     */
    const shards = getAvailableContentShards();

    for (const shard of shards) {
      try {
        const userMedia = await shard.messages.getMediaForUser(userId);
        for (const item of userMedia) {
          if (!item.mediaKey) continue;
          const parsed = parseStorageKey(item.mediaKey);
          const category: MediaCategory =
            parsed?.category ||
            (item.mediaCategory as MediaCategory) ||
            (item.type === "video"
              ? "video"
              : item.type === "document"
              ? "document"
              : "image");
          try {
            const storage = getMediaStorage(category);
            await storage.delete(item.mediaKey);
          } catch (delErr) {
            console.warn("Failed to delete user media object from B2:", item.mediaKey, delErr);
          }
        }
      } catch (err) {
        console.warn("Could not query user media from shard before deletion:", err);
      }
      await shard.conversations.deleteForUser(userId);
    }

    /*
     * ---------------------------------------------------------
     * 2. Delete all ImageKit assets belonging to this user.
     * ---------------------------------------------------------
     */
        await deleteUserImageKitAssets(userId);
        await deleteUserImageKitFolder(userId);

        /*
        * ---------------------------------------------------------
        * 3. Delete the Core DB user.
     * ---------------------------------------------------------
     *
     * The Core schema has ON DELETE CASCADE for:
     *
     *   sessions
     *   user_settings
     *   conversation_directory
     *
     * Therefore deleting the user removes those records too.
     */
    const db = getDb();

    await db.execute({
      sql: `
        DELETE FROM users
        WHERE id = ?
      `,
      args: [userId],
    });

    /*
     * ---------------------------------------------------------
     * 4. Explicitly delete the current session and cookie.
     * ---------------------------------------------------------
     *
     * The DB cascade already removes the session row, but
     * explicitly deleting the session and clearing the cookie
     * makes the logout behavior immediate and unambiguous.
     */
    const sessionId = readSessionCookie();

    if (sessionId) {
      await deleteSession(sessionId);
    }

    clearSessionCookie();

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("Account deletion failed:", error);

    return NextResponse.json(
      {
        error:
          "Account deletion could not be completed. Please try again.",
      },
      { status: 500 }
    );
  }
}