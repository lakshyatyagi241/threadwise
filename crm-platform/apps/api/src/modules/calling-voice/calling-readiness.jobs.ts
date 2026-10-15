import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Interval } from '@nestjs/schedule';
import { UnrecoverableError, type Job, type Queue } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { CallingReadinessRepository } from './calling-readiness.repository';
import { CallingReadinessService } from './calling-readiness.service';

/** One number to look at: the workspace and the number's uuid travel, never its credentials. */
export interface CallingReadinessJob {
  orgId: number;
  numberUuid: string;
  /** `connect`: the number was just connected (it may be switched on by itself); `schedule`: a look, never a switch-on. */
  source: 'connect' | 'schedule';
}

/** Meta needs a moment after a connect before the number's settings can be read. */
export const CONNECT_CHECK_DELAY_MS = 20_000;
/** The schedule wakes this often and takes the numbers that are due (a minute: the first retries of a pending switch-on are 1 and 5 minutes). */
export const SCHEDULE_TICK_MS = 60_000;
const SCHEDULE_BATCH = 100;

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: { age: 24 * 3600 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

/**
 * Runs one readiness check in the worker (EXT-CALL-007). A check never throws for what Meta says (it becomes a row of the checklist), so
 * a retry is only for a database or network fault. The job is its own request context: a system actor in the number's workspace, so
 * the audit rows of a switch-on say so.
 */
@Processor(QUEUES.CALLING_READINESS, { concurrency: 4 })
export class CallingReadinessProcessor extends WorkerHost {
  private readonly logger = new Logger(CallingReadinessProcessor.name);

  constructor(private readonly readiness: CallingReadinessService) {
    super();
  }

  async process(job: Job<CallingReadinessJob>): Promise<{ status: string }> {
    const { orgId, numberUuid, source } = job.data;
    return RequestContextStore.run(
      {
        requestId: `calling-readiness-${job.id}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      async () => {
        try {
          const r = await this.readiness.check(numberUuid, source, {
            autoEnable: source === 'connect',
            // The worker is the only place that may add the `calls` field to the platform's Meta app.
            repair: true,
          });
          this.logger.log(
            { orgId, number: numberUuid, status: r.status, source },
            'calling readiness checked',
          );
          return { status: r.status };
        } catch (err) {
          // The number was removed, or is not a Cloud API number: nothing to look at, retrying will not change it.
          if (err instanceof AppError) throw new UnrecoverableError(err.message);
          throw err;
        }
      },
    );
  }
}

/**
 * A number was connected or reconnected (the WABA domain's `whatsapp.connection.connected`): look at it for calling shortly after,
 * for workspaces whose plan has calling. Idempotent: the job id carries the event, so a redelivered event queues one job.
 */
@Injectable()
export class CallingConnectConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'calling-readiness-connect';
  readonly eventTypes = ['whatsapp.connection.connected'] as const;

  constructor(
    private readonly registry: OutboxSubscriberRegistry,
    private readonly plans: PlanEntitlementService,
    @InjectQueue(QUEUES.CALLING_READINESS) private readonly queue: Queue<CallingReadinessJob>,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const numberUuid = event.payload.connectionId;
    if (typeof numberUuid !== 'string') return;
    if (!(await this.plans.featureEnabled(event.orgId, 'waba_calling'))) return;
    await this.queue.add(
      'check',
      { orgId: event.orgId, numberUuid, source: 'connect' },
      {
        ...JOB_OPTIONS,
        jobId: `calling-readiness-connect-${event.id}`,
        delay: CONNECT_CHECK_DELAY_MS,
      },
    );
  }
}

/**
 * Looks at every number that is due, a few at a time (EXT-CALL-007): numbers with calling on, and numbers that have been prepared for
 * it, so a token that expired or a number whose quality dropped shows on the card before a call fails. Several workers may wake together;
 * the job id carries the minute, so a number is queued once per window.
 */
@Injectable()
export class CallingReadinessScheduler {
  private readonly logger = new Logger(CallingReadinessScheduler.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CallingReadinessRepository,
    @InjectQueue(QUEUES.CALLING_READINESS) private readonly queue: Queue<CallingReadinessJob>,
  ) {}

  @Interval(SCHEDULE_TICK_MS)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.enqueueDue();
      if (n > 0) this.logger.log({ queued: n }, '[CALL] readiness checks queued');
    } catch (err) {
      this.logger.error({ err: String(err) }, '[CALL] readiness schedule failed');
    } finally {
      this.running = false;
    }
  }

  async enqueueDue(now: Date = new Date()): Promise<number> {
    const due = await this.db.privileged((tx) => this.repo.due(tx, SCHEDULE_BATCH));
    if (due.length === 0) return 0;
    const window = Math.floor(now.getTime() / SCHEDULE_TICK_MS);
    try {
      await this.queue.addBulk(
        due.map((d) => ({
          name: 'check',
          data: { orgId: d.orgId, numberUuid: d.uuid, source: 'schedule' as const },
          opts: { ...JOB_OPTIONS, jobId: `calling-readiness-sched-${d.uuid}-${window}` },
        })),
      );
    } catch (err) {
      // The numbers were claimed (pushed half an hour on) before they were queued: give them back so the next tick takes them again.
      await this.db
        .privileged((tx) => this.repo.release(tx, due))
        .catch((e: unknown) =>
          this.logger.error({ err: String(e) }, '[CALL] could not give claimed numbers back'),
        );
      throw err;
    }
    return due.length;
  }
}
