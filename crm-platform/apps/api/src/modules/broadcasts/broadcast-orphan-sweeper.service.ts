import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { BroadcastProgressService } from './broadcast-progress.service';
import { BroadcastsRepository } from './broadcasts.repository';

/** No change to the broadcast or any of its recipients for this long, with recipients still unsent: its dispatch job is gone. */
const STALE_MINUTES = 30;
/** A lost job is re-queued only while the broadcast is this fresh. Older, it is failed and never sent: a message that late is wrong. */
const RECOVER_WITHIN_HOURS = 24;
const MAX_RECOVERIES = 3;
const BATCH = 20;

interface Orphan {
  id: number | string;
  uuid: string;
  org_id: number | string;
  send_attempts: number;
  too_old: boolean;
}

/**
 * Recovers broadcasts whose dispatch job was lost. A broadcast is `processing` with `node_schedule_id` set while its BullMQ job
 * runs; when the worker is restarted or killed mid-job (a release does it) and the job is lost, nothing clears either, so it
 * sat in `processing` for ever with its recipients `pending` and no error anywhere. The retry and resume sweepers do not look at
 * it: they need failed or paused recipients.
 *
 * Recent (under 24 h) and recovered fewer than 3 times: `reopen` clears `node_schedule_id`, and the due-broadcast queueing
 * (BroadcastDueService) re-dispatches it; the sender sends only the recipients still pending. Otherwise it is marked `failed`,
 * which the owner sees, and nothing is sent. Recipients held for quiet hours or a retry delay are not orphans.
 *
 * Runs privileged: it spans tenants, like the other sweeps.
 */
@Injectable()
export class BroadcastOrphanSweeper {
  private readonly logger = new Logger(BroadcastOrphanSweeper.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly progress: BroadcastProgressService,
    private readonly outbox: OutboxService,
    private readonly repo: BroadcastsRepository,
  ) {}

  @Interval(5 * 60_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { requeued, failed } = await this.sweep();
      if (requeued + failed > 0) {
        this.logger.warn(
          { requeued, failed },
          '[BCAST-ORPHAN] broadcasts with a lost dispatch job',
        );
      }
    } catch (err) {
      this.logger.error({ err }, '[BCAST-ORPHAN] sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** Public for tests. */
  async sweep(): Promise<{ requeued: number; failed: number }> {
    return this.db.privileged(async (tx) => {
      const stale = `${STALE_MINUTES} minutes`;
      const res = await tx.execute(sql`
        SELECT b.id, b.uuid, b.org_id, b.send_attempts,
               b.updated_at < now() - ${`${RECOVER_WITHIN_HOURS} hours`}::interval AS too_old
        FROM broadcasts b
        WHERE b.status = 'processing' AND b.node_schedule_id IS NOT NULL
          AND b.updated_at < now() - ${stale}::interval
          AND (b.next_attempt_at IS NULL OR b.next_attempt_at < now() - ${stale}::interval)
          AND EXISTS (
            SELECT 1 FROM broadcast_contacts c
            WHERE c.org_id = b.org_id AND c.broadcast_id = b.id AND c.status = 'pending'
              AND (c.held_until IS NULL OR c.held_until <= now()))
          AND NOT EXISTS (
            SELECT 1 FROM broadcast_contacts c
            WHERE c.org_id = b.org_id AND c.broadcast_id = b.id AND c.updated_at >= now() - ${stale}::interval)
        ORDER BY b.id LIMIT ${BATCH}
        FOR UPDATE OF b SKIP LOCKED`);

      let requeued = 0;
      let failed = 0;
      for (const o of res.rows as unknown as Orphan[]) {
        const orgId = Number(o.org_id);
        const id = Number(o.id);
        const attempt = Number(o.send_attempts) + 1;
        if (o.too_old || attempt > MAX_RECOVERIES) {
          await this.progress.setStatus(tx, orgId, id, 'failed');
          failed++;
          continue;
        }
        await this.repo.reopen(tx, orgId, id, { sendAttempts: attempt, delaySeconds: 0 });
        await this.outbox.emit(tx, {
          orgId,
          aggregateModule: 'broadcasts',
          aggregateId: id,
          eventType: 'broadcast.retry_requested',
          payload: { uuid: o.uuid, attempt, auto: true, orphaned: true },
        });
        requeued++;
      }
      return { requeued, failed };
    });
  }
}
