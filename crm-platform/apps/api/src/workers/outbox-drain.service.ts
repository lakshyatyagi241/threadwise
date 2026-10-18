import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { sanitizeErrorText } from '../common/errors/sanitize-error';
import { DatabaseService } from '../infra/db/database.service';
import { OutboxSubscriberRegistry } from '../kernel/outbox/outbox-subscribers';
import { outboxRetryDecision } from './outbox-retry-policy';

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
/**
 * A tick keeps claiming while the last batch came back full, up to this many batches. Without it a backlog drained at one batch per
 * 2 second tick (a ceiling of 100 events a second) however fast the consumers are; with it a backlog drains as fast as the consumers
 * run. The bound keeps one tick from holding the loop for ever (the next tick takes over), which matters now that every inbound
 * message adds a `message.received` event (BL-096, spec risk R2).
 */
const MAX_BATCHES_PER_TICK = 10;
/**
 * How many different aggregates one batch dispatches at the same time. Events of ONE aggregate (the same conversation, task, ...)
 * still go one after another in claim order, so a consumer that relies on that order keeps it; events of different aggregates are
 * independent. Without this a batch ran strictly one event at a time, and the round trips of each consumer (the conversation
 * notifications make several per message) set a hard ceiling on events per second. `OUTBOX_DRAIN_CONCURRENCY`, 1 to 16, default 6
 * (the worker's database pool is 20 by default, and each concurrent consumer holds one connection while it works).
 */
function drainConcurrency(): number {
  const n = Number.parseInt(process.env.OUTBOX_DRAIN_CONCURRENCY ?? '6', 10);
  return Number.isFinite(n) ? Math.min(16, Math.max(1, n)) : 6;
}

/**
 * Drains event_outbox.
 *
 * Claiming uses `FOR UPDATE SKIP LOCKED`. That is what lets N worker processes
 * run the identical query concurrently without any of them blocking on, or
 * double-processing, another's rows — no distributed lock, no leader election.
 *
 * Failures back off exponentially (with jitter) via `available_at` and are dead-lettered
 * after OUTBOX_MAX_ATTEMPTS (see outbox-retry-policy.ts). A poison event must not be able to stall the queue
 * behind it forever.
 *
 * Runs privileged: the outbox spans every tenant by definition.
 */
@Injectable()
export class OutboxDrainService {
  private readonly logger = new Logger(OutboxDrainService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly subscribers: OutboxSubscriberRegistry,
  ) {}

  @Interval(2_000)
  async drain(): Promise<void> {
    // The interval keeps firing whether or not the last pass finished. Without
    // this guard a slow batch would overlap itself into a pile-up.
    if (this.running) return;
    this.running = true;

    try {
      let processed = 0;
      for (let batch = 0; batch < MAX_BATCHES_PER_TICK; batch += 1) {
        const n = await this.drainBatch();
        processed += n;
        if (n < BATCH_SIZE) break;
      }
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

      // Dispatch first (a few aggregates at a time), then record each outcome on the claiming connection, in claim order.
      const failures = await this.dispatchAll(rows);

      for (const row of rows) {
        const failure = failures.get(row);
        if (failure === undefined) {
          await tx.execute(sql`
            UPDATE event_outbox
            SET status = 'done', processed_at = now()
            WHERE id = ${row.id} AND created_at = ${row.created_at}
          `);
        } else {
          const err = failure;
          const attempts = row.attempts + 1;
          const { dead, backoffSeconds } = outboxRetryDecision(attempts);

          await tx.execute(sql`
            UPDATE event_outbox
            SET status = ${dead ? 'dead' : 'pending'},
                attempts = ${attempts},
                last_error = ${sanitizeErrorText(err)},
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
   * Runs the dispatch of every claimed row and returns the ones that failed with their error (a row absent from the map succeeded).
   * Rows are grouped by aggregate; a group's rows run in order, and up to `drainConcurrency()` groups run at once. A failure never
   * stops the rest of its group or any other group: each row is retried on its own.
   */
  private async dispatchAll(rows: OutboxRow[]): Promise<Map<OutboxRow, unknown>> {
    const groups = new Map<string, OutboxRow[]>();
    for (const row of rows) {
      const key = `${row.org_id}:${row.aggregate_module}:${row.aggregate_id}`;
      const group = groups.get(key);
      if (group) group.push(row);
      else groups.set(key, [row]);
    }
    const failures = new Map<OutboxRow, unknown>();
    const queue = [...groups.values()];
    const worker = async (): Promise<void> => {
      for (let group = queue.shift(); group; group = queue.shift()) {
        for (const row of group) {
          try {
            await this.dispatch(row);
          } catch (err) {
            failures.set(row, err ?? new Error('unknown error'));
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(drainConcurrency(), queue.length) }, worker));
    return failures;
  }

  /**
   * Fan-out target.
   *
   * Subscribers register themselves with the OutboxSubscriberRegistry (task notifications today; the automation
   * trigger, counter updater, realtime emitter and ClickHouse feed follow the same way), and the registry runs
   * each matching one on its own so a failure in one does not swallow the event for the others.
   */
  private async dispatch(row: OutboxRow): Promise<void> {
    this.logger.debug(
      { eventType: row.event_type, orgId: row.org_id, aggregateId: row.aggregate_id },
      'outbox event dispatched',
    );
    await this.subscribers.dispatch({
      id: String(row.id),
      orgId: Number(row.org_id),
      aggregateModule: row.aggregate_module,
      aggregateId: String(row.aggregate_id),
      eventType: row.event_type,
      payload: row.payload,
    });
  }
}
