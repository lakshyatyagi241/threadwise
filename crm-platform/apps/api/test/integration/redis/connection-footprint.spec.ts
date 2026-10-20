import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QueueModule, BlockingWorker } from '../../../src/infra/queue/queue.module';
import { QUEUES } from '../../../src/infra/queue/queues';
import { RedisIoAdapter } from '../../../src/realtime/redis-io.adapter';
import { clientCount, record, sleep, startOwnRedis, type OwnRedis } from './own-redis';

/**
 * How many Redis connections one process holds, counted by the server (`connected_clients`), not by reading the code. Everything is
 * measured as a delta on a private Redis, so the numbers are exactly what the queue wiring opens.
 */
let redis: OwnRedis;

beforeAll(async () => {
  redis = await startOwnRedis(['--maxclients', '10000']);
}, 120_000);
afterAll(async () => {
  await redis.stop();
});

async function settle(probe: ReturnType<OwnRedis['client']>, expected?: number): Promise<number> {
  // connections are opened asynchronously; wait until the count stops moving
  let last = -1;
  for (let i = 0; i < 40; i++) {
    const n = await clientCount(probe);
    if (n === last && (expected === undefined || n >= expected)) return n;
    last = n;
    await sleep(150);
  }
  return last;
}

describe('connection footprint (counted by the server)', () => {
  it('queue producers: connections the API process opens for the registered queues', async () => {
    const probe = redis.client();
    const base = await settle(probe);
    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ REDIS_URL: redis.url })],
        }),
        QueueModule,
      ],
    }).compile();
    await mod.init();
    const queues = Object.values(QUEUES).map((n) => mod.get<Queue>(getQueueToken(n)));
    await Promise.all(queues.map((q) => q.waitUntilReady()));
    const after = await settle(probe, base + queues.length);
    const opened = after - base;
    record('connections', {
      queueCount: queues.length,
      producerConnections: opened,
      connectionsPerQueue: opened / queues.length,
    });
    // Documents the measured behaviour: one connection per registered queue. If this changes (a shared connection), update the
    // inventory and the report's number rather than loosening the bound.
    expect(opened).toBeGreaterThanOrEqual(queues.length);
    expect(opened).toBeLessThanOrEqual(queues.length * 2);
    await mod.close();
  }, 120_000);

  it('a worker adds its own connections on top of the producer handle', async () => {
    const probe = redis.client();
    const base = await settle(probe);
    const w = new BlockingWorker('conn-probe-67', async () => undefined, {
      connection: { host: redis.host, port: redis.port },
    });
    await w.waitUntilReady();
    const after = await settle(probe, base + 1);
    record('connectionsWorker', { perWorker: after - base });
    expect(after - base).toBeGreaterThanOrEqual(1);
    await w.close();
  }, 60_000);

  it('the socket.io adapter holds 2 (publisher + subscriber); the shared client holds 1', async () => {
    const probe = redis.client();
    const base = await settle(probe);
    const adapter = new RedisIoAdapter({} as never);
    await adapter.connectToRedis(redis.url);
    const after = await settle(probe, base + 2);
    record('connectionsAdapter', { adapter: after - base });
    expect(after - base).toBe(2);
  }, 60_000);
});
