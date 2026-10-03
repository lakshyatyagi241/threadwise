import type { Redis } from 'ioredis';

/**
 * Remembers which media id Meta gave a file, per (workspace, channel, phone number, sha256, mime), so the same file is not uploaded
 * again for every send. Short lived on purpose (Meta keeps an id for 30 days; we trust it for hours): a stale id costs one failed
 * send that `forget` repairs, a long-lived one would cost many.
 *
 * A cache that is down never fails a send: a read error is a miss, a write error is ignored.
 */
export interface UploadedMediaCache {
  get(key: string): Promise<string | null>;
  set(key: string, mediaId: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

export const uploadCacheKey = (p: {
  orgId: number;
  channelUuid: string;
  phoneNumberId: string;
  sha256: string;
  mime: string;
}): string => `wa:media-id:${p.orgId}:${p.channelUuid}:${p.phoneNumberId}:${p.sha256}:${p.mime}`;

export class RedisUploadedMediaCache implements UploadedMediaCache {
  constructor(private readonly redis: Redis) {}

  async get(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, mediaId: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    try {
      await this.redis.set(key, mediaId, 'EX', ttlSeconds);
    } catch {
      // a cache that is down does not fail a send
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch {
      // see above
    }
  }
}

/** Process-local cache: the fallback when no Redis is bound, and the one the unit tests use. */
export class MemoryUploadedMediaCache implements UploadedMediaCache {
  private readonly entries = new Map<string, { id: string; until: number }>();

  get(key: string): Promise<string | null> {
    const hit = this.entries.get(key);
    if (!hit || hit.until < Date.now()) {
      this.entries.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(hit.id);
  }

  set(key: string, mediaId: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds > 0) this.entries.set(key, { id: mediaId, until: Date.now() + ttlSeconds * 1000 });
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }
}
