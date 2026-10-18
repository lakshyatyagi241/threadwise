import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { getRuntimeMonitor } from '@crm/observability';
import { CryptoService } from '../../common/crypto/crypto.service';
import { sanitizeErrorText } from '../../common/errors/sanitize-error';
import { sealJson } from '../../common/crypto/sealed-json';
import { classifyFailure, initialStatus } from './failure-taxonomy';
import { POLICY_BY_QUEUE, POLICY_VERSION } from './failure-policy';
import { FailedOperationsRepository } from './failed-operations.repository';

/** The slice of a BullMQ `Job` a record is built from. Structural, so it is testable without Redis. */
export interface FailedJobFacts {
  id?: string | undefined;
  name: string;
  data: unknown;
  attemptsMade: number;
  timestamp?: number | undefined;
  finishedOn?: number | undefined;
  failedReason?: string | undefined;
  opts?: { attempts?: number | undefined } | undefined;
}

export interface RecordResult {
  recorded: boolean;
  created: boolean;
  uuid: string | null;
}

/**
 * Turns a job that is out of retries into a durable failed-operation record. Used by the worker's failure hook and its reconcile
 * sweep, and by the operator replay that finds a job in a failed set. Idempotent per (queue, job id): the second report of the same
 * failure is a no-op.
 *
 * What is kept: identity, a stable code, a scrubbed one-line summary, counts, a hash of the payload, and the payload SEALED with the
 * credentials key (AES-256-GCM) so the work can be redriven after the queue has dropped the job. Closing the record deletes the payload.
 */
@Injectable()
export class FailureRecorder {
  private readonly logger = new Logger(FailureRecorder.name);

  constructor(
    private readonly repo: FailedOperationsRepository,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * `unrecoverable`: the processor threw an UnrecoverableError (the job skipped its remaining attempts). A job read from a failed set
   * is final by definition, so a count below its limit means exactly that.
   */
  async record(
    queue: string,
    job: FailedJobFacts,
    unrecoverable: boolean,
    err?: unknown,
  ): Promise<RecordResult> {
    const policy = POLICY_BY_QUEUE.get(queue);
    if (!policy || job.id === undefined) return { recorded: false, created: false, uuid: null };
    const maxAttempts = Math.max(1, job.opts?.attempts ?? 1);
    const message = err instanceof Error ? err.message : (job.failedReason ?? '');
    const { category, code } = classifyFailure({
      errorMessage: message,
      unrecoverable,
      attemptsMade: job.attemptsMade,
      maxAttempts,
    });
    const json = JSON.stringify(job.data ?? null);
    const failedAt = new Date(job.finishedOn ?? Date.now());
    const result = await this.repo.capture({
      orgId: policy.orgOf(job.data),
      sourceQueue: queue,
      jobName: job.name,
      originalJobId: job.id,
      status: initialStatus(category, policy.ambiguousReplaySafe),
      category,
      errorCode: code,
      errorSummary: sanitizeErrorText(message),
      attemptsMade: job.attemptsMade,
      maxAttempts,
      payloadHash: createHash('sha256').update(json).digest('hex'),
      payloadSealed: sealJson(this.crypto, job.data ?? null),
      payloadSchemaVersion: policy.payloadSchemaVersion,
      correlationId: null,
      policyVersion: POLICY_VERSION,
      firstFailedAt: job.timestamp ? new Date(job.timestamp) : failedAt,
      lastFailedAt: failedAt,
    });
    if (result.created) {
      getRuntimeMonitor()?.observeDeadLetter(queue, category);
      // Ids and counts only: the payload, the error text and the workspace never go to a log line.
      this.logger.error(
        { queue, jobId: job.id, category, code, attemptsMade: job.attemptsMade },
        'operation failed for good; recorded',
      );
    }
    return { recorded: true, ...result };
  }
}
