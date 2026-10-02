import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { ChannelError } from '../../infra/providers/chat-conversations';
import { QUEUES } from '../../infra/queue/queues';
import { MESSAGE_SEND_JOB, messageSendJobSchema } from './message-dispatch.job';
import { IN_FLIGHT, MessageDispatchService } from './message-dispatch.service';

/** How long a message whose send another worker holds waits before this one looks again (without using up an attempt). */
const IN_FLIGHT_RETRY_MS = 5_000;

/**
 * Consumes `message-dispatch`: one `message.send` job per outbound message. Registered only in the worker process.
 *
 * The retry policy is the queue's (attempts and exponential backoff, `MESSAGE_SEND_JOB_OPTIONS`); what is retried is decided by the
 * service (`ChannelError.retryable`). A message another worker is sending right now is delayed, not retried, so waiting for a slow
 * provider call never burns the attempts that a real failure needs.
 */
@Processor(QUEUES.MESSAGE_DISPATCH, { concurrency: 8 })
export class MessageDispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(MessageDispatchProcessor.name);

  constructor(private readonly dispatch: MessageDispatchService) {
    super();
  }

  async process(job: Job, token?: string): Promise<string> {
    if (job.name !== MESSAGE_SEND_JOB) {
      throw new UnrecoverableError(`Unknown job "${job.name}" on the dispatch queue`);
    }
    const parsed = messageSendJobSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError(`Malformed send job: ${parsed.error.issues[0]?.message ?? ''}`);
    }
    const { orgId, messageUuid } = parsed.data;
    const attempts = job.opts.attempts ?? 1;

    return RequestContextStore.run(
      {
        requestId: `send-${job.id ?? ''}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      async () => {
        try {
          return await this.dispatch.dispatch(orgId, messageUuid, {
            attempt: job.attemptsMade + 1,
            finalAttempt: job.attemptsMade + 1 >= attempts,
          });
        } catch (err) {
          if (err instanceof ChannelError && err.code === IN_FLIGHT) {
            await job.moveToDelayed(Date.now() + IN_FLIGHT_RETRY_MS, token);
            throw new DelayedError();
          }
          if (!(err instanceof ChannelError)) {
            this.logger.error(
              { orgId, messageUuid, err: (err as Error).message },
              'send job crashed',
            );
          }
          throw err;
        }
      },
    );
  }
}
