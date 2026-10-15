import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
  type OnModuleInit,
} from '@nestjs/common';
import { text } from 'express';
import { CryptoService } from '../../common/crypto/crypto.service';
import { WECHAT_API } from '../../infra/providers/channel-wechat/wechat.port';
import { WechatApiClient } from '../../infra/providers/channel-wechat/wechat-api.client';
import { ChannelAdapterRegistry, ChatConversationsModule } from '../chat-conversations';
import { BroadcastSenderService } from './broadcast-sender.service';
import { BroadcastsController } from './broadcasts.controller';
import { BroadcastsRepository } from './broadcasts.repository';
import { BroadcastsService } from './broadcasts.service';
import { ChannelsController } from './channels.controller';
import { ChannelsRepository } from './channels.repository';
import { ChannelsService } from './channels.service';
import { ChatInboxIngest } from './chat-inbox-ingest';
import { InboundService } from './inbound.service';
import { WebhookController } from './webhook.controller';
import { WechatChannelAdapter } from './wechat-channel.adapter';
import { WechatTokenService } from './wechat-token.service';

/** WeChat sends `text/xml`: the Express body parsers of the API read JSON and forms only. A packet is a few kilobytes (64 KiB is far above any). */
const XML_BODY_LIMIT = '64kb';

/**
 * The WeChat Official Account channel (WECH): connect an account, receive its messages through the public webhook, answer from the inbox
 * through the channel adapter, and mass-send broadcasts.
 */
@Module({
  imports: [ChatConversationsModule],
  controllers: [ChannelsController, BroadcastsController, WebhookController],
  providers: [
    CryptoService,
    ChannelsRepository,
    ChannelsService,
    WechatTokenService,
    InboundService,
    ChatInboxIngest,
    WechatChannelAdapter,
    BroadcastsRepository,
    BroadcastsService,
    BroadcastSenderService,
    WechatApiClient,
    { provide: WECHAT_API, useExisting: WechatApiClient },
  ],
  exports: [ChannelsService, BroadcastSenderService],
})
export class ChannelWechatModule implements NestModule, OnModuleInit {
  constructor(
    private readonly channels: ChannelAdapterRegistry,
    private readonly wechat: WechatChannelAdapter,
  ) {}

  /** The XML body of the webhook is read as text (and kept raw) before the controller sees it. */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(
        text({
          type: () => true,
          limit: XML_BODY_LIMIT,
          verify: (req, _res, buf) => {
            (req as { rawBody?: Buffer }).rawBody = buf;
          },
        }),
      )
      .forRoutes(WebhookController);
  }

  /** An Official Account is an inbox channel (kind `wechat`); this adapter replaces the skeleton that refused every send. */
  onModuleInit(): void {
    this.channels.register(this.wechat);
  }
}
