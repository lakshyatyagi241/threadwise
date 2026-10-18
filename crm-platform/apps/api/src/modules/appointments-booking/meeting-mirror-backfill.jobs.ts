import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import type { BackfillBatch } from '../crm';
import { ContactMeetingsRepository } from '../crm';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';

/** Appointments looked at per transaction: small enough to keep every transaction short, large enough to finish a big workspace. */
export const BACKFILL_BATCH = 500;
/** Batches one job runs before it hands the rest to a continuation, so one job never holds a worker for a whole large installation. */
const BATCHES_PER_JOB = 100;
const CONTINUE_DELAY_MS = 5_000;

export interface MeetingMirrorBackfillJob {
  /** Resume after this appointment id (0 = from the start). */
  after: number;
}

export interface MeetingMirrorBackfillReport {
  scanned: number;
  written: number;
  /** The id to continue after, or null when every appointment has been looked at. */
  next: number | null;
}

/**
 * Writes the Meetings row of every existing booking that has a contact and none yet (BL-281, phase P1: "backfill existing appointments
 * for everyone at deploy").
 *
 * Privileged and cross-workspace on purpose (the same shape as the billing roll-ups): it only ever copies an appointment's own values
 * into a row of the SAME workspace and contact, so no tenant sees another's data. Batched by appointment id; each batch is one short
 * transaction. Idempotent: the unique index on (org_id, appointment_id) turns a repeat, or a booking being written at the same moment,
 * into a no-op, and the query skips what already has a row. Cancelled and declined bookings are not back-filled (they were never
 * going to happen); a closed booking that already has a row keeps it.
 *
 * It writes no audit rows and no `contact_meeting.created` events: it is a one-off load of history, not a user action, and a
 * workspace with years of bookings would otherwise flood every consumer. New bookings go through `AppointmentMeetingMirror`, which does.
 */
@Injectable()
export class MeetingMirrorBackfillService {
  constructor(
    private readonly db: DatabaseService,
    private readonly meetings: ContactMeetingsRepository,
  ) {}

  /** One batch after `after`. */
  async runBatch(after: number, limit = BACKFILL_BATCH): Promise<BackfillBatch> {
    return this.db.privileged((tx) => this.meetings.backfillBatch(tx, after, limit));
  }

  /** Batches until the end or `maxBatches`; `next` says where to resume when it stopped early. */
  async run(
    after = 0,
    maxBatches = Number.POSITIVE_INFINITY,
    limit = BACKFILL_BATCH,
  ): Promise<MeetingMirrorBackfillReport> {
    let cursor = after;
    let scanned = 0;
    let written = 0;
    for (let i = 0; i < maxBatches; i++) {
      const batch = await this.runBatch(cursor, limit);
      scanned += batch.scanned;
      written += batch.written;
      if (batch.lastId === null || batch.scanned < limit) return { scanned, written, next: null };
      cursor = batch.lastId;
    }
    return { scanned, written, next: cursor };
  }
}

/**
 * Queues the back-fill when the worker starts. The job id is fixed, so several workers starting together queue one; a start after it
 * finished queues it again, which finds nothing to write (it also heals a booking whose row was lost some other way).
 */
@Injectable()
export class MeetingMirrorBackfillScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(MeetingMirrorBackfillScheduler.name);

  constructor(
    @InjectQueue(QUEUES.MEETING_MIRROR_BACKFILL)
    private readonly queue: Queue<MeetingMirrorBackfillJob>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.enqueue(0);
    } catch (err) {
      // A queue that is down must not stop the worker from starting; the next start tries again.
      this.logger.error({ err: String(err) }, '[BL-281] booking meetings back-fill not queued');
    }
  }

  async enqueue(after: number, delayMs = 0): Promise<void> {
    const jobId =
      after === 0 ? 'meeting-mirror-backfill' : `meeting-mirror-backfill-after-${after}`;
    // A job that failed is kept for days under its id, which would make BullMQ ignore every later start: clear it first.
    if ((await this.queue.getJobState(jobId)) === 'failed') {
      await (await this.queue.getJob(jobId))?.remove();
    }
    await this.queue.add(
      'backfill',
      { after },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 3600 },
        delay: delayMs,
        jobId,
      },
    );
  }
}

/** Runs the back-fill; a long one continues in a new job so a restart or a crash loses at most a batch. */
@Processor(QUEUES.MEETING_MIRROR_BACKFILL, { concurrency: 1 })
export class MeetingMirrorBackfillProcessor extends WorkerHost {
  private readonly logger = new Logger(MeetingMirrorBackfillProcessor.name);

  constructor(
    private readonly backfill: MeetingMirrorBackfillService,
    private readonly scheduler: MeetingMirrorBackfillScheduler,
  ) {
    super();
  }

  async process(job: Job<MeetingMirrorBackfillJob>): Promise<MeetingMirrorBackfillReport> {
    const report = await this.backfill.run(job.data.after ?? 0, BATCHES_PER_JOB);
    if (report.written > 0 || report.next !== null) {
      this.logger.log({ ...report }, '[BL-281] booking meetings back-fill');
    }
    if (report.next !== null) await this.scheduler.enqueue(report.next, CONTINUE_DELAY_MS);
    return report;
  }
}
