import { Module, type OnModuleInit } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { BroadcastsModule } from '../broadcasts';
import { ChannelAdapterRegistry, ChatConversationsModule } from '../chat-conversations';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { WabaDiagnosticsController, WabaPlatformDiagnosticsController } from './waba-diagnostics.controller';
import { WabaDiagnosticsService } from './waba-diagnostics.service';
import { WabaExtrasController } from './waba-extras.controller';
import { WabaExtrasService } from './waba-extras.service';
import { WabaHealthDetailsService } from './waba-health-details.service';
import { WabaConfigService } from './waba-config.service';
import { WabaPlatformController } from './waba-platform.controller';
import { WabaConnectionsController } from './waba-connections.controller';
import { WabaConnectionsRepository } from './waba-connections.repository';
import { WabaConnectService } from './waba-connect.service';
import { WabaChannelAdapter } from './inbox/waba-channel.adapter';
import { WabaChannelSync } from './inbox/waba-channel-sync.service';
import { WabaInboxSink } from './inbox/waba-inbox.sink';
import { WABA_INBOUND_SINK } from './waba-inbound-sink';
import { WabaIngestService } from './waba-ingest.service';
import { WabaTemplateEvents } from './waba-template-events.service';
import { WabaWebhookController } from './waba-webhook.controller';
import { WabaWebhookService } from './waba-webhook.service';

/**
 * WhatsApp Business numbers (WABA): connect, keep wired, receive the webhook. Provider access (Meta Graph, Interakt) is the
 * global `WabaProvidersModule`; kernel services (audit, outbox, RBAC), the database, Redis and the queues are global too.
 *
 * Inbound messages and delivery reports the broadcasts did not claim go to the inbox (`WabaInboxSink`, bound to
 * `WABA_INBOUND_SINK`); each connected number is an inbox channel (`whatsapp_waba`).
 */
@Module({
  imports: [BroadcastsModule, PlatformSettingsModule, ChatConversationsModule],
  controllers: [
    WabaConnectionsController,
    WabaExtrasController,
    WabaDiagnosticsController,
    WabaPlatformDiagnosticsController,
    WabaWebhookController,
    WabaPlatformController,
  ],
  providers: [
    CryptoService,
    WabaConfigService,
    WabaHealthDetailsService,
    WabaConnectionsRepository,
    WabaConnectService,
    WabaExtrasService,
    WabaDiagnosticsService,
    WabaWebhookService,
    WabaIngestService,
    WabaTemplateEvents,
    WabaChannelAdapter,
    WabaChannelSync,
    WabaInboxSink,
    { provide: WABA_INBOUND_SINK, useExisting: WabaInboxSink },
  ],
  exports: [
    WabaConnectService,
    WabaConnectionsRepository,
    WabaIngestService,
    WabaChannelSync,
    WABA_INBOUND_SINK,
  ],
})
export class WabaModule implements OnModuleInit {
  constructor(
    private readonly channels: ChannelAdapterRegistry,
    private readonly adapter: WabaChannelAdapter,
  ) {}

  /** A connected WhatsApp number is an inbox channel (`whatsapp_waba`); the inbox finds its adapter through its registry. */
  onModuleInit(): void {
    this.channels.register(this.adapter);
  }
}
