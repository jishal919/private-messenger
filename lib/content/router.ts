import type { ContentShard } from "./types";
import {
  getShardConfig,
  getShardConfigs,
} from "./registry";
import { TursoContentShard } from "./adapters/turso";

const shardCache = new Map<string, ContentShard>();

export function getContentShard(
  shardId: string
): ContentShard {
  const cached = shardCache.get(shardId);

  if (cached) {
    return cached;
  }

  const config = getShardConfig(shardId);

  let shard: ContentShard;

  switch (config.provider) {
    case "turso": {
      shard = new TursoContentShard({
        id: config.id,
        url: config.connection.url,
        authToken: config.connection.authToken,
      });

      break;
    }

    default:
      throw new Error(
        `Unsupported content provider: ${config.provider}`
      );
  }

  shardCache.set(shardId, shard);

  return shard;
}

export function getAvailableContentShards(): ContentShard[] {
  return getShardConfigs().map((config) =>
    getContentShard(config.id)
  );
}