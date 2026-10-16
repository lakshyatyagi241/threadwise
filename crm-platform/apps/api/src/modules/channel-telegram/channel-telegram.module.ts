import { Module, type OnModuleInit } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { TELEGRAM_API } from '../../infra/providers/channel-telegram/telegram.port';
import { TelegramBotApiFactory } from '../../infra/providers/channel-telegram/telegram-bot-api.client';
import { NoInboundHooks, OpenTelegramPlanGate } from './_shims/open-gates';
import { StorageMediaStore } from './_shims/storage-media-store';
import { ChatInboxIngest } from './_shims/chat-inbox-ingest';
import { SqlTelegramTemplates } from './_shims/sql-telegram-templates';
import {
  INBOUND_HOOKS,
  INBOX_INGEST,
  MEDIA_STORE,
  TELEGRAM_PLAN_GATE,
  TELEGRAM_TEMPLATES,
} from './_shims/tokens';
import { ChannelAdapterRegistry, ChatConversationsModule } from '../chat-conversations';
import { CrmModule } from '../crm';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { BotsController } from './bots.controller';
import { BotsRepository } from './bots.repository';
import { BotsService } from './bots.service';
import { InboundService } from './inbound.service';
import { TelegramChannelAdapter } from './telegram-channel.adapter';
import { TelegramSenderService } from './telegram-sender.service';
import { TgBroadcastSenderService } from './tg-broadcast-sender.service';
import { TgBroadcastsController } from './tg-broadcasts.controller';
import { TgBroadcastsRepository } from './tg-broadcasts.repository';
import { TgBroadcastsService } from './tg-broadcasts.service';
import { WebhookController } from './webhook.controller';
import { SendWindowModule } from '../compliance-center';
import { ContactConsentModule } from '../contact-consent';

/**
 * The Telegram channel (TG). The shim below stands in for a service another domain owns; it is replaced by binding the real
 * one to the same token (see `_shims/tokens.ts`).
 */
@Module({
  imports: [
    ChatConversationsModule,
    CrmModule,
    PlatformSettingsModule,
    SendWindowModule,
    ContactConsentModule,
  ],
  controllers: [BotsController, TgBroadcastsController, WebhookController],
  providers: [
    CryptoService,
    BotsService,
    BotsRepository,
    InboundService,
    TelegramSenderService,
    TelegramChannelAdapter,
    TgBroadcastsService,
    TgBroadcastsRepository,
    TgBroadcastSenderService,
    TelegramBotApiFactory,
    { provide: TELEGRAM_API, useExisting: TelegramBotApiFactory },
    { provide: TELEGRAM_PLAN_GATE, useClass: OpenTelegramPlanGate },
    ChatInboxIngest,
    { provide: INBOX_INGEST, useExisting: ChatInboxIngest },
    { provide: MEDIA_STORE, useClass: StorageMediaStore },
    { provide: INBOUND_HOOKS, useClass: NoInboundHooks },
    { provide: TELEGRAM_TEMPLATES, useClass: SqlTelegramTemplates },
  ],
  exports: [BotsService, TelegramSenderService, TgBroadcastSenderService],
})
export class ChannelTelegramModule implements OnModuleInit {
  constructor(
    private readonly channels: ChannelAdapterRegistry,
    private readonly telegram: TelegramChannelAdapter,
  ) {}

  /** A bot is an inbox channel (kind `telegram`); this adapter replaces the skeleton that refused every send. */
  onModuleInit(): void {
    this.channels.register(this.telegram);
  }
}
