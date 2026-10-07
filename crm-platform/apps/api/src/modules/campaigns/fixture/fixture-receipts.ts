import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUES } from '../../../infra/queue/queues';
import { BroadcastReceiptsService, type DeliveryReceipt } from '../../broadcasts';
import { WabaReceiptRegistry } from '../../whatsapp-cloud-api-waba';
import type { FixtureReceipt, FixtureReceiptSink } from './fixture-engine-sender';

/** The job name the sandbox's reports travel under on the campaign queue. */
export const FIXTURE_RECEIPT_JOB = 'fixture-receipt';

/** The sandbox's reports as delayed jobs on the campaign queue, which the worker drains: the same hop a webhook takes (an async report). */
@Injectable()
export class FixtureReceiptQueue implements FixtureReceiptSink {
  constructor(@InjectQueue(QUEUES.CAMPAIGN) private readonly queue: Queue) {}

  async emit(receipt: FixtureReceipt, delayMs: number): Promise<void> {
    await this.queue.add(FIXTURE_RECEIPT_JOB, receipt, {
      delay: delayMs,
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  }
}

/**
 * Applies a sandbox report exactly as the webhook ingest does: the broadcasts first, then whoever registered for the Cloud API (the
 * campaigns and the wizard's test sends).
 */
@Injectable()
export class FixtureReceiptConsumer {
  constructor(
    private readonly broadcasts: BroadcastReceiptsService,
    private readonly registry: WabaReceiptRegistry,
  ) {}

  async deliver(r: FixtureReceipt): Promise<boolean> {
    const receipt: DeliveryReceipt = {
      providerMessageId: r.providerMessageId,
      status: r.status,
      occurredAt: new Date(r.occurredAt),
      errorCode: r.errorCode ?? null,
      errorMessage: r.errorMessage ?? null,
    };
    return (await this.broadcasts.handle(receipt)) || (await this.registry.route(receipt));
  }
}
