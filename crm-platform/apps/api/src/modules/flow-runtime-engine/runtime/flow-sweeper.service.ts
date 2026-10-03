import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { RequestContextStore } from '../../../common/context/request-context';
import { DatabaseService } from '../../../infra/db/database.service';
import { FlowEngine } from './engine.service';
import { FlowRunPublisher } from './flow-run.publisher';
import { RunRepository } from './run.repository';

const BATCH = 200;

/**
 * Pushes the runs that need it (WD-FLR-015): an idle wait that gave up (`expired`, `idle_timeout`), a run past its absolute limit, a
 * Delay or a halt that is due (its delayed job is the primary wake-up; this is the backup if the queue lost it), and a run that was
 * committed but whose first job never got queued (a crash between the commit and the queue).
 *
 * WaDesk's equivalent deleted any run older than an hour measured from its START, even one the customer had just answered. Here an
 * idle wait is measured from the last activity and the absolute limit is per run (a week, longer while a Delay needs it).
 *
 * Runs privileged: due runs span every tenant, like the outbox drain.
 */
@Injectable()
export class FlowSweeperService {
  private readonly logger = new Logger(FlowSweeperService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly runs: RunRepository,
    private readonly engine: FlowEngine,
    private readonly publisher: FlowRunPublisher,
  ) {}

  @Interval(15_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.tickOnce();
    } catch (err) {
      this.logger.error({ err }, '[FLR] sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** Public for tests. */
  async tickOnce(now: Date = new Date()): Promise<{ expired: number; woken: number }> {
    const due = await this.db.privileged((tx) => this.runs.due(tx, now, BATCH));
    let expired = 0;
    let woken = 0;
    for (const d of due) {
      await RequestContextStore.run(
        {
          requestId: `flr-sweep-${d.id}`,
          orgId: d.orgId,
          actorType: 'system',
          actorId: null,
          userId: null,
        },
        async () => {
          if (d.reason === 'lifetime' || d.reason === 'idle') {
            const r = await this.engine.expire(
              d.orgId,
              d.id,
              d.stepSeq,
              d.reason === 'lifetime' ? 'max_lifetime' : 'idle_timeout',
            );
            if (r === 'ended') expired++;
          } else {
            await this.publisher.schedule(d.orgId, d.id, d.stepSeq, 0);
            woken++;
          }
        },
      );
    }
    if (expired + woken > 0) this.logger.log({ expired, woken }, '[FLR] runs swept');
    return { expired, woken };
  }
}
