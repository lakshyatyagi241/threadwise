import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import {
  CHANNEL_INGEST_JOB,
  channelIngestJobSchema,
} from '../../infra/providers/chat-conversations';
import { QUEUES } from '../../infra/queue/queues';
import { InboundIngestService } from './inbound-ingest.service';
import { ReceiptsService } from './receipts.service';

/**
 * A receipt that finds no message is retried for this long: the provider (or the simulator) can report a step a moment before the
 * send that it reports on has committed its ledger row. Past it, the receipt is not ours (another system's id, a swept ledger) and is
 * dropped.
 */
export const UNKNOWN_RECEIPT_GRACE_MS = 2 * 60_000;

/** Raised to send a not-yet-routable receipt back through the queue's backoff. */
class ReceiptNotRoutable extends Error {}

/**
 * Consumes `webhook-ingest`: one normalised inbound message or one delivery receipt per `channel.ingest` job (what the webhook door and
 * the dev simulator enqueue). Registered only in the worker process (`ChatConversationsWorkerModule`, imported by `WorkersModule`): an
 * HTTP pod never picks up a job.
 *
 * Concurrency is plain parallelism: per-thread ordering comes from the thread's row lock and `msg_seq` inside the pipeline, not from
 * the queue (BullMQ cannot order per key, and a concurrency-1 queue would serialise the whole workspace).
 */
@Processor(QUEUES.WEBHOOK_INGEST, { concurrency: 8 })
export class ChannelIngestProcessor extends WorkerHost {
  private readonly logger = new Logger(ChannelIngestProcessor.name);

  constructor(
    private readonly inbound: InboundIngestService,
    private readonly receipts: ReceiptsService,
  ) {
    super();
  }

  async process(job: Job): Promise<string> {
    if (job.name !== CHANNEL_INGEST_JOB) {
      throw new UnrecoverableError(`Unknown job "${job.name}" on the ingest queue`);
    }
    const parsed = channelIngestJobSchema.safeParse(job.data);
    if (!parsed.success) {
      // A payload that does not parse will not parse next time either.
      throw new UnrecoverableError(
        `Malformed ingest job: ${parsed.error.issues[0]?.message ?? ''}`,
      );
    }
    const data = parsed.data;

    return RequestContextStore.run(
      {
        requestId: `ingest-${job.id ?? ''}`,
        orgId: data.orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      async () => {
        if (data.type === 'inbound') {
          const attempts = job.opts.attempts ?? 1;
          const result = await this.inbound.ingest(data, {
            finalAttempt: job.attemptsMade + 1 >= attempts,
          });
          if (result.outcome === 'dropped') {
            this.logger.warn(
              { orgId: data.orgId, channel: data.channelUuid, reason: result.reason },
              'inbound message dropped',
            );
          }
          return result.outcome;
        }

        const outcome = await this.receipts.apply(data);
        if (outcome === 'unknown' && Date.now() - job.timestamp < UNKNOWN_RECEIPT_GRACE_MS) {
          throw new ReceiptNotRoutable('receipt for a message that is not stored yet');
        }
        return outcome;
      },
    );
  }
}
