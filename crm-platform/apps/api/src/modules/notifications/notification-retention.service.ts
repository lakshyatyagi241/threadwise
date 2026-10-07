import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { retentionConfig, type RetentionConfig } from '../../config/domains/notifications.env';
import { DatabaseService } from '../../infra/db/database.service';

export interface RetentionResult {
  /** Another worker held the lock: nothing was done and nothing is wrong. */
  skipped: boolean;
  readDeleted: number;
  unreadDeleted: number;
  batches: number;
  /** A kind of row hit the per-run batch limit, so the next run continues (the log says so). */
  moreToDo: boolean;
  readCutoff: string;
  unreadCutoff: string;
  durationMs: number;
}

const DAY_MS = 86_400_000;
/** One key for the whole job: every worker pod competes for the same lock, one at a time wins. */
const LOCK_NAME = 'notification-retention';

/**
 * Prunes the bell feed (decision D5 of docs/specs/realtime-notifications.md; WaDesk never pruned and one install held 194k rows).
 *
 * Rows already read are deleted once they are `NOTIFY_RETENTION_READ_DAYS` old (default 90), rows never read once they are
 * `NOTIFY_RETENTION_UNREAD_DAYS` old (default 180); age is the row's `created_at`, so nothing from the last 90 days is ever touched
 * with the defaults (the read age cannot be set below 30, and the unread age is raised to the read age if configured lower).
 *
 * It runs daily in the worker process. Deletes go out in batches of `NOTIFY_RETENTION_BATCH_SIZE`, each its own short transaction, at most
 * `NOTIFY_RETENTION_MAX_BATCHES` per kind per run, so a first run over a huge backlog is spread over several days instead of holding
 * locks or filling the WAL; the event loop is given room between batches. Several worker pods are safe: a batch first takes a
 * transaction-scoped advisory lock (a pod that does not get it leaves the work to the one that did), and the rows are claimed with
 * `FOR UPDATE SKIP LOCKED` so a row is never fought over. Deleting twice is harmless, so a crash mid-run loses nothing.
 *
 * Runs privileged: it spans every tenant, like the outbox drain; it never reads a row, only deletes by age.
 */
@Injectable()
export class NotificationRetentionService {
  private readonly logger = new Logger(NotificationRetentionService.name);
  private running = false;

  constructor(private readonly db: DatabaseService) {}

  @Cron('0 30 3 * * *')
  async daily(): Promise<void> {
    if (!retentionConfig().enabled) return;
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error({ err }, 'notification retention failed');
    } finally {
      this.running = false;
    }
  }

  /** One pass. `now` is a parameter so tests drive a fake clock; `config` so they can use small batches. */
  async runOnce(
    now: Date = new Date(),
    config: RetentionConfig = retentionConfig(),
  ): Promise<RetentionResult> {
    const started = Date.now();
    const readCutoff = new Date(now.getTime() - config.readDays * DAY_MS);
    const unreadCutoff = new Date(now.getTime() - config.unreadDays * DAY_MS);
    const result: RetentionResult = {
      skipped: false,
      readDeleted: 0,
      unreadDeleted: 0,
      batches: 0,
      moreToDo: false,
      readCutoff: readCutoff.toISOString(),
      unreadCutoff: unreadCutoff.toISOString(),
      durationMs: 0,
    };

    for (const kind of ['read', 'unread'] as const) {
      const cutoff = kind === 'read' ? readCutoff : unreadCutoff;
      let batches = 0;
      for (;;) {
        const deleted = await this.batch(kind, cutoff, config.batchSize);
        if (deleted === null) {
          result.skipped = true;
          result.durationMs = Date.now() - started;
          return result;
        }
        batches += 1;
        result.batches += 1;
        if (kind === 'read') result.readDeleted += deleted;
        else result.unreadDeleted += deleted;
        if (deleted < config.batchSize) break;
        if (batches >= config.maxBatches) {
          result.moreToDo = true;
          break;
        }
        // Let the rest of the worker (the outbox drain, queue processors) have the event loop between batches.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }

    result.durationMs = Date.now() - started;
    this.logger.log(
      {
        readDeleted: result.readDeleted,
        unreadDeleted: result.unreadDeleted,
        batches: result.batches,
        moreToDo: result.moreToDo,
        readCutoff: result.readCutoff,
        unreadCutoff: result.unreadCutoff,
        durationMs: result.durationMs,
      },
      'notification retention pass done',
    );
    return result;
  }

  /** One batch in its own transaction. Null when another worker holds the lock. */
  private batch(kind: 'read' | 'unread', cutoff: Date, size: number): Promise<number | null> {
    const isRead = kind === 'read';
    return this.db.privileged(async (tx) => {
      const lock = await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${LOCK_NAME}, 0)) AS ok`,
      );
      if ((lock.rows[0] as { ok: boolean } | undefined)?.ok !== true) return null;
      // The partial indexes idx_inbox_notifications_prune_read / _unread serve exactly these two predicates, oldest first.
      const res = await tx.execute(
        isRead
          ? sql`
        WITH doomed AS (
          SELECT org_id, id FROM inbox_notifications
          WHERE read_at IS NOT NULL AND created_at < ${cutoff.toISOString()}::timestamptz
          ORDER BY created_at LIMIT ${size} FOR UPDATE SKIP LOCKED
        ), gone AS (
          DELETE FROM inbox_notifications n USING doomed d
          WHERE n.org_id = d.org_id AND n.id = d.id RETURNING 1
        ) SELECT count(*)::int AS n FROM gone`
          : sql`
        WITH doomed AS (
          SELECT org_id, id FROM inbox_notifications
          WHERE read_at IS NULL AND created_at < ${cutoff.toISOString()}::timestamptz
          ORDER BY created_at LIMIT ${size} FOR UPDATE SKIP LOCKED
        ), gone AS (
          DELETE FROM inbox_notifications n USING doomed d
          WHERE n.org_id = d.org_id AND n.id = d.id RETURNING 1
        ) SELECT count(*)::int AS n FROM gone`,
      );
      return Number((res.rows[0] as { n: number | string } | undefined)?.n ?? 0);
    });
  }
}
