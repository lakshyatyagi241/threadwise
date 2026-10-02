import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Interval } from '@nestjs/schedule';
import type { Job, Queue } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { TemplateSyncService } from './template-sync.service';
import { TemplatesRepository } from './templates.repository';

/** One pass looks at no more than this many stale templates (Reference: 25 per workspace); the next pass takes the rest. */
const BATCH = 50;
const TICK_MS = 10 * 60_000;

export interface TemplateSweepJob {
  /** The ten-minute slot that queued it; also the job id, so two worker pods queue one pass, not two. */
  slot: number;
}

/**
 * Queues the stale-status sweep every ten minutes (TW-TPL-027). Reference ran it from the library page load because it had no cron;
 * the clock is the trigger here. Registered only in the worker process.
 */
@Injectable()
export class TemplateSweepScheduler {
  private readonly logger = new Logger(TemplateSweepScheduler.name);

  constructor(@InjectQueue(QUEUES.TPL_SWEEP) private readonly queue: Queue<TemplateSweepJob>) {}

  @Interval(TICK_MS)
  async tick(): Promise<void> {
    try {
      await this.enqueue(new Date());
    } catch (err) {
      this.logger.error({ err }, '[TPL] queueing the status sweep failed');
    }
  }

  /** Public for tests. Queueing the same slot twice is a no-op. */
  async enqueue(now: Date): Promise<void> {
    const slot = Math.floor(now.getTime() / TICK_MS);
    await this.queue.add('sweep', { slot }, { jobId: `tpl-sweep-${slot}` });
  }
}

/**
 * Re-reads every template that has been PENDING on Meta for over an hour and not checked for half an hour, because a dropped
 * webhook would otherwise leave it "in review" forever. Meta calls are per template and a failure only moves that template's
 * clock, so one broken number cannot stop the rest. Registered only in the worker process (MessageTemplatesWorkerModule).
 */
@Processor(QUEUES.TPL_SWEEP, { concurrency: 1 })
export class TemplateSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(TemplateSweepProcessor.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TemplatesRepository,
    private readonly sync: TemplateSyncService,
  ) {
    super();
  }

  async process(job: Job<TemplateSweepJob>): Promise<{ checked: number; changed: number }> {
    // Stale rows span every organization, like the outbox drain.
    const targets = await this.db.privileged((tx) =>
      this.repo.staleTargets(tx, BATCH, new Date()),
    );
    let changed = 0;
    for (const t of targets) {
      const moved = await RequestContextStore.run(
        {
          requestId: `tpl-sweep-${job.id}-${t.id}`,
          orgId: t.orgId,
          actorType: 'system',
          actorId: null,
          userId: null,
        },
        () => this.sync.refreshStale(t.orgId, t.id),
      ).catch((err: unknown) => {
        this.logger.error({ err, templateId: t.id }, '[TPL] stale refresh crashed');
        return false;
      });
      if (moved) changed++;
    }
    if (targets.length > 0)
      this.logger.log({ checked: targets.length, changed }, '[TPL] stale status sweep');
    return { checked: targets.length, changed };
  }
}
