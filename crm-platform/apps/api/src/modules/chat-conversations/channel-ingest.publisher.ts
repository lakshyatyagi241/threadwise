import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import { QUEUES } from '../../infra/queue/queues';
import {
  CHANNEL_INGEST_JOB,
  type ChannelIngestJob,
  type NormalisedInbound,
  type NormalisedReceipt,
} from '../../infra/providers/chat-conversations';

/**
 * Puts normalised inbound messages and delivery receipts on the `webhook-ingest` queue. Webhook controllers and the dev simulator
 * answer right after this; a worker stores them.
 *
 * Job ids use `-` and `.`, never `:` (BullMQ reserves it). The id only collapses an immediate redelivery of the same provider message
 * into one job: it is an optimisation, and the ledger's unique key remains the authority that makes a late duplicate a no-op.
 */
@Injectable()
export class ChannelIngestPublisher {
  constructor(@InjectQueue(QUEUES.WEBHOOK_INGEST) private readonly queue: Queue) {}

  /**
   * `copy` > 0 gives a redelivery its own job id; the simulator uses it to put the same message through the pipeline several times
   * and prove the ledger stores it once.
   */
  async enqueueInbound(
    orgId: number,
    channelUuid: string,
    message: NormalisedInbound,
    copy = 0,
  ): Promise<string> {
    const jobId = `ingest-${channelUuid}-in-${message.providerMessageId}${copy > 0 ? `-d${copy}` : ''}`;
    const job: ChannelIngestJob = {
      type: 'inbound',
      orgId,
      channelUuid,
      message: {
        ...message,
        providerTimestamp: message.providerTimestamp.toISOString(),
      },
    };
    await this.queue.add(CHANNEL_INGEST_JOB, job, { jobId });
    return jobId;
  }

  /** `unique` gives the job a fresh id, for a receipt that is meant to arrive twice (a test of the receipt rules). */
  async enqueueReceipt(
    orgId: number,
    channelUuid: string,
    receipt: NormalisedReceipt,
    opts: { delayMs?: number; unique?: boolean } = {},
  ): Promise<string> {
    const jobId = `ingest-${channelUuid}-rc-${receipt.providerMessageId}-${receipt.status}${opts.unique ? `-${randomUUID()}` : ''}`;
    const job: ChannelIngestJob = {
      type: 'receipt',
      orgId,
      channelUuid,
      receipt: { ...receipt, at: receipt.at.toISOString() },
    };
    await this.queue.add(CHANNEL_INGEST_JOB, job, { jobId, delay: opts.delayMs ?? 0 });
    return jobId;
  }
}
