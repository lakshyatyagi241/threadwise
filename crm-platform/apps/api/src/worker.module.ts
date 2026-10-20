import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/config.module';
import type { Env } from './config/env.schema';
import { DbModule } from './infra/db/db.module';
import { RedisModule } from './infra/redis/redis.module';
import { QueueModule } from './infra/queue/queue.module';
import { QueueGuardModule } from './infra/queue/queue-guard.module';
import { FAILURE_POLICIES } from './modules/failed-operations';
import { WorkerDrainModule } from './infra/queue/worker-drain.module';
import { ProvidersModule } from './infra/providers/providers.module';
import { KernelModule } from './kernel/kernel.module';
import { SendGuardModule } from './modules/auth';
import { ApiKeyAccessModule } from './modules/public-api/api-key-access.module';
import {
  JobMetricsModule,
  QueueDepthModule,
  RedisPressureModule,
  WorkerHeartbeatModule,
} from './modules/platform-infrastructure';
import { RealtimeEmitterModule } from './realtime';
import { WorkersModule } from './workers/workers.module';

/**
 * Background worker.
 *
 * Same repository, same image, different entrypoint — chosen over a separate
 * package so there is exactly one copy of the domain logic, and over
 * in-process workers so a campaign burst cannot starve HTTP latency.
 *
 * Deliberately excluded: controllers, guards, the HTTP server. This process
 * accepts no inbound traffic; its only inputs are the database and Redis.
 */
@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          autoLogging: false,
        },
      }),
    }),
    DbModule,
    RedisModule,
    QueueModule,
    // Trims finished-job history before a full Redis stops every queue.
    QueueGuardModule.forRoot({ capturedQueues: FAILURE_POLICIES.map((p) => p.queue) }),
    // Closes the workers (waiting for running jobs) before the database pools close.
    WorkerDrainModule,
    ProvidersModule,
    SendGuardModule,
    KernelModule,
    // Publish-only realtime: jobs announce what they did; the API pods that hold the sockets deliver it.
    RealtimeEmitterModule,
    // `ApiKeyGuard` is a provider of the flow runtime module the workers import (its controller serves the API process), and the guard
    // needs this service: without it the worker fails to boot ("can't resolve dependencies of the ApiKeyGuard").
    ApiKeyAccessModule,
    WorkersModule,
    // Says the worker is alive and how far behind the outbox is, for /ready and the container healthcheck (TW-INFRA-015).
    WorkerHeartbeatModule,
    // Job wait and duration per queue for every processor, from one hook (docs/performance/event-loop).
    JobMetricsModule,
    // Backlog and oldest waiting age per queue: the signals a saturated queue shows before any job finishes late.
    QueueDepthModule,
    // Redis memory/clients/evictions (crm_redis_*), and a pause for workers while Redis is at maxmemory instead of a hot error loop.
    RedisPressureModule,
  ],
})
export class WorkerModule {}
