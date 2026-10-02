import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { TELEGRAM_API } from '../../infra/providers/channel-telegram/telegram.port';
import { TelegramBotApiFactory } from '../../infra/providers/channel-telegram/telegram-bot-api.client';
import { NoInboundHooks, NoMediaStore, OpenTelegramPlanGate } from './_shims/open-gates';
import { SqlInboxIngest } from './_shims/sql-inbox-ingest';
import { INBOUND_HOOKS, INBOX_INGEST, MEDIA_STORE, TELEGRAM_PLAN_GATE } from './_shims/tokens';
import { BotsController } from './bots.controller';
import { BotsRepository } from './bots.repository';
import { BotsService } from './bots.service';
import { InboundService } from './inbound.service';
import { WebhookController } from './webhook.controller';

/**
 * The Telegram channel (TG). The shim below stands in for a service another domain owns; it is replaced by binding the real
 * one to the same token (see `_shims/tokens.ts`).
 */
@Module({
  controllers: [BotsController, WebhookController],
  providers: [
    CryptoService,
    BotsService,
    BotsRepository,
    InboundService,
    TelegramBotApiFactory,
    { provide: TELEGRAM_API, useExisting: TelegramBotApiFactory },
    { provide: TELEGRAM_PLAN_GATE, useClass: OpenTelegramPlanGate },
    { provide: INBOX_INGEST, useClass: SqlInboxIngest },
    { provide: MEDIA_STORE, useClass: NoMediaStore },
    { provide: INBOUND_HOOKS, useClass: NoInboundHooks },
  ],
  exports: [BotsService],
})
export class ChannelTelegramModule {}
