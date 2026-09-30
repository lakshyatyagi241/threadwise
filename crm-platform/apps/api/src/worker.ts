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
    KernelModule,
    WorkersModule,
  ],
})
class WorkerModule {}

async function bootstrap(): Promise<void> {
  // No HTTP listener at all — createApplicationContext, not create().
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });

  // In-flight jobs need to finish before the process exits, or a deploy leaves
  // half-processed outbox rows stuck in 'processing'.
  app.enableShutdownHooks();

  new Logger('worker').log('worker started — outbox drain and partition maintenance active');
}

void bootstrap();
