import { describe, expect, it } from 'vitest';
import type { WizardFollowUp } from '@crm/contracts';
import { audience, draft, NOW, uuid } from '../testing';
import { defaultRule } from './schedule';
import { issueFor, sequenceMappingIssues, stepIssues, stepOfPath, unmappedSlots } from './issues';

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
    const d = draft({ audience: audience({ groupIds: [uuid(11)] }) });
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

describe('step 3 when the balance cannot be checked', () => {
  it('stops the broadcast: an unknown balance is not a sufficient one', () => {
    const out = stepIssues(3, draft(), { slots: [], now: NOW, credit: null, creditFailed: true });
    expect(out.map((i) => i.code)).toContain('balance_unavailable');
  });
});

describe('follow-up issues (step 4)', () => {
  const step = (action: WizardFollowUp['action']): WizardFollowUp => ({
    trigger: 'not_read',
    waitMinutes: 60,
    action,
  });
  const cloud = `waba:${uuid(31)}`;

  it('a step without its template or flow is reported on its own action path', () => {
    const d = draft({
      senderKey: cloud,
      followUps: [
        step({ kind: 'template', templateId: uuid(1) }),
        step({ kind: 'template', templateId: null }),
        step({ kind: 'flow', flowId: null }),
      ],
    });
    expect(stepIssues(4, d, ctx)).toEqual([
      { path: 'followUps.1.action', code: 'follow_up_template_required' },
      { path: 'followUps.2.action', code: 'follow_up_flow_required' },
    ]);
    expect(issueFor(stepIssues(4, d, ctx), 'followUps.2.action')?.code).toBe(
      'follow_up_flow_required',
    );
  });

  it('a complete step passes, and follow-ups on a non Cloud API number are refused', () => {
    const done = [step({ kind: 'flow', flowId: uuid(81) })];
    expect(stepIssues(4, draft({ senderKey: cloud, followUps: done }), ctx)).toEqual([]);
    expect(
      stepIssues(4, draft({ senderKey: `baileys:${uuid(40)}`, followUps: done }), ctx).map(
        (i) => i.code,
      ),
    ).toEqual(['follow_up_cloud_api_only']);
    expect(stepIssues(4, draft({ senderKey: `baileys:${uuid(40)}` }), ctx)).toEqual([]);
  });

  it('every follow-up path belongs to step 4', () => {
    expect(stepOfPath('followUps')).toBe(4);
    expect(stepOfPath('followUps.1.action')).toBe(4);
  });
});

describe('template sequence issues', () => {
  const rec = { mode: 'recurring' as const, rule: defaultRule('Asia/Kolkata', NOW) };
  const entry = (templateId: string | null, variables = {}) => ({ templateId, variables });

  it("step 3 reports each sequence template's unmapped slot on its own path and step", () => {
    const d = draft({
      schedule: rec,
      templateSequence: [
        entry(uuid(5), { 'body.1': { kind: 'fixed', text: 'x' } }),
        entry(uuid(6)),
      ],
    });
    const issues = stepIssues(3, d, {
      ...ctx,
      slots: [],
      slotsSequence: [['body.1', 'body.2'], ['body.1']],
    });
    expect(issues.map((i) => i.path)).toEqual([
      'templateSequence.0.variables.body.2',
      'templateSequence.1.variables.body.1',
    ]);
    expect(issues.every((i) => i.code === 'variable_unmapped')).toBe(true);
    expect(sequenceMappingIssues(issues, 1)).toEqual([
      { path: 'variables.body.1', code: 'variable_unmapped' },
    ]);
    expect(unmappedSlots(sequenceMappingIssues(issues, 0))).toEqual(['body.2']);
  });

  it('step 4 reports an empty entry, a sequence off a recurring schedule and one with A/B', () => {
    const base = { templateSequence: [entry(null)] };
    expect(stepIssues(4, draft({ ...base, schedule: rec }), ctx)).toEqual([
      { path: 'templateSequence.0.templateId', code: 'sequence_template_required' },
    ]);
    expect(
      stepIssues(4, draft({ templateSequence: [entry(uuid(5))] }), ctx).map((i) => i.code),
    ).toEqual(['sequence_not_recurring']);
    expect(
      stepIssues(
        4,
        draft({ templateSequence: [entry(uuid(5))], schedule: rec, abTesting: true }),
        ctx,
      ).map((i) => i.code),
    ).toEqual(['sequence_with_ab']);
    expect(
      stepIssues(4, draft({ templateSequence: [entry(uuid(5))], schedule: rec }), ctx),
    ).toEqual([]);
  });

  it('maps the paths to their step', () => {
    expect(stepOfPath('templateSequence.2.variables.body.1')).toBe(3);
    expect(stepOfPath('templateSequence.2.templateId')).toBe(4);
    expect(stepOfPath('templateSequence')).toBe(4);
  });
});
