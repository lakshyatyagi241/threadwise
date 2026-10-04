import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { stdSerializers } from 'pino';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { AppConfigModule } from './config/config.module';
import type { Env } from './config/env.schema';
import { CryptoService } from './common/crypto/crypto.service';
import { maskSecretUrl } from './common/logging/mask-secret-url';
import { ProblemExceptionFilter } from './common/filters/problem-exception.filter';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { RequestContextStore } from './common/context/request-context';
import { DbModule } from './infra/db/db.module';
import { RedisModule } from './infra/redis/redis.module';
import { QueueModule } from './infra/queue/queue.module';
import { ProvidersModule } from './infra/providers/providers.module';
import { KernelModule } from './kernel/kernel.module';
import { AuthModule } from './modules/auth/auth.module';
import { SendGuardModule } from './modules/auth/security/send-guard.module';
import { UploadPolicyService } from './modules/auth';
import { AccountGateGuard } from './modules/auth/guards/account-gate.guard';
import { ImpersonationGuard } from './modules/auth/guards/impersonation.guard';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './modules/auth/guards/permissions.guard';
import {
  LOG_REDACT_PATHS,
  PlatformInfrastructureModule,
  ThrottleGuard,
} from './modules/platform-infrastructure';
import { AdminModule } from './modules/admin';
import { RolesPermissionsModule } from './modules/roles-permissions';
import { BspBillingEngineModule } from './modules/bsp-billing-engine';
import { WalletMessageBillingModule } from './modules/wallet-message-billing';
import { AppointmentsBookingModule } from './modules/appointments-booking';
import { BroadcastsModule } from './modules/broadcasts';
import { CallingVoiceModule } from './modules/calling-voice';
import { CampaignsModule } from './modules/campaigns';
import { ChannelFacebookModule } from './modules/channel-facebook';
import { ChannelInstagramModule } from './modules/channel-instagram';
import { ShopifyWoocommerceModule } from './modules/shopify-woocommerce';
import { ChannelTelegramModule } from './modules/channel-telegram';
import { AiAgentsTrainingModule } from './modules/ai-agents-training';
import { AiKeysUsageAdminModule } from './modules/ai-keys-usage-admin';
import { NodeBridgeRuntimeModule, NodeCatalogBridgeModule } from './modules/node-bridge-runtime';
import { CatalogProductsModule } from './modules/catalog-products';
import { StorefrontBuilderModule } from './modules/storefront-builder';
import { StoreOrdersSalesModule } from './modules/store-orders-sales';
import { FlowRuntimeEngineModule } from './modules/flow-runtime-engine';
import { FlowBuilderEditorModule } from './modules/flow-builder-editor';
import { ScheduledQueueWarmerModule } from './modules/scheduled-queue-warmer';
import { ChatbotWidgetModule } from './modules/chatbot-widget';
import { CrmModule } from './modules/crm';
import { LocalizationTranslationModule } from './modules/localization-translation';
import { PlatformSupportDeskModule } from './modules/platform-support-desk';
import { DashboardsAnalyticsChartsModule } from './modules/dashboards-analytics-charts';
import { NotificationsModule } from './modules/notifications';
import { PlansModule } from './modules/plans-subscriptions-trials/plans.module';
import { TrialGateGuard } from './modules/plans-subscriptions-trials/trial-gate.guard';
import { PlanFeatureGuard } from './modules/plans-subscriptions-trials/plan-feature.guard';
import {
  MediaStorageService,
  PlatformSettingsModule,
} from './modules/platform-settings-branding-storage';
import { InstallUpdateLicensingModule } from './modules/install-update-licensing';
import { AddonsExtensionRegistryModule } from './modules/addons-extension-registry';
import { CmsModule } from './modules/marketing-site-cms';
import { AdminConsoleShellModule } from './modules/admin-console-shell';
import { PlatformPaymentGatewaysModule } from './modules/platform-payment-gateways';
import { CouponsCreditsReferralCurrencyModule } from './modules/coupons-credits-referral-currency';
import { TeamChatModule } from './modules/team-chat';
import { WebhookFanoutModule } from './modules/webhook-fanout';
import { OutboundWebhooksModule } from './modules/outbound-webhooks';
import { MessageTemplatesModule } from './modules/message-templates';
import { WabaModule } from './modules/whatsapp-cloud-api-waba';
import { WhatsappDevicesBaileysModule } from './modules/whatsapp-devices-baileys';
import { WhatsAppProviderAdminModule } from './modules/whatsapp-provider-admin';
import { ChatConversationsModule, MessageMediaAccessPolicy } from './modules/chat-conversations';
import { TeamInboxConversationsModule } from './modules/team-inbox-conversations';
import { TeamInboxRoutingSlaModule } from './modules/team-inbox-routing-sla';
import { WorkspacesTeamsTenancyModule } from './modules/workspaces-teams-tenancy';
import { WorkspaceImpersonationModule } from './modules/workspaces-teams-tenancy/workspace-impersonation.module';
import { LeadsModule } from './modules/leads';
import { FormsBuilderModule } from './modules/forms-builder';
import { MarketplaceModule } from './modules/marketplace';
import { ChromeExtensionSheetsAddonModule } from './modules/chrome-extension-sheets-addon';
import { PartnerModule } from './modules/partner/partner.module';
import { PublicApiModule } from './modules/public-api/public-api.module';
import { DeveloperRestApiV1Module } from './modules/developer-rest-api-v1';
import { ChatMediaModule } from './infra/providers/chat-conversations/media';
import { RealtimeModule } from './realtime/realtime.module';
import { HealthModule } from './health/health.module';

/**
 * The HTTP application.
 *
 * Order matters in two places:
 *   - JwtAuthGuard runs before PermissionsGuard, because you cannot check a
 *     user's grants before you know who they are.
 *   - RequestContextMiddleware runs before both, so guards write into a context
 *     that already exists.
 *
 * Background work is deliberately absent — see worker.ts.
 */
@Module({
  imports: [
    AppConfigModule,

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } }
              : undefined,
          genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
          // Every log line carries the tenant and actor, so a production
          // question ("what did org 42 do at 14:03") is a filter, not a grep.
          customProps: () => {
            const ctx = RequestContextStore.peek();
            return ctx
              ? {
                  requestId: ctx.requestId,
                  orgId: ctx.orgId || undefined,
                  actorType: ctx.actorType,
                  actorId: ctx.actorId ?? undefined,
                }
              : {};
          },
          serializers: {
            // A push portal's address carries its secret as the last path segment: never in a log line.
            req: (req: Parameters<typeof stdSerializers.req>[0]) => {
              const out = stdSerializers.req(req);
              return { ...out, url: maskSecretUrl(out.url) };
            },
          },
          // Every credential and signature header the API reads (WD-INFRA-028), not just the three that are always there.
          redact: {
            paths: LOG_REDACT_PATHS,
            remove: true,
          },
          autoLogging: {
            // Health probes fire every few seconds; logging them buries
            // everything that matters.
            ignore: (req) => req.url === '/health' || req.url === '/ready',
          },
        },
      }),
    }),

    // Infrastructure
    DbModule,
    RedisModule,
    QueueModule,
    ProvidersModule,

    // Platform
    KernelModule,
    AuthModule,
    PlatformInfrastructureModule,
    PlansModule,
    PlatformSettingsModule,
    LocalizationTranslationModule,
    InstallUpdateLicensingModule,
    AddonsExtensionRegistryModule,
    AiKeysUsageAdminModule,
    AiAgentsTrainingModule,
    NodeBridgeRuntimeModule,
    WhatsappDevicesBaileysModule,
    NodeCatalogBridgeModule,
    ScheduledQueueWarmerModule,
    FlowRuntimeEngineModule,
    FlowBuilderEditorModule,
    CmsModule,
    AdminConsoleShellModule,
    PlatformPaymentGatewaysModule,
    CouponsCreditsReferralCurrencyModule,
    BspBillingEngineModule,
    WalletMessageBillingModule,
    SendGuardModule,
    RealtimeModule,
    // The one door chat media goes through (store, link, the authenticated media route), over the platform's storage and upload policy.
    ChatMediaModule.register({
      imports: [PlatformSettingsModule],
      objectGateway: { useExisting: MediaStorageService },
      uploadValidator: { useExisting: UploadPolicyService },
      // A link stops working when the person may no longer see the conversation the file belongs to.
      accessPolicy: { useClass: MessageMediaAccessPolicy },
    }),
    HealthModule,

    // Apps
    AdminModule,
    RolesPermissionsModule,
    CrmModule,
    DashboardsAnalyticsChartsModule,
    AppointmentsBookingModule,
    NotificationsModule,
    BroadcastsModule,
    CampaignsModule,
    CallingVoiceModule,
    ChannelTelegramModule,
    ChannelFacebookModule,
    ChannelInstagramModule,
    ShopifyWoocommerceModule,
    CatalogProductsModule,
    StorefrontBuilderModule,
    StoreOrdersSalesModule,
    ChatbotWidgetModule,
    PartnerModule,
    PublicApiModule,
    DeveloperRestApiV1Module,
    PlatformSupportDeskModule,
    TeamChatModule,
    WebhookFanoutModule,
    OutboundWebhooksModule,
    WabaModule,
    WhatsAppProviderAdminModule,
    MessageTemplatesModule,
    ChatConversationsModule,
    TeamInboxConversationsModule,
    TeamInboxRoutingSlaModule,
    WorkspacesTeamsTenancyModule,
    WorkspaceImpersonationModule,
    LeadsModule,
    FormsBuilderModule,
    MarketplaceModule,
    ChromeExtensionSheetsAddonModule,
    // InboxModule, BroadcastModule, BillingModule, ExamsModule — see each
    // module's README for the intended shape.
  ],
  providers: [
    CryptoService,
    { provide: APP_FILTER, useClass: ProblemExceptionFilter },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // An operator acting as a workspace owner (WD-WSP-032/033): read-only sessions cannot write, nobody touches the owner's credentials.
    // Straight after authentication, so it sees the act-as context and runs before anything that reads or writes tenant data.
    { provide: APP_GUARD, useClass: ImpersonationGuard },
    // The request throttle (WD-INFRA-010): once the caller is known, before any guard that reads the database.
    { provide: APP_GUARD, useExisting: ThrottleGuard },
    // After authentication, before permissions: a gated account (suspended,
    // unverified under 'block', MFA or password change required) is refused
    // here with a code the web app maps to the right lock screen.
    { provide: APP_GUARD, useClass: AccountGateGuard },
    // The free-trial hard gate (WD-PLAN-015): a workspace whose trial ended gets 402 on every feature route until it picks a plan.
    // After the account gate so a locked account is reported as locked first.
    { provide: APP_GUARD, useExisting: TrialGateGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // Route-level plan gate (WD-PLAN-019): after permissions, so a request that is not allowed at all is refused for that first.
    { provide: APP_GUARD, useExisting: PlanFeatureGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [CryptoService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
