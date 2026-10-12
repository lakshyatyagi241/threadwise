import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUES } from '../../infra/queue/queues';

export interface MailSyncJob {
  orgId: number;
  mailboxUuid: string;
}

/**
 * The one door a mailbox sync is queued through (the 60 second sweep, a new connection, "Sync now"). The job id is the mailbox, so a sync
 * that is waiting or running is never queued a second time; a failed run is retried a few times with a growing delay, then left to the
 * next sweep. Completed and failed jobs are removed at once: the mailbox row is the record (`last_synced_at`, `last_error`).
 */
@Injectable()
export class MailSyncPublisher {
  private readonly logger = new Logger(MailSyncPublisher.name);

  constructor(@InjectQueue(QUEUES.MAIL_SYNC) private readonly queue: Queue<MailSyncJob>) {}

  /** True when a job was added, false when one for this mailbox was already waiting. A broker failure is logged, never thrown. */
  async enqueue(orgId: number, mailboxUuid: string): Promise<boolean> {
    try {
      const jobId = `mail-sync-${mailboxUuid}`;
      const existing = await this.queue.getJob(jobId);
      if (existing) return false;
      await this.queue.add(
        'sync',
        { orgId, mailboxUuid },
        {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 15_000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      return true;
    } catch (err) {
      this.logger.error({ err, orgId, mailbox: mailboxUuid }, 'mailbox sync not queued');
      return false;
    }
  }
}
