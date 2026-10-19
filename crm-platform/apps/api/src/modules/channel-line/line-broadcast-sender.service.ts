import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import { LINE_API, type LineApiFactory } from '../../infra/providers/channel-line/line.port';
import { QUEUES } from '../../infra/queue/queues';
import {
  HELD_TABLES,
  SendWindowService,
  holdRecipient,
  scheduleWake,
  splitByQuietHours,
  heldSummaries,
} from '../compliance-center';
import { ConsentGate, consentSkipNote, gateRecipients } from '../contact-consent';
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
import type { LineBroadcastJob } from './line-broadcasts.service';
import { LineTokenService } from './line-token.service';
import { broadcastMessages, type MediaKind } from './message-builders';

export type LineRunResult = 'skipped' | 'stopped' | 'done' | 'failed' | 'held';

/**
 * Sends one LINE broadcast, run by the `line-broadcast` worker job. People are claimed in batches of 40 with `FOR UPDATE SKIP LOCKED`
 * and pushed one by one about 50 ms apart (one push per person, up to five message objects: a media bubble first, then the text or
 * the template), and each outcome is written at once, so a crash loses at most the person in flight (put back after two minutes).
 * Counters are recomputed from the rows. Pause or delete is noticed at the next batch.
 *
 * Every batch asks the ConsentGate first (purpose marketing, channel line): a contact who withdrew, or has no recorded consent while the
 * workspace requires it, is `blocked` with `Not messaged: consent (<reason>)`, not messaged. A person with no contact is asked as an
 * anonymous subject (allowed while the switch is off).
 *
 * Quiet hours (BL-191): after the gate, a person whose local time is inside the workspace's quiet hours is HELD, not denied. They go back
 * to `pending` with the instant they may be messaged, the rest of the audience goes, and when only held people are left the run ends and a
 * delayed job takes them up at the first opening (asking the gate again, as every batch does).
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
    private readonly sendWindow: SendWindowService,
    @InjectQueue(QUEUES.LINE_BROADCAST) private readonly queue: Queue<LineBroadcastJob>,
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

    // A run visits each recipient once, in order: a person held for the quiet hours is not claimed again by this run.
    let lastId = 0;
    for (;;) {
      broadcast = await load();
      if (!broadcast || broadcast.status !== 'sending') return 'stopped';
      const current = broadcast;

      const batch = await this.db.txAs({ orgId }, (tx) =>
        this.repo.claim(tx, orgId, broadcastId, BATCH_SIZE, lastId),
      );
      if (batch.length === 0) return this.finish(orgId, current);
      lastId = Math.max(...batch.map((r) => r.id));

      // Every person is asked first (BL-141), on the first send and on a release alike; then whoever is inside the quiet hours is held.
      const gated = await gateRecipients(this.gate, orgId, batch, 'line');
      const refused = new Map(gated.skipped.map((s) => [s.row.id, s.reason]));
      const windows = await splitByQuietHours(this.sendWindow, orgId, gated.go);
      const held = new Map(windows.held.map((h) => [h.row.id, h.hold]));

      // The renewal of a rotated token happens here, at most once a day, not per person.
      const api = this.line.forToken(await this.tokens.accessToken(orgId, channel));

      for (const r of batch) {
        const why = refused.get(r.id);
        if (why) {
          await this.db.txAs({ orgId }, (tx) =>
            this.repo.markRecipient(tx, orgId, r.id, {
              status: 'blocked',
              error: consentSkipNote(why),
            }),
          );
          continue;
        }

        // Held, not denied: back to `pending` with the instant they may be messaged; the rest of the audience carries on.
        const hold = held.get(r.id);
        if (hold) {
          await this.db.txAs({ orgId }, (tx) =>
            holdRecipient(tx, orgId, HELD_TABLES.line, r.id, hold),
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

  /**
   * Nothing to claim: the broadcast is done, or what is left waits. People another worker still holds keep it sending; people held for
   * the quiet hours keep it sending too, and a delayed job comes back for them at the first opening.
   */
  private async finish(orgId: number, broadcast: LineBroadcastRow): Promise<LineRunResult> {
    const outcome = await this.db.txAs({ orgId }, async (tx) => {
      const row = await this.repo.findByUuid(tx, orgId, broadcast.uuid, true);
      if (!row || row.status !== 'sending') return { result: 'stopped' as const };
      await this.repo.recompute(tx, orgId, row.id);
      if ((await this.repo.pendingCount(tx, orgId, row.id)) > 0) {
        const next = (await heldSummaries(tx, orgId, HELD_TABLES.line, [row.id])).get(row.id)?.next;
        return next ? { result: 'held' as const, next } : { result: 'stopped' as const };
      }
      await this.repo.setStatus(tx, orgId, row.id, 'done', { markFinished: true });
      return { result: 'done' as const };
    });
    if (outcome.result === 'held') {
      await scheduleWake(
        this.queue,
        'send',
        { orgId, broadcastId: broadcast.id },
        broadcast.uuid,
        outcome.next,
        (err) =>
          this.logger.error(
            { orgId, broadcast: broadcast.uuid, err },
            'could not queue the wake-up of a LINE broadcast held for the quiet hours',
          ),
        this.sendWindow.now(),
      );
      this.logger.log(
        { orgId, broadcast: broadcast.uuid, resumeAt: outcome.next },
        '[LINE] broadcast waits: recipients held for the quiet hours',
      );
    }
    return outcome.result;
  }
}
