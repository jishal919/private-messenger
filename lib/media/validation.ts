import {
  ALLOWED_DOCUMENT_EXTENSIONS,
  BLOCKED_EXTENSIONS,
  MAX_DOCUMENT_SIZE_MB,
  MAX_IMAGE_SIZE_MB,
  MAX_VIDEO_SIZE_MB,
} from "./config";
import type { MediaCategory } from "./types";

export function sanitizeFilename(filename: string): string {
  if (!filename) return "file";

  // Remove directory traversal, null bytes, backslashes, slashes, and control characters
  let clean = filename
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[/\\]+/g, "")
    .replace(/\.\.+/g, "")
    .trim();

  // Replace special characters with hyphens
  clean = clean.replace(/[^a-zA-Z0-9._-]/g, "_");

  if (!clean || clean === "." || clean.startsWith(".")) {
    clean = `file_${Date.now()}${clean.startsWith(".") ? clean : ""}`;
  }

  // Cap maximum filename length
  if (clean.length > 80) {
    const extIdx = clean.lastIndexOf(".");
    if (extIdx > 0 && clean.length - extIdx <= 10) {
      const ext = clean.slice(extIdx);
      clean = clean.slice(0, 80 - ext.length) + ext;
    } else {
      clean = clean.slice(0, 80);
    }
  }

  return clean;
}

export function getFileExtension(filename: string): string {
  const parts = filename.split(".");
  if (parts.length < 2) return "";
  return parts[parts.length - 1].toLowerCase();
}

export function validateMediaUploadRequest(params: {
  category: unknown;
  filename: unknown;
  mimeType: unknown;
  fileSize: unknown;
}): {
  category: MediaCategory;
  safeFilename: string;
  mimeType: string;
  fileSize: number;
} {
  const { category, filename, mimeType, fileSize } = params;

  if (category !== "image" && category !== "video" && category !== "document") {
    throw new Error("Invalid media category. Must be image, video, or document.");
  }

  if (typeof filename !== "string" || !filename.trim()) {
    throw new Error("Filename is required.");
  }

  if (typeof mimeType !== "string" || !mimeType.trim()) {
    throw new Error("MIME type is required.");
  }

  const size = Number(fileSize);
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error("Invalid file size.");
  }

  const safeFilename = sanitizeFilename(filename);
  const ext = getFileExtension(safeFilename);

  if (BLOCKED_EXTENSIONS.has(ext)) {
    throw new Error(`Executable file types like .${ext} are strictly prohibited.`);
  }

  // Validate size limits per category
  if (category === "image") {
    const maxBytes = MAX_IMAGE_SIZE_MB * 1024 * 1024;
    if (size > maxBytes) {
      throw new Error(`Image exceeds the maximum allowed size of ${MAX_IMAGE_SIZE_MB}MB.`);
    }
    if (!mimeType.toLowerCase().startsWith("image/")) {
      throw new Error("Invalid MIME type for image.");
    }
  } else if (category === "video") {
    const maxBytes = MAX_VIDEO_SIZE_MB * 1024 * 1024;
    if (size > maxBytes) {
      throw new Error(`Video exceeds the maximum allowed size of ${MAX_VIDEO_SIZE_MB}MB.`);
    }
    if (!mimeType.toLowerCase().startsWith("video/")) {
      throw new Error("Invalid MIME type for video.");
    }
  } else if (category === "document") {
    const maxBytes = MAX_DOCUMENT_SIZE_MB * 1024 * 1024;
    if (size > maxBytes) {
      throw new Error(`Document exceeds the maximum allowed size of ${MAX_DOCUMENT_SIZE_MB}MB.`);
    }

    if (!ALLOWED_DOCUMENT_EXTENSIONS.has(ext)) {
      throw new Error(
        `Unsupported document format .${ext}. Allowed formats: ${Array.from(
          ALLOWED_DOCUMENT_EXTENSIONS
        ).join(", ")}`
      );
    }
  }

  return {
    category,
    safeFilename,
    mimeType: mimeType.toLowerCase(),
    fileSize: size,
  };
}

export function generateStorageKey(
  category: MediaCategory,
  conversationId: string,
  safeFilename: string
): string {
  const uniqueId = crypto.randomUUID();
  return `media/${category}s/${conversationId}/${uniqueId}-${safeFilename}`;
}

export function parseStorageKey(key: string): {
  category: MediaCategory;
  conversationId: string;
} | null {
  const parts = key.split("/");
  // Expected: ["media", "images"|"videos"|"documents", conversationId, filename]
  if (parts.length < 4 || parts[0] !== "media") {
    return null;
  }

  let category: MediaCategory;
  if (parts[1] === "images") {
    category = "image";
  } else if (parts[1] === "videos") {
    category = "video";
  } else if (parts[1] === "documents") {
    category = "document";
  } else {
    return null;
  }

  const conversationId = parts[2];
  if (!conversationId) return null;

  return { category, conversationId };
}
