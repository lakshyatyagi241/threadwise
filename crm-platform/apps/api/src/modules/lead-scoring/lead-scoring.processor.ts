import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { LeadScoringAiError } from '../../infra/providers/lead-scoring/lead-scoring-ai.port';
import { QUEUES } from '../../infra/queue/queues';
import { LeadScoringService, type LeadScoreJob } from './lead-scoring.service';

/**
 * Scores one contact (worker process only: LeadScoringWorkerModule, imported by WorkersModule). The vendor call happens with no
 * transaction open. Idempotent: scoring twice writes the same kind of row and a person's score is never overwritten, so a retry or a
 * second job for the same contact is harmless. A vendor that is busy is retried by the queue; a refused key or an unusable answer is not.
 * The rate limit keeps a backfill from flooding the vendor.
 */
@Processor(QUEUES.LSC_SCORE, { concurrency: 3, limiter: { max: 5, duration: 1_000 } })
export class LeadScoringProcessor extends WorkerHost {
  private readonly logger = new Logger(LeadScoringProcessor.name);

  constructor(private readonly scoring: LeadScoringService) {
    super();
  }

  async process(job: Job<LeadScoreJob>): Promise<void> {
    const { orgId, contactId, trigger } = job.data;
    await RequestContextStore.run(
      {
        requestId: `lsc-job-${job.id}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      async () => {
        try {
          const out = await this.scoring.score(orgId, contactId, trigger);
          if (out.status === 'skipped') {
            this.logger.debug({ orgId, contactId, reason: out.reason }, 'lead scoring skipped');
          }
        } catch (err) {
          // Retry only what a later attempt can fix: the vendor being busy. Everything else would fail the same way.
          if (err instanceof LeadScoringAiError && err.retryable) throw err;
          if (err instanceof AppError) throw new UnrecoverableError(err.message);
          throw err;
        }
      },
    );
  }
}
