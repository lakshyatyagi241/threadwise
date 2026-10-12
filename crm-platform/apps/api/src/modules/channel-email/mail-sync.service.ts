import { Injectable, Logger } from '@nestjs/common';
import { channelEmailEnv } from '../../config/domains/channel-email.env';
import { DatabaseService } from '../../infra/db/database.service';
import { GmailClient, GoogleMailError } from '../../infra/providers/channel-email';
import { MailChannelSync } from './mail-channel.sync';
import { MailIngestService } from './mail-ingest.service';
import { MailboxUnavailableError } from './mail-errors';
import { MailPlan } from './mail-plan';
import {
  backfillQuery,
  isQuiet,
  planBatch,
  planFailure,
  skippableByLabels,
  type Candidate,
  type SyncMode,
} from './mail-sync-rules';
import { MailTokens } from './mail-tokens.service';
import { MailboxesRepository } from './mailboxes.repository';

export type SyncResult =
  | {
      status: 'skipped';
      reason: 'none' | 'disconnected' | 'needs_reauth' | 'not_configured' | 'feature_off';
    }
  | {
      status: 'synced';
      mode: SyncMode;
      stored: number;
      duplicates: number;
      skipped: number;
      failed: number;
      leftover: boolean;
    };

/**
 * One sync of one mailbox (TW-MAIL-021): reads what arrived in the INBOX since the stored Gmail history id and stores each message in the
 * inbox (`MailIngestService`). Runs in the worker, one job per mailbox.
 *
 *  - First run (no cursor): the last `MAIL_BACKFILL_DAYS` days are listed and stored QUIETLY (history: no unread, no notification).
 *  - Normal run: `users.history.list` from the cursor; messages added to the INBOX are stored as live mail.
 *  - Gmail answers 404 for a cursor it no longer keeps: the last days are listed again (quietly) and a new cursor taken.
 *  - A message already stored (ledger) is skipped before anything is downloaded; the inbox's own ledger is the authority, so a repeated or
 *    overlapping run is harmless.
 *  - Per run at most `MAIL_SYNC_MAX_MESSAGES` new messages are stored; when more wait, the cursor stays put and the next run continues.
 *  - A message that cannot be stored (a bug, a hostile mail) is counted, logged and left behind: the cursor still advances so one bad mail
 *    never blocks the mailbox, and the hub shows how many were lost.
 *
 * A workspace without the `email_channel` feature is not synced (its mail and conversations stay).
 */
@Injectable()
export class MailSyncService {
  private readonly logger = new Logger(MailSyncService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MailboxesRepository,
    private readonly tokens: MailTokens,
    private readonly gmail: GmailClient,
    private readonly ingest: MailIngestService,
    private readonly channel: MailChannelSync,
    private readonly plan: MailPlan,
  ) {}

  /** Throws only for an error the queue should retry (a Google outage); everything else is recorded on the mailbox and returned. */
  async sync(orgId: number, mailboxUuid: string): Promise<SyncResult> {
    const mailbox = await this.tokens.load(orgId, mailboxUuid);
    if (!mailbox) return { status: 'skipped', reason: 'none' };
    if (mailbox.status === 'disconnected') return { status: 'skipped', reason: 'disconnected' };
    if (mailbox.status === 'needs_reauth') return { status: 'skipped', reason: 'needs_reauth' };
    if (!(await this.plan.isEnabled(orgId))) return { status: 'skipped', reason: 'feature_off' };

    try {
      return await this.tokens.withToken(orgId, mailboxUuid, async (token, row) => {
        let channelUuid = row.channelUuid;
        if (!channelUuid) channelUuid = await this.channel.sync(orgId, row);
        if (!channelUuid) throw new Error('The inbox channel of this mailbox could not be created');
        return this.run(orgId, { ...row, channelUuid }, token);
      });
    } catch (err) {
      if (err instanceof MailboxUnavailableError) {
        return { status: 'skipped', reason: err.reason === 'none' ? 'none' : err.reason };
      }
      if (err instanceof GoogleMailError) {
        const plan = planFailure(err);
        await this.record(orgId, mailbox.id, { error: plan.message, status: 'error' });
        this.logger.warn(
          { orgId, mailbox: mailboxUuid, kind: err.kind, status: err.status, reason: err.reason },
          'mailbox sync failed',
        );
        if (plan.retry) throw err;
        return {
          status: 'synced',
          mode: 'history',
          stored: 0,
          duplicates: 0,
          skipped: 0,
          failed: 0,
          leftover: false,
        };
      }
      await this.record(orgId, mailbox.id, {
        error: 'The sync failed. It will be retried.',
        status: 'error',
      });
      throw err;
    }
  }

  private async run(
    orgId: number,
    mailbox: NonNullable<Awaited<ReturnType<MailTokens['load']>>> & { channelUuid: string },
    token: string,
  ): Promise<SyncResult> {
    const env = channelEmailEnv();
    let mode: SyncMode = mailbox.historyId ? 'history' : 'backfill';
    let candidates: Candidate[] = [];
    // Where the cursor goes when everything read was dealt with.
    let nextCursor: string | null = null;
    let readAll = true;

    if (mode === 'history') {
      try {
        const got = await this.readHistory(token, mailbox.historyId!, env.MAIL_SYNC_MAX_PAGES);
        candidates = got.candidates;
        readAll = got.complete;
        nextCursor = got.complete ? got.currentHistoryId : got.resumeAfter;
      } catch (err) {
        if (!(err instanceof GoogleMailError) || err.kind !== 'not_found') throw err;
        mode = 'repair';
      }
    }
    if (mode !== 'history') {
      // The cursor is taken BEFORE listing: mail that arrives while the list is read is then found by the next history run.
      const profile = await this.gmail.getProfile(token);
      nextCursor = profile.historyId || null;
      candidates = await this.listRecent(token, env.MAIL_BACKFILL_DAYS, env.MAIL_SYNC_MAX_PAGES);
    }

    const quiet = isQuiet(mode);
    const unseen: Candidate[] = [];
    let duplicates = 0;
    let skipped = 0;
    const seenIds = new Set<string>();
    for (const c of candidates) {
      if (seenIds.has(c.id)) continue;
      seenIds.add(c.id);
      if (skippableByLabels(c.labelIds)) {
        skipped += 1;
        continue;
      }
      const known = await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.repo.messageStored(tx, orgId, mailbox.channelUuid, c.id),
      );
      if (known) duplicates += 1;
      else unseen.push(c);
    }

    const { batch, leftover } = planBatch(unseen, env.MAIL_SYNC_MAX_MESSAGES);
    let stored = 0;
    let failed = 0;
    for (const c of batch) {
      try {
        const raw = await this.gmail.getMessage(token, c.id);
        const outcome = await this.ingest.store(orgId, mailbox, token, raw, { quiet });
        if (outcome === 'stored') stored += 1;
        else if (outcome === 'duplicate') duplicates += 1;
        else skipped += 1;
      } catch (err) {
        // A message deleted since it was listed is simply gone. Anything else Google-side (an outage, a revoked token) ends the run
        // here and is retried as a whole; the ledger makes the part already stored harmless.
        if (err instanceof GoogleMailError && err.kind === 'not_found') {
          skipped += 1;
          continue;
        }
        if (err instanceof GoogleMailError || err instanceof MailboxUnavailableError) throw err;
        failed += 1;
        this.logger.error(
          { orgId, mailbox: mailbox.uuid, message: c.id, err: (err as Error).message },
          'a mail could not be stored',
        );
      }
    }

    const advance = !leftover && (readAll || nextCursor !== null);
    await this.record(orgId, mailbox.id, {
      historyId: advance ? nextCursor : null,
      syncedAt: new Date(),
      error:
        failed > 0
          ? `${failed} message${failed === 1 ? '' : 's'} could not be stored and were skipped.`
          : null,
      status: 'connected',
    });
    return { status: 'synced', mode, stored, duplicates, skipped, failed, leftover };
  }

  /** Reads history pages: what was added to the INBOX since `cursor` (newest first, like a list), and where to continue. */
  private async readHistory(token: string, cursor: string, maxPages: number) {
    const candidates: Candidate[] = [];
    let pageToken: string | null = null;
    let current: string | null = null;
    let lastRecord: string | null = null;
    let complete = false;
    for (let page = 0; page < maxPages; page += 1) {
      const got = await this.gmail.listHistory(token, { startHistoryId: cursor, pageToken });
      for (const a of got.added)
        candidates.push({ id: a.id, threadId: a.threadId, labelIds: a.labelIds });
      current = got.historyId ?? current;
      lastRecord = got.lastRecordId ?? lastRecord;
      pageToken = got.nextPageToken;
      if (!pageToken) {
        complete = true;
        break;
      }
    }
    // History runs oldest to newest; the batch planner takes newest first (the order of a Gmail list) and reverses it once.
    candidates.reverse();
    return { candidates, complete, currentHistoryId: current, resumeAfter: lastRecord ?? cursor };
  }

  /** The newest mail of the INBOX within the last days (Gmail's order: newest first). */
  private async listRecent(token: string, days: number, maxPages: number): Promise<Candidate[]> {
    const out: Candidate[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < maxPages; page += 1) {
      const got = await this.gmail.listMessages(token, {
        q: backfillQuery(days),
        labelIds: ['INBOX'],
        pageToken,
      });
      for (const m of got.messages) out.push({ id: m.id, threadId: m.threadId, labelIds: null });
      pageToken = got.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  }

  private record(
    orgId: number,
    id: number,
    input: {
      historyId?: string | null;
      syncedAt?: Date;
      error: string | null;
      status: 'connected' | 'error';
    },
  ): Promise<void> {
    return this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.saveSync(tx, orgId, id, {
        historyId: input.historyId ?? null,
        syncedAt: input.syncedAt ?? null,
        error: input.error,
        status: input.status,
      }),
    );
  }
}
