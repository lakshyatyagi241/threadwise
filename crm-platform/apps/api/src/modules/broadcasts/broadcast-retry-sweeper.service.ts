import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { BroadcastProgressService } from './broadcast-progress.service';
import { BroadcastsRepository } from './broadcasts.repository';
import { PERMANENT_FAILURE_SQL_REGEX, resolvePolicy, retryDelaySeconds } from './retry-policy';

const BATCH = 20;
const MAX_AGE_DAYS = 7;

interface Candidate {
  id: number | string;
  uuid: string;
  org_id: number | string;
  send_attempts: number;
  attempts: unknown;
  backoff: unknown;
}

/**
 * The automatic retry of failed recipients (WD-BCAST-039), on a clock of its own. WaDesk ran it from the Node heartbeat, so
 * a workspace with no Baileys socket never got it.
 *
 * Candidates are finished broadcasts from the last 7 days that still have a failed recipient a retry could fix and whose
 * next attempt is due. Per broadcast: record the attempt and its backoff first (a crash cannot spin), put the retryable
 * failures back to pending, and make it due again; the sender then sends only those. A broadcast that has used its attempts
 * is left for manual review. Per-organization overrides come from `org_plan_state.overrides`
 * (`broadcast_retry_attempts`, `broadcast_retry_backoff_sec`); the platform defaults are 3 and 60.
 *
 * Runs privileged: it spans tenants, like the due-broadcast queueing.
 */
@Injectable()
export class BroadcastRetrySweeper {
  private readonly logger = new Logger(BroadcastRetrySweeper.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: BroadcastsRepository,
    private readonly progress: BroadcastProgressService,
    private readonly outbox: OutboxService,
  ) {}

  @Interval(60_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.sweep();
      if (n > 0) this.logger.log({ retried: n }, '[BCAST-SWEEP] failed recipients re-queued');
    } catch (err) {
      this.logger.error({ err }, '[BCAST-SWEEP] sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** Public for tests. Returns how many broadcasts were reopened. */
  async sweep(): Promise<number> {
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT b.id, b.uuid, b.org_id, b.send_attempts,
               s.overrides -> 'broadcast_retry_attempts' AS attempts,
               s.overrides -> 'broadcast_retry_backoff_sec' AS backoff
        FROM broadcasts b
        LEFT JOIN org_plan_state s ON s.org_id = b.org_id
        WHERE b.status IN ('completed', 'completed_with_errors', 'failed')
          AND b.created_at > now() - ${`${MAX_AGE_DAYS} days`}::interval
          AND (b.next_attempt_at IS NULL OR b.next_attempt_at <= now())
          AND EXISTS (
            SELECT 1 FROM broadcast_contacts c
            WHERE c.org_id = b.org_id AND c.broadcast_id = b.id AND c.status IN ('failed', 'undelivered')
              AND (c.error_message IS NULL OR c.error_message !~ ${PERMANENT_FAILURE_SQL_REGEX}))
        ORDER BY b.id LIMIT ${BATCH}
        FOR UPDATE OF b SKIP LOCKED`);

      let reopened = 0;
      for (const c of res.rows as unknown as Candidate[]) {
        const orgId = Number(c.org_id);
        const id = Number(c.id);
        const policy = resolvePolicy({ attempts: c.attempts, backoffSeconds: c.backoff });
        if (Number(c.send_attempts) >= policy.attempts) continue; // used up: left for manual review

        const attempt = Number(c.send_attempts) + 1;
        const retried = await this.repo.resetFailed(tx, orgId, id, true);
        if (retried === 0) continue;
        await this.repo.reopen(tx, orgId, id, {
          sendAttempts: attempt,
          delaySeconds: retryDelaySeconds(attempt, policy.backoffSeconds),
        });
        await this.progress.recompute(tx, orgId, id);
        await this.progress.setStatus(tx, orgId, id, 'processing');
        await this.outbox.emit(tx, {
          orgId,
          aggregateModule: 'broadcasts',
          aggregateId: id,
          eventType: 'broadcast.retry_requested',
          payload: { uuid: c.uuid, retried, attempt, auto: true },
        });
        reopened++;
      }
      return reopened;
    });
  }
}
