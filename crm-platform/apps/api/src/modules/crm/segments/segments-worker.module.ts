import { Module } from '@nestjs/common';
import { CrmModule } from '../crm.module';
import { SegmentActionsProcessor } from './segment-actions.processor';
import { SegmentCountSweepService } from './segment-count-sweep.service';

/**
 * The segment count sweep and the processor of the segment-actions queue. Imported ONLY by
 * WorkersModule (the worker process): an API pod that also swept would multiply the polling load,
 * and the HTTP app enqueues jobs but must never pick one up.
 */
@Module({
  imports: [CrmModule],
  providers: [SegmentCountSweepService, SegmentActionsProcessor],
})
export class SegmentsWorkerModule {}
