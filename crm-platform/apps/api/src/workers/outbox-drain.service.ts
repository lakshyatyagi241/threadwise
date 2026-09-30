import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../infra/db/database.service';

interface OutboxRow {
  id: string;
  created_at: Date;
  org_id: number;
  aggregate_module: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

const BATCH_SIZE = 200;
const MAX_ATTEMPTS = 8;

/**
 * Drains event_outbox.
 *
 * Claiming uses `FOR UPDATE SKIP LOCKED`. That is what lets N worker processes
 * run the identical query concurrently without any of them blocking on, or
 * double-processing, another's rows — no distributed lock, no leader election.
 *
 * Failures back off exponentially via `available_at` and are dead-lettered
 * after MAX_ATTEMPTS. A poison event must not be able to stall the queue
 * behind it forever.
 *
 * Runs privileged: the outbox spans every tenant by definition.
 */
@Injectable()
export class OutboxDrainService {
  private readonly logger = new Logger(OutboxDrainService.name);
  private running = false;

  constructor(private readonly db: DatabaseService) {}

  @Interval(2_000)
  async drain(): Promise<void> {
    // The interval keeps firing whether or not the last pass finished. Without
    // this guard a slow batch would overlap itself into a pile-up.
    if (this.running) return;
    this.running = true;

    try {
      const processed = await this.drainBatch();
      if (processed > 0) {
        this.logger.debug({ processed }, 'outbox batch drained');
      }
    } catch (err) {
      this.logger.error({ err }, 'outbox drain failed');
    } finally {
      this.running = false;
    }
  }

  private async drainBatch(): Promise<number> {
    return this.db.privileged(async (tx) => {
      const claimed = await tx.execute(sql`
        WITH claimed AS (
          SELECT id, created_at
          FROM event_outbox
          WHERE status = 'pending' AND available_at <= now()
          ORDER BY created_at, id
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE event_outbox o
        SET status = 'processing'
        FROM claimed
        WHERE o.id = claimed.id AND o.created_at = claimed.created_at
        RETURNING o.id, o.created_at, o.org_id, o.aggregate_module, o.aggregate_id,
                  o.event_type, o.payload, o.attempts
      `);

      const rows = claimed.rows as unknown as OutboxRow[];
      if (rows.length === 0) return 0;

      for (const row of rows) {
        try {
          await this.dispatch(row);
          await tx.execute(sql`
            UPDATE event_outbox
            SET status = 'done', processed_at = now()
            WHERE id = ${row.id} AND created_at = ${row.created_at}
          `);
        } catch (err) {
          const attempts = row.attempts + 1;
          const dead = attempts >= MAX_ATTEMPTS;
          // 2^attempts seconds, capped at 15 minutes.
          const backoffSeconds = Math.min(2 ** attempts, 900);

          await tx.execute(sql`
            UPDATE event_outbox
            SET status = ${dead ? 'dead' : 'pending'},
                attempts = ${attempts},
                last_error = ${err instanceof Error ? err.message : String(err)},
                available_at = now() + ${`${backoffSeconds} seconds`}::interval
            WHERE id = ${row.id} AND created_at = ${row.created_at}
          `);

          if (dead) {
            this.logger.error(
              { eventId: row.id, eventType: row.event_type, orgId: row.org_id },
              'outbox event dead-lettered after max attempts',
            );
          }
        }
      }

      return rows.length;
    });
  }

  /**
   * Fan-out target.
   *
   * Today this only logs. It becomes the automation trigger (workflows),
   * the counter updater, the realtime emitter and the ClickHouse feed — each
   * added as an explicit subscriber, so a failure in one does not silently
   * swallow the event for the others.
   */
  private async dispatch(row: OutboxRow): Promise<void> {
    this.logger.debug(
      { eventType: row.event_type, orgId: row.org_id, aggregateId: row.aggregate_id },
      'outbox event dispatched',
    );
  }
}
