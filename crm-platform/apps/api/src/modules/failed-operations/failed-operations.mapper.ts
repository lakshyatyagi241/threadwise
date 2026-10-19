import type { FailedOperation, FailedOperationDetail } from '@crm/contracts';
import type { FailedOperationRow } from './failed-operations.repository';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** The only place a row becomes a response: no internal id, no sealed payload. */
export function toFailedOperation(r: FailedOperationRow): FailedOperation {
  return {
    uuid: r.uuid,
    sourceQueue: r.source_queue,
    jobName: r.job_name,
    originalJobId: r.original_job_id,
    orgId: r.org_id === null ? null : Number(r.org_id),
    status: r.status,
    failureCategory: r.failure_category,
    errorCode: r.error_code,
    errorSummary: r.error_summary,
    attemptsMade: r.attempts_made,
    maxAttempts: r.max_attempts,
    hasPayload: r.has_payload,
    replayCount: r.replay_count,
    lastReplayAt: iso(r.last_replay_at),
    resolvedAt: iso(r.resolved_at),
    resolutionReason: r.resolution_reason,
    firstFailedAt: r.first_failed_at.toISOString(),
    lastFailedAt: r.last_failed_at.toISOString(),
  };
}

export function toDetail(
  r: FailedOperationRow,
  events: Array<{
    eventType: string;
    actorType: string;
    actorId: number | null;
    detail: unknown;
    createdAt: Date;
  }>,
): FailedOperationDetail {
  return {
    ...toFailedOperation(r),
    events: events.map((e) => ({
      eventType: e.eventType,
      actorType: e.actorType,
      actorId: e.actorId,
      detail: (e.detail && typeof e.detail === 'object' ? e.detail : {}) as Record<string, unknown>,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}
