import { NextResponse } from "next/server";

import ImageKit from "@imagekit/nodejs";
import { getCurrentUser } from "@/lib/session";

const imagekit = new ImageKit({
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
});

export async function GET() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json(
      { error: "Not authenticated." },
      { status: 401 }
    );
  }

  const publicKey = process.env.IMAGEKIT_PUBLIC_KEY;

  if (!publicKey) {
    return NextResponse.json(
      { error: "Image storage is not configured." },
      { status: 503 }
    );
  }

  try {
    const authenticationParameters =
      imagekit.helper.getAuthenticationParameters();

    return NextResponse.json({
      ...authenticationParameters,
      publicKey,
    });
  } catch {
    return NextResponse.json(
      { error: "Could not initialize image upload." },
      { status: 500 }
    );
  }
}