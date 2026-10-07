import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { initSentry, installProcessHandlers } from './modules/platform-infrastructure';
import { WorkerModule } from './worker.module';

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
