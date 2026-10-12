import { Module } from '@nestjs/common';
import { LeadScoringConsumer } from './lead-scoring.consumer';
import { LeadScoringModule } from './lead-scoring.module';
import { LeadScoringProcessor } from './lead-scoring.processor';
import { LeadScoringRetentionService } from './lead-scoring-retention.service';

/**
 * What only the worker runs: the queue processor that calls the AI vendor, the outbox consumer that queues changed contacts, and the
 * log retention sweep. Imported ONLY by WorkersModule: an API pod that also scored would multiply the load.
 */
@Module({
  imports: [LeadScoringModule],
  providers: [LeadScoringProcessor, LeadScoringConsumer, LeadScoringRetentionService],
})
export class LeadScoringWorkerModule {}
