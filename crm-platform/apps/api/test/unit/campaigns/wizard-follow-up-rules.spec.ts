import { describe, expect, it } from 'vitest';
import { wizardDraftSchema, wizardStepIssues } from '@crm/contracts';
import {
  FOLLOW_UP_POLL_MS,
  decideFollowUp,
  followUpDeadline,
  followUpStatusIsNewer,
  followUpsOf,
} from '../../../src/modules/campaigns/wizard/wizard-follow-up-rules';

const base = new Date('2026-12-01T10:00:00Z');
const at = (min: number) => new Date(base.getTime() + min * 60_000);
const look = (
  trigger: 'replied' | 'read' | 'not_replied' | 'not_read',
  waitMinutes: number,
  now: number,
  seen: { replied?: boolean; read?: boolean } = {},
) =>
  decideFollowUp(
    { trigger, waitMinutes },
    { now: at(now), baseAt: base, replied: seen.replied ?? false, read: seen.read ?? false },
  );

describe('the deadline of a step', () => {
  it('is the wait after the message before it', () => {
    expect(followUpDeadline(base, { waitMinutes: 90 }).toISOString()).toBe(
      '2026-12-01T11:30:00.000Z',
    );
  });
});

describe('"not replied" and "not read"', () => {
  it('wait until the deadline and look again exactly then', () => {
    expect(look('not_read', 60, 10)).toEqual({ kind: 'wait', checkAt: at(60) });
    expect(look('not_replied', 60, 59)).toEqual({ kind: 'wait', checkAt: at(60) });
  });
  it('fire at the deadline when the event is missing', () => {
    expect(look('not_read', 60, 60)).toEqual({ kind: 'fire' });
    expect(look('not_replied', 60, 600)).toEqual({ kind: 'fire' });
  });
  it('end the chain as soon as the event happened, without waiting for the deadline', () => {
    expect(look('not_read', 60, 5, { read: true })).toEqual({ kind: 'skip' });
    expect(look('not_replied', 60, 70, { replied: true })).toEqual({ kind: 'skip' });
  });
  it('are not fooled by the other event', () => {
    expect(look('not_read', 60, 61, { replied: true })).toEqual({ kind: 'fire' });
    expect(look('not_replied', 60, 61, { read: true })).toEqual({ kind: 'fire' });
  });
});

describe('"replied" and "read"', () => {
  it('fire the moment the event is there', () => {
    expect(look('replied', 240, 3, { replied: true })).toEqual({ kind: 'fire' });
    expect(look('read', 240, 3, { read: true })).toEqual({ kind: 'fire' });
  });
  it('look again after a minute, never later than the deadline', () => {
    expect(look('replied', 240, 3)).toEqual({
      kind: 'wait',
      checkAt: new Date(at(3).getTime() + FOLLOW_UP_POLL_MS),
    });
    expect(look('read', 10, 9.5)).toEqual({ kind: 'wait', checkAt: at(10) });
  });
  it('lapse when the time runs out without the event', () => {
    expect(look('replied', 90, 90)).toEqual({ kind: 'lapse' });
    expect(look('read', 90, 500)).toEqual({ kind: 'lapse' });
  });
  it('still fire on a late look when the event happened inside the time', () => {
    expect(look('replied', 90, 200, { replied: true })).toEqual({ kind: 'fire' });
  });
});

describe('the steps stored on a campaign', () => {
  const step = (trigger: string, wait: number) => ({
    trigger,
    waitMinutes: wait,
    action: { kind: 'template', templateId: '11111111-1111-4111-8111-111111111111' },
  });
  it('are read in order, and none for a draft that never had any', () => {
    expect(followUpsOf(null)).toEqual([]);
    expect(followUpsOf({ draft: { name: 'x' } })).toEqual([]);
    expect(
      followUpsOf({ draft: { followUps: [step('read', 10), step('not_replied', 20)] } }).map(
        (s) => s.trigger,
      ),
    ).toEqual(['read', 'not_replied']);
  });
  it('stop at the first one that is not valid (a later step is never run on its own)', () => {
    expect(
      followUpsOf({
        draft: { followUps: [step('read', 10), step('nonsense', 20), step('read', 5)] },
      }),
    ).toHaveLength(1);
  });
});

describe('a message status only moves forward', () => {
  it('sent < delivered < read; failed ends any', () => {
    expect(followUpStatusIsNewer(null, 'sent')).toBe(true);
    expect(followUpStatusIsNewer('sent', 'delivered')).toBe(true);
    expect(followUpStatusIsNewer('delivered', 'read')).toBe(true);
    expect(followUpStatusIsNewer('read', 'delivered')).toBe(false);
    expect(followUpStatusIsNewer('delivered', 'delivered')).toBe(false);
    expect(followUpStatusIsNewer('sent', 'failed')).toBe(true);
  });
});

describe('the draft rules for follow-ups', () => {
  const now = new Date('2026-12-01T00:00:00Z');
  const tpl = '22222222-2222-4222-8222-222222222222';
  const draft = (over: Record<string, unknown>) =>
    wizardDraftSchema.parse({ name: 'n', templateId: tpl, senderKey: `waba:${tpl}`, ...over });
  const issues = (d: ReturnType<typeof draft>) =>
    wizardStepIssues(4, d, { now }).filter((i) => i.path.startsWith('followUps'));

  it('a draft has none by default and at most three', () => {
    expect(draft({}).followUps).toEqual([]);
    const s = { trigger: 'read', waitMinutes: 5, action: { kind: 'template', templateId: tpl } };
    expect(() => draft({ followUps: [s, s, s, s] })).toThrow();
  });
  it('asks for a template or a flow on every step', () => {
    const d = draft({
      followUps: [
        { trigger: 'read', waitMinutes: 5, action: { kind: 'template', templateId: null } },
        { trigger: 'read', waitMinutes: 5, action: { kind: 'flow', flowId: null } },
      ],
    });
    expect(issues(d)).toEqual([
      { path: 'followUps.0.action', code: 'follow_up_template_required' },
      { path: 'followUps.1.action', code: 'follow_up_flow_required' },
    ]);
  });
  it('is for Cloud API numbers only', () => {
    const s = { trigger: 'read', waitMinutes: 5, action: { kind: 'template', templateId: tpl } };
    expect(issues(draft({ followUps: [s] }))).toEqual([]);
    expect(issues(draft({ followUps: [s], senderKey: `baileys:${tpl}` }))).toEqual([
      { path: 'followUps', code: 'follow_up_cloud_api_only' },
    ]);
  });
  it('keeps the wait inside one minute to seven days', () => {
    const s = (m: number) => ({
      trigger: 'read',
      waitMinutes: m,
      action: { kind: 'template', templateId: tpl },
    });
    expect(() => draft({ followUps: [s(0)] })).toThrow();
    expect(() => draft({ followUps: [s(10_081)] })).toThrow();
    expect(() => draft({ followUps: [s(10_080)] })).not.toThrow();
  });
});
