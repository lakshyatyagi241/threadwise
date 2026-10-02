import { Inject, Injectable, Logger } from '@nestjs/common';
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

export type FbRunResult = 'skipped' | 'stopped' | 'done' | 'failed';

const GONE = 'The Page this broadcast belongs to is no longer connected.';
const OUTSIDE = 'Outside the 24-hour messaging window.';

/**
 * Sends one Messenger broadcast (TW-FB-013), run by the `fb-broadcast` worker job. People are claimed in batches of 25 with
 * `FOR UPDATE SKIP LOCKED`, sent one by one about 50 ms apart, and each outcome is written at once, so a crash loses at most the
 * person in flight (put back after two minutes). Counters are recomputed from the rows. Pause or delete is noticed at the next batch.
 *
 * Meta lets a Page message a person only within 24 hours of their last message, and that window closes while a broadcast runs, so it
 * is checked again for every person at the moment of sending.
 */
@Injectable()
export class FbBroadcastSenderService {
  private readonly logger = new Logger(FbBroadcastSenderService.name);

  /** Replaceable in tests so a run does not wait. */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
  /** Replaceable in tests so the window can be tested without moving the clock. */
  now: () => Date = () => new Date();

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: FbBroadcastsRepository,
    private readonly pages: PagesRepository,
    private readonly crypto: CryptoService,
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

    for (;;) {
      broadcast = await load();
      if (!broadcast || broadcast.status !== 'sending') return 'stopped';
      const current = broadcast;

      // A token Meta revoked mid-run flags the Page; the next batch finds it and stops (Reference stopped the same way).
      page = await livePage();
      if (page?.status !== 'connected') return this.fail(orgId, broadcastId, GONE);

      const batch = await this.db.txAs({ orgId }, (tx) =>
        this.repo.claim(tx, orgId, broadcastId, BATCH_SIZE),
      );
      if (batch.length === 0) return this.finish(orgId, current);

      for (const r of batch) {
        const lastIn =
          r.conversationId === null
            ? null
            : await this.db.txAs({ orgId }, (tx) =>
                this.inbox.lastInboundAt(tx, orgId, r.conversationId as number),
              );
        if (!insideWindow(lastIn, this.now())) {
          await this.mark(orgId, r.id, { status: 'blocked', error: OUTSIDE });
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

  /** Nothing pending: the broadcast is done. People another worker still holds keep it sending. */
  private finish(orgId: number, broadcast: FbBroadcastRow): Promise<FbRunResult> {
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
