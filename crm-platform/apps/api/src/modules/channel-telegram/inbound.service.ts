import { timingSafeEqual } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { ERROR_CODES } from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  TELEGRAM_API,
  type TelegramApiFactory,
} from '../../infra/providers/channel-telegram/telegram.port';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import {
  INBOUND_HOOKS,
  INBOX_INGEST,
  MEDIA_STORE,
  type InboundContext,
  type InboundHooks,
  type InboundMessageInput,
  type InboxIngest,
  type MediaStore,
} from './_shims/tokens';
import { BotsRepository, type BotRow } from './bots.repository';
import {
  chatTitle,
  extract,
  paymentOf,
  pickMessage,
  quickReplyLabel,
  senderUid,
  updateKind,
  type Update,
} from './update-rules';

/** Telegram's own limit on a webhook is generous; this only stops a flood from one routing token. */
const HITS_PER_MINUTE = 120;

export interface Ack {
  ok: true;
  note: string;
}
const ack = (note: string): Ack => ({ ok: true, note });

const str = (x: unknown): string | null =>
  typeof x === 'string' || typeof x === 'number' ? String(x) : null;
const dict = (x: unknown): Record<string, unknown> =>
  typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : {};

/**
 * The public Telegram webhook (TW-TG-003 to 006): one signed address per bot.
 *
 * Telegram retries anything but a 2xx, so every outcome, a wrong secret and an unknown bot included, answers 200 with a note
 * and does nothing. Only a flood is refused (429). The tenant is found through a narrow SECURITY DEFINER lookup; from there on
 * everything runs under that organization's context.
 */
@Injectable()
export class InboundService {
  private readonly logger = new Logger(InboundService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: BotsRepository,
    private readonly crypto: CryptoService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(TELEGRAM_API) private readonly telegram: TelegramApiFactory,
    @Inject(INBOX_INGEST) private readonly inbox: InboxIngest,
    @Inject(MEDIA_STORE) private readonly media: MediaStore,
    @Inject(INBOUND_HOOKS) private readonly hooks: InboundHooks,
  ) {}

  async ingest(token: string, secretHeader: string, update: Update): Promise<Ack> {
    await this.rateLimit(token);

    const found = await this.db.primary.execute(sql`SELECT * FROM tg_bot_lookup(${token})`);
    const hit = found.rows[0] as
      { bot_org_id: number | string; bot_row_id: number | string } | undefined;
    if (!hit) return ack('unknown bot');
    const orgId = Number(hit.bot_org_id);

    const bot = await this.db.txAs({ orgId }, (tx) =>
      this.repo.findById(tx, orgId, Number(hit.bot_row_id)),
    );
    if (!bot) return ack('unknown bot');

    const stored = bot.secretToken ? this.crypto.decrypt(bot.secretToken) : '';
    if (stored !== '' && !same(stored, secretHeader)) {
      this.logger.warn({ orgId, bot: bot.id }, 'telegram inbound secret mismatch');
      return ack('bad secret');
    }
    if (!bot.active) return ack('bot disabled');

    try {
      return await this.dispatch(orgId, bot, update);
    } catch (err) {
      // Telegram must still get its 200: the message is logged, not retried into a loop.
      this.logger.error({ err, orgId, bot: bot.id }, 'telegram ingest failed');
      return ack('ok');
    }
  }

  private async dispatch(orgId: number, bot: BotRow, update: Update): Promise<Ack> {
    const api = this.telegram.forToken(this.crypto.decrypt(bot.botToken));
    const kind = updateKind(update);

    if (kind === 'pre_checkout_query') {
      // Telegram fails the charge if this is not answered within 10 seconds: approve first, record after.
      const id = str(dict(update.pre_checkout_query).id) ?? '';
      const res = await api.answerPreCheckoutQuery(id, true);
      if (!res.ok)
        this.logger.warn({ orgId, bot: bot.id, error: res.error }, 'pre_checkout answer failed');
      await this.touch(orgId, bot, false);
      return ack('pre_checkout_query');
    }

    if (kind === 'callback_query') {
      await this.touch(orgId, bot, false);
      const cq = dict(update.callback_query);
      await api.answerCallbackQuery(str(cq.id) ?? '');
      const label = quickReplyLabel(str(cq.data) ?? '');
      const chat = dict(dict(cq.message).chat);
      if (label !== null && Object.keys(chat).length > 0) {
        // Replayed as a typed message so flows and keyword replies fire exactly as if the customer had typed it.
        await this.store(orgId, bot, {
          message_id: dict(cq.message).message_id,
          chat,
          from: dict(cq.from),
          text: label,
        });
      }
      return ack('callback_query');
    }

    if (kind === 'chat_join_request' || kind === 'poll_answer') {
      await this.touch(orgId, bot, false);
      return ack(kind);
    }

    const m = pickMessage(update);
    if (!m) return ack('no message');
    await this.touch(orgId, bot, true);
    await this.store(orgId, bot, m);
    return ack('ok');
  }

  private touch(orgId: number, bot: BotRow, clearError: boolean): Promise<void> {
    return this.db.txAs({ orgId }, (tx) => this.repo.touchInbound(tx, orgId, bot.id, clearError));
  }

  /** Writes a message update into the inbox, then lets the automation hooks run. */
  private async store(orgId: number, bot: BotRow, m: Record<string, unknown>): Promise<void> {
    const chatId = str(dict(m.chat).id) ?? '';
    if (chatId === '') return;

    const payment = paymentOf(m);
    const x = payment ? { text: payment.body, mediaType: null, fileId: null } : extract(m);
    const api = this.telegram.forToken(this.crypto.decrypt(bot.botToken));

    const input: InboundMessageInput = {
      chatId,
      chatType: (str(dict(m.chat).type) ?? 'private').toLowerCase(),
      title: chatTitle(m),
      uid: senderUid(m),
      fromId: str(dict(m.from).id),
      username: str(dict(m.from).username),
      firstName: str(dict(m.from).first_name),
      lastName: str(dict(m.from).last_name),
      messageId: str(m.message_id),
      text: x.text,
      mediaType: x.mediaType,
      fileId: x.fileId,
      event: payment ? 'successful_payment' : null,
      payment: payment
        ? Object.fromEntries(
            Object.entries({
              currency: payment.currency,
              total_amount: payment.totalAmount,
              amount_display: payment.amountDisplay,
              invoice_payload: payment.invoicePayload,
              telegram_payment_charge_id: payment.telegramChargeId,
              provider_payment_charge_id: payment.providerChargeId,
              order_info: payment.orderInfo,
            }).filter(([, v]) => v !== null && v !== ''),
          )
        : null,
    };

    // The file is copied into the inbox's own storage by the channel adapter; the tokened Telegram URL is never kept.
    const recorded = await this.inbox.recordInbound(orgId, bot.id, input);
    // A redelivered update is stored once: nothing runs a second time.
    if (!recorded.stored) return;

    // A new private contact gets the profile photo once, best effort, only when we can store files.
    if (
      recorded.newContact &&
      recorded.contactId !== null &&
      input.chatType === 'private' &&
      this.media.enabled
    ) {
      const contactId = recorded.contactId;
      void (async () => {
        const fileId = await api.getUserProfilePhoto(input.uid);
        const file = fileId ? await api.downloadFile(fileId) : null;
        const url = file ? await this.media.save(orgId, file.bytes, file.extension) : null;
        if (url)
          await this.db.txAs({ orgId }, (tx) =>
            this.inbox.setContactImage(tx, orgId, contactId, url),
          );
      })().catch(() => undefined); // the avatar is optional
    }

    const ctx: InboundContext = {
      orgId,
      botRowId: bot.id,
      conversationId: recorded.conversationId,
      chatId,
      text: x.text,
      fromId: input.fromId,
      newThread: recorded.newThread,
    };

    if (payment) {
      // A payment is its own row: no flow start, no keyword reply (Telegram's receipt is the confirmation).
      await this.hooks
        .resumePaid(ctx, {
          amountDisplay: payment.amountDisplay,
          currency: payment.currency,
          chargeId: payment.telegramChargeId,
          payload: payment.invoicePayload,
        })
        .catch((err: unknown) => this.logger.warn({ err }, 'telegram payment resume failed'));
      return;
    }

    try {
      if (!(await this.hooks.handoffToFlow(ctx))) await this.hooks.automate(ctx);
    } catch (err) {
      this.logger.warn({ err, orgId, bot: bot.id }, 'telegram automation failed');
    }
  }

  private async rateLimit(token: string): Promise<void> {
    try {
      const key = `tg_hits:${token}:${Math.floor(Date.now() / 60_000)}`;
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, 120);
      if (n > HITS_PER_MINUTE) {
        throw new AppError(
          ERROR_CODES.RATE_LIMITED,
          'Too many requests',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      // Redis down: the webhook keeps working, unthrottled.
    }
  }
}

/** Constant-time comparison, so the secret cannot be guessed one character at a time. */
function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
