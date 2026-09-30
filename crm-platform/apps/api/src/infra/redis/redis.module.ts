import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../../config/env.schema';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

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
