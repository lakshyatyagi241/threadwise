import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { QUEUES } from '../../infra/queue/queues';
import { TgBroadcastSenderService } from './tg-broadcast-sender.service';
import type { TgBroadcastJob } from './tg-broadcasts.service';

/**
 * Sends one Telegram broadcast per job (WD-TG-013). Registered only in the worker process (ChannelTelegramWorkerModule, imported
 * by WorkersModule): the HTTP app never picks up a job. A retry after a crash is safe: sent chats are not pending any more.
 */
@Processor(QUEUES.TG_BROADCAST, { concurrency: 2 })
export class TgBroadcastProcessor extends WorkerHost {
  private readonly logger = new Logger(TgBroadcastProcessor.name);

  constructor(private readonly sender: TgBroadcastSenderService) {
    super();
  }

  process(job: Job<TgBroadcastJob>): Promise<string> {
    const { orgId, broadcastId } = job.data;
    return RequestContextStore.run(
      {
        requestId: `tg-bcast-${broadcastId}`,
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
          this.logger.error({ orgId, broadcastId, err }, '[TG] broadcast job crashed');
          throw err;
        }
      },
    );
  }
}
