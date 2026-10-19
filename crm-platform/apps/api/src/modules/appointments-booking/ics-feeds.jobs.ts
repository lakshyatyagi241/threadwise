import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Interval } from '@nestjs/schedule';
import type { Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { IcsFeedsRepository } from './ics-feeds.repository';
import { IcsFeedsService } from './ics-feeds.service';

/** One feed to read: only ids travel, never an address or an event. */
export interface IcsFeedRefreshJob {
  orgId: number;
  feedId: number;
}

/** The scheduler wakes this often and takes the feeds that are due; each healthy feed is then due about every 15 minutes. */
export const ICS_TICK_MS = 60_000;
/** Feeds claimed per tick: a low, steady rate against other people's servers. */
const TICK_BATCH = 20;
/** A claimed feed is not offered again for this long, which also bounds a read that died without recording its result. */
const CLAIM_MS = 10 * 60_000;
const LOCK_TTL_MS = 5 * 60_000;
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

const JOB_OPTIONS = {
  // A read that fails is recorded with its own back-off; the queue's retry is only for a database or Redis fault.
  attempts: 2,
  backoff: { type: 'exponential' as const, delay: 30_000, jitter: 0.5 },
  removeOnComplete: true,
  removeOnFail: { age: 24 * 3600 },
};

/**
 * Reads one iCal feed (BL-035). One Redis lock per feed keeps two workers from fetching the same address at once. The remote calendar's answer
 * never makes the job fail: it ends in the feed's status and back-off.
 */
@Processor(QUEUES.CALENDAR_ICS_REFRESH, { concurrency: 4 })
export class IcsFeedRefreshProcessor extends WorkerHost {
  private readonly logger = new Logger(IcsFeedRefreshProcessor.name);

  constructor(
    private readonly feeds: IcsFeedsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    super();
  }

  async process(job: Job<IcsFeedRefreshJob>): Promise<string> {
    const { orgId, feedId } = job.data;
    const key = `ics-feed:lock:${orgId}:${feedId}`;
    const token = randomUUID();
    const got = await this.redis.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
    if (got !== 'OK') return 'locked';
    try {
      const done = await this.feeds.refresh(orgId, feedId);
      this.logger.debug({ orgId, feedId, done }, '[BL-035] iCal feed read');
      return done;
    } finally {
      await this.redis.eval(RELEASE, 1, key, token).catch(() => undefined);
    }
  }
}

/** Offers the feeds that are due to the queue, a few a minute (the claim moves their next time, so each is taken once). */
@Injectable()
export class IcsFeedRefreshScheduler {
  private readonly logger = new Logger(IcsFeedRefreshScheduler.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly feeds: IcsFeedsRepository,
    @InjectQueue(QUEUES.CALENDAR_ICS_REFRESH) private readonly queue: Queue<IcsFeedRefreshJob>,
  ) {}

  @Interval(ICS_TICK_MS)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.enqueueDue();
      if (n > 0) this.logger.log({ queued: n }, '[BL-035] iCal feed reads queued');
    } catch (err) {
      this.logger.error({ err: String(err) }, '[BL-035] iCal feed schedule failed');
    } finally {
      this.running = false;
    }
  }

  async enqueueDue(now: Date = new Date()): Promise<number> {
    const due = await this.db.privileged((tx) => this.feeds.claimDue(tx, TICK_BATCH, CLAIM_MS));
    if (due.length === 0) return 0;
    const window = Math.floor(now.getTime() / ICS_TICK_MS);
    await this.queue.addBulk(
      due.map((f) => ({
        name: 'refresh',
        data: { orgId: f.orgId, feedId: f.id },
        opts: { ...JOB_OPTIONS, jobId: `ics-feed-${f.orgId}-${f.id}-${window}` },
      })),
    );
    return due.length;
  }
}
