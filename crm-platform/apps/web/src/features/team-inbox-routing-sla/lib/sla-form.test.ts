import { describe, expect, it } from 'vitest';
import type { InboxSlaPolicy } from '@crm/contracts';
import { draftOf, emptyDraft, minutesOf, toInput } from './sla-form';

const policy = (over: Partial<InboxSlaPolicy> = {}): InboxSlaPolicy => ({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Standard',
  firstResponseMinutes: 30,
  resolutionMinutes: 1440,
  pauseWhenWaitingOnCustomer: true,
  respectBusinessHours: false,
  priorityOverrides: { urgent: { firstResponseMinutes: 5 } },
  isDefault: true,
  conversationCount: 2,
  rowVersion: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('minutesOf', () => {
  it('empty is no target, a whole number in range is the number, anything else is invalid', () => {
    expect(minutesOf('', 100)).toBeNull();
    expect(minutesOf('  ', 100)).toBeNull();
    expect(minutesOf('45', 100)).toBe(45);
    for (const bad of ['0', '-5', '1.5', 'abc', '101', '1e3', '2 3']) {
      expect(minutesOf(bad, 100), bad).toBeUndefined();
    }
  });
});

describe('the policy form', () => {
  it('the first policy of a workspace starts as the default, the others do not', () => {
    expect(emptyDraft(true).isDefault).toBe(true);
    expect(emptyDraft(false).isDefault).toBe(false);
  });

  it('round-trips a policy through the form', () => {
    const d = draftOf(policy());
    expect(d).toMatchObject({
      name: 'Standard',
      firstResponse: '30',
      resolution: '1440',
      pause: true,
      businessHours: false,
      isDefault: true,
    });
    expect(d.overrides.urgent).toEqual(['5', '']);
    const out = toInput(d);
    expect(out.ok && out.value).toMatchObject({
      name: 'Standard',
      firstResponseMinutes: 30,
      resolutionMinutes: 1440,
      pauseWhenWaitingOnCustomer: true,
      respectBusinessHours: false,
      priorityOverrides: { urgent: { firstResponseMinutes: 5 } },
      isDefault: true,
    });
  });

  it('leaves out priorities with no targets and sends null for an empty target', () => {
    const d = { ...emptyDraft(false), name: ' VIP ', firstResponse: '10' };
    const out = toInput(d);
    expect(out.ok && out.value).toEqual({
      name: 'VIP',
      firstResponseMinutes: 10,
      resolutionMinutes: null,
      pauseWhenWaitingOnCustomer: true,
      respectBusinessHours: true,
      priorityOverrides: {},
      isDefault: false,
    });
  });

  it('refuses an empty name and bad minutes anywhere, overrides included', () => {
    expect(toInput({ ...emptyDraft(false), name: ' ' })).toEqual({ ok: false, problem: 'name' });
    expect(toInput({ ...emptyDraft(false), name: 'x', firstResponse: '0' })).toEqual({
      ok: false,
      problem: 'minutes',
    });
    const d = emptyDraft(false);
    d.name = 'x';
    d.overrides.high = ['abc', ''];
    expect(toInput(d)).toEqual({ ok: false, problem: 'minutes' });
  });
});
