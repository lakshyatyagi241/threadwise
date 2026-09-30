import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { DEFAULT_JOB_OPTIONS, QUEUES } from './queues';

/**
 * BullMQ wiring.
 *
 * Registering the queues in the API process (not just the worker) is
 * deliberate: the API only ever *enqueues*. Processors are registered
 * separately and only when WORKER_MODE is on, so an HTTP pod never picks up a
 * job it should not be running.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const url = new URL(config.get('REDIS_URL', { infer: true }));
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            password: url.password || undefined,
            // BullMQ's blocking commands require this to be null; the default
            // of 20 makes long-blocking reads throw under load.
            maxRetriesPerRequest: null,
          },
          defaultJobOptions: DEFAULT_JOB_OPTIONS,
        };
      },
    }),
    BullModule.registerQueue(...Object.values(QUEUES).map((name) => ({ name }))),
  ],
  exports: [BullModule],
})
export class QueueModule {}
