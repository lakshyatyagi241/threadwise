import { Inject, Injectable } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import {
  TELEGRAM_API,
  type MediaKind,
  type MediaSource,
  type TelegramApiFactory,
} from '../../infra/providers/channel-telegram/telegram.port';
import { BotsRepository, type BotRow } from './bots.repository';
import { sendToChat, type Outcome } from './chat-send';
import { templateButtonsMarkup } from './telegram-markup';

export interface ThreadReply {
  /** The bot that carried the thread (the channel's handle) and the Telegram chat. */
  botRowId: number;
  chatId: string;
  text: string;
  /** The file to send: its bytes, an address or a Telegram file id. */
  media?: { kind: MediaKind; source: MediaSource } | null;
  /** A Telegram template's buttons: they become the keyboard. */
  buttons?: readonly unknown[] | null;
}

/** The reason a reply gives when the bot is gone or paused. */
export const BOT_NOT_CONNECTED = 'Telegram bot not connected';

const failed = (error: string): Outcome => ({
  ok: false,
  providerMessageId: null,
  fileId: null,
  error,
});

/**
 * A reply in a Telegram thread (TW-TG-008, 009). The team inbox calls this; it sends through the bot that carried the thread
 * (read from the thread key), so the customer sees the answer from the bot they wrote to. Never throws: a Telegram refusal or a
 * disconnected bot comes back as `ok = false` with the reason.
 */
@Injectable()
export class TelegramSenderService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: BotsRepository,
    private readonly crypto: CryptoService,
    @Inject(TELEGRAM_API) private readonly telegram: TelegramApiFactory,
  ) {}

  async reply(orgId: number, r: ThreadReply): Promise<Outcome> {
    // The bot that carried the thread must still be there and switched on.
    const bot: BotRow | undefined = await this.db.txAs({ orgId }, (tx) =>
      this.repo.findById(tx, orgId, r.botRowId),
    );
    if (!bot?.active) return failed(BOT_NOT_CONNECTED);

    let text = r.text;
    let markup: object | null = null;
    if (r.buttons && r.buttons.length > 0) {
      const mk = templateButtonsMarkup(r.buttons);
      markup = mk.replyMarkup;
      if (mk.append !== '') text = `${text}${mk.append}`.trim();
    }

    const api = this.telegram.forToken(this.crypto.decrypt(bot.botToken));
    return sendToChat(api, r.chatId, { text, media: r.media ?? null, markup });
  }
}
