import { Global, Module } from '@nestjs/common';
import { WABA_INBOUND_SINK_OVERRIDE } from '../whatsapp-cloud-api-waba/waba-inbound.port';
import { ChatConversationsModule } from './chat-conversations.module';
import { WabaInboxSink } from './waba-inbox-sink';

/**
 * Hands the WABA domain's inbound traffic to the inbox. The WABA module binds `WABA_INBOUND_SINK` to whatever provides
 * `WABA_INBOUND_SINK_OVERRIDE` (and to a logging default when nothing does); this module provides it, and is global so the WABA module
 * sees it without importing the inbox: the dependency points from the inbox to the WhatsApp domain, never back.
 *
 * Imported by `ChatConversationsWorkerModule` only: the sink runs in the webhook worker (`WabaIngestProcessor`), and the HTTP app, which
 * only authenticates and queues the delivery, never calls it.
 */
@Global()
@Module({
  imports: [ChatConversationsModule],
  providers: [WabaInboxSink, { provide: WABA_INBOUND_SINK_OVERRIDE, useExisting: WabaInboxSink }],
  exports: [WABA_INBOUND_SINK_OVERRIDE],
})
export class WabaInboxBindingModule {}
