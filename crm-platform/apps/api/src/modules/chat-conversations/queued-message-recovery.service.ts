import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DatabaseService } from '../../infra/db/database.service';
import { MessagesRepository } from './messages.repository';
import { OutboundService } from './outbound.service';

/** A message is overdue when it has been `queued` this long: normally a send takes seconds. */
const OVERDUE_SECONDS = 60;
/** Older than this is not recovered: re-sending a day-old message the agent has long given up on would be a surprise. */
const MAX_AGE_HOURS = 24;
const BATCH = 200;

/**
 * Recovery for outbound messages that were stored `queued` but never reached (or never finished in) the dispatch queue: the API
 * process died between the commit and the enqueue, Redis lost the job, or a job exhausted its attempts on infrastructure errors.
 * Every 30 seconds it looks for `queued` messages older than a minute (the partial index `idx_messages_queued` serves it) and puts
 * them on the queue again.
 *
 * Safe to run on every worker and to repeat: the job id is fixed per message and generation, so a live job is left alone, and the send
 * itself is idempotent (the dispatcher answers a repeated client reference from its stored result). A finished or failed job that
 * still holds the id is removed first, otherwise BullMQ would drop the new one as a duplicate of its own history.
 *
 * Runs privileged (it spans every workspace by definition). Imported by WorkersModule only.
 */
@Injectable()
export class QueuedMessageRecoveryService {
  private readonly logger = new Logger(QueuedMessageRecoveryService.name);
  private readonly messages = new MessagesRepository();
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly outbound: OutboundService,
  ) {}

  @Interval(30_000)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.sweep();
      if (n > 0) this.logger.log({ requeued: n }, 'recovered queued messages');
    } catch (err) {
      this.logger.error({ err }, 'queued message recovery failed');
    } finally {
      this.running = false;
    }
  }

  /** One pass. Returns how many messages were put back on the queue. */
  async sweep(overdueSeconds = OVERDUE_SECONDS): Promise<number> {
    const stale = await this.db.privileged((tx) =>
      this.messages.staleQueued(tx, overdueSeconds, MAX_AGE_HOURS, BATCH),
    );
    let requeued = 0;
    for (const m of stale) {
      if (await this.outbound.requeueJob(m.orgId, m.uuid, m.generation)) requeued += 1;
    }
    return requeued;
  }
}
