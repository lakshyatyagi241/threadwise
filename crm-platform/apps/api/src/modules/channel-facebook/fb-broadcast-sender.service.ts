import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import {
  FACEBOOK_GRAPH,
  type FacebookGraphFactory,
} from '../../infra/providers/channel-facebook/facebook.port';
import { INBOX_INGEST, type InboxIngest } from './_shims/tokens';
import {
  BATCH_SIZE,
  CLAIM_TIMEOUT_MINUTES,
  SEND_GAP_MS,
  insideWindow,
  isUnreachable,
  messengerButtons,
  personalise,
} from './broadcast-rules';
import { FbBroadcastsRepository, type FbBroadcastRow } from './fb-broadcasts.repository';
import { TOKEN_INVALID_MESSAGE, clipError, isTokenError } from './page-rules';
import { PagesRepository } from './pages.repository';
import type { FbBroadcastJob } from './fb-broadcasts.service';
import { QUEUES } from '../../infra/queue/queues';
import {
  HELD_TABLES,
  SendWindowService,
  heldSummaries,
  holdRecipient,
  scheduleWake,
  splitByQuietHours,
} from '../compliance-center';
import { ConsentGate } from '../contact-consent';

export type FbRunResult = 'skipped' | 'stopped' | 'done' | 'failed' | 'held';

const GONE = 'The Page this broadcast belongs to is no longer connected.';
const OUTSIDE = 'Outside the 24-hour messaging window.';
const OUTSIDE_AFTER_HOLD =
  'Outside the 24-hour messaging window (it closed while the message waited for the quiet hours to end).';

/**
 * Sends one Messenger broadcast (TW-FB-013), run by the `fb-broadcast` worker job. People are claimed in batches of 25 with
 * `FOR UPDATE SKIP LOCKED`, sent one by one about 50 ms apart, and each outcome is written at once, so a crash loses at most the
 * person in flight (put back after two minutes). Counters are recomputed from the rows. Pause or delete is noticed at the next batch.
 *
 * Meta lets a Page message a person only within 24 hours of their last message, and that window closes while a broadcast runs, so it
 * is checked again for every person at the moment of sending.
 *
 * Quiet hours (BL-191): a person whose local time is inside the workspace's quiet hours is HELD, not denied. They go back to `pending`
 * with the instant they may be messaged, the rest of the audience goes, and when only held people are left a delayed job takes them up at
 * the first opening. At release the ConsentGate is asked again and the 24 hour window is checked again, as it is for every send.
 */
@Injectable()
export class FbBroadcastSenderService {
  private readonly logger = new Logger(FbBroadcastSenderService.name);

  /** Replaceable in tests so a run does not wait. */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: FbBroadcastsRepository,
    private readonly pages: PagesRepository,
    private readonly crypto: CryptoService,
    private readonly sendWindow: SendWindowService,
    private readonly gate: ConsentGate,
    @InjectQueue(QUEUES.FB_BROADCAST) private readonly queue: Queue<FbBroadcastJob>,
    @Inject(FACEBOOK_GRAPH) private readonly graph: FacebookGraphFactory,
    @Inject(INBOX_INGEST) private readonly inbox: InboxIngest,
  ) {}

  async run(orgId: number, broadcastId: number): Promise<FbRunResult> {
    const load = () => this.db.txAs({ orgId }, (tx) => this.repo.findById(tx, orgId, broadcastId));
    let broadcast = await load();
    if (!broadcast || broadcast.status !== 'sending') return 'skipped';

    const pageRowId = broadcast.pageRowId;
    const livePage = () =>
      this.db.txAs({ orgId }, (tx) => this.pages.findById(tx, orgId, pageRowId));
    let page = await livePage();
    if (page?.status !== 'connected') return this.fail(orgId, broadcastId, GONE);

    await this.db.txAs({ orgId }, (tx) =>
      this.repo.releaseStale(tx, orgId, broadcastId, CLAIM_TIMEOUT_MINUTES),
    );

    const api = this.graph.forPage(this.crypto.decrypt(page.accessToken ?? ''), page.pageId);
    const body = broadcast.body ? this.crypto.decrypt(broadcast.body) : '';
    const buttons = broadcast.buttons
      ? messengerButtons(JSON.parse(this.crypto.decrypt(broadcast.buttons)) as unknown[])
      : [];

    // A run visits each recipient once, in order: a person held for the quiet hours is not claimed again by this run.
    let lastId = 0;
    for (;;) {
      broadcast = await load();
      if (!broadcast || broadcast.status !== 'sending') return 'stopped';
      const current = broadcast;

      // A token Meta revoked mid-run flags the Page; the next batch finds it and stops (Reference stopped the same way).
      page = await livePage();
      if (page?.status !== 'connected') return this.fail(orgId, broadcastId, GONE);

      const batch = await this.db.txAs({ orgId }, (tx) =>
        this.repo.claim(tx, orgId, broadcastId, BATCH_SIZE, lastId),
      );
      if (batch.length === 0) return this.finish(orgId, current);
      lastId = Math.max(...batch.map((r) => r.id));

      const windows = await splitByQuietHours(this.sendWindow, orgId, batch);
      const held = new Map(windows.held.map((h) => [h.row.id, h.hold]));
      // A person released from a hold may have unsubscribed while they waited: the gate is asked again (BL-141).
      const released = batch.filter((r) => r.wasHeld && r.contactId !== null);
      const recheck =
        released.length > 0
          ? await this.gate.checkMany(
              orgId,
              released.map((r) => r.contactId as number),
              'facebook',
              'marketing_messaging',
            )
          : null;

      for (const r of batch) {
        const verdict = r.contactId === null ? undefined : recheck?.decisions.get(r.contactId);
        if (verdict && verdict.decision === 'deny') {
          await this.mark(orgId, r.id, {
            status: 'blocked',
            error: `Not messaged: consent (${verdict.reason})`,
          });
          continue;
        }
        const hold = held.get(r.id);
        if (hold) {
          await this.db.txAs({ orgId }, (tx) =>
            holdRecipient(tx, orgId, HELD_TABLES.facebook, r.id, hold),
          );
          continue;
        }
        const lastIn =
          r.conversationId === null
            ? null
            : await this.db.txAs({ orgId }, (tx) =>
                this.inbox.lastInboundAt(tx, orgId, r.conversationId as number),
              );
        if (!insideWindow(lastIn, new Date())) {
          await this.mark(orgId, r.id, {
            status: 'blocked',
            error: r.wasHeld ? OUTSIDE_AFTER_HOLD : OUTSIDE,
          });
          continue;
        }

        const text = personalise(body, r.title);
        const res =
          buttons.length > 0
            ? await api.sendButtonTemplate(r.psid, text, buttons)
            : await api.sendText(r.psid, text);

        if (res.ok) {
          const mid = res.data?.messageId || null;
          await this.mark(orgId, r.id, { status: 'sent', providerMessageId: mid });
          if (r.conversationId !== null) {
            await this.mirror(orgId, current.uuid, r.conversationId, text, mid);
          }
        } else {
          const error = res.error ?? 'Facebook rejected the send.';
          if (isTokenError(res.code)) {
            await this.db.txAs({ orgId }, (tx) =>
              this.pages.markExpired(
                tx,
                orgId,
                pageRowId,
                clipError(error) ?? TOKEN_INVALID_MESSAGE,
              ),
            );
          }
          await this.mark(orgId, r.id, {
            status: isUnreachable(error) ? 'blocked' : 'failed',
            error,
          });
        }
        await this.sleep(SEND_GAP_MS);
      }
      await this.db.txAs({ orgId }, (tx) => this.repo.recompute(tx, orgId, broadcastId));
    }
  }

  private mark(
    orgId: number,
    id: number,
    v: {
      status: 'sent' | 'failed' | 'blocked';
      providerMessageId?: string | null;
      error?: string | null;
    },
  ): Promise<void> {
    return this.db.txAs({ orgId }, (tx) => this.repo.markRecipient(tx, orgId, id, v));
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
      this.logger.warn(
        { orgId, broadcast: broadcastUuid, err },
        'facebook broadcast mirror failed',
      );
    }
  }

  private async fail(orgId: number, broadcastId: number, why: string): Promise<FbRunResult> {
    await this.db.txAs({ orgId }, async (tx) => {
      await this.repo.recompute(tx, orgId, broadcastId);
      await this.repo.setStatus(tx, orgId, broadcastId, 'failed', {
        lastError: why.slice(0, 255),
        markFinished: true,
      });
    });
    return 'failed';
  }

  /**
   * Nothing to claim: the broadcast is done, or what is left waits. People another worker still holds keep it sending; people held for
   * the quiet hours keep it sending too, and a delayed job comes back for them at the first opening.
   */
  private async finish(orgId: number, broadcast: FbBroadcastRow): Promise<FbRunResult> {
    const outcome = await this.db.txAs({ orgId }, async (tx) => {
      const row = await this.repo.findByUuid(tx, orgId, broadcast.uuid, true);
      if (!row || row.status !== 'sending') return { result: 'stopped' as const };
      await this.repo.recompute(tx, orgId, row.id);
      if ((await this.repo.pendingCount(tx, orgId, row.id)) > 0) {
        const next = (await heldSummaries(tx, orgId, HELD_TABLES.facebook, [row.id])).get(
          row.id,
        )?.next;
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
            'could not queue the wake-up of a Messenger broadcast held for the quiet hours',
          ),
        this.sendWindow.now(),
      );
      this.logger.log(
        { orgId, broadcast: broadcast.uuid, resumeAt: outcome.next },
        '[FB] broadcast waits: recipients held for the quiet hours',
      );
    }
    return outcome.result;
  }
}
