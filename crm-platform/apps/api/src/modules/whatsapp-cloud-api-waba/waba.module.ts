import { forwardRef, Global, Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { BroadcastsModule } from '../broadcasts';
import { WebhookFanoutModule } from '../webhook-fanout';
import { CrmModule } from '../crm';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { WhatsAppProviderRegistryModule } from '../whatsapp-provider-registry';
import {
  WabaDiagnosticsController,
  WabaPlatformDiagnosticsController,
} from './waba-diagnostics.controller';
import { WabaDiagnosticsService } from './waba-diagnostics.service';
import { WabaExtrasController } from './waba-extras.controller';
import { WabaExtrasService } from './waba-extras.service';
import { WabaHealthDetailsService } from './waba-health-details.service';
import { WabaConfigService } from './waba-config.service';
import {
  WABA_CALLS_SINK,
  WABA_CALLS_SINK_OVERRIDE,
  LoggingCallsSink,
  type WabaCallsSink,
} from './waba-calls-sink';
import { WabaPlatformController } from './waba-platform.controller';
import { PinnacleOnboardingService } from './pinnacle-onboarding.service';
import { WabaConnectionsController } from './waba-connections.controller';
import { WabaConnectionsRepository } from './waba-connections.repository';
import { WABA_CONNECTIONS } from './waba-connections.port';
import { WabaConnectService } from './waba-connect.service';
import {
  WABA_INBOUND_SINK,
  WABA_INBOUND_SINK_OVERRIDE,
  LoggingInboundSink,
  type WabaInboundSink,
} from './waba-inbound-sink';
import { WabaIngestService } from './waba-ingest.service';
import { WabaReceiptRegistry } from './waba-receipt-registry';
import { WabaTemplateEvents } from './waba-template-events.service';
import { WabaGroupsController } from './waba-groups.controller';
import { WabaGroupsAdminService } from './waba-groups-admin.service';
import { WabaGroupsRepository } from './waba-groups.repository';
import { WabaGroupsService } from './waba-groups.service';
import { WabaOrdersService } from './waba-orders.service';
import { WabaClickSyncService } from './waba-click-sync.service';
import { CustomerProfilesController } from './customer-profiles.controller';
import { CustomerProfilesService } from './customer-profiles.service';
import { WabaWebhookController } from './waba-webhook.controller';
import { WabaWebhookService } from './waba-webhook.service';

/**
 * WhatsApp Business numbers (WABA): connect, keep wired, receive the webhook. Provider access (Meta Graph, Interakt) is the
 * global `WabaProvidersModule`; kernel services (audit, outbox, RBAC), the database, Redis and the queues are global too.
 *
 * The inbox takes inbound traffic through `WABA_INBOUND_SINK_OVERRIDE` (a global provider in the worker process: chat-conversations);
 * where nothing provides it, inbound messages are acknowledged and logged.
 */
/**
 * Global so the inbox can inject `WABA_CONNECTIONS` without importing this module: a static import here closes a file cycle (inbox, WABA,
 * broadcasts, node bridge) that leaves broadcast classes undefined when a spec enters through `broadcasts/send-safety`.
 */
@Global()
@Module({
  // forwardRef: the broadcasts barrel and this module import each other through node-bridge-runtime.
  imports: [
    forwardRef(() => BroadcastsModule),
    PlatformSettingsModule,
    WhatsAppProviderRegistryModule,
    CrmModule,
    WebhookFanoutModule,
  ],
  controllers: [
    WabaConnectionsController,
    WabaExtrasController,
    WabaGroupsController,
    WabaDiagnosticsController,
    WabaPlatformDiagnosticsController,
    WabaWebhookController,
    WabaPlatformController,
    CustomerProfilesController,
  ],
  providers: [
    CryptoService,
    WabaConfigService,
    WabaHealthDetailsService,
    WabaConnectionsRepository,
    WabaConnectService,
    PinnacleOnboardingService,
    WabaExtrasService,
    WabaDiagnosticsService,
    WabaWebhookService,
    WabaIngestService,
    WabaReceiptRegistry,
    WabaTemplateEvents,
    { provide: WABA_CONNECTIONS, useExisting: WabaConnectService },
    {
      provide: WABA_INBOUND_SINK,
      inject: [{ token: WABA_INBOUND_SINK_OVERRIDE, optional: true }],
      useFactory: (override?: WabaInboundSink): WabaInboundSink =>
        override ?? new LoggingInboundSink(),
    },
    {
      provide: WABA_CALLS_SINK,
      inject: [{ token: WABA_CALLS_SINK_OVERRIDE, optional: true }],
      useFactory: (override?: WabaCallsSink): WabaCallsSink => override ?? new LoggingCallsSink(),
    },
    WabaGroupsService,
    WabaGroupsRepository,
    WabaGroupsAdminService,
    WabaOrdersService,
    WabaClickSyncService,
    CustomerProfilesService,
  ],
  exports: [
    WabaConnectService,
    WabaConnectionsRepository,
    WabaIngestService,
    WabaReceiptRegistry,
    WabaWebhookService,
    WabaClickSyncService,
    WabaDiagnosticsService,
    WABA_INBOUND_SINK,
    WABA_CONNECTIONS,
  ],
})
export class WabaModule {}
