import { NextResponse } from "next/server";
import ImageKit from "@imagekit/nodejs";

import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

const imagekit = new ImageKit({
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
});

function isValidAvatarKey(
  avatarKey: string,
  userId: string
): boolean {
  const expectedPrefix = `users/${userId}/avatar/`;

  return (
    avatarKey.startsWith(expectedPrefix) &&
    avatarKey.length <= 500
  );
}

export async function PATCH(request: Request) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
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
    typeof body !== "object" ||
    body === null
  ) {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }

  const avatarKey =
    typeof (body as { avatarKey?: unknown }).avatarKey ===
    "string"
      ? (body as { avatarKey: string }).avatarKey.trim()
      : "";

  const avatarFileId =
    typeof (body as { avatarFileId?: unknown }).avatarFileId ===
    "string"
      ? (body as { avatarFileId: string }).avatarFileId.trim()
      : "";

  if (
    !avatarKey ||
    !avatarFileId ||
    !isValidAvatarKey(
      avatarKey,
      currentUser.id
    )
  ) {
    return NextResponse.json(
      { error: "Invalid avatar information." },
      { status: 400 }
    );
  }

  const db = getDb();

  const existingResult = await db.execute({
    sql: `
      SELECT
        avatar_key,
        avatar_file_id
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    args: [currentUser.id],
  });

  const existingRow = existingResult.rows[0];

  const oldAvatarFileId =
    existingRow?.avatar_file_id == null
      ? null
      : String(existingRow.avatar_file_id);

  /*
   * The new ImageKit upload has already succeeded.
   * Save the new avatar first.
   */
  await db.execute({
    sql: `
      UPDATE users
      SET
        avatar_key = ?,
        avatar_file_id = ?
      WHERE id = ?
    `,
    args: [
      avatarKey,
      avatarFileId,
      currentUser.id,
    ],
  });

  /*
   * Delete the previous ImageKit asset.
   *
   * We only do this when there is a previous file and
   * it is different from the newly uploaded file.
   */
  if (
    oldAvatarFileId &&
    oldAvatarFileId !== avatarFileId
  ) {
    try {
      await imagekit.files.delete(
        oldAvatarFileId
      );
    } catch (error) {
      /*
       * The new avatar is already saved and usable.
       *
       * If deletion fails, don't break the avatar update.
       * The old asset can be cleaned up later.
       */
      console.error(
        "Failed to delete previous avatar from ImageKit:",
        error
      );
    }
  }

  return NextResponse.json({
    avatarKey,
    avatarFileId,
  });
}

export async function DELETE() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json(
      { error: "Not authenticated." },
      { status: 401 }
    );
  }

  const db = getDb();

  const result = await db.execute({
    sql: `
      SELECT avatar_file_id
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    args: [currentUser.id],
  });

  const fileId =
    result.rows[0]?.avatar_file_id == null
      ? null
      : String(
          result.rows[0].avatar_file_id
        );

  /*
   * Delete the actual ImageKit asset first.
   */
  if (fileId) {
    try {
      await imagekit.files.delete(fileId);
    } catch (error) {
      console.error(
        "Failed to delete avatar from ImageKit:",
        error
      );

      return NextResponse.json(
        {
          error:
            "Could not remove the profile picture from image storage.",
        },
        { status: 502 }
      );
    }
  }

  /*
   * Only clear the database after the ImageKit deletion
   * succeeds.
   */
  await db.execute({
    sql: `
      UPDATE users
      SET
        avatar_key = NULL,
        avatar_file_id = NULL
      WHERE id = ?
    `,
    args: [currentUser.id],
  });

  return NextResponse.json({
    avatarKey: null,
    avatarFileId: null,
  });
}