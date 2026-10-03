import { Inject, Injectable, Logger } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import {
  FACEBOOK_GRAPH,
  type FacebookGraphFactory,
} from '../../infra/providers/channel-facebook/facebook.port';
import { INBOX_INGEST, type InboxIngest } from './_shims/tokens';
import { PLACEHOLDER_NAME } from './_shims/sql-inbox-ingest';
import { readHistory } from './event-rules';
import { dmThreadKey } from './page-rules';
import { PagesRepository } from './pages.repository';

/** WaDesk imported the 25 newest threads and 25 messages of each. */
export const MAX_THREADS = 25;
export const PER_THREAD = 25;

export interface BackfillResult {
  threads: number;
  messages: number;
  skipped: number;
}

/**
 * Pulls a Page's existing Messenger threads into the inbox (WD-FB-010), so past chats are already there after connecting.
 *
 * It writes through the same thread key and the same dedup as the live webhook, so running it again never doubles a message and a
 * later live message joins the same thread. It STORES ONLY: it never calls the automation hooks, so no flow, AI or keyword reply
 * ever answers a message from the past. Best effort: a message that fails is counted and skipped.
 */
@Injectable()
export class BackfillService {
  private readonly logger = new Logger(BackfillService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly pages: PagesRepository,
    private readonly crypto: CryptoService,
    @Inject(FACEBOOK_GRAPH) private readonly graph: FacebookGraphFactory,
    @Inject(INBOX_INGEST) private readonly inbox: InboxIngest,
  ) {}

  async run(orgId: number, pageRowId: number): Promise<BackfillResult> {
    const page = await this.db.txAs({ orgId }, (tx) => this.pages.findById(tx, orgId, pageRowId));
    const none: BackfillResult = { threads: 0, messages: 0, skipped: 0 };
    if (!page || page.status !== 'connected') return none;

    const api = this.graph.forPage(this.crypto.decrypt(page.accessToken ?? ''), page.pageId);
    const result = { ...none };

    for (const conv of await api.listConversations(MAX_THREADS)) {
      if (!conv.id) {
        result.skipped += 1;
        continue;
      }
      // The customer is the participant that is not the Page; failing that, the first message tells.
      let psid =
        conv.participants?.data
          ?.map((p) => p.id ?? '')
          .find((id) => id !== '' && id !== page.pageId) ?? '';

      // Meta answers newest first; storing oldest first lets the thread end on the newest message.
      const messages = (await api.getConversationMessages(conv.id, PER_THREAD)).reverse();
      let imported = false;
      for (const raw of messages) {
        const m = readHistory(page.pageId, raw);
        if (!m) {
          if (!raw.id) result.skipped += 1;
          continue;
        }
        if (psid === '') psid = m.fromId;
        try {
          const rec = await this.db.txAs({ orgId }, (tx) =>
            this.inbox.recordInbound(tx, orgId, {
              kind: 'dm',
              rawJid: dmThreadKey(page.pageId, psid),
              title: PLACEHOLDER_NAME,
              senderId: psid,
              body: m.text,
              mediaType: m.mediaType,
              mediaUrl: m.mediaUrl,
              dedup: m.mid,
              at: m.timestamp === null ? null : new Date(m.timestamp),
              meta: { psid, kind: 'dm', backfill: true },
            }),
          );
          if (rec.stored) {
            result.messages += 1;
            imported = true;
          }
        } catch (err) {
          this.logger.debug(
            { err, orgId, page: page.id, mid: m.mid },
            'facebook backfill message skipped',
          );
          result.skipped += 1;
        }
      }
      if (imported) result.threads += 1;
    }
    this.logger.log({ orgId, page: page.id, ...result }, 'facebook backfill done');
    return result;
  }
}
