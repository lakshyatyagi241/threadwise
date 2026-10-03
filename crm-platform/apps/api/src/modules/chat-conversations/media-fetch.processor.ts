import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { QUEUES } from '../../infra/queue/queues';
import { MEDIA_FETCH_JOB, mediaFetchJobSchema } from './media-fetch.job';
import { MediaFetchService } from './media-fetch.service';

/**
 * Consumes `media-fetch`: one `media.fetch` job per inbound message whose file is being copied from the provider. Registered only in the
 * worker process. The retry policy is the queue's (`MEDIA_FETCH_JOB_OPTIONS`); what is retried is decided by the service
 * (`MediaFetchError.retryable`).
 *
 * Concurrency 3, not 8: a download can be a 100 MB document and, on a cloud bucket, is held in memory once before it is uploaded, so the
 * number of files in flight is the number of large buffers a worker can hold.
 */
@Processor(QUEUES.MEDIA_FETCH, { concurrency: 3 })
export class MediaFetchProcessor extends WorkerHost {
  constructor(private readonly media: MediaFetchService) {
    super();
  }

  async process(job: Job): Promise<string> {
    if (job.name !== MEDIA_FETCH_JOB) {
      throw new UnrecoverableError(`Unknown job "${job.name}" on the media-fetch queue`);
    }
    const parsed = mediaFetchJobSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError(
        `Malformed media-fetch job: ${parsed.error.issues[0]?.message ?? ''}`,
      );
    }
    const { orgId, messageUuid, generation } = parsed.data;
    const attempts = job.opts.attempts ?? 1;

    return RequestContextStore.run(
      {
        requestId: `media-${job.id ?? ''}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () =>
        this.media.run(orgId, messageUuid, {
          generation,
          attempt: job.attemptsMade + 1,
          finalAttempt: job.attemptsMade + 1 >= attempts,
        }),
    );
  }
}
