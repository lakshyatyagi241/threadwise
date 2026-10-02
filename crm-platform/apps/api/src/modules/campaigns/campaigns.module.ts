import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { BroadcastsModule } from '../broadcasts';
import {
  DefaultCampaignSettings,
  NoFlowStarter,
  OpenCampaignBilling,
  OpenCampaignPlanGate,
} from './_shims/open-gates';
import {
  CAMPAIGN_BILLING,
  CAMPAIGN_FLOW_STARTER,
  CAMPAIGN_PLAN_GATE,
  CAMPAIGN_SETTINGS,
} from './_shims/tokens';
import { CampaignAudienceService } from './audience.service';
import { CampaignEvents } from './campaign-events';
import { CampaignJobs } from './campaign-jobs';
import { CampaignsActionsController } from './campaigns-actions.controller';
import { CampaignsActionsService } from './campaigns-actions.service';
import { CampaignsReadController } from './campaigns-read.controller';
import { CampaignsReadService } from './campaigns-read.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignsRepository } from './campaigns.repository';
import { CampaignsService } from './campaigns.service';

/**
 * WhatsApp campaigns (CAMP). The sending kit (senders, templates, pacing, link tracking) is broadcasts', reached through its
 * public surface. The shims below stand in for services other domains own; each is replaced by binding the real one to the
 * same token (see `_shims/tokens.ts`).
 */
@Module({
  imports: [BroadcastsModule],
  controllers: [CampaignsController, CampaignsReadController, CampaignsActionsController],
  providers: [
    CryptoService,
    CampaignsRepository,
    CampaignAudienceService,
    CampaignsService,
    CampaignsReadService,
    CampaignsActionsService,
    CampaignEvents,
    CampaignJobs,
    { provide: CAMPAIGN_PLAN_GATE, useClass: OpenCampaignPlanGate },
    { provide: CAMPAIGN_BILLING, useClass: OpenCampaignBilling },
    { provide: CAMPAIGN_FLOW_STARTER, useClass: NoFlowStarter },
    { provide: CAMPAIGN_SETTINGS, useClass: DefaultCampaignSettings },
  ],
  exports: [CampaignsRepository, CampaignEvents, CampaignJobs],
})
export class CampaignsModule {}
