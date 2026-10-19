import { Module } from '@nestjs/common';
import { RollupService } from './rollup/rollup.service';
import { RollupWorker } from './rollup/rollup.worker';

/**
 * The analytics rollup (docs/superpowers/specs/2026-10-16-event-based-analytics-design.md, section 4.4). Imported ONLY by WorkersModule
 * (the worker process): it runs the 30 second pass and the nightly reconcile, which an API pod must not.
 */
@Module({
  providers: [RollupService, RollupWorker],
  exports: [RollupService],
})
export class AnalyticsWorkerModule {}
