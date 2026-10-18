import { describe, expect, it } from 'vitest';
import { decideRecovery, type RecoveryInput } from './recovery-decision';

const ok: RecoveryInput = {
  status: 'OPEN',
  category: 'TRANSIENT',
  tenantActive: true,
  hasPayload: true,
  payloadSchemaVersion: 1,
  currentSchemaVersion: 1,
  replayCount: 0,
  maxReplays: 3,
  ageMs: 1000,
  maxAgeMs: 86_400_000,
  sinceLastReplayMs: null,
  cooldownMs: 60_000,
  ambiguousReplaySafe: true,
  acknowledgedRepair: false,
};
const decide = (over: Partial<RecoveryInput>) => decideRecovery({ ...ok, ...over });

describe('decideRecovery', () => {
  it('redrives an open, recent, authorized operation', () => {
    expect(decide({})).toMatchObject({ action: 'REDRIVE', code: 'OK' });
  });

  it.each(['RESOLVED', 'TERMINAL'] as const)('never runs %s work again', (status) => {
    expect(decide({ status })).toMatchObject({ action: 'RESOLVE', code: 'ALREADY_CLOSED' });
  });

  it('refuses a second redrive while one is running', () => {
    expect(decide({ status: 'REDRIVING' })).toMatchObject({
      action: 'BLOCK',
      code: 'BEING_REDRIVEN',
    });
  });

  it('refuses an escalated operation: a person decides', () => {
    expect(decide({ status: 'ESCALATED' })).toMatchObject({ action: 'BLOCK', code: 'ESCALATED' });
  });

  it('refuses a suspended or deleted workspace, but not one the record does not name', () => {
    expect(decide({ tenantActive: false })).toMatchObject({
      action: 'BLOCK',
      code: 'TENANT_INACTIVE',
    });
    expect(decide({ tenantActive: null }).action).toBe('REDRIVE');
  });

  it('refuses when no payload is kept', () => {
    expect(decide({ hasPayload: false })).toMatchObject({ code: 'NO_PAYLOAD' });
  });

  it('refuses a payload shaped for another version of the worker', () => {
    expect(decide({ payloadSchemaVersion: 1, currentSchemaVersion: 2 })).toMatchObject({
      code: 'SCHEMA_OUTDATED',
    });
  });

  it('refuses an operation past the redrive window', () => {
    expect(decide({ ageMs: 86_400_001 })).toMatchObject({ code: 'EXPIRED' });
  });

  it('sends an ambiguous outcome to reconciliation when the consumer is not idempotent', () => {
    expect(decide({ status: 'RECONCILIATION_REQUIRED', ambiguousReplaySafe: false })).toMatchObject(
      {
        action: 'RECONCILE',
        code: 'RECONCILE_FIRST',
      },
    );
    expect(decide({ status: 'RECONCILIATION_REQUIRED', ambiguousReplaySafe: true }).action).toBe(
      'REDRIVE',
    );
  });

  it('a blocked operation needs the operator to confirm the repair', () => {
    expect(decide({ status: 'BLOCKED', category: 'AUTHORIZATION' })).toMatchObject({
      code: 'NEEDS_ACKNOWLEDGEMENT',
    });
    expect(
      decide({ status: 'BLOCKED', category: 'AUTHORIZATION', acknowledgedRepair: true }).action,
    ).toBe('REDRIVE');
  });

  it('is finite: the replay budget ends in a refusal', () => {
    expect(decide({ replayCount: 2 }).action).toBe('REDRIVE');
    expect(decide({ replayCount: 3 })).toMatchObject({ action: 'BLOCK', code: 'REPLAY_LIMIT' });
  });

  it('waits out the cooldown', () => {
    expect(decide({ sinceLastReplayMs: 59_999 })).toMatchObject({ code: 'COOLDOWN' });
    expect(decide({ sinceLastReplayMs: 60_000 }).action).toBe('REDRIVE');
  });

  it('checks the workspace before anything that depends on the payload', () => {
    expect(decide({ tenantActive: false, hasPayload: false }).code).toBe('TENANT_INACTIVE');
  });
});
