import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ChatChannelProvidersModule } from '../../infra/providers/chat-conversations';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { ChannelAdapterRegistry } from './channel-adapter.registry';
import { ChannelDispatcher } from './channel-dispatcher.service';
import { ChannelIngestPublisher } from './channel-ingest.publisher';
import { ChannelRegistryService } from './channel-registry.service';
import { ChannelVault } from './channel-vault';
import { ChannelWebhooksController } from './channel-webhooks.controller';
import { ChannelWebhooksService } from './channel-webhooks.service';
import { ChannelsController } from './channels.controller';
import { ChannelsFacade } from './channels.facade';
import { ChannelsRepository } from './channels.repository';
import { SimulatorController } from './simulator.controller';
import { SimulatorPolicy } from './simulator-policy.service';
import { SimulatorService } from './simulator.service';

/**
 * Chat conversations (CHAT): the conversation core. This slice is the channel registry, the channel port with its dispatcher, the dev
 * simulator and the public webhook door; the message store, ingest and send pipelines build on it.
 *
 * Kernel services (audit, outbox, RBAC), the database, Redis, the queues and the send guard are global.
 */
@Module({
  imports: [ChatChannelProvidersModule, PlansCoreModule],
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
  ],
  exports: [ChannelsFacade, ChannelRegistryService, ChannelDispatcher, ChannelIngestPublisher],
})
export class ChatConversationsModule {}
