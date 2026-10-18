import { WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { Interval } from '@nestjs/schedule';
import type { Job } from 'bullmq';
import { getRuntimeMonitor } from '@crm/observability';
import { sanitizeErrorText } from '../../common/errors/sanitize-error';
import { FailedOperationsRepository } from './failed-operations.repository';
import { FailedOperationsService } from './failed-operations.service';
import { FailureRecorder } from './failure-recorder';
import { FAILURE_POLICIES, POLICY_BY_QUEUE, parseReplayJobId, replayJobId } from './failure-policy';
import { classifyFailure, initialStatus } from './failure-taxonomy';

/** How long a record may sit REDRIVING before the sweep checks whether its job ever ran. */
export const STALE_REDRIVE_MS = 10 * 60 * 1000;
/** Closed records are kept this long (evidence), then deleted. Unresolved records are never deleted. */
export const CLOSED_RETENTION_DAYS = 30;
const SWEEP_BATCH = 500;
const CAPTURE_RETRIES = [0, 200, 1_000];

interface ObservableJobWorker {
  name: string;
  on(event: 'failed', l: (job: Job | undefined, err: Error) => void): unknown;
  on(event: 'completed', l: (job: Job) => void): unknown;
}

/** True when this `failed` event is the job's last: BullMQ emits it for every failed attempt, including ones it will retry. */
export function isFinalFailure(job: Pick<Job, 'attemptsMade' | 'opts'>, err: Error): boolean {
  return err.name === 'UnrecoverableError' || job.attemptsMade >= (job.opts?.attempts ?? 1);
}

/**
 * Worker side of the dead-letter store, in one place for every processor (the way job metrics are attached), so a queue is covered by
 * listing it in the failure policy and a new processor needs no edit.
 *
 * Two paths write the record, and both are idempotent per job: the live `failed` event (detection within a second) and the reconcile
 * sweep, which reads each policy queue's failed set. The sweep is what makes capture survive the database being down at the moment of
 * failure, a worker killed between "job failed" and "record written", and a missed event: the job stays in the failed set until its
 * 3-day retention, and the sweep runs every minute, so a record is late, never lost. A failed write is counted
 * (`crm_dead_letter_capture_failures_total`) so that lateness is visible.
 */
@Injectable()
export class FailureCaptureService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FailureCaptureService.name);
  private sweeping = false;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly recorder: FailureRecorder,
    private readonly repo: FailedOperationsRepository,
    private readonly ops: FailedOperationsService,
  ) {}

  onApplicationBootstrap(): number {
    let attached = 0;
    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.instance;
      if (!(instance instanceof WorkerHost)) continue;
      let worker: ObservableJobWorker;
      try {
        worker = instance.worker as unknown as ObservableJobWorker;
        if (!POLICY_BY_QUEUE.has(worker.name)) continue;
        worker.on('failed', (job, err) => void this.onFailed(worker.name, job, err));
        worker.on('completed', (job) => void this.onCompleted(worker.name, job));
        attached += 1;
      } catch (err) {
        this.logger.warn(
          { err: sanitizeErrorText(err), processor: wrapper.name },
          'failure capture not attached to a worker',
        );
      }
    }
    return attached;
  }

  async onFailed(queue: string, job: Job | undefined, err: Error): Promise<void> {
    if (!job || !isFinalFailure(job, err)) return;
    try {
      const replay = parseReplayJobId(job.id);
      if (replay) {
        await this.onReplayFailed(replay.uuid, job, err);
        return;
      }
      await this.captureWithRetry(
        queue,
        job,
        err.name === 'UnrecoverableError' || job.attemptsMade < (job.opts?.attempts ?? 1),
        err,
      );
    } catch (e) {
      // Never throw out of an event handler. The job is still in the failed set; the sweep records it.
      getRuntimeMonitor()?.observeDeadLetterCaptureFailure(queue);
      this.logger.error(
        { queue, jobId: job.id, err: sanitizeErrorText(e) },
        'could not record a failed operation; the sweep will retry',
      );
    }
  }

  async onCompleted(queue: string, job: Job): Promise<void> {
    const replay = parseReplayJobId(job.id);
    if (!replay || !POLICY_BY_QUEUE.has(queue)) return;
    try {
      await this.repo.close(replay.uuid, 'RESOLVED', ['REDRIVING'], 'Redrive completed', {
        type: 'system',
        id: null,
      });
    } catch (e) {
      this.logger.error(
        { queue, err: sanitizeErrorText(e) },
        'could not close a redriven operation; the sweep will',
      );
    }
  }

  private async captureWithRetry(
    queue: string,
    job: Job,
    unrecoverable: boolean,
    err?: Error,
  ): Promise<void> {
    let last: unknown;
    for (const wait of CAPTURE_RETRIES) {
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        await this.recorder.record(queue, job, unrecoverable, err);
        return;
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }

  /** A redriven job failed again: back to a state a person can act on, or ESCALATED once the replay budget is used. */
  private async onReplayFailed(
    uuid: string,
    job: Pick<Job, 'attemptsMade' | 'opts' | 'failedReason'>,
    err?: Error,
  ): Promise<void> {
    const row = await this.repo.byUuid(uuid);
    if (!row) return;
    const policy = POLICY_BY_QUEUE.get(row.source_queue);
    if (!policy) return;
    const maxAttempts = Math.max(1, job.opts?.attempts ?? 1);
    const message = err?.message ?? job.failedReason ?? '';
    const { category, code } = classifyFailure({
      errorMessage: message,
      unrecoverable: err?.name === 'UnrecoverableError' || job.attemptsMade < maxAttempts,
      attemptsMade: job.attemptsMade,
      maxAttempts,
    });
    await this.repo.replayFailed(uuid, {
      status:
        row.replay_count >= policy.maxReplays
          ? 'ESCALATED'
          : initialStatus(category, policy.ambiguousReplaySafe),
      category,
      errorCode: code,
      summary: sanitizeErrorText(message),
      attemptsMade: job.attemptsMade,
    });
  }

  /** Every minute: record what the live event missed, settle redrives that lost their report, publish the backlog, drop old closed rows. */
  @Interval(60_000)
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.captureFailedSets();
      await this.settleStaleRedrives();
      await this.publishBacklog();
      await this.repo.purgeClosed(CLOSED_RETENTION_DAYS);
    } catch (err) {
      this.logger.error({ err: sanitizeErrorText(err) }, 'failed-operation sweep failed');
    } finally {
      this.sweeping = false;
    }
  }

  async captureFailedSets(): Promise<number> {
    let recorded = 0;
    for (const policy of FAILURE_POLICIES) {
      const jobs = await this.ops.queue(policy.queue).getFailed(0, SWEEP_BATCH - 1);
      for (const job of jobs) {
        try {
          const replay = parseReplayJobId(job.id);
          if (replay) await this.onReplayFailed(replay.uuid, job);
          else {
            const r = await this.recorder.record(
              policy.queue,
              job,
              job.attemptsMade < (job.opts?.attempts ?? 1),
            );
            if (r.created) recorded += 1;
          }
        } catch (err) {
          getRuntimeMonitor()?.observeDeadLetterCaptureFailure(policy.queue);
          this.logger.error(
            { queue: policy.queue, jobId: job.id, err: sanitizeErrorText(err) },
            'sweep could not record a failed operation',
          );
        }
      }
    }
    return recorded;
  }

  async settleStaleRedrives(): Promise<void> {
    for (const stale of await this.repo.staleRedriving(STALE_REDRIVE_MS)) {
      const job = await this.ops
        .queue(stale.source_queue)
        .getJob(replayJobId(stale.uuid, stale.replay_count));
      const state = job ? await job.getState() : 'unknown';
      if (state === 'completed') {
        await this.repo.close(stale.uuid, 'RESOLVED', ['REDRIVING'], 'Redrive completed', {
          type: 'system',
          id: null,
        });
      } else if (state === 'failed' && job) {
        await this.onReplayFailed(stale.uuid, job);
      } else if (state === 'unknown') {
        // The claim was taken and no job exists (the enqueuer died, or a completed job was already dropped): hand it back to a person.
        await this.repo.markStale(stale.uuid);
      }
      // waiting / active / delayed: still running; check again next minute.
    }
  }

  async publishBacklog(): Promise<void> {
    const monitor = getRuntimeMonitor();
    if (!monitor) return;
    const seen = new Set<string>();
    for (const b of await this.repo.backlog()) {
      seen.add(b.queue);
      monitor.setDeadLetterBacklog(b.queue, b.open, b.oldestSeconds);
    }
    // A queue that drained must read 0, not keep its last value.
    for (const p of FAILURE_POLICIES)
      if (!seen.has(p.queue)) monitor.setDeadLetterBacklog(p.queue, 0, 0);
  }
}
