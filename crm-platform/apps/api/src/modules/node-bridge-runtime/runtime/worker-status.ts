import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';

/** A worker that has not reported for this long is gone (it reports every pass, about every 30 s). */
export const WORKER_ALIVE_S = 90;

/**
 * Whether the device runtime is running and what it holds (WD-NODE-004). WaDesk's bridge answered `/health` over HTTP; the runtime
 * is now a worker with no HTTP surface, so each worker leaves a short-lived heartbeat in Redis and this reads them.
 */
@Injectable()
export class NodeWorkerStatus {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async read(): Promise<{ workers: number; devices: number }> {
    let workers = 0;
    let devices = 0;
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', 'wa:worker:*', 'COUNT', 100);
      cursor = next;
      if (keys.length === 0) continue;
      for (const raw of await this.redis.mget(...keys)) {
        if (!raw) continue;
        try {
          devices += Number((JSON.parse(raw) as { devices?: number }).devices ?? 0);
          workers++;
        } catch {
          /* a malformed beat counts as no worker */
        }
      }
    } while (cursor !== '0');
    return { workers, devices };
  }
}
