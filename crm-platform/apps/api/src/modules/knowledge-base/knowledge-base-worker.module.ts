import { Module } from '@nestjs/common';
import { KbEmbedWorker } from './kb-embed.worker';
import { KnowledgeBaseModule } from './knowledge-base.module';

/** What only the worker runs: the embedding queue. Imported ONLY by WorkersModule: an API pod that also embedded would multiply the load. */
@Module({
  imports: [KnowledgeBaseModule],
  providers: [KbEmbedWorker],
})
export class KnowledgeBaseWorkerModule {}
