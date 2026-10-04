import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { InboundEventsRepository, type NewInboundEvent } from './inbound-events.repository';
import { inboundJobId, type InboundJob } from './inbound-job';

/** The headers worth keeping with a stored delivery: who sent it and how. Never an authentication header. */
const KEPT_HEADERS = ['user-agent', 'content-type', 'accept'] as const;

export function keptHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of KEPT_HEADERS) {
    const v = headers[name];
    if (v) out[name] = v.slice(0, 200);
  }
  return out;
}

/**
 * The door's side of an `async` connection: the delivery is written whole to the inbox (the sender is answered only after this
 * succeeded, so a 200 means "we have it"), then a job is queued for the worker. Queueing is an optimisation, not the guarantee: when Redis
 * is down the row is still there and the worker's sweep finds it a few seconds later.
 */
@Injectable()
export class InboundIntake {
  private readonly logger = new Logger(InboundIntake.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: InboundEventsRepository,
    @InjectQueue(QUEUES.MKT_INBOUND) private readonly queue: Queue<InboundJob>,
  ) {}

  async accept(
    orgId: number,
    event: Omit<NewInboundEvent, 'body'> & { body: string },
  ): Promise<{ id: number; uuid: string }> {
    // Postgres text cannot hold a NUL; a sender that sends one must not be able to make the store fail.
    const body = event.body.replaceAll('\u0000', '');
    const stored = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.insert(tx, orgId, { ...event, body }),
    );
    await this.kick(orgId, stored.id);
    return stored;
  }

  /** Queues the delivery's job. A failure is logged and swallowed: the sweep is the safety net. */
  async kick(orgId: number, eventId: number): Promise<void> {
    try {
      await this.queue.add(
        'inbound',
        { orgId, eventId },
        {
          jobId: inboundJobId(orgId, eventId),
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (err) {
      this.logger.warn(
        { err, orgId, eventId },
        'inbound delivery not queued; the sweep will take it',
      );
    }
  }
}
