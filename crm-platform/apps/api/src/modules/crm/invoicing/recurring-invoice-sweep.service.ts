import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { RequestContextStore } from '../../../common/context/request-context';
import { RecurringInvoicesService } from './recurring-invoices.service';

const BATCH = 100;

/**
 * Generates the invoices of recurring schedules whose date has come. Every five minutes it finds due schedules across workspaces
 * (the one cross-tenant read, privileged) and runs each in its own workspace's context, in its own transaction: a failure in one
 * workspace cannot touch another, and a second worker passes over a schedule that is already being run (SKIP LOCKED).
 * Retrying is safe: the run history's unique key stops a period from being generated twice.
 * Imported by WorkersModule only (through InvoicingWorkerModule).
 */
@Injectable()
export class RecurringInvoiceSweepService {
  private readonly logger = new Logger(RecurringInvoiceSweepService.name);
  private running = false;

  constructor(private readonly recurring: RecurringInvoicesService) {}

  @Interval(300_000)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.sweep();
      if (n > 0) this.logger.debug({ generated: n }, 'recurring invoice sweep');
    } catch (err) {
      this.logger.error({ err }, 'recurring invoice sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** One pass. Returns how many invoices were generated. */
  async sweep(limit = BATCH): Promise<number> {
    let generated = 0;
    for (const due of await this.recurring.due(limit)) {
      try {
        generated += await RequestContextStore.run(
          {
            requestId: randomUUID(),
            orgId: due.orgId,
            actorType: 'system',
            actorId: null,
            userId: null,
          },
          () => this.recurring.runDue(due.orgId, due.id),
        );
      } catch (err) {
        this.logger.error({ err, schedule: due.id }, 'recurring schedule run failed');
      }
    }
    return generated;
  }
}
