import { Module } from '@nestjs/common';
import { LEAD_SCORING_AI_PORT } from '../../infra/providers/lead-scoring/lead-scoring-ai.port';
import { FixtureLeadScoringAiAdapter } from '../../infra/providers/lead-scoring/fixture-lead-scoring-ai.adapter';
import { OpenRouterLeadScoringAiAdapter } from '../../infra/providers/lead-scoring/openrouter-lead-scoring-ai.adapter';
import { AiKeysUsageAdminModule } from '../ai-keys-usage-admin';
import { CrmModule } from '../crm';
import { LeadChatDigestRepository } from './lead-chat-digest.repository';
import { LeadChatDigestService } from './lead-chat-digest.service';
import { LeadScoringPlatformController } from './lead-scoring-platform.controller';
import { LeadScoringPlatformService } from './lead-scoring-platform.service';
import { LeadScoringConfigService } from './lead-scoring-config.service';
import { LeadScoringController } from './lead-scoring.controller';
import { LeadScoringRepository } from './lead-scoring.repository';
import { LeadScoringService } from './lead-scoring.service';

/**
 * The AI driver: OpenRouter, or the offline fixture for the automated tests and the browser run. The fixture is a stand-in for the
 * vendor and must never answer in production, so asking for it there is a boot failure, not a silent downgrade.
 */
export const leadScoringAiProvider = {
  provide: LEAD_SCORING_AI_PORT,
  useFactory: () => {
    if (process.env.LEAD_SCORING_AI_DRIVER?.trim() === 'fixture') {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('LEAD_SCORING_AI_DRIVER=fixture is not allowed in production');
      }
      return new FixtureLeadScoringAiAdapter();
    }
    return new OpenRouterLeadScoringAiAdapter();
  },
};

/**
 * AI lead scoring (LSC): the workspace API, the operator controls, and the scorer. The worker-only pieces (queue processor, outbox
 * consumer, log retention) are in LeadScoringWorkerModule. Registered in app.module.ts.
 */
@Module({
  imports: [AiKeysUsageAdminModule, CrmModule],
  controllers: [LeadScoringController, LeadScoringPlatformController],
  providers: [
    leadScoringAiProvider,
    LeadScoringConfigService,
    LeadScoringRepository,
    LeadChatDigestRepository,
    LeadChatDigestService,
    LeadScoringService,
    LeadScoringPlatformService,
  ],
  exports: [
    LeadScoringService,
    LeadChatDigestService,
    LeadScoringConfigService,
    LeadScoringRepository,
  ],
})
export class LeadScoringModule {}
