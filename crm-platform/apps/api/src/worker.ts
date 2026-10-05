import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/config.module';
import type { Env } from './config/env.schema';
import { DbModule } from './infra/db/db.module';
import { RedisModule } from './infra/redis/redis.module';
import { QueueModule } from './infra/queue/queue.module';
import { ProvidersModule } from './infra/providers/providers.module';
import { KernelModule } from './kernel/kernel.module';
import { SendGuardModule } from './modules/auth';
import {
  initSentry,
  installProcessHandlers,
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
    ProvidersModule,
    SendGuardModule,
    KernelModule,
    // Publish-only realtime: jobs announce what they did; the API pods that hold the sockets deliver it.
    RealtimeEmitterModule,
    WorkersModule,
    // Says the worker is alive and how far behind the outbox is, for /ready and the container healthcheck (TW-INFRA-015).
    WorkerHeartbeatModule,
  ],
})
class WorkerModule {}

async function bootstrap(): Promise<void> {
  installProcessHandlers('worker');
  initSentry('worker');

  // No HTTP listener at all — createApplicationContext, not create().
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });

  // bufferLogs holds every log line in memory until a logger is attached or the buffer is flushed. Nothing here attaches one,
  // and unlike NestFactory.create the application-context path does not flush on its own, so without this every Logger call in
  // the worker (outbox failures, dead-lettered events, processor warnings) was neither printed nor released.
  app.flushLogs();

  // In-flight jobs need to finish before the process exits, or a deploy leaves
  // half-processed outbox rows stuck in 'processing'.
  app.enableShutdownHooks();

  new Logger('worker').log('worker started — outbox drain and partition maintenance active');
}

void bootstrap();
