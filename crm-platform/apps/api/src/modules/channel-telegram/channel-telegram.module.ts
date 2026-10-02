import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { TELEGRAM_API } from '../../infra/providers/channel-telegram/telegram.port';
import { TelegramBotApiFactory } from '../../infra/providers/channel-telegram/telegram-bot-api.client';
import { OpenTelegramPlanGate } from './_shims/open-gates';
import { TELEGRAM_PLAN_GATE } from './_shims/tokens';
import { BotsController } from './bots.controller';
import { BotsRepository } from './bots.repository';
import { BotsService } from './bots.service';

/**
 * The Telegram channel (TG). The shim below stands in for a service another domain owns; it is replaced by binding the real
 * one to the same token (see `_shims/tokens.ts`).
 */
@Module({
  controllers: [BotsController],
  providers: [
    CryptoService,
    BotsService,
    BotsRepository,
    TelegramBotApiFactory,
    { provide: TELEGRAM_API, useExisting: TelegramBotApiFactory },
    { provide: TELEGRAM_PLAN_GATE, useClass: OpenTelegramPlanGate },
  ],
  exports: [BotsService],
})
export class ChannelTelegramModule {}
