import { Module } from '@nestjs/common';
import { KnowledgeBaseModule } from '../knowledge-base';
import { SourcesRepository } from './sources.repository';
import { SourceIngestConsumer } from './source-ingest.consumer';
import { TRAINING_URL_FETCHER } from '../../infra/providers/ai-agents-training/training-url-fetcher.port';
import { HttpTrainingUrlFetcher } from '../../infra/providers/ai-agents-training/http-training-url-fetcher.adapter';

/**
 * The outbox consumer that reads URL knowledge entries. Imported ONLY by WorkersModule (the worker process): a consumer registers
 * itself with the kernel's OutboxSubscriberRegistry, which the drain loop in that process fans events out to, and the HTTP app only
 * writes the events.
 */
@Module({
  imports: [KnowledgeBaseModule],
  providers: [
    SourcesRepository,
    SourceIngestConsumer,
    { provide: TRAINING_URL_FETCHER, useClass: HttpTrainingUrlFetcher },
  ],
})
export class AiAgentsTrainingWorkerModule {}
