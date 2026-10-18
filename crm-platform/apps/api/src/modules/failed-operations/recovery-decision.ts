import type { FailedOperationStatus, FailureCategory } from './failure-taxonomy';

/**
 * Whether one failed operation may be put back on its queue. Pure: the service loads every input from the database or the workspace
 * itself, never from the caller, so a request cannot claim eligibility it does not have.
 *
 * The order is the standard's: closed work is not run again; a workspace that is gone or suspended has no authority; an outcome that
 * may have half happened is reconciled first (or, where the consumer is idempotent, allowed); then the bounds (age, count, cooldown).
 */
export type RecoveryAction = 'REDRIVE' | 'BLOCK' | 'RESOLVE' | 'RECONCILE';

export type RecoveryCode =
  | 'OK'
  | 'ALREADY_CLOSED'
  | 'BEING_REDRIVEN'
  | 'TENANT_INACTIVE'
  | 'NO_PAYLOAD'
  | 'SCHEMA_OUTDATED'
  | 'EXPIRED'
  | 'REPLAY_LIMIT'
  | 'COOLDOWN'
  | 'NEEDS_ACKNOWLEDGEMENT'
  | 'RECONCILE_FIRST'
  | 'ESCALATED';

export interface RecoveryInput {
  status: FailedOperationStatus;
  category: FailureCategory;
  /** null: the record names no workspace (it is found when the job runs). */
  tenantActive: boolean | null;
  hasPayload: boolean;
  payloadSchemaVersion: number;
  currentSchemaVersion: number;
  replayCount: number;
  maxReplays: number;
  ageMs: number;
  maxAgeMs: number;
  /** Milliseconds since the last redrive; null when there was none. */
  sinceLastReplayMs: number | null;
  cooldownMs: number;
  ambiguousReplaySafe: boolean;
  /** The operator states the cause of a BLOCKED record is repaired (a credential renewed, a rule or deploy fixed). */
  acknowledgedRepair: boolean;
}

export interface RecoveryDecision {
  action: RecoveryAction;
  code: RecoveryCode;
  reason: string;
}

const block = (code: RecoveryCode, reason: string): RecoveryDecision => ({
  action: 'BLOCK',
  code,
  reason,
});

export function decideRecovery(i: RecoveryInput): RecoveryDecision {
  if (i.status === 'RESOLVED' || i.status === 'TERMINAL') {
    return { action: 'RESOLVE', code: 'ALREADY_CLOSED', reason: 'The operation is already closed' };
  }
  if (i.status === 'REDRIVING') {
    return block('BEING_REDRIVEN', 'A redrive of this operation is already running');
  }
  if (i.status === 'ESCALATED') {
    return block(
      'ESCALATED',
      'Redrive limit reached; a person decides (terminate it or repair and acknowledge)',
    );
  }
  if (i.tenantActive === false) {
    return block(
      'TENANT_INACTIVE',
      'The workspace is suspended or deleted; it has no authority to run work',
    );
  }
  if (!i.hasPayload) {
    return block('NO_PAYLOAD', 'No payload is kept for this operation, so it cannot be re-queued');
  }
  if (i.payloadSchemaVersion !== i.currentSchemaVersion) {
    return block(
      'SCHEMA_OUTDATED',
      'The payload was captured with an older job shape than the worker reads',
    );
  }
  if (i.ageMs > i.maxAgeMs) {
    return block('EXPIRED', 'The operation is older than the redrive window; close it instead');
  }
  if (i.status === 'RECONCILIATION_REQUIRED' && !i.ambiguousReplaySafe) {
    return {
      action: 'RECONCILE',
      code: 'RECONCILE_FIRST',
      reason:
        'The outcome may have partly happened and the consumer is not idempotent; establish what happened first',
    };
  }
  if (i.status === 'BLOCKED' && !i.acknowledgedRepair) {
    return block(
      'NEEDS_ACKNOWLEDGEMENT',
      'A retry cannot fix this by itself; confirm the cause is repaired to redrive',
    );
  }
  if (i.replayCount >= i.maxReplays) {
    return block('REPLAY_LIMIT', 'Redriven the maximum number of times');
  }
  if (i.sinceLastReplayMs !== null && i.sinceLastReplayMs < i.cooldownMs) {
    return block('COOLDOWN', 'Redriven a moment ago; wait for the cooldown');
  }
  return { action: 'REDRIVE', code: 'OK', reason: 'Replay prerequisites satisfied' };
}
