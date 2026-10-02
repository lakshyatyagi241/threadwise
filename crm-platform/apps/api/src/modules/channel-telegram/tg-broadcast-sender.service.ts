import { Inject, Injectable, Logger } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import {
  TELEGRAM_API,
  type MediaKind,
  type MediaSource,
  type TelegramApiFactory,
} from '../../infra/providers/channel-telegram/telegram.port';
import { INBOX_INGEST, MEDIA_STORE, type InboxIngest, type MediaStore } from './_shims/tokens';
import {
  BATCH_SIZE,
  CLAIM_TIMEOUT_MINUTES,
  SEND_GAP_MS,
  isUnreachable,
  personalise,
} from './broadcast-rules';
import { BotsRepository } from './bots.repository';
import { sendToChat, type Outcome } from './chat-send';
import { templateButtonsMarkup } from './telegram-markup';
import { TgBroadcastsRepository, type TgBroadcastRow } from './tg-broadcasts.repository';

export type TgRunResult = 'skipped' | 'stopped' | 'done' | 'failed';

type Bytes = Extract<MediaSource, { bytes: Uint8Array }>;

/**
 * Sends one Telegram broadcast (WD-TG-013), run by the `tg-broadcast` worker job. Chats are claimed in batches of 25 with
 * `FOR UPDATE SKIP LOCKED`, sent one by one about 50 ms apart, and each outcome is written at once, so a crash loses at most the
 * chat in flight (put back after two minutes). Counters are recomputed from the rows. Pause or delete is noticed at the next batch.
 */
@Injectable()
export class TgBroadcastSenderService {
  private readonly logger = new Logger(TgBroadcastSenderService.name);

  /** Replaceable in tests so a run does not wait. */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TgBroadcastsRepository,
    private readonly bots: BotsRepository,
    private readonly crypto: CryptoService,
    @Inject(TELEGRAM_API) private readonly telegram: TelegramApiFactory,
    @Inject(MEDIA_STORE) private readonly media: MediaStore,
    @Inject(INBOX_INGEST) private readonly inbox: InboxIngest,
  ) {}

  async run(orgId: number, broadcastId: number): Promise<TgRunResult> {
    const load = () => this.db.txAs({ orgId }, (tx) => this.repo.findById(tx, orgId, broadcastId));
    let broadcast = await load();
    if (!broadcast || broadcast.status !== 'sending') return 'skipped';

    const botRowId = broadcast.botRowId;
    const bot = await this.db.txAs({ orgId }, (tx) => this.bots.findById(tx, orgId, botRowId));
    if (!bot?.active) {
      await this.db.txAs({ orgId }, (tx) =>
        this.repo.setStatus(tx, orgId, broadcastId, 'failed', {
          lastError: 'The bot is no longer connected or is paused.',
          markFinished: true,
        }),
      );
      return 'failed';
    }

    await this.db.txAs({ orgId }, (tx) =>
      this.repo.releaseStale(tx, orgId, broadcastId, CLAIM_TIMEOUT_MINUTES),
    );

    const api = this.telegram.forToken(this.crypto.decrypt(bot.botToken));
    const body = broadcast.body ? this.crypto.decrypt(broadcast.body) : '';
    const buttons = broadcast.buttons
      ? (JSON.parse(this.crypto.decrypt(broadcast.buttons)) as unknown[])
      : [];
    const markup = buttons.length > 0 ? templateButtonsMarkup(buttons) : null;
    let fileId = broadcast.mediaFileId;
    // The bytes are read once per run, not once per chat.
    let bytes: Bytes | null | undefined;

    for (;;) {
      broadcast = await load();
      if (!broadcast || broadcast.status !== 'sending') return 'stopped';
      const current = broadcast;

      const batch = await this.db.txAs({ orgId }, (tx) =>
        this.repo.claim(tx, orgId, broadcastId, BATCH_SIZE),
      );
      if (batch.length === 0) return this.finish(orgId, current);

      for (const r of batch) {
        const text = `${personalise(body, r.title)}${markup?.append ?? ''}`.trim();

        let out: Outcome;
        if (current.mediaPath && current.mediaKind) {
          const kind = current.mediaKind as MediaKind;
          if (!fileId && bytes === undefined) bytes = await this.readBytes(current.mediaPath);
          const url = this.media.publicUrl(current.mediaPath);
          const source: MediaSource | null = fileId
            ? { fileId }
            : (bytes ?? (url ? { url } : null));
          out = source
            ? await sendToChat(api, r.chatId, {
                text,
                media: { kind, source },
                markup: markup?.replyMarkup ?? null,
              })
            : {
                ok: false,
                providerMessageId: null,
                fileId: null,
                error: 'The file could not be read or reached.',
              };
        } else {
          out = await sendToChat(api, r.chatId, {
            text,
            markup: markup?.replyMarkup ?? null,
          });
        }

        if (out.ok && !fileId && out.fileId) {
          const id = out.fileId;
          fileId = id;
          await this.db.txAs({ orgId }, (tx) =>
            this.repo.setMediaFileId(tx, orgId, broadcastId, id),
          );
        }
        await this.db.txAs({ orgId }, (tx) =>
          this.repo.markRecipient(tx, orgId, r.id, {
            status: out.ok ? 'sent' : isUnreachable(out.error ?? '') ? 'blocked' : 'failed',
            providerMessageId: out.providerMessageId,
            error: out.error,
          }),
        );
        if (out.ok && r.conversationId !== null) {
          await this.mirror(orgId, current.uuid, r.conversationId, text, out.providerMessageId);
        }
        await this.sleep(SEND_GAP_MS);
      }
      await this.db.txAs({ orgId }, (tx) => this.repo.recompute(tx, orgId, broadcastId));
    }
  }

  /** A failure to copy into the thread never fails the send (WaDesk). */
  private async mirror(
    orgId: number,
    broadcastUuid: string,
    conversationId: number,
    text: string,
    providerMessageId: string | null,
  ): Promise<void> {
    try {
      await this.db.txAs({ orgId }, (tx) =>
        this.inbox.recordOutbound(tx, orgId, conversationId, {
          body: text,
          providerMessageId,
          broadcastUuid,
        }),
      );
    } catch (err) {
      this.logger.warn({ orgId, broadcast: broadcastUuid, err }, 'broadcast mirror failed');
    }
  }

  private async readBytes(path: string): Promise<Bytes | null> {
    const local = await this.media.read(path);
    return local ? { bytes: local.bytes, filename: local.filename } : null;
  }

  /** Nothing pending: the broadcast is done. Chats another worker still holds keep it sending. */
  private finish(orgId: number, broadcast: TgBroadcastRow): Promise<TgRunResult> {
    return this.db.txAs({ orgId }, async (tx) => {
      const row = await this.repo.findByUuid(tx, orgId, broadcast.uuid, true);
      if (!row || row.status !== 'sending') return 'stopped';
      await this.repo.recompute(tx, orgId, row.id);
      if ((await this.repo.pendingCount(tx, orgId, row.id)) > 0) return 'stopped';
      await this.repo.setStatus(tx, orgId, row.id, 'done', { markFinished: true });
      return 'done';
    });
  }
}
