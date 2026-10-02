import { Inject, Injectable } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import {
  TELEGRAM_API,
  type MediaKind,
  type MediaSource,
  type TelegramApiFactory,
} from '../../infra/providers/channel-telegram/telegram.port';
import { MEDIA_STORE, type MediaStore } from './_shims/tokens';
import { BotsRepository, type BotRow } from './bots.repository';
import { sendToChat, type Outcome } from './chat-send';
import { templateButtonsMarkup } from './telegram-markup';
import { parseThreadKey } from './update-rules';

export interface ThreadReply {
  /** The thread key, `tg:<bot row id>:<chat id>`. */
  rawJid: string;
  text: string;
  /** A stored file path (ours) or an absolute address. */
  media?: { kind: MediaKind; path: string } | null;
  /** A Telegram template's buttons: they become the keyboard. */
  buttons?: readonly unknown[] | null;
}

const failed = (error: string): Outcome => ({
  ok: false,
  providerMessageId: null,
  fileId: null,
  error,
});

/**
 * A reply in a Telegram thread (WD-TG-008, 009). The team inbox calls this; it sends through the bot that carried the thread
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
    @Inject(MEDIA_STORE) private readonly media: MediaStore,
  ) {}

  async reply(orgId: number, r: ThreadReply): Promise<Outcome> {
    const key = parseThreadKey(r.rawJid);
    if (!key) return failed('Not a Telegram thread.');

    // The bot named in the key must still be connected; an older key without a bot falls back to the first active one.
    const bot: BotRow | undefined = await this.db.txAs({ orgId }, (tx) =>
      key.botRowId === null
        ? this.repo.findFirstActive(tx, orgId)
        : this.repo.findById(tx, orgId, key.botRowId),
    );
    if (!bot) return failed('Telegram bot not connected');

    let text = r.text;
    let markup: object | null = null;
    if (r.buttons && r.buttons.length > 0) {
      const mk = templateButtonsMarkup(r.buttons);
      markup = mk.replyMarkup;
      if (mk.append !== '') text = `${text}${mk.append}`.trim();
    }

    let media: { kind: MediaKind; source: MediaSource } | null = null;
    if (r.media) {
      const source = await this.mediaSource(r.media.path);
      if (!source) return failed('The file could not be read or reached.');
      media = { kind: r.media.kind, source };
    }

    const api = this.telegram.forToken(this.crypto.decrypt(bot.botToken));
    return sendToChat(api, key.chatId, { text, media, markup });
  }

  /** Uploaded from our storage when the file is ours (no public address needed), else sent by address. */
  private async mediaSource(path: string): Promise<MediaSource | null> {
    const local = await this.media.read(path);
    if (local) return { bytes: local.bytes, filename: local.filename };
    const url = this.media.publicUrl(path);
    return url ? { url } : null;
  }
}
