/** Public surface of the Telegram channel. Other domains import only from here. */
export { ChannelTelegramModule } from './channel-telegram.module';
export { TelegramSenderService, type ThreadReply } from './telegram-sender.service';
export type { Outcome as TelegramSendOutcome } from './chat-send';
