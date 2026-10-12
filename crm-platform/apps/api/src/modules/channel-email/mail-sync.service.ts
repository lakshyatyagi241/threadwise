import { Injectable, Logger } from '@nestjs/common';
import { channelEmailEnv } from '../../config/domains/channel-email.env';
import { DatabaseService } from '../../infra/db/database.service';
import { MailDriverError } from './drivers/mail-driver';
import { MailDriverRegistry } from './drivers/mail-driver.registry';
import { MailChannelSync } from './mail-channel.sync';
import { MailIngestService } from './mail-ingest.service';
import { MailboxUnavailableError } from './mail-errors';
import { MailPlan } from './mail-plan';
import { planDriverFailure, type SyncMode } from './mail-sync-rules';
import { MailTokens } from './mail-tokens.service';
import { MailboxesRepository, type MailboxRow } from './mailboxes.repository';

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
 * One sync of one mailbox (TW-MAIL-021), whatever its provider: the mailbox's driver reads what is new since the stored cursor
 * (`MailDriver.sync`) and each message is stored in the inbox (`MailIngestService`). Runs in the worker, one job per mailbox. Nothing here
 * knows a provider; the driver owns the cursor's meaning, the quiet backfill, history repair and the batch cap.
 *
 *  - A message already stored (ledger) is skipped by the driver before anything is downloaded (`isKnown`); the inbox's own ledger is the
 *    authority, so a repeated or overlapping run is harmless.
 *  - A message that cannot be stored (a bug, a hostile mail) is counted, logged and left behind: the cursor still advances so one bad mail
 *    never blocks the mailbox, and the hub shows how many were lost.
 *  - A driver failure is recorded on the mailbox in the driver's words; only a retryable one is rethrown for the queue.
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
    private readonly drivers: MailDriverRegistry,
    private readonly ingest: MailIngestService,
    private readonly channel: MailChannelSync,
    private readonly plan: MailPlan,
  ) {}

  /** Throws only for an error the queue should retry (a provider outage); everything else is recorded on the mailbox and returned. */
  async sync(orgId: number, mailboxUuid: string): Promise<SyncResult> {
    const mailbox = await this.tokens.load(orgId, mailboxUuid);
    if (!mailbox) return { status: 'skipped', reason: 'none' };
    if (mailbox.status === 'disconnected') return { status: 'skipped', reason: 'disconnected' };
    if (mailbox.status === 'needs_reauth') return { status: 'skipped', reason: 'needs_reauth' };
    if (!(await this.plan.isEnabled(orgId))) return { status: 'skipped', reason: 'feature_off' };

    try {
      return await this.tokens.withAccess(orgId, mailboxUuid, async (access, row) => {
        let channelUuid = row.channelUuid;
        if (!channelUuid) channelUuid = await this.channel.sync(orgId, row);
        if (!channelUuid) throw new Error('The inbox channel of this mailbox could not be created');
        return this.run(orgId, { ...row, channelUuid }, access);
      });
    } catch (err) {
      if (err instanceof MailboxUnavailableError) {
        return { status: 'skipped', reason: err.reason === 'none' ? 'none' : err.reason };
      }
      if (err instanceof MailDriverError) {
        const plan = planDriverFailure(err);
        if (err.kind === 'auth_failed' || err.kind === 'reauth') {
          // The saved login is refused (a changed password): only the person can fix it.
          await this.tokens.markNeedsReauth(orgId, mailbox, err.providerCode, err.message);
          return { status: 'skipped', reason: 'needs_reauth' };
        }
        await this.record(orgId, mailbox.id, { error: plan.message, status: 'error' });
        this.logger.warn(
          {
            orgId,
            mailbox: mailboxUuid,
            kind: err.kind,
            status: err.status,
            reason: err.providerCode,
          },
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
    mailbox: MailboxRow & { channelUuid: string },
    access: Parameters<Parameters<MailTokens['withAccess']>[2]>[0],
  ): Promise<SyncResult> {
    const env = channelEmailEnv();
    const driver = this.drivers.get(mailbox.provider);
    const batch = await driver.sync({ orgId, mailbox, access }, mailbox.syncCursor, {
      maxMessages: env.MAIL_SYNC_MAX_MESSAGES,
      maxPages: env.MAIL_SYNC_MAX_PAGES,
      backfillDays: env.MAIL_BACKFILL_DAYS,
      isKnown: (providerMessageId) =>
        this.db.txAs({ orgId, userId: null }, (tx) =>
          this.repo.messageStored(tx, orgId, mailbox.channelUuid, providerMessageId),
        ),
      knownThreadKeys: (ids) =>
        this.db.txAs({ orgId, userId: null }, (tx) =>
          this.repo.threadKeysOf(tx, orgId, mailbox.channelUuid, ids),
        ),
    });

    let stored = 0;
    let duplicates = batch.duplicates;
    let skipped = batch.skipped;
    let failed = batch.failed;
    for (const mail of batch.messages) {
      try {
        const outcome = await this.ingest.store(orgId, mailbox, mail, { quiet: batch.quiet });
        if (outcome === 'stored') stored += 1;
        else if (outcome === 'duplicate') duplicates += 1;
        else skipped += 1;
      } catch (err) {
        // A mailbox that became unusable mid-run (or a provider failure while downloading a file) ends the run and is retried as a whole;
        // the ledger makes the part already stored harmless.
        if (err instanceof MailDriverError || err instanceof MailboxUnavailableError) throw err;
        failed += 1;
        this.logger.error(
          {
            orgId,
            mailbox: mailbox.uuid,
            message: mail.providerMessageId,
            err: (err as Error).message,
          },
          'a mail could not be stored',
        );
      }
    }

    await this.record(orgId, mailbox.id, {
      cursor: batch.nextCursor,
      syncedAt: new Date(),
      error:
        failed > 0
          ? `${failed} message${failed === 1 ? '' : 's'} could not be stored and were skipped.`
          : null,
      status: 'connected',
    });
    return {
      status: 'synced',
      mode: batch.mode,
      stored,
      duplicates,
      skipped,
      failed,
      leftover: batch.hasMore,
    };
  }

  private record(
    orgId: number,
    id: number,
    input: {
      cursor?: Record<string, unknown> | null;
      syncedAt?: Date;
      error: string | null;
      status: 'connected' | 'error';
    },
  ): Promise<void> {
    return this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.saveSync(tx, orgId, id, {
        cursor: input.cursor ?? null,
        syncedAt: input.syncedAt ?? null,
        error: input.error,
        status: input.status,
      }),
    );
  }
}
