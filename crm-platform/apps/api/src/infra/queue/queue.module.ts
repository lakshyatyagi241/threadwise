import { BullModule } from '@nestjs/bullmq';
import { Queue, Worker, type WorkerOptions } from 'bullmq';
import { REDIS_COMMAND_TIMEOUT_MS } from '../redis/redis.module';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { DEFAULT_JOB_OPTIONS, QUEUES, jobOptionsFor } from './queues';

/**
 * BullMQ wiring.
 *
 * Registering the queues in the API process (not just the worker) is
 * deliberate: the API only ever *enqueues*. Processors are registered
 * separately and only when WORKER_MODE is on, so an HTTP pod never picks up a
 * job it should not be running.
 */
/**
 * Workers wait out a Redis outage and reconnect: BullMQ's blocking commands require `maxRetriesPerRequest: null`.
 */
export const WORKER_CONNECTION_OPTIONS = {
  maxRetriesPerRequest: null,
  enableOfflineQueue: true,
  // Put back explicitly: a worker's blocking read waits longer than any command deadline by design, and the worker connection is built
  // from the producer's options, which carry one.
  commandTimeout: undefined,
} as const;

/**
 * The side that only enqueues (an HTTP request, a sweeper) must fail at once while Redis is down. With the worker setting a producer's
 * `queue.add` waits in the offline queue for the whole outage, so a request that promises "queue unreachable: answer 503 and let the
 * provider redeliver" never answers (RF-05).
 */
export const PRODUCER_CONNECTION_OPTIONS = {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  // The fail-fast setting above only helps when the connection is visibly down. Up but silent (a dropped route), a `queue.add` would
  // wait for ever; this ends it.
  commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
} as const;

/** How long a producer waits for its FIRST connection to Redis before `add` fails. */
export const PRODUCER_READY_TIMEOUT_MS = 3_000;

/**
 * BullMQ's `add` waits for the queue's first connection to be ready, and waits for ever: a process that started while Redis was down
 * (a restart during an outage) would hold every request that enqueues until Redis came back, whatever the connection options say. This
 * class bounds that wait. The wait itself carries on in the background, so the queue works as soon as Redis returns.
 */
export class BoundedQueue extends Queue {
  private async readyWithinDeadline(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.waitUntilReady(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Command timed out: the queue connection is not ready')),
            PRODUCER_READY_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  override async add(...args: Parameters<Queue['add']>): ReturnType<Queue['add']> {
    await this.readyWithinDeadline();
    return super.add(...args);
  }

  override async addBulk(...args: Parameters<Queue['addBulk']>): ReturnType<Queue['addBulk']> {
    await this.readyWithinDeadline();
    return super.addBulk(...args);
  }
}
BullModule.queueClass = BoundedQueue;

/**
 * @nestjs/bullmq builds each worker from the registered queue's options, so a fail-fast queue connection would reach the workers too.
 * Every worker the explorer creates goes through this class, which puts the worker setting back on the connection.
 */
export class BlockingWorker extends Worker {
  constructor(
    name: string,
    processor?: ConstructorParameters<typeof Worker>[1],
    opts?: WorkerOptions,
  ) {
    super(
      name,
      processor,
      opts?.connection && !('duplicate' in opts.connection)
        ? { ...opts, connection: { ...opts.connection, ...WORKER_CONNECTION_OPTIONS } }
        : opts,
    );
  }
}
BullModule.workerClass = BlockingWorker;

/** The Redis address of the queues, from `REDIS_URL` (BullMQ does not read the database index from a URL itself). */
export function queueRedisOptions(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    // The database index of REDIS_URL (`/14`): BullMQ does not read it from a URL, so every checkout on one Redis server shared
    // queue 0 and a worker could take another checkout's job.
    db: Number(url.pathname.replace('/', '')) || 0,
  };
}

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: {
          ...queueRedisOptions(config.get('REDIS_URL', { infer: true })),
          ...WORKER_CONNECTION_OPTIONS,
        },
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
    }),
    // A queue-level `defaultJobOptions` replaces the root one whole, so each queue gets the full set (jobOptionsFor spreads the defaults).
    // The queue handle is the producer side and fails fast; workers get the worker setting back in BlockingWorker.
    BullModule.registerQueueAsync(
      ...Object.values(QUEUES).map((name) => ({
        name,
        inject: [ConfigService],
        useFactory: (config: ConfigService<Env, true>) => ({
          defaultJobOptions: jobOptionsFor(name),
          connection: {
            ...queueRedisOptions(config.get('REDIS_URL', { infer: true })),
            ...PRODUCER_CONNECTION_OPTIONS,
          },
        }),
      })),
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
