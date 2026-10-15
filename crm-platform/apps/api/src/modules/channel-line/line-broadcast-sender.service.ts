import { Inject, Injectable, Logger } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import { LINE_API, type LineApiFactory } from '../../infra/providers/channel-line/line.port';
import { ConsentGate } from '../contact-consent';
import { INBOX_INGEST, type InboxIngest } from './_shims/tokens';
import {
  BATCH_SIZE,
  CLAIM_TIMEOUT_MINUTES,
  SEND_GAP_MS,
  isUnreachable,
  personalise,
} from './broadcast-rules';
import { ChannelsRepository } from './channels.repository';
import { LineBroadcastsRepository, type LineBroadcastRow } from './line-broadcasts.repository';
import { LineTokenService } from './line-token.service';
import { broadcastMessages, type MediaKind } from './message-builders';

export type LineRunResult = 'skipped' | 'stopped' | 'done' | 'failed';

/**
 * Sends one LINE broadcast, run by the `line-broadcast` worker job. People are claimed in batches of 40 with `FOR UPDATE SKIP LOCKED`
 * and pushed one by one about 50 ms apart (one push per person, up to five message objects: a media bubble first, then the text or
 * the template), and each outcome is written at once, so a crash loses at most the person in flight (put back after two minutes).
 * Counters are recomputed from the rows. Pause or delete is noticed at the next batch.
 *
 * Every batch asks the ConsentGate first (purpose marketing, channel line): a contact who withdrew is `blocked`, not messaged.
 */
@Injectable()
export class LineBroadcastSenderService {
  private readonly logger = new Logger(LineBroadcastSenderService.name);

  /** Replaceable in tests so a run does not wait. */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: LineBroadcastsRepository,
    private readonly channels: ChannelsRepository,
    private readonly crypto: CryptoService,
    private readonly tokens: LineTokenService,
    private readonly gate: ConsentGate,
    @Inject(LINE_API) private readonly line: LineApiFactory,
    @Inject(INBOX_INGEST) private readonly inbox: InboxIngest,
  ) {}

  async run(orgId: number, broadcastId: number): Promise<LineRunResult> {
    const load = () => this.db.txAs({ orgId }, (tx) => this.repo.findById(tx, orgId, broadcastId));
    let broadcast = await load();
    if (!broadcast || broadcast.status !== 'sending') return 'skipped';

    const channelRowId = broadcast.channelRowId;
    const channel = await this.db.txAs({ orgId }, (tx) =>
      this.channels.findById(tx, orgId, channelRowId),
    );
    if (!channel?.active) {
      await this.db.txAs({ orgId }, (tx) =>
        this.repo.setStatus(tx, orgId, broadcastId, 'failed', {
          lastError: 'The LINE channel is no longer connected or is paused.',
          markFinished: true,
        }),
      );
      return 'failed';
    }

    await this.db.txAs({ orgId }, (tx) =>
      this.repo.releaseStale(tx, orgId, broadcastId, CLAIM_TIMEOUT_MINUTES),
    );

    const body = broadcast.body ? this.crypto.decrypt(broadcast.body) : '';
    const buttons: unknown[] = Array.isArray(broadcast.buttons) ? broadcast.buttons : [];
    const media =
      broadcast.mediaPath && broadcast.mediaKind
        ? { url: broadcast.mediaPath, kind: broadcast.mediaKind as MediaKind }
        : null;

    for (;;) {
      broadcast = await load();
      if (!broadcast || broadcast.status !== 'sending') return 'stopped';
      const current = broadcast;

      const batch = await this.db.txAs({ orgId }, (tx) =>
        this.repo.claim(tx, orgId, broadcastId, BATCH_SIZE),
      );
      if (batch.length === 0) return this.finish(orgId, current);

      // The renewal of a rotated token happens here, at most once a day, not per person.
      const api = this.line.forToken(await this.tokens.accessToken(orgId, channel));
      const verdict = await this.gate.checkMany(
        orgId,
        batch.flatMap((r) => (r.contactId === null ? [] : [r.contactId])),
        'line',
        'marketing_messaging',
      );

      for (const r of batch) {
        if (r.contactId !== null && !verdict.allowed.has(r.contactId)) {
          const why = verdict.decisions.get(r.contactId)?.reason ?? 'withdrawn';
          await this.db.txAs({ orgId }, (tx) =>
            this.repo.markRecipient(tx, orgId, r.id, {
              status: 'blocked',
              error: `Not messaged: consent (${why})`,
            }),
          );
          continue;
        }

        const text = personalise(body, r.title);
        const messages = broadcastMessages(media, text, buttons);
        if (messages.length === 0) {
          // Nothing to send for this person: treated as done, not stuck (Reference).
          await this.db.txAs({ orgId }, (tx) =>
            this.repo.markRecipient(tx, orgId, r.id, { status: 'sent' }),
          );
          continue;
        }

        const res = await api.push(r.userId, messages);
        const providerMessageId = res.data?.sentMessages?.[0]?.id ?? null;
        const error = res.ok ? null : (res.error ?? 'LINE rejected the send.');
        await this.db.txAs({ orgId }, (tx) =>
          this.repo.markRecipient(tx, orgId, r.id, {
            status: res.ok ? 'sent' : isUnreachable(error ?? '') ? 'blocked' : 'failed',
            providerMessageId,
            error,
          }),
        );
        if (res.ok && r.conversationId !== null) {
          await this.mirror(orgId, current.uuid, r.conversationId, text, providerMessageId);
        }
        await this.sleep(SEND_GAP_MS);
      }
      await this.db.txAs({ orgId }, (tx) => this.repo.recompute(tx, orgId, broadcastId));
    }
  }

  /** A failure to copy into the thread never fails the send (Reference). */
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

  /** Nothing pending: the broadcast is done. People another worker still holds keep it sending. */
  private finish(orgId: number, broadcast: LineBroadcastRow): Promise<LineRunResult> {
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
