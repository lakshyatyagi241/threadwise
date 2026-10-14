import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { QUEUES } from '../../infra/queue/queues';
import { VibBroadcastSenderService } from './vib-broadcast-sender.service';
import type { VibBroadcastJob } from './vib-broadcasts.service';

/**
 * Sends one Viber broadcast per job (TW-VIB-013). Registered only in the worker process (ChannelViberWorkerModule, imported by
 * WorkersModule): the HTTP app never picks up a job. A retry after a crash is safe: sent users are not pending any more.
 */
@Processor(QUEUES.VIBER_BROADCAST, { concurrency: 2 })
export class VibBroadcastProcessor extends WorkerHost {
  private readonly logger = new Logger(VibBroadcastProcessor.name);

  constructor(private readonly sender: VibBroadcastSenderService) {
    super();
  }

  process(job: Job<VibBroadcastJob>): Promise<string> {
    const { orgId, broadcastId } = job.data;
    return RequestContextStore.run(
      {
        requestId: `viber-bcast-${broadcastId}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      async () => {
        try {
          return await this.sender.run(orgId, broadcastId);
        } catch (err) {
          if (err instanceof AppError) throw new UnrecoverableError(err.message);
          this.logger.error({ orgId, broadcastId, err }, '[VIB] broadcast job crashed');
          throw err;
        }
      },
    );
  }
}
