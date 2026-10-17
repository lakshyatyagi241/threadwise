import { Module, type OnModuleInit } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { FACEBOOK_GRAPH } from '../../infra/providers/channel-facebook/facebook.port';
import { FacebookGraphClients } from '../../infra/providers/channel-facebook/facebook-graph.client';
import { NoInboundHooks, OpenFacebookPlanGate } from './_shims/open-gates';
import { SqlFacebookTemplates } from './_shims/sql-facebook-templates';
import { ChatInboxIngest } from './_shims/chat-inbox-ingest';
import {
  FACEBOOK_PLAN_GATE,
  FACEBOOK_TEMPLATES,
  INBOUND_HOOKS,
  INBOX_INGEST,
} from './_shims/tokens';
import { ChannelAdapterRegistry, ChatConversationsModule } from '../chat-conversations';
import { CrmModule } from '../crm';
import { BackfillService } from './backfill.service';
import { FacebookChannelAdapter } from './facebook-channel.adapter';
import { FbBroadcastSenderService } from './fb-broadcast-sender.service';
import { FbBroadcastsController } from './fb-broadcasts.controller';
import { FbBroadcastsRepository } from './fb-broadcasts.repository';
import { FbBroadcastsService } from './fb-broadcasts.service';
import { InboundService } from './inbound.service';
import { InsightsController } from './insights.controller';
import { InsightsRepository } from './insights.repository';
import { InsightsService } from './insights.service';
import { PagesController } from './pages.controller';
import { PagesRepository } from './pages.repository';
import { PagesService } from './pages.service';
import { PostsController } from './posts.controller';
import { PostsRepository } from './posts.repository';
import { PostsService } from './posts.service';
import { SenderService } from './sender.service';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';
import { FacebookPublicController } from './webhook.controller';
import { SendWindowModule } from '../compliance-center';
import { ContactConsentModule } from '../contact-consent';

/**
 * The Facebook Pages channel (FB). The shims below stand in for services other domains own; each is replaced by binding the real
 * one to the same token (see `_shims/tokens.ts`).
 */
@Module({
  imports: [ChatConversationsModule, CrmModule, SendWindowModule, ContactConsentModule],
  controllers: [
    PagesController,
    FbBroadcastsController,
    SetupController,
    PostsController,
    InsightsController,
    FacebookPublicController,
  ],
  providers: [
    CryptoService,
    PagesService,
    PagesRepository,
    InboundService,
    BackfillService,
    SenderService,
    FacebookChannelAdapter,
    FbBroadcastsService,
    FbBroadcastsRepository,
    FbBroadcastSenderService,
    SetupService,
    PostsService,
    PostsRepository,
    InsightsService,
    InsightsRepository,
    FacebookGraphClients,
    { provide: FACEBOOK_GRAPH, useExisting: FacebookGraphClients },
    { provide: FACEBOOK_PLAN_GATE, useClass: OpenFacebookPlanGate },
    ChatInboxIngest,
    { provide: INBOX_INGEST, useExisting: ChatInboxIngest },
    { provide: INBOUND_HOOKS, useClass: NoInboundHooks },
    { provide: FACEBOOK_TEMPLATES, useClass: SqlFacebookTemplates },
  ],
  exports: [
    PagesService,
    PagesRepository,
    BackfillService,
    SenderService,
    FbBroadcastSenderService,
    // The Meta app's settings (id, secret, Graph version): the Meta lead ads door reads them from the same place.
    FACEBOOK_GRAPH,
  ],
})
export class ChannelFacebookModule implements OnModuleInit {
  constructor(
    private readonly channels: ChannelAdapterRegistry,
    private readonly facebook: FacebookChannelAdapter,
  ) {}

  /** A connected Page is an inbox channel (kind `facebook`); the inbox finds its adapter through its registry. */
  onModuleInit(): void {
    this.channels.register(this.facebook);
  }
}
