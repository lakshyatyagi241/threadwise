import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { QUEUES } from '../../infra/queue/queues';
import type { MailSyncJob } from './mail-sync.publisher';
import { MailSyncService, type SyncResult } from './mail-sync.service';

/**
 * Syncs one Gmail mailbox (TW-MAIL-021). Registered only in the worker process (ChannelEmailWorkerModule, imported by WorkersModule): the
 * HTTP app never runs it. A retry is safe: every message is stored once by its Gmail id.
 */
@Processor(QUEUES.MAIL_SYNC, { concurrency: 4 })
export class MailSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(MailSyncProcessor.name);

  constructor(private readonly sync: MailSyncService) {
    super();
  }

  process(job: Job<MailSyncJob>): Promise<SyncResult> {
    const { orgId, mailboxUuid } = job.data;
    return RequestContextStore.run(
      {
        requestId: `mail-sync-${mailboxUuid}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      async () => {
        try {
          return await this.sync.sync(orgId, mailboxUuid);
        } catch (err) {
          this.logger.warn(
            { orgId, mailbox: mailboxUuid, err: (err as Error).message },
            'mail sync job failed',
          );
          throw err;
        }
      },
    );
  }
}
