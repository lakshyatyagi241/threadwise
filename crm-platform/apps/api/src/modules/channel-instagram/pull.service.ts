import { Inject, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import {
  INSTAGRAM_BRIDGE,
  type InstagramBridgeFactory,
} from '../../infra/providers/channel-instagram/instagram-bridge.port';
import { EngineConnectionService } from '../addons-extension-registry';
import { AccountsRepository } from './accounts.repository';
import { IngestService } from './ingest.service';
import { isHistory, sentAtOf, skipThread } from './ingest-rules';
import { INSTAGRAM_INBOX_INGEST, type InstagramInboxIngest } from './_shims/tokens';

export interface PullJob {
  orgId: number;
  /** Fetch every thread again, even those with nothing newer (a one-time catch-up). */
  force?: boolean;
}

export interface PullResult {
  /** Messages stored now (a message already held does not count). */
  ingested: number;
  /** Threads whose messages were fetched. */
  scanned: number;
}

/**
 * Pulls new Instagram messages from the engine into the inbox (TW-IG-009). A private Reference cannot be reached by the engine's push,
 * and Reference can always reach the engine, so it asks: the threads of every account the workspace linked, then the messages of
 * each thread with news, in both directions (our own sends and the engine's automations show too). Every message goes through the
 * same ingest as a push, which stores it once, so the two paths compose.
 */
@Injectable()
export class PullService {
  private readonly logger = new Logger(PullService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly accounts: AccountsRepository,
    private readonly engines: EngineConnectionService,
    private readonly ingest: IngestService,
    @Inject(INSTAGRAM_BRIDGE) private readonly bridge: InstagramBridgeFactory,
    @Inject(INSTAGRAM_INBOX_INGEST) private readonly inbox: InstagramInboxIngest,
  ) {}

  /** Is there an engine to ask? The sweep checks this once before looking at any organization. */
  async configured(): Promise<boolean> {
    const c = await this.engines.connection('instagram');
    return c.url !== '' && c.secret !== '';
  }

  async pull(orgId: number, force = false): Promise<PullResult> {
    const none: PullResult = { ingested: 0, scanned: 0 };
    const conn = await this.engines.connection('instagram');
    if (conn.url === '' || conn.secret === '') return none;

    const { rows, known } = await this.db.txAs({ orgId }, async (tx) => ({
      rows: await this.accounts.list(tx, orgId),
      known: await this.inbox.threadClock(tx, orgId),
    }));
    // The accounts THIS workspace linked decide what is asked for; the engine's own stamp on an account is not relied on.
    if (rows.length === 0) return none;
    const username = new Map(rows.map((r) => [r.instaflowAccountId, r.username ?? '']));

    const api = this.bridge.with(conn);
    const threads = (
      await Promise.all(rows.map((r) => api.conversations(r.instaflowAccountId)))
    ).flat();

    const now = new Date();
    let ingested = 0;
    let scanned = 0;
    for (const t of threads) {
      if (t.id === '') continue;
      if (skipThread(known.get(`ig:${t.id}`.toLowerCase()), t.lastAt, force)) continue;
      scanned += 1;
      for (const m of await api.messages(t.id)) {
        // A message with no id cannot be told from one already stored, so it would be stored again on every pull.
        if (m.id === '') continue;
        const at = sentAtOf(m.at ?? '', now);
        try {
          const out = await this.ingest.ingest(
            orgId,
            {
              account: { id: t.account, username: username.get(t.account) ?? '' },
              conversation: { id: t.id, name: t.name, handle: t.handle, avatar: t.avatar },
              message: {
                id: m.id,
                from_me: m.fromMe,
                type: m.type,
                text: m.text,
                media_url: m.mediaUrl,
                buttons: m.buttons,
                at: m.at,
              },
            },
            // Old messages are history: stored for the thread's past, never answered. A first pull would otherwise reply to
            // every message the account ever received.
            isHistory(at, now),
          );
          if (out.stored) ingested += 1;
        } catch (err) {
          this.logger.warn(
            { err, orgId, thread: t.id },
            'instagram pull: a message was not stored',
          );
        }
      }
    }
    if (ingested > 0 || scanned > 0) {
      this.logger.log({ orgId, threads: threads.length, scanned, ingested }, 'instagram pull done');
    }
    return { ingested, scanned };
  }
}
