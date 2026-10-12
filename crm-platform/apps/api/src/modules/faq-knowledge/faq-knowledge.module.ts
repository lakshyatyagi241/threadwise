import { Module } from '@nestjs/common';
import { FAQ_AI_PORT } from '../../infra/providers/faq-knowledge/faq-ai.port';
import { FixtureFaqAiAdapter } from '../../infra/providers/faq-knowledge/fixture-faq-ai.adapter';
import { OpenRouterFaqAiAdapter } from '../../infra/providers/faq-knowledge/openrouter-faq-ai.adapter';
import { AiKeysUsageAdminModule } from '../ai-keys-usage-admin';
import { FaqPlatformController } from './faq-platform.controller';
import { FaqPlatformService } from './faq-platform.service';
import { FaqConfigService } from './faq-config.service';
import { FaqController } from './faq.controller';
import { FaqEmbeddingService } from './faq-embedding.service';
import { FaqGenerateService } from './faq-generate.service';
import { FaqInsightsService } from './faq-insights.service';
import { FaqLogRepository } from './faq-log.repository';
import { FaqFlowService } from './faq-flow.service';
import { FaqMatchService } from './faq-match.service';
import { FaqVerifyService } from './faq-verify.service';
import { FaqSettingsService } from './faq-settings.service';
import { FaqRepository } from './faq.repository';
import { FaqService } from './faq.service';

/**
 * The AI driver: OpenRouter, or the offline fixture for the automated tests and the browser run. The fixture is a stand-in for the
 * vendor and must never answer in production, so asking for it there is a boot failure, not a silent downgrade.
 */
export const faqAiProvider = {
  provide: FAQ_AI_PORT,
  useFactory: () => {
    if (process.env.FAQ_AI_DRIVER?.trim() === 'fixture') {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('FAQ_AI_DRIVER=fixture is not allowed in production');
      }
      return new FixtureFaqAiAdapter();
    }
    return new OpenRouterFaqAiAdapter();
  },
};

/**
 * FAQ knowledge base (ADR-0021): the management API, the matcher, the platform controls. The worker-only pieces (embedding queue,
 * inbound answering, log retention) are in FaqKnowledgeWorkerModule. Registered in app.module.ts.
 */
@Module({
  imports: [AiKeysUsageAdminModule],
  controllers: [FaqController, FaqPlatformController],
  providers: [
    faqAiProvider,
    FaqConfigService,
    FaqRepository,
    FaqLogRepository,
    FaqEmbeddingService,
    FaqSettingsService,
    FaqVerifyService,
    FaqMatchService,
    FaqFlowService,
    FaqService,
    FaqGenerateService,
    FaqInsightsService,
    FaqPlatformService,
  ],
  exports: [
    FaqConfigService,
    FaqRepository,
    FaqLogRepository,
    FaqEmbeddingService,
    FaqSettingsService,
    FaqMatchService,
    FaqFlowService,
  ],
})
export class FaqKnowledgeModule {}
