import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { QUEUES } from '../../infra/queue/queues';
import { MESSAGE_LOG_EXPORT_JOB, messageLogExportJobSchema } from './message-log-export.job';
import { MessageLogExportRunner } from './message-log-export.runner';

/**
 * Consumes `msg-log-export`: one job per requested export of the message log. Registered only in the worker process. Concurrency 1: a
 * year-long export reads a lot and holds its file in memory, so two at once on one worker is the limit of what is kind to the database.
 */
@Processor(QUEUES.MSG_LOG_EXPORT, { concurrency: 1 })
export class MessageLogExportProcessor extends WorkerHost {
  constructor(private readonly runner: MessageLogExportRunner) {
    super();
  }

  async process(job: Job): Promise<string> {
    if (job.name !== MESSAGE_LOG_EXPORT_JOB) {
      throw new UnrecoverableError(`Unknown job "${job.name}" on the msg-log-export queue`);
    }
    const parsed = messageLogExportJobSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError(
        `Malformed msg-log-export job: ${parsed.error.issues[0]?.message ?? ''}`,
      );
    }
    const { orgId, exportUuid } = parsed.data;
    return RequestContextStore.run(
      {
        requestId: `msglog-${job.id ?? ''}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () => this.runner.run(orgId, exportUuid),
    );
  }
}
