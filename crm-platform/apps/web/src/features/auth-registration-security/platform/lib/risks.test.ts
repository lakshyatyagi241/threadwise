import { describe, expect, it } from 'vitest';
import {
  riskDetail,
  riskOwner,
  riskRowTone,
  riskWorkspace,
  seeAllRisksHref,
  shapeRisk,
} from './risks';

const risk = {
  severity: 'high' as const,
  signal: 'auth.lockout',
  detail: 'ann@example.com',
  workspace: 'Acme Ltd',
  scope: 'workspace' as const,
  actor: 'Ann Lee',
  actorKind: 'user' as const,
  at: '2026-10-01T10:00:00.000Z',
};

describe('riskDetail', () => {
  it('hides a detail that is empty or only repeats the signal', () => {
    expect(riskDetail('auth.lockout', 'auth.lockout')).toBeNull();
    expect(riskDetail('auth.lockout', '  auth.lockout ')).toBeNull();
    expect(riskDetail('auth.lockout', '')).toBeNull();
    expect(riskDetail('auth.lockout', '   ')).toBeNull();
  });
  it('keeps a detail that says something else', () => {
    expect(riskDetail('auth.lockout', 'ann@example.com')).toBe('ann@example.com');
  });
});

describe('riskWorkspace', () => {
  it('names the workspace when there is one', () => {
    expect(riskWorkspace({ workspace: 'Acme Ltd', scope: 'workspace' })).toEqual({
      kind: 'name',
      name: 'Acme Ltd',
    });
  });
  it('reads a platform-level event as the app platform', () => {
    expect(riskWorkspace({ workspace: null, scope: 'platform' })).toEqual({ kind: 'platform' });
    expect(riskWorkspace({ workspace: '  ', scope: 'platform' })).toEqual({ kind: 'platform' });
  });
  it('shows a dash for an event that belongs to nothing', () => {
    expect(riskWorkspace({ workspace: null, scope: 'none' })).toEqual({ kind: 'none' });
    expect(riskWorkspace({ workspace: null, scope: 'workspace' })).toEqual({ kind: 'none' });
  });
});

describe('riskOwner', () => {
  it('shows the person name the API resolved', () => {
    expect(riskOwner({ actor: ' Ann Lee ', actorKind: 'user' })).toEqual({
      kind: 'name',
      name: 'Ann Lee',
    });
    expect(riskOwner({ actor: 'Sam Ops', actorKind: 'platform_operator' })).toEqual({
      kind: 'name',
      name: 'Sam Ops',
    });
  });
  it('reads a system actor as System whatever the label says', () => {
    expect(riskOwner({ actor: 'System', actorKind: 'system' })).toEqual({ kind: 'system' });
    expect(riskOwner({ actor: '', actorKind: 'system' })).toEqual({ kind: 'system' });
  });
  it('falls back to the kind of actor when a person has no name left', () => {
    expect(riskOwner({ actor: '  ', actorKind: 'user' })).toEqual({ kind: 'type', type: 'user' });
    expect(riskOwner({ actor: '', actorKind: 'platform_operator' })).toEqual({
      kind: 'type',
      type: 'platform_operator',
    });
  });
});

describe('shapeRisk', () => {
  it('builds the row and the Inspect link filtered to the signal', () => {
    expect(shapeRisk(risk)).toEqual({
      severity: 'high',
      signal: 'auth.lockout',
      detail: 'ann@example.com',
      workspace: { kind: 'name', name: 'Acme Ltd' },
      owner: { kind: 'name', name: 'Ann Lee' },
      at: '2026-10-01T10:00:00.000Z',
      inspectHref: '/admin/security/events?event=auth.lockout',
    });
  });
  it('drops the detail line when it equals the signal', () => {
    expect(shapeRisk({ ...risk, detail: 'auth.lockout' }).detail).toBeNull();
  });
  it('encodes a signal that needs it in the link', () => {
    expect(shapeRisk({ ...risk, signal: 'a b&c' }).inspectHref).toBe(
      '/admin/security/events?event=a+b%26c',
    );
  });
});

describe('seeAllRisksHref', () => {
  it('opens the viewer on failures', () => {
    expect(seeAllRisksHref()).toBe('/admin/security/events?status=failure');
  });
});

describe('riskRowTone', () => {
  it('tints high rows red and medium rows amber', () => {
    expect(riskRowTone('high')).toBe('danger');
    expect(riskRowTone('medium')).toBe('warning');
    expect(riskRowTone('watch')).toBeNull();
  });
});
