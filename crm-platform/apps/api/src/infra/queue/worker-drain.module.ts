import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { WorkerDrainService } from './worker-drain.service';

/** Imported by the worker process only (worker.module.ts): the HTTP app runs no processor. */
@Module({ imports: [DiscoveryModule], providers: [WorkerDrainService] })
export class WorkerDrainModule {}
