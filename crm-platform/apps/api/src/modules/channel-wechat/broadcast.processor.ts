import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { QUEUES } from '../../infra/queue/queues';
import { BroadcastSenderService } from './broadcast-sender.service';
import type { WechatBroadcastJob } from './broadcasts.service';

/**
 * Sends one WeChat broadcast per job. Registered only in the worker process (ChannelWechatWorkerModule, imported by WorkersModule):
 * the HTTP app queues jobs but never picks one up. A job that finds the broadcast no longer `sending` does nothing, so a duplicate job
 * cannot send twice.
 */
@Processor(QUEUES.WECHAT_BROADCAST, { concurrency: 2 })
export class BroadcastProcessor extends WorkerHost {
  private readonly logger = new Logger(BroadcastProcessor.name);

  constructor(private readonly sender: BroadcastSenderService) {
    super();
  }

  process(job: Job<WechatBroadcastJob>): Promise<string> {
    const { orgId, broadcastId } = job.data;
    return RequestContextStore.run(
      {
        requestId: `wechat-bcast-${broadcastId}`,
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
          this.logger.error({ orgId, broadcastId, err }, '[WECHAT] broadcast job crashed');
          throw err;
        }
      },
    );
  }
}
