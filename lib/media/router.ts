import { getB2AccountConfig } from "./config";
import { BackblazeB2MediaProvider } from "./providers/backblaze";
import type { MediaCategory, MediaStorageProvider } from "./types";

const providerCache = new Map<MediaCategory, MediaStorageProvider>();

export function getMediaStorage(category: MediaCategory): MediaStorageProvider {
  const cached = providerCache.get(category);
  if (cached) {
    return cached;
  }

  const config = getB2AccountConfig(category);
  const provider = new BackblazeB2MediaProvider(category, config);

  providerCache.set(category, provider);
  return provider;
}
