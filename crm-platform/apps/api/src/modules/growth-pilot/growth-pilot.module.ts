import { Module } from '@nestjs/common';
import {
  ApolloEnrichmentAdapter,
  FixtureEnrichmentAdapter,
  NoEnrichmentAdapter,
} from '../../infra/providers/growth-enrichment/growth-enrichment.adapters';
import { GROWTH_ENRICHMENT_PORT } from '../../infra/providers/growth-enrichment/growth-enrichment.port';
import { AiKeysUsageAdminModule } from '../ai-keys-usage-admin';
import { CampaignsModule } from '../campaigns';
import { ContactConsentModule } from '../contact-consent';
import { CrmModule } from '../crm';
import { LeadScoringModule } from '../lead-scoring';
import { NotificationsModule } from '../notifications';
import { TeamInboxConversationsModule } from '../team-inbox-conversations';
import { TeamInboxRoutingSlaModule } from '../team-inbox-routing-sla';
import { GrowthActionsService } from './growth-actions.service';
import { GrowthAssistantService } from './growth-assistant.service';
import { GrowthAutomationService } from './growth-automation.service';
import { GrowthDigestListener } from './growth-digest.listener';
import { GrowthGateService } from './growth-gate.service';
import { GrowthController } from './growth.controller';
import { GrowthRepository } from './growth.repository';
import { GrowthService } from './growth.service';

/**
 * The enrichment driver: none (the default: the switch has no effect), a real provider with its key, or the offline fixture for the
 * automated tests. The fixture stands in for a vendor and must never answer in production, so asking for it there is a boot failure.
 */
export const growthEnrichmentProvider = {
  provide: GROWTH_ENRICHMENT_PORT,
  useFactory: () => {
    const driver = process.env.GROWTH_ENRICHMENT_DRIVER?.trim();
    if (driver === 'fixture') {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('GROWTH_ENRICHMENT_DRIVER=fixture is not allowed in production');
      }
      return new FixtureEnrichmentAdapter();
    }
    const key = process.env.GROWTH_ENRICHMENT_API_KEY?.trim() ?? '';
    if (driver === 'apollo' && key !== '') return new ApolloEnrichmentAdapter(key);
    return new NoEnrichmentAdapter();
  },
};

/**
 * The growth pilot: what lead scoring knows, turned into things a team can act on. Offered to the pilot workspaces only: the gate in
 * `GrowthGateService` is the first line of every route, listener and sweeper. The worker-only pieces (sweepers, the handover consumer)
 * are in GrowthPilotWorkerModule. Registered in app.module.ts.
 */
@Module({
  imports: [
    AiKeysUsageAdminModule,
    CampaignsModule,
    ContactConsentModule,
    CrmModule,
    LeadScoringModule,
    NotificationsModule,
    TeamInboxConversationsModule,
    TeamInboxRoutingSlaModule,
  ],
  controllers: [GrowthController],
  providers: [
    growthEnrichmentProvider,
    GrowthRepository,
    GrowthGateService,
    GrowthService,
    GrowthActionsService,
    GrowthAssistantService,
    GrowthAutomationService,
    // Registers itself with lead scoring at start-up, in the API (the Read chat button) and in the worker (the idle sweeper).
    GrowthDigestListener,
  ],
  exports: [
    GrowthRepository,
    GrowthGateService,
    GrowthService,
    GrowthAutomationService,
    GrowthActionsService,
  ],
})
export class GrowthPilotModule {}
