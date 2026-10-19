import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { FailedOperationsModule } from './failed-operations.module';
import { FailureCaptureService } from './failure-capture.service';

/** Records every operation that fails for good, and sweeps. Imported ONLY by the worker: the HTTP app never runs a processor. */
@Module({ imports: [DiscoveryModule, FailedOperationsModule], providers: [FailureCaptureService] })
export class FailedOperationsWorkerModule {}
