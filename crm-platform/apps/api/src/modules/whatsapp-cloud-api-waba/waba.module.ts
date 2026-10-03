import { forwardRef, Global, Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { BroadcastsModule } from '../broadcasts';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { WhatsAppProviderRegistryModule } from '../whatsapp-provider-registry';
import { WabaHealthDetailsService } from './waba-health-details.service';
import { WabaConfigService } from './waba-config.service';
import {
  WABA_CALLS_SINK,
  WABA_CALLS_SINK_OVERRIDE,
  LoggingCallsSink,
  type WabaCallsSink,
} from './waba-calls-sink';
import { WabaPlatformController } from './waba-platform.controller';
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
import { WabaTemplateEvents } from './waba-template-events.service';
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
  ],
  controllers: [WabaConnectionsController, WabaWebhookController, WabaPlatformController],
  providers: [
    CryptoService,
    WabaConfigService,
    WabaHealthDetailsService,
    WabaConnectionsRepository,
    WabaConnectService,
    WabaWebhookService,
    WabaIngestService,
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
  ],
  exports: [
    WabaConnectService,
    WabaConnectionsRepository,
    WabaIngestService,
    WabaWebhookService,
    WABA_INBOUND_SINK,
    WABA_CONNECTIONS,
  ],
})
export class WabaModule {}
