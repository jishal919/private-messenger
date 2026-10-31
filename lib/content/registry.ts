import type { ContentProvider } from "./types";

export interface ContentShardConfig {
  id: string;
  provider: ContentProvider;

  /**
   * Provider-specific connection information.
   *
   * Secrets should come from environment variables,
   * not from the Core DB.
   */
  connection: Record<string, string>;

  enabled: boolean;
  priority: number;
}

function loadShardConfig(): ContentShardConfig[] {
  const raw = process.env.CONTENT_SHARDS_CONFIG;

  if (!raw) {
    throw new Error(
      "CONTENT_SHARDS_CONFIG is not configured"
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "CONTENT_SHARDS_CONFIG contains invalid JSON"
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      "CONTENT_SHARDS_CONFIG must be an array"
    );
  }

  return parsed as ContentShardConfig[];
}

export function getShardConfigs(): ContentShardConfig[] {
  return loadShardConfig().filter(
    (shard) => shard.enabled
  );
}

export function getShardConfig(
  id: string
): ContentShardConfig {
  const shard = getShardConfigs().find(
    (item) => item.id === id
  );

  if (!shard) {
    throw new Error(
      `Content shard "${id}" was not found`
    );
  }

  return shard;
}