import {
  apiGetMediaUploadAuthorization,
  apiSendMediaMessage,
  generateClientId,
  type ApiMessage,
} from "./api";
import type { MediaCategory } from "@/lib/media/types";

export interface DirectUploadParams {
  conversationId: string;
  category: MediaCategory;
  file: File | Blob;
  filename: string;
  mimeType: string;
  originalSize?: number | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  caption?: string | null;
  clientId: string;
  replyToMessageId?: string | null;
  onProgress?: (percentage: number) => void;
  signal?: AbortSignal;
}

export async function uploadMediaDirectly(
  params: DirectUploadParams
): Promise<ApiMessage> {
  const {
    conversationId,
    category,
    file,
    filename,
    mimeType,
    originalSize,
    width,
    height,
    durationMs,
    caption,
    clientId,
    replyToMessageId,
    onProgress,
    signal,
  } = params;

  if (signal?.aborted) {
    throw new Error("Upload cancelled.");
  }

  // 1. Request temporary upload authorization from server
  const { authorization } = await apiGetMediaUploadAuthorization(
    conversationId,
    {
      category,
      filename,
      mimeType,
      fileSize: file.size,
    }
  );

  if (signal?.aborted) {
    throw new Error("Upload cancelled.");
  }

  // 2. Perform direct B2 upload using XMLHttpRequest to track progress
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", authorization.uploadUrl, true);

    // Set headers (e.g. Content-Type)
    if (authorization.headers) {
      for (const [headerKey, headerVal] of Object.entries(
        authorization.headers
      )) {
        xhr.setRequestHeader(headerKey, headerVal);
      }
    } else {
      xhr.setRequestHeader("Content-Type", mimeType);
    }

    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          const percent = Math.min(
            100,
            Math.round((event.loaded / event.total) * 100)
          );
          onProgress(percent);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (onProgress) onProgress(100);
        resolve();
      } else {
        console.error("Backblaze B2 upload failed with HTTP status:", xhr.status, xhr.responseText);
        reject(
          new Error(
            `Media upload to storage failed (HTTP ${xhr.status}). Check storage bucket CORS or network.`
          )
        );
      }
    };

    xhr.onerror = () => {
      reject(
        new Error(
          "Network error while uploading to storage. Please check your connection."
        )
      );
    };

    xhr.ontimeout = () => {
      reject(new Error("Upload timed out."));
    };

    if (signal) {
      signal.addEventListener("abort", () => {
        xhr.abort();
        reject(new Error("Upload cancelled."));
      });
    }

    xhr.send(file);
  });

  if (signal?.aborted) {
    throw new Error("Upload cancelled.");
  }

  // 3. Create message record in content shard
  const messageClientId = clientId || generateClientId();
  const { message } = await apiSendMediaMessage(conversationId, {
    type: category,
    mediaKey: authorization.key,
    mediaSize: file.size,
    mediaOriginalSize: originalSize || file.size,
    mediaMimeType: mimeType,
    mediaName: filename,
    mediaWidth: width ?? null,
    mediaHeight: height ?? null,
    durationMs: durationMs ?? null,
    content: caption ?? null,
    clientId: messageClientId,
    replyToMessageId,
  });

  return message;
}
