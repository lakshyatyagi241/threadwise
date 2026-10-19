import { describe, expect, it, vi } from 'vitest';

const ctor = vi.hoisted(() => vi.fn());
vi.mock('bullmq', async (orig) => {
  const actual = await orig<typeof import('bullmq')>();
  return {
    ...actual,
    Worker: class {
      constructor(...args: unknown[]) {
        ctor(...args);
      }
    },
  };
});

import { BlockingWorker, PRODUCER_CONNECTION_OPTIONS, queueRedisOptions } from './queue.module';

describe('queue connections (RF-05)', () => {
  it('a worker built from a fail-fast queue connection gets maxRetriesPerRequest null back', () => {
    const connection = {
      ...queueRedisOptions('redis://:pw@h:6380/3'),
      ...PRODUCER_CONNECTION_OPTIONS,
    };
    new BlockingWorker('q', async () => undefined, { connection, concurrency: 4 });
    const opts = ctor.mock.calls[0][2];
    expect(opts.connection).toMatchObject({
      host: 'h',
      port: 6380,
      db: 3,
      maxRetriesPerRequest: null,
    });
    // A command deadline on a worker would cut its blocking read (BZPOPMIN waits longer than any deadline by design).
    expect(opts.connection.commandTimeout).toBeUndefined();
    expect(opts.concurrency).toBe(4);
  });

  it('producers fail fast', () => {
    expect(PRODUCER_CONNECTION_OPTIONS).toEqual({
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      commandTimeout: 2_000,
    });
  });

  it('rediss:// turns TLS on for the queue connection, redis:// leaves it off (E6)', () => {
    expect(queueRedisOptions('rediss://:pw@h:6380/3')).toMatchObject({ host: 'h', tls: {} });
    expect(queueRedisOptions('redis://:pw@h:6380/3')).not.toHaveProperty('tls');
  });
});
