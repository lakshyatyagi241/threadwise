import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../../config/env.schema';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
/** The Redis that holds the BullMQ queues. The same connection as REDIS_CLIENT until REDIS_CACHE_URL separates them. */
export const REDIS_QUEUE_CLIENT = Symbol('REDIS_QUEUE_CLIENT');

/**
 * How long a command may wait for its answer. `maxRetriesPerRequest` only bounds a connection that is visibly down; a connection that
 * is up but silent (a dropped route, a frozen host) raises no error at all, so without this a request that reads or writes a cache key
 * waits for ever. Nothing on this client blocks (BullMQ and the socket.io adapter have their own connections), so a deadline is safe.
 */
export const REDIS_COMMAND_TIMEOUT_MS = 2_000;

/**
 * The cache Redis URL, or undefined when REDIS_CACHE_URL is unset OR empty. docker-compose passes `REDIS_CACHE_URL: ${REDIS_CACHE_URL:-}`, so
 * "unset" arrives as ''. The schema turns '' into undefined, but ConfigService falls back to the raw environment when the validated value is
 * undefined, so '' still reaches here; `??` keeps '' and ioredis then connects to localhost (release 160798ba4: the API never became healthy).
 */
export function cacheRedisUrl(config: ConfigService<Env, true>): string | undefined {
  const url = config.get('REDIS_CACHE_URL', { infer: true });
  return typeof url === 'string' && url.trim() !== '' ? url.trim() : undefined;
}

function connect(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: 3,
    commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
    // The default back-off grows to 2 s a try, and `maxRetriesPerRequest` counts tries, so during a long outage every command waited
    // 3 x 2 s before failing. Capped, a command on a dead connection fails in about a second and a half at most.
    retryStrategy: (times: number) => Math.min(times * 50, 500),
    enableReadyCheck: true,
    lazyConnect: false,
  });
}

/**
 * One shared Redis connection for caching (RBAC grants, idempotency keys,
 * rate-limit counters), on REDIS_CACHE_URL when that is set so a full cache cannot
 * fill the queue Redis; REDIS_QUEUE_CLIENT is the connection to the queue Redis.
 *
 * BullMQ and the socket.io adapter each open their OWN connections —
 * BullMQ blocks on BRPOPLPUSH and the pub/sub adapter puts its connection in
 * subscriber mode, and neither can share a client that also serves GETs.
 */
@Global()
@Module({
  providers: [
    // REDIS_CLIENT: the cache and state keys. REDIS_CACHE_URL when set, else REDIS_URL.
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Redis =>
        connect(cacheRedisUrl(config) ?? config.get('REDIS_URL', { infer: true })),
    },
    // REDIS_QUEUE_CLIENT: only for looking at the queue Redis itself (memory, trimming finished jobs). BullMQ opens its own connections.
    {
      provide: REDIS_QUEUE_CLIENT,
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: (config: ConfigService<Env, true>, shared: Redis): Redis => {
        const cache = cacheRedisUrl(config);
        const queue = config.get('REDIS_URL', { infer: true });
        return cache === undefined || cache === queue ? shared : connect(queue);
      },
    },
  ],
  exports: [REDIS_CLIENT, REDIS_QUEUE_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    // Individual clients are closed by Nest through the provider lifecycle;
    // this hook exists so a future connection pool has a home.
  }
}
