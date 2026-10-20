import { Module } from '@nestjs/common';
import { QueueGuardService } from './queue-guard.service';

/** Imported by the worker process only (worker.module.ts): one trimmer, not one per API pod. */
@Module({ providers: [QueueGuardService] })
export class QueueGuardModule {}
