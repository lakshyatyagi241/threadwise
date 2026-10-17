import { Module, type OnModuleInit } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { LINE_API } from '../../infra/providers/channel-line/line.port';
import { LineApiFactoryImpl } from '../../infra/providers/channel-line/line-api.client';
import { ChannelAdapterRegistry, ChatConversationsModule } from '../chat-conversations';
import { ContactConsentModule } from '../contact-consent';
import { ChatInboxIngest } from './_shims/chat-inbox-ingest';
import { NoInboundHooks } from './_shims/open-gates';
import { SqlLineTemplates } from './_shims/sql-line-templates';
import { INBOUND_HOOKS, INBOX_INGEST, LINE_TEMPLATES } from './_shims/tokens';
import { ChannelsController } from './channels.controller';
import { ChannelsRepository } from './channels.repository';
import { ChannelsService } from './channels.service';
import { InboundService } from './inbound.service';
import { LineBroadcastSenderService } from './line-broadcast-sender.service';
import { LineBroadcastsController } from './line-broadcasts.controller';
import { LineBroadcastsRepository } from './line-broadcasts.repository';
import { LineBroadcastsService } from './line-broadcasts.service';
import { LineChannelAdapter } from './line-channel.adapter';
import { LineSenderService } from './line-sender.service';
import { LineTokenService } from './line-token.service';
import { ReplyTokensRepository } from './reply-tokens.repository';
import { WebhookController } from './webhook.controller';
import { SendWindowModule } from '../compliance-center';

/**
 * The LINE channel. The shims stand in for what another domain owns (the flow runtime and automation hooks, the template lookup); each
 * is replaced by binding the real one to the same token (see `_shims/tokens.ts`).
 */
@Module({
  imports: [ChatConversationsModule, ContactConsentModule, SendWindowModule],
  controllers: [ChannelsController, LineBroadcastsController, WebhookController],
  providers: [
    CryptoService,
    ChannelsService,
    ChannelsRepository,
    InboundService,
    LineSenderService,
    LineChannelAdapter,
    LineTokenService,
    ReplyTokensRepository,
    LineBroadcastsService,
    LineBroadcastsRepository,
    LineBroadcastSenderService,
    LineApiFactoryImpl,
    { provide: LINE_API, useExisting: LineApiFactoryImpl },
    ChatInboxIngest,
    { provide: INBOX_INGEST, useExisting: ChatInboxIngest },
    { provide: INBOUND_HOOKS, useClass: NoInboundHooks },
    { provide: LINE_TEMPLATES, useClass: SqlLineTemplates },
  ],
  exports: [ChannelsService, LineSenderService, LineBroadcastSenderService],
})
export class ChannelLineModule implements OnModuleInit {
  constructor(
    private readonly channels: ChannelAdapterRegistry,
    private readonly line: LineChannelAdapter,
  ) {}

  /** A LINE channel is an inbox channel (kind `line`); this binds the adapter that sends a reply typed in the inbox. */
  onModuleInit(): void {
    this.channels.register(this.line);
  }
}
