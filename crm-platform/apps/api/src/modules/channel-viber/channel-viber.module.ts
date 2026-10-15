import { Module, type OnModuleInit } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { VIBER_API } from '../../infra/providers/channel-viber/viber.port';
import { ViberBotApiFactory } from '../../infra/providers/channel-viber/viber-bot-api.client';
import { ChatInboxIngest } from './_shims/chat-inbox-ingest';
import { SqlViberTemplates } from './_shims/sql-viber-templates';
import { INBOX_INGEST, VIBER_TEMPLATES } from './_shims/tokens';
import { ChannelAdapterRegistry, ChatConversationsModule } from '../chat-conversations';
import { ChannelsController } from './channels.controller';
import { ChannelsRepository } from './channels.repository';
import { ChannelsService } from './channels.service';
import { InboundService } from './inbound.service';
import { InsightsController } from './insights.controller';
import { InsightsRepository } from './insights.repository';
import { InsightsService } from './insights.service';
import { ViberChannelAdapter } from './viber-channel.adapter';
import { ViberSenderService } from './viber-sender.service';
import { VibBroadcastSenderService } from './vib-broadcast-sender.service';
import { VibBroadcastsController } from './vib-broadcasts.controller';
import { VibBroadcastsRepository } from './vib-broadcasts.repository';
import { VibBroadcastsService } from './vib-broadcasts.service';
import { WebhookController } from './webhook.controller';

/**
 * The Viber channel (VIB). The shims below stand in for what another domain owns; each is replaced by binding the real service to the
 * same token (see `_shims/tokens.ts`).
 */
@Module({
  imports: [ChatConversationsModule],
  controllers: [ChannelsController, VibBroadcastsController, InsightsController, WebhookController],
  providers: [
    CryptoService,
    ChannelsService,
    ChannelsRepository,
    InboundService,
    ViberSenderService,
    ViberChannelAdapter,
    VibBroadcastsService,
    VibBroadcastsRepository,
    VibBroadcastSenderService,
    InsightsService,
    InsightsRepository,
    ViberBotApiFactory,
    { provide: VIBER_API, useExisting: ViberBotApiFactory },
    ChatInboxIngest,
    { provide: INBOX_INGEST, useExisting: ChatInboxIngest },
    { provide: VIBER_TEMPLATES, useClass: SqlViberTemplates },
  ],
  exports: [ChannelsService, ViberSenderService, VibBroadcastSenderService],
})
export class ChannelViberModule implements OnModuleInit {
  constructor(
    private readonly channels: ChannelAdapterRegistry,
    private readonly viber: ViberChannelAdapter,
  ) {}

  /** A Viber channel is an inbox channel (kind `viber`); a reply typed in the inbox leaves through this adapter. */
  onModuleInit(): void {
    this.channels.register(this.viber);
  }
}
