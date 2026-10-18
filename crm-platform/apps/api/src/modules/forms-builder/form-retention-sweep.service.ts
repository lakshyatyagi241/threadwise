import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';

const BATCH = 1000;
const MAX_BATCHES = 50;
/** Analytics events are kept this long (no personal data in them; the table is a stream, spec section 6). */
export const FORM_EVENT_RETENTION_DAYS = 90;

/**
 * The daily retention sweep of the Forms add-on (docs/specs/forms-builder-app.md 9.5): the answers a visitor typed are personal data kept
 * only for the form's `retention_days` (default 365). Once `answers_expires_at` passes, the worker empties the answers and what identifies
 * the visitor (the page, the referrer, the user agent, the address hash) and stamps `payload_purged_at`. The submission row, its outcome,
 * its links to the contact and company, and the consent evidence stay: they are the record that the submission happened. Analytics events
 * older than 90 days are deleted.
 *
 * Runs privileged to reach every workspace in one statement (the list of expired rows is not tenant data). Each batch picks its rows with
 * SKIP LOCKED, so several workers cannot double up, and the partial index on `answers_expires_at` keeps the pick cheap. Imported by the
 * worker module only.
 */
@Injectable()
export class FormRetentionSweepService {
  private readonly logger = new Logger(FormRetentionSweepService.name);
  private running = false;

  constructor(private readonly db: DatabaseService) {}

  @Cron('17 3 * * *')
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const answers = await this.sweepAnswers();
      const events = await this.sweepEvents();
      if (answers > 0 || events > 0) this.logger.log({ answers, events }, 'form retention sweep');
    } catch (err) {
      this.logger.error({ err }, 'form retention sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** Purges every set of answers past its retention, a batch at a time; returns how many. */
  async sweepAnswers(): Promise<number> {
    let total = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const n = await this.db.privileged(async (tx) => {
        const res = await tx.execute(sql`
          UPDATE web_form_submissions SET answers = '{}'::jsonb, utm = '{}'::jsonb, referrer = NULL, page_url = NULL,
            user_agent = NULL, ip_hash = NULL, payload_purged_at = now()
          WHERE (org_id, id) IN (
            SELECT org_id, id FROM web_form_submissions
            WHERE answers_expires_at < now() AND payload_purged_at IS NULL
              -- Kept while the person (or the workspace) is under a legal hold (BL-295).
              AND NOT is_subject_held(org_id, 'contact', contact_id)
            ORDER BY answers_expires_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
          RETURNING 1`);
        return res.rows.length;
      });
      total += n;
      if (n < BATCH) break;
    }
    return total;
  }

  /** Deletes analytics events older than their retention, a batch at a time; returns how many. */
  async sweepEvents(): Promise<number> {
    let total = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const n = await this.db.privileged(async (tx) => {
        const res = await tx.execute(sql`
          DELETE FROM web_form_events
          WHERE (id, created_at) IN (
            SELECT id, created_at FROM web_form_events
            WHERE created_at < now() - make_interval(days => ${FORM_EVENT_RETENTION_DAYS}) LIMIT ${BATCH})
          RETURNING 1`);
        return res.rows.length;
      });
      total += n;
      if (n < BATCH) break;
    }
    return total;
  }
}
