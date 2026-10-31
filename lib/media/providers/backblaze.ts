import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { B2AccountConfig } from "../config";
import type {
  MediaCategory,
  MediaStorageProvider,
  MediaUploadAuthorization,
} from "../types";
import { generateStorageKey } from "../validation";

function extractRegionFromEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    // e.g. s3.us-west-004.backblazeb2.com -> us-west-004
    const hostParts = url.hostname.split(".");
    if (hostParts.length >= 3 && hostParts[0] === "s3") {
      return hostParts[1];
    }
  } catch {
    // fallback
  }
  return "us-east-005";
}

export class BackblazeB2MediaProvider implements MediaStorageProvider {
  readonly id = "backblaze";
  readonly category: MediaCategory;
  private readonly bucket: string;
  private readonly s3: S3Client;

  constructor(category: MediaCategory, config: B2AccountConfig) {
    this.category = category;
    this.bucket = config.bucket;

    const region = extractRegionFromEndpoint(config.endpoint);

    this.s3 = new S3Client({
      endpoint: config.endpoint,
      region,
      credentials: {
        accessKeyId: config.keyId,
        secretAccessKey: config.applicationKey,
      },
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async getUploadAuthorization(params: {
    conversationId: string;
    safeFilename: string;
    mimeType: string;
    fileSize: number;
  }): Promise<MediaUploadAuthorization> {
    const key = generateStorageKey(
      this.category,
      params.conversationId,
      params.safeFilename
    );

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: params.mimeType,
    });

    const expiresIn = 900; // 15 minutes
    const uploadUrl = await getSignedUrl(this.s3, command, {
      expiresIn,
      signableHeaders: new Set(["host"]),
    });

    return {
      uploadUrl,
      key,
      method: "PUT",
      headers: {
        "Content-Type": params.mimeType,
      },
      expiresIn,
      category: this.category,
    };
  }

  async getDownloadUrl(
    key: string,
    expiresInSeconds: number = 3600
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return await getSignedUrl(this.s3, command, {
      expiresIn: expiresInSeconds,
    });
  }

  async delete(key: string): Promise<boolean> {
    try {
      await this.s3.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      return true;
    } catch (err: unknown) {
      const code =
        typeof err === "object" && err !== null && "name" in err
          ? String((err as { name?: unknown }).name)
          : "";
      const status =
        typeof err === "object" && err !== null && "$metadata" in err
          ? (err as { $metadata?: { httpStatusCode?: number } }).$metadata
              ?.httpStatusCode
          : undefined;

      // Tolerate object already deleted or missing
      if (
        code === "NoSuchKey" ||
        code === "NotFound" ||
        status === 404
      ) {
        return true;
      }

      console.error(`Backblaze B2 deletion error for key ${key}:`, err);
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      return true;
    } catch (err: unknown) {
      const code =
        typeof err === "object" && err !== null && "name" in err
          ? String((err as { name?: unknown }).name)
          : "";
      const status =
        typeof err === "object" && err !== null && "$metadata" in err
          ? (err as { $metadata?: { httpStatusCode?: number } }).$metadata
              ?.httpStatusCode
          : undefined;

      if (
        code === "NoSuchKey" ||
        code === "NotFound" ||
        status === 404
      ) {
        return false;
      }
      throw err;
    }
  }
}
