import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ChatChannelProvidersModule } from '../../infra/providers/chat-conversations';
import { CrmModule } from '../crm';
import { LocalizationTranslationModule } from '../localization-translation';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { ChannelAdapterRegistry } from './channel-adapter.registry';
import { ChannelDispatcher } from './channel-dispatcher.service';
import { ChannelIngestPublisher } from './channel-ingest.publisher';
import { ChannelRegistryService } from './channel-registry.service';
import { ChannelVault } from './channel-vault';
import { ChannelWebhooksController } from './channel-webhooks.controller';
import { ChannelWebhooksService } from './channel-webhooks.service';
import { ChatRealtimePublisher } from './chat-realtime.publisher';
import { WabaGroupThreadTitleService } from './waba-group-thread-title.service';
import { ConversationLifecycleService } from './conversation-lifecycle.service';
import { CONVERSATIONS_FACADE } from './conversations.facade';
import { ConversationsRepository } from './conversations.repository';
import { ConversationsService } from './conversations.service';
import { EmailDeliveryService } from './email-delivery.service';
import { EmailMessageAccess } from './email-message-access.service';
import { ExternalChannelIngest } from './external-channel-ingest.service';
import { InboundMessageHooks } from './inbound-hooks';
import { InboundIngestService } from './inbound-ingest.service';
import { InboundTranslationListener } from './inbound-translation.listener';
import { MediaFetchPublisher } from './media-fetch.publisher';
import { MediaFetchService } from './media-fetch.service';
import { MessageDispatchService } from './message-dispatch.service';
import { MessageViewService } from './message-view.service';
import { MessagesRepository } from './messages.repository';
import { OutboundService } from './outbound.service';
import { DeliveryReporter } from './delivery-reporter';
import { ReceiptsService } from './receipts.service';
import { ChannelsController } from './channels.controller';
import { ChannelsFacade } from './channels.facade';
import { ChannelsRepository } from './channels.repository';
import { SimulatorController } from './simulator.controller';
import { SimulatorPolicy } from './simulator-policy.service';
import { SimulatorService } from './simulator.service';
import { WabaChannelLinkService } from './waba-channel-link.service';

/**
 * Chat conversations (CHAT): the conversation core. The channel registry, the channel port with its dispatcher, the dev simulator and
 * the public webhook door, and the message pipelines: inbound ingest, delivery receipts, outbound enqueue and dispatch. WhatsApp is not
 * received or connected here: its numbers, tokens and webhook belong to the WABA domain (`WabaModule`), and this module is a consumer of
 * it (`WabaChannelLinkService` keeps a channel per connected number; the inbound sink bound by `WabaInboxBindingModule` feeds the ingest
 * queue). The workers
 * that run the pipelines live in `ChatConversationsWorkerModule` (worker process only); this module holds everything the HTTP app and
 * the worker share, and binds `CONVERSATIONS_FACADE`.
 *
 * Kernel services (audit, outbox, RBAC), the database, Redis, the queues, the send guard, the realtime emitter and the chat media
 * door are global.
 */
@Module({
  imports: [ChatChannelProvidersModule, PlansCoreModule, CrmModule, LocalizationTranslationModule],
  controllers: [
    ChannelsController,
    SimulatorController,
    // Public: the signature is the authentication.
    ChannelWebhooksController,
  ],
  providers: [
    CryptoService,
    ChannelVault,
    ChannelsRepository,
    ChannelAdapterRegistry,
    SimulatorPolicy,
    ChannelRegistryService,
    ChannelIngestPublisher,
    ChannelDispatcher,
    ChannelWebhooksService,
    WabaChannelLinkService,
    WabaGroupThreadTitleService,
    SimulatorService,
    ChannelsFacade,
    ConversationsRepository,
    MessagesRepository,
    ConversationLifecycleService,
    ChatRealtimePublisher,
    MessageViewService,
    MediaFetchPublisher,
    InboundMessageHooks,
    InboundTranslationListener,
    InboundIngestService,
    ExternalChannelIngest,
    ReceiptsService,
    DeliveryReporter,
    OutboundService,
    MessageDispatchService,
    MediaFetchService,
    ConversationsService,
    EmailMessageAccess,
    EmailDeliveryService,
    { provide: CONVERSATIONS_FACADE, useExisting: ConversationsService },
  ],
  exports: [
    ChannelAdapterRegistry,
    ChannelsFacade,
    ChannelRegistryService,
    ChannelDispatcher,
    ChannelIngestPublisher,
    ExternalChannelIngest,
    CONVERSATIONS_FACADE,
    // The email module's door to a message's `meta.email` (attachment download): visibility-checked.
    EmailMessageAccess,
    // Where the email module reports a bounce of a sent mail (TW-MAIL-032).
    EmailDeliveryService,
    WabaChannelLinkService,
    WabaGroupThreadTitleService,
    // Where the flow runtime (and any later reader of inbound traffic) listens.
    InboundMessageHooks,
    // The pipelines the workers drive.
    InboundIngestService,
    ReceiptsService,
    OutboundService,
    MessageDispatchService,
    MediaFetchService,
    MediaFetchPublisher,
  ],
})
export class ChatConversationsModule {}
