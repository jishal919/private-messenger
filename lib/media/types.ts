export type MediaCategory = "image" | "video" | "document";

export interface MediaUploadAuthorization {
  uploadUrl: string;
  key: string;
  method: "PUT";
  headers?: Record<string, string>;
  expiresIn: number;
  category: MediaCategory;
}

export interface MediaMetadata {
  key: string;
  provider: string;
  category: MediaCategory;
  mimeType: string;
  size: number;
  originalSize?: number | null;
  name: string;
  expiresAt: number;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  objectId?: string | null;
}

export interface MediaStorageProvider {
  readonly id: string;
  readonly category: MediaCategory;

  getUploadAuthorization(params: {
    conversationId: string;
    safeFilename: string;
    mimeType: string;
    fileSize: number;
  }): Promise<MediaUploadAuthorization>;

  getDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;

  delete(key: string): Promise<boolean>;

  exists(key: string): Promise<boolean>;
}
