import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthMaintenanceService, AuthModule, OtpTemplateRefreshService } from '../modules/auth';
import { BspBillingEngineWorkerModule } from '../modules/bsp-billing-engine';
import { WalletMessageBillingWorkerModule } from '../modules/wallet-message-billing';
import { AppointmentsBookingWorkerModule } from '../modules/appointments-booking';
import { BroadcastsWorkerModule } from '../modules/broadcasts';
import { CallingVoiceWorkerModule } from '../modules/calling-voice';
import { CatalogProductsWorkerModule } from '../modules/catalog-products';
import { StorefrontBuilderWorkerModule } from '../modules/storefront-builder';
import { StoreOrdersSalesWorkerModule } from '../modules/store-orders-sales';
import { ChatConversationsWorkerModule } from '../modules/chat-conversations';
import { TeamInboxRoutingSlaWorkerModule } from '../modules/team-inbox-routing-sla';
import { CampaignsWorkerModule } from '../modules/campaigns';
import { ChannelFacebookWorkerModule } from '../modules/channel-facebook';
import { ChannelInstagramWorkerModule } from '../modules/channel-instagram';
import { ShopifyWoocommerceWorkerModule } from '../modules/shopify-woocommerce';
import { ChannelEmailWorkerModule } from '../modules/channel-email';
import { ChannelSmsWorkerModule } from '../modules/channel-sms';
import { ChannelTelegramWorkerModule } from '../modules/channel-telegram';
import {
  ContactImportWorkerModule,
  InvoicingWorkerModule,
  SalesDocsWorkerModule,
  SegmentsWorkerModule,
  TasksWorkerModule,
} from '../modules/crm';
import { CouponsCreditsReferralCurrencyWorkerModule } from '../modules/coupons-credits-referral-currency';
import { PaygwWorkerModule } from '../modules/platform-payment-gateways';
import { PlatformSupportDeskWorkerModule } from '../modules/platform-support-desk';
import { PlansWorkerModule } from '../modules/plans-subscriptions-trials';
import { MessageTemplatesWorkerModule } from '../modules/message-templates';
import {
  NodeBridgeRuntimeWorkerModule,
  NodeCatalogBridgeModule,
} from '../modules/node-bridge-runtime';
import { NotificationsWorkerModule } from '../modules/notifications';
import { WebhookFanoutWorkerModule } from '../modules/webhook-fanout';
import { OutboundWebhooksWorkerModule } from '../modules/outbound-webhooks';
import { ApiLibraryWorkerModule } from '../modules/api-library';
import { FaqKnowledgeWorkerModule } from '../modules/faq-knowledge/faq-knowledge-worker.module';
import { LeadScoringWorkerModule } from '../modules/lead-scoring/lead-scoring-worker.module';
import { WabaWorkerModule } from '../modules/whatsapp-cloud-api-waba';
import { AiAgentsTrainingWorkerModule } from '../modules/ai-agents-training';
import { FlowBuilderEditorWorkerModule } from '../modules/flow-builder-editor';
import { FlowRuntimeEngineWorkerModule } from '../modules/flow-runtime-engine';
import { LeadsWorkerModule } from '../modules/leads';
import { FormsBuilderWorkerModule } from '../modules/forms-builder';
import { ScheduledQueueWarmerWorkerModule } from '../modules/scheduled-queue-warmer';
import { MarketplaceWorkerModule } from '../modules/marketplace';
import { WorkspacesTeamsTenancyWorkerModule } from '../modules/workspaces-teams-tenancy';
import { OutboxDrainService } from './outbox-drain.service';
import { PartitionMaintenanceService } from './partition-maintenance.service';

/**
 * Background work.
 *
 * Imported ONLY by the worker bootstrap (worker.ts), never by the HTTP app. An
 * API pod that also drained the outbox would compete with request handling for
 * the event loop, and every API pod added would multiply the polling load on
 * the database.
 *
 * Still to land here: campaign sender (throttled), billing roll-up, SLA sweep,
 * counter flush, bulk import/export.
 */
@Module({
  // AuthModule: the OTP template poll reuses the sender registry and the Meta template client.
  imports: [
    ScheduleModule.forRoot(),
    AuthModule,
    ContactImportWorkerModule,
    TasksWorkerModule,
    BspBillingEngineWorkerModule,
    WalletMessageBillingWorkerModule,
    SegmentsWorkerModule,
    SalesDocsWorkerModule,
    InvoicingWorkerModule,
    NotificationsWorkerModule,
    AppointmentsBookingWorkerModule,
    BroadcastsWorkerModule,
    PlansWorkerModule,
    PaygwWorkerModule,
    CouponsCreditsReferralCurrencyWorkerModule,
    WabaWorkerModule,
    WebhookFanoutWorkerModule,
    OutboundWebhooksWorkerModule,
    ApiLibraryWorkerModule,
    FaqKnowledgeWorkerModule,
    LeadScoringWorkerModule,
    CallingVoiceWorkerModule,
    CatalogProductsWorkerModule,
    StorefrontBuilderWorkerModule,
    StoreOrdersSalesWorkerModule,
    MessageTemplatesWorkerModule,
    ChatConversationsWorkerModule,
    TeamInboxRoutingSlaWorkerModule,
    CampaignsWorkerModule,
    ChannelTelegramWorkerModule,
    ChannelSmsWorkerModule,
    ChannelEmailWorkerModule,
    ChannelFacebookWorkerModule,
    ChannelInstagramWorkerModule,
    ShopifyWoocommerceWorkerModule,
    ScheduledQueueWarmerWorkerModule,
    FlowBuilderEditorWorkerModule,
    AiAgentsTrainingWorkerModule,
    FlowRuntimeEngineWorkerModule,
    NodeBridgeRuntimeWorkerModule,
    NodeCatalogBridgeModule,
    LeadsWorkerModule,
    FormsBuilderWorkerModule,
    MarketplaceWorkerModule,
    PlatformSupportDeskWorkerModule,
    WorkspacesTeamsTenancyWorkerModule,
  ],
  providers: [
    OutboxDrainService,
    PartitionMaintenanceService,
    AuthMaintenanceService,
    OtpTemplateRefreshService,
  ],
  exports: [
    OutboxDrainService,
    PartitionMaintenanceService,
    AuthMaintenanceService,
    OtpTemplateRefreshService,
  ],
})
export class WorkersModule {}
