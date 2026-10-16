import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { QUEUES } from '../../infra/queue/queues';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import {
  CalendarBackfillService,
  type BackfillCursor,
  type BackfillReport,
} from './calendar-backfill.service';

/** One workspace to back-fill: only its id (and where the last pass stopped) travels, never a token or an appointment. */
export interface CalendarBackfillJob {
  orgId: number;
  after?: BackfillCursor | null;
}

const LOCK_TTL_MS = 20 * 60_000;
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
/** A pass that hit its limit is continued by the next job after this pause, so a big back-fill is a steady trickle, not a burst. */
const CONTINUE_DELAY_MS = 30_000;

const JOB_OPTIONS = {
  attempts: 4,
  backoff: { type: 'exponential' as const, delay: 60_000 },
  // Gone as soon as it ends: the next connect enqueues a fresh one (the id only keeps TWO jobs from waiting for the same workspace).
  removeOnComplete: true,
  removeOnFail: { age: 24 * 3600 },
};

/**
 * Queues the back-fill of one workspace (BL-035). Used by the outbox consumer after a connect, a reconnect or a change of provider, and by
 * the settings page's "write the upcoming bookings to the calendar now". The job id is derived from the workspace, so asking twice while one
 * is waiting or running is one job.
 */
@Injectable()
export class CalendarBackfillQueue {
  constructor(
    @InjectQueue(QUEUES.CALENDAR_BACKFILL) private readonly queue: Queue<CalendarBackfillJob>,
  ) {}

  async enqueue(orgId: number, after: BackfillCursor | null = null, delayMs = 0): Promise<void> {
    await this.queue.add(
      'backfill',
      { orgId, after },
      {
        ...JOB_OPTIONS,
        delay: delayMs,
        // A continuation has its own id: the job that queues it is still active, and an id is unique among waiting, active and delayed jobs.
        jobId: after ? `calendar-backfill-${orgId}-${after.id}` : `calendar-backfill-${orgId}`,
      },
    );
  }
}

/**
 * Runs one workspace's back-fill. One Redis lock per workspace keeps two workers (or a retry that overlaps its predecessor) from writing the
 * same events at once; the write is idempotent anyway, the lock only saves the duplicate calls. A pass that stops on a calendar failure
 * throws, so the queue retries it with backoff.
 */
@Processor(QUEUES.CALENDAR_BACKFILL, { concurrency: 2 })
export class CalendarBackfillProcessor extends WorkerHost {
  private readonly logger = new Logger(CalendarBackfillProcessor.name);

  constructor(
    private readonly backfill: CalendarBackfillService,
    private readonly queue: CalendarBackfillQueue,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    super();
  }

  async process(job: Job<CalendarBackfillJob>): Promise<BackfillReport | { skipped: 'locked' }> {
    const { orgId, after } = job.data;
    const key = `calendar-backfill:lock:${orgId}`;
    const token = randomUUID();
    const got = await this.redis.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
    if (got !== 'OK') return { skipped: 'locked' };
    try {
      const report = await this.backfill.backfillOrg(orgId, after ?? null);
      if (report.looked > 0 || report.outcome !== 'ok') {
        this.logger.log({ orgId, ...report }, '[BL-035] calendar back-fill');
      }
      if (report.moreWaiting && report.next) {
        await this.queue.enqueue(orgId, report.next, CONTINUE_DELAY_MS);
      }
      return report;
    } finally {
      await this.redis.eval(RELEASE, 1, key, token).catch(() => undefined);
    }
  }
}
