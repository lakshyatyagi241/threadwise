import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { BroadcastsModule } from '../broadcasts';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { WhatsAppProviderRegistryModule } from '../whatsapp-provider-registry';
import { WabaHealthDetailsService } from './waba-health-details.service';
import { WabaConfigService } from './waba-config.service';
import { WabaPlatformController } from './waba-platform.controller';
import { WabaConnectionsController } from './waba-connections.controller';
import { WabaConnectionsRepository } from './waba-connections.repository';
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
@Module({
  imports: [BroadcastsModule, PlatformSettingsModule, WhatsAppProviderRegistryModule],
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
    {
      provide: WABA_INBOUND_SINK,
      inject: [{ token: WABA_INBOUND_SINK_OVERRIDE, optional: true }],
      useFactory: (override?: WabaInboundSink): WabaInboundSink =>
        override ?? new LoggingInboundSink(),
    },
  ],
  exports: [WabaConnectService, WabaConnectionsRepository, WabaIngestService, WABA_INBOUND_SINK],
})
export class WabaModule {}
