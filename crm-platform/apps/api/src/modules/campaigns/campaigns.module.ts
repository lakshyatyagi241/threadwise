import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CAMPAIGN_AI_IMAGE_PORT } from '../../infra/providers/campaigns/campaign-ai-image.port';
import { HttpCampaignAiImageAdapter } from '../../infra/providers/campaigns/http-campaign-ai-image.adapter';
import { AiKeysUsageAdminModule } from '../ai-keys-usage-admin';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { PlanCampaignGate } from './_shims/plan-gate';
import { PlatformCampaignSettings } from './_shims/platform-campaign-settings';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { BroadcastsModule } from '../broadcasts';
import { SendWindowModule } from '../compliance-center';
import { ContactConsentModule } from '../contact-consent';
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
import { CampaignAiController } from './campaign-ai.controller';
import { CampaignAiImageController } from './campaign-ai-image.controller';
import { CampaignAiImageService } from './campaign-ai-image.service';
import { CampaignAiService } from './campaign-ai.service';
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
import { FixtureRegistrar } from './fixture/fixture-registrar';
import { FixtureReceiptQueue } from './fixture/fixture-receipts';
import { WizardAudienceService } from './wizard/wizard-audience.service';
import { WizardBroadcastsService } from './wizard/wizard-broadcasts.service';
import { WizardContactsService } from './wizard/wizard-contacts.service';
import { WizardController } from './wizard/wizard.controller';
import { WizardCsvService } from './wizard/wizard-csv.service';
import { WizardDraftsService } from './wizard/wizard-drafts.service';
import { WizardLaunchService } from './wizard/wizard-launch.service';
import { WizardReadService } from './wizard/wizard-read.service';
import { WizardReviewService } from './wizard/wizard-review.service';
import { WizardRunService } from './wizard/wizard-run.service';
import { WizardTestSendService } from './wizard/wizard-test-send.service';
import { BroadcastSummaryController } from './summary/broadcast-summary.controller';
import { CampaignSummaryRepository } from './summary/campaign-summary.repository';
import { CampaignSummaryService } from './summary/campaign-summary.service';
import { WizardRepository } from './wizard/wizard.repository';

/**
 * WhatsApp campaigns (CAMP). The sending kit (senders, templates, pacing, link tracking) is broadcasts', reached through its
 * public surface. The shims below stand in for services other domains own; each is replaced by binding the real one to the
 * same token (see `_shims/tokens.ts`).
 */
@Module({
  imports: [
    SendWindowModule,
    AiKeysUsageAdminModule,
    BroadcastsModule,
    ContactConsentModule,
    ChatConversationsModule,
    CrmModule,
    PlansCoreModule,
    PlatformSettingsModule,
    WalletMessageBillingModule,
  ],
  controllers: [
    // The wizard's own route base, so nothing it serves can be shadowed by `campaigns/:id`.
    WizardController,
    CampaignAiController,
    CampaignAiImageController,
    CampaignsController,
    CampaignsReadController,
    BroadcastSummaryController,
    CampaignsActionsController,
    CampaignCallbacksController,
  ],
  providers: [
    CryptoService,
    CampaignsRepository,
    CampaignAudienceService,
    CampaignsService,
    CampaignsReadService,
    CampaignSummaryRepository,
    CampaignSummaryService,
    CampaignsActionsService,
    CampaignAiService,
    CampaignEvents,
    CampaignJobs,
    CampaignMirrorService,
    CampaignCallbacksService,
    CampaignReceiptsService,
    WizardRepository,
    WizardAudienceService,
    WizardCsvService,
    WizardContactsService,
    WizardReadService,
    WizardDraftsService,
    WizardReviewService,
    WizardRunService,
    WizardLaunchService,
    WizardTestSendService,
    WizardBroadcastsService,
    FixtureReceiptQueue,
    FixtureRegistrar,
    { provide: CAMPAIGN_AI_IMAGE_PORT, useClass: HttpCampaignAiImageAdapter },
    CampaignAiImageService,
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
    WizardRepository,
    WizardRunService,
    WizardTestSendService,
    WizardCsvService,
    CAMPAIGN_PLAN_GATE,
    CAMPAIGN_BILLING,
    CAMPAIGN_FLOW_STARTER,
    CAMPAIGN_SETTINGS,
  ],
})
export class CampaignsModule {}
