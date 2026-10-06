import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { PlanCampaignGate } from './_shims/plan-gate';
import { PlatformCampaignSettings } from './_shims/platform-campaign-settings';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { BroadcastsModule } from '../broadcasts';
import { ChatConversationsModule } from '../chat-conversations';
import { WalletMessageBillingModule } from '../wallet-message-billing';
import { CrmModule } from '../crm';
import { NoFlowStarter } from './_shims/open-gates';
import {
  CAMPAIGN_BILLING,
  CAMPAIGN_FLOW_STARTER,
  CAMPAIGN_PLAN_GATE,
  CAMPAIGN_SETTINGS,
} from './_shims/tokens';
import { WalletCampaignBilling } from './_shims/wallet-billing';
import { CampaignAudienceService } from './audience.service';
import { CampaignCallbacksController } from './campaign-callbacks.controller';
import { CampaignCallbacksService } from './campaign-callbacks.service';
import { CampaignEvents } from './campaign-events';
import { CampaignMirrorService } from './campaign-mirror.service';
import { CampaignJobs } from './campaign-jobs';
import { CampaignReceiptsService } from './campaign-receipts.service';
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
  imports: [
    BroadcastsModule,
    ChatConversationsModule,
    CrmModule,
    PlansCoreModule,
    PlatformSettingsModule,
    WalletMessageBillingModule,
  ],
  controllers: [
    CampaignsController,
    CampaignsReadController,
    CampaignsActionsController,
    CampaignCallbacksController,
  ],
  providers: [
    CryptoService,
    CampaignsRepository,
    CampaignAudienceService,
    CampaignsService,
    CampaignsReadService,
    CampaignsActionsService,
    CampaignEvents,
    CampaignJobs,
    CampaignMirrorService,
    CampaignCallbacksService,
    CampaignReceiptsService,
    { provide: CAMPAIGN_PLAN_GATE, useClass: PlanCampaignGate },
    { provide: CAMPAIGN_BILLING, useClass: WalletCampaignBilling },
    { provide: CAMPAIGN_FLOW_STARTER, useClass: NoFlowStarter },
    { provide: CAMPAIGN_SETTINGS, useClass: PlatformCampaignSettings },
  ],
  // The worker module reuses this module's providers and the kits it was built from.
  exports: [
    CampaignsService,
    CampaignsReadService,
    CampaignsActionsService,
    BroadcastsModule,
    CrmModule,
    CryptoService,
    CampaignsRepository,
    CampaignEvents,
    CampaignJobs,
    CampaignMirrorService,
    CampaignReceiptsService,
    CAMPAIGN_PLAN_GATE,
    CAMPAIGN_BILLING,
    CAMPAIGN_FLOW_STARTER,
    CAMPAIGN_SETTINGS,
  ],
})
export class CampaignsModule {}
