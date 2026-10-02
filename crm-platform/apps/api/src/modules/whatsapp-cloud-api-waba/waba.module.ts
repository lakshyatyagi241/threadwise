import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { BroadcastsModule } from '../broadcasts';
import { WabaConnectionsController } from './waba-connections.controller';
import { WabaConnectionsRepository } from './waba-connections.repository';
import { WabaConnectService } from './waba-connect.service';
import { WABA_INBOUND_SINK, LoggingInboundSink } from './waba-inbound-sink';
import { WabaIngestService } from './waba-ingest.service';
import { WabaTemplateEvents } from './waba-template-events.service';
import { WabaWebhookController } from './waba-webhook.controller';
import { WabaWebhookService } from './waba-webhook.service';

/**
 * WhatsApp Business numbers (WABA): connect, keep wired, receive the webhook. Provider access (Meta Graph, Interakt) is the
 * global `WabaProvidersModule`; kernel services (audit, outbox, RBAC), the database, Redis and the queues are global too.
 *
 * The inbox binds `WABA_INBOUND_SINK` (override the provider below) when it lands; until then inbound messages are
 * acknowledged and logged.
 */
@Module({
  imports: [BroadcastsModule],
  controllers: [WabaConnectionsController, WabaWebhookController],
  providers: [
    CryptoService,
    WabaConnectionsRepository,
    WabaConnectService,
    WabaWebhookService,
    WabaIngestService,
    WabaTemplateEvents,
    { provide: WABA_INBOUND_SINK, useClass: LoggingInboundSink },
  ],
  exports: [WabaConnectService, WabaConnectionsRepository, WabaIngestService, WABA_INBOUND_SINK],
})
export class WabaModule {}
