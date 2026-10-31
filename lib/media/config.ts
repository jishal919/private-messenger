import type { MediaCategory } from "./types";

export interface B2AccountConfig {
  keyId: string;
  applicationKey: string;
  bucket: string;
  endpoint: string;
}

export const MEDIA_RETENTION_DAYS = Math.max(
  1,
  parseInt(process.env.MEDIA_RETENTION_DAYS || "30", 10) || 30
);

export const MAX_IMAGE_SIZE_MB = Math.max(
  1,
  parseInt(process.env.MAX_IMAGE_SIZE_MB || "20", 10) || 20
);

export const MAX_VIDEO_SIZE_MB = Math.max(
  1,
  parseInt(process.env.MAX_VIDEO_SIZE_MB || "100", 10) || 100
);

export const MAX_DOCUMENT_SIZE_MB = Math.max(
  1,
  parseInt(process.env.MAX_DOCUMENT_SIZE_MB || "25", 10) || 25
);

export const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "txt",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "zip",
  "csv",
  "rtf",
]);

export const BLOCKED_EXTENSIONS = new Set([
  "exe",
  "msi",
  "bat",
  "cmd",
  "scr",
  "com",
  "ps1",
  "sh",
  "vbs",
  "app",
  "dmg",
  "bin",
  "jar",
  "apk",
  "deb",
  "rpm",
  "iso",
  "dll",
  "sys",
]);

export function getB2AccountConfig(category: MediaCategory): B2AccountConfig {
  let keyId = "";
  let applicationKey = "";
  let bucket = "";
  let endpoint = "";

  switch (category) {
    case "image":
      keyId = process.env.B2_IMAGES_KEY_ID || "";
      applicationKey = process.env.B2_IMAGES_APPLICATION_KEY || "";
      bucket = process.env.B2_IMAGES_BUCKET || "";
      endpoint = process.env.B2_IMAGES_ENDPOINT || "";
      break;

    case "video":
      keyId = process.env.B2_VIDEOS_KEY_ID || "";
      applicationKey = process.env.B2_VIDEOS_APPLICATION_KEY || "";
      bucket = process.env.B2_VIDEOS_BUCKET || "";
      endpoint = process.env.B2_VIDEOS_ENDPOINT || "";
      break;

    case "document":
      keyId = process.env.B2_DOCUMENTS_KEY_ID || "";
      applicationKey = process.env.B2_DOCUMENTS_APPLICATION_KEY || "";
      bucket = process.env.B2_DOCUMENTS_BUCKET || "";
      endpoint = process.env.B2_DOCUMENTS_ENDPOINT || "";
      break;
  }

  if (!keyId || !applicationKey || !bucket || !endpoint) {
    throw new Error(
      `Backblaze B2 configuration is incomplete for media category "${category}". Please check your environment variables.`
    );
  }

  return {
    keyId,
    applicationKey,
    bucket,
    endpoint: endpoint.replace(/\/+$/, ""),
  };
}
