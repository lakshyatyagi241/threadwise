import { describe, expect, it } from 'vitest';
import { draft, NOW, uuid } from '../testing';
import { issueFor, stepIssues, stepOfPath, unmappedSlots } from './issues';

const ctx = { slots: ['body.1', 'body.2'], now: NOW };

describe('stepIssues', () => {
  it('step 1 needs a name and a template', () => {
    const codes = stepIssues(1, draft(), ctx).map((i) => i.code);
    expect(codes).toEqual(['name_required', 'template_required', 'sender_required']);
    expect(
      stepIssues(1, draft({ name: 'A', templateId: uuid(1), senderKey: `waba:${uuid(31)}` }), ctx),
    ).toEqual([]);
  });

  it('step 2 needs a source, and blocks a known empty audience', () => {
    expect(stepIssues(2, draft(), ctx).map((i) => i.code)).toEqual(['audience_required']);
    const d = draft({ audience: { groupIds: [uuid(11)], segmentIds: [], rules: null } });
    expect(stepIssues(2, d, ctx)).toEqual([]);
    expect(stepIssues(2, d, { ...ctx, count: { recipients: 0 } }).map((i) => i.code)).toEqual([
      'no_recipients',
    ]);
    expect(stepIssues(2, d, { ...ctx, count: { recipients: 5 } })).toEqual([]);
  });

  it('step 3 lists the unmapped variables', () => {
    const d = draft({ variables: { 'body.1': { kind: 'fixed', text: 'x' } } });
    const issues = stepIssues(3, d, ctx);
    expect(unmappedSlots(issues)).toEqual(['body.2']);
    expect(issueFor(issues, 'variables.body.2')?.code).toBe('variable_unmapped');
  });

  it('step 3 is blocked while the wallet is being checked and when it is short', () => {
    const d = draft({
      variables: { 'body.1': { kind: 'fixed', text: 'x' }, 'body.2': { kind: 'fixed', text: 'y' } },
    });
    expect(stepIssues(3, d, { ...ctx, creditPending: true }).map((i) => i.code)).toEqual([
      'checking_balance',
    ]);
    expect(
      stepIssues(3, d, { ...ctx, credit: { sufficient: false, recipients: 10 } }).map(
        (i) => i.code,
      ),
    ).toEqual(['insufficient_balance']);
    expect(stepIssues(3, d, { ...ctx, credit: { sufficient: true, recipients: 10 } })).toEqual([]);
    expect(
      stepIssues(3, d, { ...ctx, credit: { sufficient: true, recipients: 0 } }).map((i) => i.code),
    ).toEqual(['no_recipients']);
  });

  it('step 4: a scheduled time in the past, an empty date, and retries need an end date', () => {
    const past = draft({
      schedule: { mode: 'scheduled', date: '2026-10-05', time: '09:00', timezone: 'Asia/Kolkata' },
    });
    expect(stepIssues(4, past, ctx).map((i) => i.code)).toEqual(['schedule_in_past']);
    const empty = draft({
      schedule: { mode: 'scheduled', date: '', time: '09:00', timezone: 'UTC' },
    });
    expect(stepIssues(4, empty, ctx).map((i) => i.code)).toEqual(['schedule_required']);
    const retry = draft({ retries: { enabled: true, endDate: null, timezone: null } });
    expect(stepIssues(4, retry, ctx).map((i) => i.code)).toEqual(['retry_end_required']);
    expect(stepIssues(4, draft(), ctx)).toEqual([]);
  });

  it('step 4: an unknown time zone is reported, not thrown', () => {
    const bad = draft({
      schedule: { mode: 'scheduled', date: '2026-12-01', time: '09:00', timezone: 'Mars/Base' },
    });
    expect(() => stepIssues(4, bad, ctx)).not.toThrow();
    expect(stepIssues(4, bad, ctx).length).toBeGreaterThan(0);
  });

  it('step 4: a recurring rule in the future is fine, an invalid one is not', () => {
    const rule = {
      frequency: 'weekly' as const,
      interval: 1,
      startDate: '2026-10-12',
      timeOfDay: '09:00',
      timezone: 'Asia/Kolkata',
      weekdays: [1, 3],
      monthDay: null,
      ends: { kind: 'never' as const },
    };
    expect(stepIssues(4, draft({ schedule: { mode: 'recurring', rule } }), ctx)).toEqual([]);
    const bad = draft({ schedule: { mode: 'recurring', rule: { ...rule, interval: 0 } } });
    expect(stepIssues(4, bad, ctx).map((i) => i.code)).toEqual(['recurrence_invalid']);
    const blank = draft({ schedule: { mode: 'recurring', rule: { ...rule, startDate: '' } } });
    expect(stepIssues(4, blank, ctx).map((i) => i.code)).toEqual(['schedule_required']);
  });
});

describe('stepOfPath', () => {
  it('maps a draft path to the step that owns it', () => {
    expect(stepOfPath('name')).toBe(1);
    expect(stepOfPath('templateId')).toBe(1);
    expect(stepOfPath('audience')).toBe(2);
    expect(stepOfPath('audience.rules')).toBe(2);
    expect(stepOfPath('variables.body.1')).toBe(3);
    expect(stepOfPath('schedule.date')).toBe(4);
    expect(stepOfPath('retries.endDate')).toBe(4);
    expect(stepOfPath('something.else')).toBe(4);
  });
});
