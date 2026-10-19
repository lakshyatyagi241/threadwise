import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { liveDaysFor, recordSweep } from '../data-retention';
import { LeadSyncRunsRepository } from './lead-sync-runs.repository';

const BATCH = 1000;
const MAX_BATCHES = 50;
/** How long a finished sync or backfill is kept as the record of who pulled what and when. */
export const SYNC_RUN_RETENTION_DAYS = 90;

/**
 * The retention of raw lead payloads (spec L-12, open question 9: 30 days by default, per source up to a year). A lead's payload is
 * personal data kept only so a mapping can be fixed and the lead retried; once `payload_expires_at` passes, the worker nulls it and stamps
 * `payload_purged_at`. The event row, its status and the contact it made stay: they are the record that the lead happened.
 *
 * Runs privileged to reach every workspace in one statement (the list of expired events is not tenant data). The batch picks its rows with
 * SKIP LOCKED, so several workers cannot double up, and the partial index on `payload_expires_at` keeps the pick cheap. Imported by the
 * worker module only.
 */
@Injectable()
export class LeadRetentionSweepService {
  private readonly logger = new Logger(LeadRetentionSweepService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly runs: LeadSyncRunsRepository,
  ) {}

  @Cron('7 * * * *')
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const purged = await this.sweep();
      if (purged > 0) this.logger.log({ purged }, 'lead payload retention sweep');
      const days = await this.db.privileged((tx) =>
        liveDaysFor(tx, 'lead_sync_runs', SYNC_RUN_RETENTION_DAYS),
      );
      const pruned = await this.db.privileged((tx) => this.runs.prune(tx, days));
      await recordSweep(this.db, this.logger, 'lead_sync_runs', { deletedRows: pruned });
      if (pruned > 0) this.logger.log({ pruned }, 'lead sync run retention sweep');
    } catch (err) {
      this.logger.error({ err }, 'lead payload retention sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** Purges every payload past its retention, a batch at a time; returns how many. */
  async sweep(): Promise<number> {
    let total = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const n = await this.db.privileged(async (tx) => {
        const res = await tx.execute(sql`
          UPDATE lead_events SET payload = NULL, payload_purged_at = now()
          WHERE (org_id, id) IN (
            SELECT org_id, id FROM lead_events
            WHERE payload IS NOT NULL AND payload_expires_at < now()
              -- Kept while the person (or the workspace) is under a legal hold (BL-295).
              AND NOT is_subject_held(org_id, 'contact', contact_id)
            ORDER BY payload_expires_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
          RETURNING 1`);
        return res.rows.length;
      });
      total += n;
      if (n < BATCH) break;
    }
    return total;
  }
}
