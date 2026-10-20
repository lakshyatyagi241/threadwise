import { Module } from '@nestjs/common';
import { KB_AI_PORT } from '../../infra/providers/knowledge-base/kb-ai.port';
import { FixtureKbAiAdapter } from '../../infra/providers/knowledge-base/fixture-kb-ai.adapter';
import { OpenRouterKbAiAdapter } from '../../infra/providers/knowledge-base/openrouter-kb-ai.adapter';
import { AiKeysUsageAdminModule } from '../ai-keys-usage-admin';
import { KbChunkRepository } from './kb-chunk.repository';
import { KbConfigService } from './kb-config.service';
import { KbEmbeddingService } from './kb-embedding.service';
import { KbIndexService } from './kb-index.service';
import { KbRetrievalService } from './kb-retrieval.service';

/**
 * The AI driver: OpenRouter, or the offline fixture for the automated tests and the browser run. The fixture is a stand-in for the
 * vendor and must never answer in production, so asking for it there is a boot failure, not a silent downgrade.
 */
export const kbAiProvider = {
  provide: KB_AI_PORT,
  useFactory: () => {
    if (process.env.KB_AI_DRIVER?.trim() === 'fixture') {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('KB_AI_DRIVER=fixture is not allowed in production');
      }
      return new FixtureKbAiAdapter();
    }
    return new OpenRouterKbAiAdapter();
  },
};

/**
 * The knowledge base search every AI agent reads through: passages of the agent's own entries, embedded and searched by meaning.
 * No controller: nothing about it is set by a workspace user. The worker-only piece (the embedding queue) is in
 * KnowledgeBaseWorkerModule. Registered in app.module.ts.
 */
@Module({
  imports: [AiKeysUsageAdminModule],
  providers: [
    kbAiProvider,
    KbConfigService,
    KbChunkRepository,
    KbEmbeddingService,
    KbIndexService,
    KbRetrievalService,
  ],
  exports: [
    KbConfigService,
    KbChunkRepository,
    KbEmbeddingService,
    KbIndexService,
    KbRetrievalService,
  ],
})
export class KnowledgeBaseModule {}
