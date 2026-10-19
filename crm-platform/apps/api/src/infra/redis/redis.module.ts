import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../../config/env.schema';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * How long a command may wait for its answer. `maxRetriesPerRequest` only bounds a connection that is visibly down; a connection that
 * is up but silent (a dropped route, a frozen host) raises no error at all, so without this a request that reads or writes a cache key
 * waits for ever. Nothing on this client blocks (BullMQ and the socket.io adapter have their own connections), so a deadline is safe.
 */
export const REDIS_COMMAND_TIMEOUT_MS = 2_000;

/**
 * One shared Redis connection for caching (RBAC grants, idempotency keys,
 * rate-limit counters).
 *
 * BullMQ and the socket.io adapter each open their OWN connections —
 * BullMQ blocks on BRPOPLPUSH and the pub/sub adapter puts its connection in
 * subscriber mode, and neither can share a client that also serves GETs.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Redis =>
        new Redis(config.get('REDIS_URL', { infer: true }), {
          maxRetriesPerRequest: 3,
          commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
          // The default back-off grows to 2 s a try, and `maxRetriesPerRequest` counts tries, so during a long outage every command waited
          // 3 x 2 s before failing. Capped, a command on a dead connection fails in about a second and a half at most.
          retryStrategy: (times: number) => Math.min(times * 50, 500),
          enableReadyCheck: true,
          lazyConnect: false,
        }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    // Individual clients are closed by Nest through the provider lifecycle;
    // this hook exists so a future connection pool has a home.
  }
}
