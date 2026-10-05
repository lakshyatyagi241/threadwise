import { Module, type OnModuleInit } from '@nestjs/common';
import { HttpInstagramBridgeFactory } from '../../infra/providers/channel-instagram/http-instagram-bridge.client';
import { INSTAGRAM_BRIDGE } from '../../infra/providers/channel-instagram/instagram-bridge.port';
import { AddonsExtensionRegistryModule } from '../addons-extension-registry';
import { ChannelAdapterRegistry, ChatConversationsModule } from '../chat-conversations';
import { NoInstagramAutomation, OpenInstagramPlanGate } from './_shims/open-gates';
import { ChatInstagramIngest } from './_shims/chat-instagram-ingest';
import { SqlInstagramTemplates } from './_shims/sql-instagram-templates';
import {
  INSTAGRAM_AUTOMATION,
  INSTAGRAM_INBOX_INGEST,
  INSTAGRAM_PLAN_GATE,
  INSTAGRAM_TEMPLATES,
} from './_shims/tokens';
import { AccountsController } from './accounts.controller';
import { AccountsRepository } from './accounts.repository';
import { AccountsService } from './accounts.service';
import { BroadcastsController } from './broadcasts.controller';
import { BroadcastsService } from './broadcasts.service';
import { FlowsController } from './flows.controller';
import { FlowsService } from './flows.service';
import { InboundService } from './inbound.service';
import { InstagramChannelAdapter } from './instagram-channel.adapter';
import { InstaflowPublicController } from './inbound.controller';
import { IngestService } from './ingest.service';
import { PullService } from './pull.service';
import { SenderService } from './sender.service';

/**
 * The Instagram channel (IG), through the engine bridge. The shims below stand in for services other domains own; each is replaced
 * by binding the real one to the same token (see `_shims/tokens.ts`).
 */
@Module({
  imports: [AddonsExtensionRegistryModule, ChatConversationsModule],
  controllers: [
    AccountsController,
    BroadcastsController,
    FlowsController,
    InstaflowPublicController,
  ],
  providers: [
    AccountsService,
    AccountsRepository,
    InboundService,
    IngestService,
    PullService,
    FlowsService,
    BroadcastsService,
    SenderService,
    InstagramChannelAdapter,
    HttpInstagramBridgeFactory,
    { provide: INSTAGRAM_BRIDGE, useExisting: HttpInstagramBridgeFactory },
    { provide: INSTAGRAM_PLAN_GATE, useClass: OpenInstagramPlanGate },
    ChatInstagramIngest,
    { provide: INSTAGRAM_INBOX_INGEST, useExisting: ChatInstagramIngest },
    { provide: INSTAGRAM_AUTOMATION, useClass: NoInstagramAutomation },
    { provide: INSTAGRAM_TEMPLATES, useClass: SqlInstagramTemplates },
  ],
  exports: [AccountsService, AccountsRepository, IngestService, PullService, SenderService],
})
export class ChannelInstagramModule implements OnModuleInit {
  constructor(
    private readonly channels: ChannelAdapterRegistry,
    private readonly instagram: InstagramChannelAdapter,
  ) {}

  /** A linked account is an inbox channel (kind `instagram`); the inbox finds its adapter through its registry. */
  onModuleInit(): void {
    this.channels.register(this.instagram);
  }
}
