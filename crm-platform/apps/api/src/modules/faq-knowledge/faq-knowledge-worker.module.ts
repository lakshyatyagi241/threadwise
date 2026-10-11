import { Module } from '@nestjs/common';
import { ChatConversationsModule } from '../chat-conversations';
import { FlowRuntimeEngineModule } from '../flow-runtime-engine';
import { FaqAnswerService } from './faq-answer.service';
import { FaqEmbedWorker } from './faq-embed.worker';
import { FaqInboundListener } from './faq-inbound.listener';
import { FaqKnowledgeModule } from './faq-knowledge.module';
import { FaqRetentionService } from './faq-retention.service';

/**
 * What only the worker runs: the embedding queue, the inbound listener that answers customers, and the log retention sweep.
 * Imported ONLY by WorkersModule: an API pod that also embedded or answered would multiply the load.
 */
@Module({
  imports: [FaqKnowledgeModule, ChatConversationsModule, FlowRuntimeEngineModule],
  providers: [FaqEmbedWorker, FaqRetentionService, FaqAnswerService, FaqInboundListener],
})
export class FaqKnowledgeWorkerModule {}
