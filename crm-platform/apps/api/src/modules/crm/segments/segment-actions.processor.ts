import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { QUEUES } from '../../../infra/queue/queues';
import { SegmentActionsService, type SegmentAddToGroupJob } from './segment-actions.service';

/**
 * Runs the segment actions that are too big for a request (today: copy a segment's contacts into a
 * group). Registered only in the worker process (SegmentsWorkerModule, imported by WorkersModule).
 *
 * Idempotent: members already in the group are skipped by the insert itself, so a retry after a
 * crash, or a second job for the same pair, changes nothing twice.
 */
@Processor(QUEUES.SEGMENT_ACTIONS, { concurrency: 2 })
export class SegmentActionsProcessor extends WorkerHost {
  private readonly logger = new Logger(SegmentActionsProcessor.name);

  constructor(private readonly actions: SegmentActionsService) {
    super();
  }

  async process(job: Job<SegmentAddToGroupJob>): Promise<void> {
    const data = job.data;
    // A worker has no HTTP request: the context carries the tenant and the person who started the
    // action (for audit), and explicit grants, because the segment-visibility check fails closed
    // without them. The request that queued the job already checked what this person may do.
    const grants = new Map<string, { effect: 'allow' | 'deny'; scope: 'all' | 'team' | 'own' }>([
      ['record.segments.read', { effect: 'allow', scope: 'all' }],
      ['record.segments.update', { effect: 'allow', scope: 'all' }],
    ]);
    await RequestContextStore.run(
      {
        requestId: data.requestId ?? `segment-job-${job.id}`,
        orgId: data.orgId,
        actorType: 'user',
        actorId: data.userId,
        userId: data.userId,
        grants,
      },
      async () => {
        try {
          await this.actions.runAddToGroup(data);
        } catch (err) {
          // A rule the data broke will break again: do not retry it.
          if (err instanceof AppError) throw new UnrecoverableError(err.message);
          throw err;
        }
      },
    );
    this.logger.log({ orgId: data.orgId, segment: data.segmentUuid }, 'segment action finished');
  }
}
