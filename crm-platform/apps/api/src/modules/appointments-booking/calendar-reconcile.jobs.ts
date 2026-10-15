import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Interval } from '@nestjs/schedule';
import type { Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { CalendarReconcileService, type ReconcileReport } from './calendar-reconcile.service';
import { GoogleCalendarConnectionRepository } from './google-calendar-connection.repository';

/** One workspace to look at: only its id travels, never a token or an appointment. */
export interface CalendarReconcileJob {
  orgId: number;
}

/** The scheduler wakes this often and takes the workspaces that are due; each workspace is then due about once an hour. */
export const RECONCILE_TICK_MS = 60_000;
/** Workspaces claimed per tick: a low, steady rate against Google rather than every workspace at once. */
const TICK_BATCH = 10;
/** A claimed workspace is not offered again for this long, which also bounds a pass that died without writing its schedule. */
const CLAIM_MS = 30 * 60_000;
const LOCK_TTL_MS = 20 * 60_000;
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 60_000 },
  removeOnComplete: { age: 24 * 3600 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

/**
 * Looks at one workspace's calendar (TW-GACC-011). A pass never throws for what Google says (it ends in the report and the workspace's
 * back-off), so a retry is only for a database or Redis fault. One Redis lock per workspace keeps two workers (or a retry that overlaps its
 * predecessor) from reading the same calendar at once.
 */
@Processor(QUEUES.CALENDAR_RECONCILE, { concurrency: 2 })
export class CalendarReconcileProcessor extends WorkerHost {
  private readonly logger = new Logger(CalendarReconcileProcessor.name);

  constructor(
    private readonly reconcile: CalendarReconcileService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    super();
  }

  async process(job: Job<CalendarReconcileJob>): Promise<ReconcileReport | { skipped: 'locked' }> {
    const { orgId } = job.data;
    const key = `calendar-reconcile:lock:${orgId}`;
    const token = randomUUID();
    const got = await this.redis.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
    if (got !== 'OK') return { skipped: 'locked' };
    try {
      const report = await this.reconcile.reconcileOrg(orgId);
      if (report.looked > 0 || report.outcome !== 'ok') {
        this.logger.log({ orgId, ...report }, '[GACC] calendar reconcile');
      }
      return report;
    } finally {
      await this.redis.eval(RELEASE, 1, key, token).catch(() => undefined);
    }
  }
}

/** Offers the workspaces that are due to the queue, a few a minute (the claim moves their next time, so each is taken once). */
@Injectable()
export class CalendarReconcileScheduler {
  private readonly logger = new Logger(CalendarReconcileScheduler.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly connections: GoogleCalendarConnectionRepository,
    @InjectQueue(QUEUES.CALENDAR_RECONCILE) private readonly queue: Queue<CalendarReconcileJob>,
  ) {}

  @Interval(RECONCILE_TICK_MS)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.enqueueDue();
      if (n > 0) this.logger.log({ queued: n }, '[GACC] calendar reconciles queued');
    } catch (err) {
      this.logger.error({ err: String(err) }, '[GACC] calendar reconcile schedule failed');
    } finally {
      this.running = false;
    }
  }

  async enqueueDue(now: Date = new Date()): Promise<number> {
    const orgs = await this.db.privileged((tx) =>
      this.connections.claimDueReconciles(tx, TICK_BATCH, CLAIM_MS),
    );
    if (orgs.length === 0) return 0;
    const window = Math.floor(now.getTime() / RECONCILE_TICK_MS);
    await this.queue.addBulk(
      orgs.map((orgId) => ({
        name: 'reconcile',
        data: { orgId },
        opts: { ...JOB_OPTIONS, jobId: `calendar-reconcile-${orgId}-${window}` },
      })),
    );
    return orgs.length;
  }
}
