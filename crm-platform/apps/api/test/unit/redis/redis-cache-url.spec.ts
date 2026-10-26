import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cacheRedisUrl } from '../../../src/infra/redis/redis.module';

/**
 * Release 160798ba4 failed on 26 Oct: its API slot never became healthy because the cache Redis client connected to localhost.
 * docker-compose passes `REDIS_CACHE_URL: ${REDIS_CACHE_URL:-}`, so an unset setting arrives as an EMPTY string. The schema turns '' into
 * undefined, but ConfigService falls back to the raw environment when the validated value is undefined, so '' reached the module and
 * `'' ?? REDIS_URL` kept the '' (ioredis then defaults to localhost:6379).
 */
const REDIS_URL = 'redis://redis:6379';
// Validated config as the schema leaves it: the REDIS_CACHE_URL key is absent.
const cfg = () => new ConfigService<never, true>({}) as never;

afterEach(() => vi.unstubAllEnvs());

describe('cacheRedisUrl: the cache Redis is separate only when REDIS_CACHE_URL really holds a URL', () => {
  it('an empty value (what docker-compose passes when it is unset) means "not set"', () => {
    vi.stubEnv('REDIS_CACHE_URL', '');
    expect(cacheRedisUrl(cfg())).toBeUndefined();
  });

  it('a whitespace-only value means "not set"', () => {
    vi.stubEnv('REDIS_CACHE_URL', '   ');
    expect(cacheRedisUrl(cfg())).toBeUndefined();
  });

  it('an unset variable means "not set"', () => {
    delete process.env.REDIS_CACHE_URL;
    expect(cacheRedisUrl(cfg())).toBeUndefined();
  });

  it('a real URL is used, trimmed', () => {
    vi.stubEnv('REDIS_CACHE_URL', '  redis://cache:6380  ');
    expect(cacheRedisUrl(cfg())).toBe('redis://cache:6380');
  });

  it('the fallback the module applies lands on REDIS_URL, never on an empty string', () => {
    vi.stubEnv('REDIS_CACHE_URL', '');
    expect(cacheRedisUrl(cfg()) ?? REDIS_URL).toBe(REDIS_URL);
  });
});
