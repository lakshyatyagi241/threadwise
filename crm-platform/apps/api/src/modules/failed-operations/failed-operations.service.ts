import { getQueueToken } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { JobsOptions, Queue } from 'bullmq';
import { AppError } from '../../common/errors/app-error';
import { CryptoService } from '../../common/crypto/crypto.service';
import { openJson } from '../../common/crypto/sealed-json';
import { sanitizeErrorText } from '../../common/errors/sanitize-error';
import { jobOptionsFor, type QueueName } from '../../infra/queue/queues';
import { AuthAuditService } from '../auth';
import {
  FailedOperationsRepository,
  type Actor,
  type FailedOperationRow,
  type ListFilter,
} from './failed-operations.repository';
import { POLICY_BY_QUEUE, replayJobId } from './failure-policy';
import { decideRecovery, type RecoveryCode } from './recovery-decision';
import type { FailedOperationStatus } from './failure-taxonomy';

export interface RedriveOutcome {
  redriven: boolean;
  code: RecoveryCode | 'NOT_REPLAYABLE' | 'ENQUEUE_FAILED' | 'LOST_CLAIM';
  reason: string;
  replay?: number;
}

/**
 * The operator's tools over failed operations: look, redrive one, close one.
 *
 * Redrive is the only way a failed operation goes back on a queue, and it is one record at a time. It reads the record, the workspace
 * and the policy itself (the request carries nothing but the id and the operator's statement that a repair was made), asks
 * {@link decideRecovery}, takes the record with a compare-and-swap, and only then enqueues the stored payload under a job id that
 * maps the outcome back to the record. A queue-level `job.retry` is never used: it would reset the attempt count and bypass this check.
 */
@Injectable()
export class FailedOperationsService {
  private readonly logger = new Logger(FailedOperationsService.name);

  constructor(
    private readonly repo: FailedOperationsRepository,
    private readonly crypto: CryptoService,
    private readonly moduleRef: ModuleRef,
    private readonly audit: AuthAuditService,
  ) {}

  queue(name: string): Queue {
    return this.moduleRef.get<Queue>(getQueueToken(name), { strict: false });
  }

  /** The queue's own options (fresh attempts, its backoff). A seam so a test can shorten the backoff without touching production policy. */
  protected replayOptions(queue: string): JobsOptions {
    return jobOptionsFor(queue as QueueName);
  }

  list(filter: ListFilter): Promise<FailedOperationRow[]> {
    return this.repo.list(filter);
  }

  async detail(uuid: string) {
    const row = await this.repo.byUuid(uuid);
    if (!row) throw AppError.notFound('failed operation', uuid);
    return { row, events: await this.repo.events(uuid) };
  }

  async redrive(
    uuid: string,
    operatorId: number,
    acknowledgedRepair: boolean,
  ): Promise<RedriveOutcome> {
    const actor: Actor = { type: 'platform_operator', id: operatorId };
    const row = await this.repo.byUuid(uuid);
    if (!row) throw AppError.notFound('failed operation', uuid);
    const policy = POLICY_BY_QUEUE.get(row.source_queue);
    if (!policy) {
      const out: RedriveOutcome = {
        redriven: false,
        code: 'NOT_REPLAYABLE',
        reason: 'This queue has no redrive policy',
      };
      await this.repo.reject(row, out.code, out.reason, actor);
      await this.auditRedrive(operatorId, row, 'rejected', out.code);
      return out;
    }
    const decision = decideRecovery({
      status: row.status,
      category: row.failure_category,
      tenantActive: row.org_id === null ? null : await this.repo.orgActive(row.org_id),
      hasPayload: row.has_payload,
      payloadSchemaVersion: row.payload_schema_version,
      currentSchemaVersion: policy.payloadSchemaVersion,
      replayCount: row.replay_count,
      maxReplays: policy.maxReplays,
      ageMs: Date.now() - row.first_failed_at.getTime(),
      maxAgeMs: policy.maxAgeMs,
      sinceLastReplayMs: row.last_replay_at ? Date.now() - row.last_replay_at.getTime() : null,
      cooldownMs: policy.cooldownMs,
      ambiguousReplaySafe: policy.ambiguousReplaySafe,
      acknowledgedRepair,
    });
    if (decision.action !== 'REDRIVE') {
      await this.repo.reject(row, decision.code, decision.reason, actor);
      await this.auditRedrive(operatorId, row, 'rejected', decision.code);
      return { redriven: false, code: decision.code, reason: decision.reason };
    }

    const claimed = await this.repo.claim(row, actor);
    if (!claimed) {
      await this.repo.reject(row, 'LOST_CLAIM', 'Another redrive took this operation first', actor);
      await this.auditRedrive(operatorId, row, 'rejected', 'LOST_CLAIM');
      return {
        redriven: false,
        code: 'LOST_CLAIM',
        reason: 'Another redrive took this operation first',
      };
    }
    try {
      const sealed = await this.repo.sealedPayload(uuid);
      if (sealed === null) throw new Error('payload missing after claim');
      const data = openJson<unknown>(this.crypto, sealed);
      // Fresh attempts under the queue's own policy; the id maps the outcome back to this record and makes a repeated add a no-op.
      await this.queue(row.source_queue).add(row.job_name, data, {
        ...this.replayOptions(row.source_queue),
        jobId: replayJobId(uuid, claimed.replay),
      });
    } catch (err) {
      const reason = sanitizeErrorText(err);
      await this.repo.revertClaim(uuid, row.status, reason, actor, row.last_replay_at);
      this.logger.error(
        { uuid, queue: row.source_queue },
        'redrive could not enqueue; claim reverted',
      );
      await this.auditRedrive(operatorId, row, 'enqueue_failed', 'ENQUEUE_FAILED');
      return { redriven: false, code: 'ENQUEUE_FAILED', reason };
    }
    await this.auditRedrive(operatorId, row, 'enqueued', 'OK', claimed.replay);
    return { redriven: true, code: 'OK', reason: decision.reason, replay: claimed.replay };
  }

  /** Closes an operation without running it: the event is accounted for elsewhere, stale or not worth running. Drops the payload. */
  async terminate(uuid: string, operatorId: number, reason: string): Promise<{ closed: boolean }> {
    const row = await this.repo.byUuid(uuid);
    if (!row) throw AppError.notFound('failed operation', uuid);
    const from: FailedOperationStatus[] = [
      'OPEN',
      'BLOCKED',
      'RECONCILIATION_REQUIRED',
      'READY_FOR_REDRIVE',
      'ESCALATED',
    ];
    const closed = await this.repo.close(uuid, 'TERMINAL', from, sanitizeErrorText(reason, 200), {
      type: 'platform_operator',
      id: operatorId,
    });
    if (closed) await this.auditRedrive(operatorId, row, 'terminated', 'OK');
    return { closed };
  }

  private async auditRedrive(
    operatorId: number,
    row: FailedOperationRow,
    outcome: string,
    code: string,
    replay?: number,
  ): Promise<void> {
    // Ids, queue and codes only: the audit trail never holds a payload or an error text. recordStandalone never throws.
    await this.audit.recordStandalone({
      event: 'platform.failed_operations.redrive',
      status: outcome === 'enqueued' || outcome === 'terminated' ? 'info' : 'warning',
      actorType: 'platform_operator',
      actorId: operatorId,
      orgId: row.org_id,
      payload: {
        failedOperation: row.uuid,
        queue: row.source_queue,
        outcome,
        code,
        ...(replay ? { replay } : {}),
      },
    });
  }
}
