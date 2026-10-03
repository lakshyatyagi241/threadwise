import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ChatChannelProvidersModule } from '../../infra/providers/chat-conversations';
import { CrmModule } from '../crm';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { ChannelAdapterRegistry } from './channel-adapter.registry';
import { ChannelDispatcher } from './channel-dispatcher.service';
import { ChannelIngestPublisher } from './channel-ingest.publisher';
import { ChannelRegistryService } from './channel-registry.service';
import { ChannelVault } from './channel-vault';
import { ChannelWebhooksController } from './channel-webhooks.controller';
import { ChannelWebhooksService } from './channel-webhooks.service';
import { ChatRealtimePublisher } from './chat-realtime.publisher';
import { ConversationLifecycleService } from './conversation-lifecycle.service';
import { CONVERSATIONS_FACADE } from './conversations.facade';
import { ConversationsRepository } from './conversations.repository';
import { ConversationsService } from './conversations.service';
import { InboundIngestService } from './inbound-ingest.service';
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

/**
 * Chat conversations (CHAT): the conversation core. The channel registry, the channel port with its dispatcher, the dev simulator and
 * the public webhook door, and the message pipelines: inbound ingest, delivery receipts, outbound enqueue and dispatch. The workers
 * that run the pipelines live in `ChatConversationsWorkerModule` (worker process only); this module holds everything the HTTP app and
 * the worker share, and binds `CONVERSATIONS_FACADE`.
 *
 * Kernel services (audit, outbox, RBAC), the database, Redis, the queues, the send guard, the realtime emitter and the chat media
 * door are global.
 */
@Module({
  imports: [ChatChannelProvidersModule, PlansCoreModule, CrmModule],
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
    SimulatorService,
    ChannelsFacade,
    ConversationsRepository,
    MessagesRepository,
    ConversationLifecycleService,
    ChatRealtimePublisher,
    MessageViewService,
    InboundIngestService,
    ReceiptsService,
    DeliveryReporter,
    OutboundService,
    MessageDispatchService,
    ConversationsService,
    { provide: CONVERSATIONS_FACADE, useExisting: ConversationsService },
  ],
  exports: [
    ChannelsFacade,
    ChannelRegistryService,
    ChannelDispatcher,
    ChannelIngestPublisher,
    CONVERSATIONS_FACADE,
    // The pipelines the workers drive.
    InboundIngestService,
    ReceiptsService,
    OutboundService,
    MessageDispatchService,
  ],
})
export class ChatConversationsModule {}
