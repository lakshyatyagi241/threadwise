import { Module } from '@nestjs/common';
import { FaqLogArchiveRepository } from './faq-log-archive.repository';
import { FaqRetentionService } from './faq-retention.service';
import { KbEmbedWorker } from './kb-embed.worker';
import { KnowledgeBaseModule } from './knowledge-base.module';

/** What only the worker runs: the embedding queue and the retention sweep of the archived FAQ match log. Imported ONLY by WorkersModule: an API pod that also embedded would multiply the load. */
@Module({
  imports: [KnowledgeBaseModule],
  providers: [KbEmbedWorker, FaqLogArchiveRepository, FaqRetentionService],
})
export class KnowledgeBaseWorkerModule {}
