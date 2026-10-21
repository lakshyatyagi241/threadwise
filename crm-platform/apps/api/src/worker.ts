import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import {
  initSentry,
  installProcessHandlers,
  startRuntimeMonitor,
} from './modules/platform-infrastructure';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  installProcessHandlers('worker');
  initSentry('worker');
  // Same loop, CPU, memory and GC metrics as the API; job duration and wait are fed by observeJob.
  startRuntimeMonitor('worker');

  // No HTTP listener at all — createApplicationContext, not create().
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });

  // bufferLogs holds every log line in memory until a logger is attached or the buffer is flushed. Nothing here attaches one,
  // and unlike NestFactory.create the application-context path does not flush on its own, so without this every Logger call in
  // the worker (outbox failures, dead-lettered events, processor warnings) was neither printed nor released.
  // Every Nest `Logger` call goes through pino (JSON, redaction, service field); without this they print as coloured text.
  app.useLogger(app.get(PinoLogger));
  app.flushLogs();

  // In-flight jobs need to finish before the process exits, or a deploy leaves
  // half-processed outbox rows stuck in 'processing'.
  app.enableShutdownHooks();

  new Logger('worker').log('worker started — outbox drain and partition maintenance active');
}

void bootstrap();
