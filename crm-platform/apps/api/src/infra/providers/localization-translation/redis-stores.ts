import type { Redis } from 'ioredis';
import type { BreakerStore } from './translation-driver.port';
import { CappedMap } from '../../../common/cache/capped-map';

export const TRANSLATION_CACHE = Symbol('TRANSLATION_CACHE');
export const TRANSLATION_BREAKER = Symbol('TRANSLATION_BREAKER');

export interface TranslationCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/**
 * Cache and breaker over Redis. Redis being down must never stop a message from being sent: every call degrades to
 * "no cache" / "breaker closed" instead of throwing.
 */
export class RedisTranslationStores implements TranslationCache, BreakerStore {
  constructor(private readonly redis: Redis) {}

  async get(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, value, 'EX', ttlSeconds);
    } catch {
      /* cache is best effort */
    }
  }

  async isOpen(key: string): Promise<boolean> {
    try {
      return (await this.redis.exists(key)) === 1;
    } catch {
      return false;
    }
  }

  async open(key: string, ttlSeconds: number): Promise<void> {
    await this.set(key, '1', ttlSeconds);
  }
}

/** In-process stores for tests and for running without Redis. */
export class MemoryTranslationStores implements TranslationCache, BreakerStore {
  private readonly data = new CappedMap<string, { value: string; expires: number }>(10000);

  async get(key: string): Promise<string | null> {
    const hit = this.data.get(key);
    if (!hit || hit.expires < Date.now()) return null;
    return hit.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.data.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  }

  async isOpen(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  async open(key: string, ttlSeconds: number): Promise<void> {
    await this.set(key, '1', ttlSeconds);
  }
}
