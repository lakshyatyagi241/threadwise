import { describe, expect, it } from 'vitest';
import { derivePlan } from '../load/core';
import { consentOf, planSettings, stagesOf } from '../load/orgsettings';

// shapes read from the real Waboo workspace support+demo (geta_core + tenant database), 2026-10-18
const sales = [
  { id: 'f77ujco2', name: 'Lead', probability: 10 },
  { id: 'gWCU99jc', name: 'Qualified', probability: 25 },
  { id: 'GKfcxvfh', name: 'Proposal', probability: 50 },
  { id: 'icPRK9BX', name: 'Negotiation', probability: 75 },
  { id: '3hrZ8Fpi', name: 'Closed Won', probability: 100 },
];
const support = [
  { name: 'New', probability: 10 },
  { name: 'In Progress', probability: 50 },
  { name: 'Resolved', probability: 100 },
];

describe('stagesOf', () => {
  it('keeps the Waboo stages, the 100% one is Won, and a Lost stage is added last', () => {
    const r = stagesOf(sales);
    expect(r.map((s) => s.name)).toEqual(['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Closed Won', 'Lost']);
    expect(r.map((s) => s.probability)).toEqual([10, 25, 50, 75, 100, 0]);
    expect(r.filter((s) => s.isWon).map((s) => s.name)).toEqual(['Closed Won']);
    expect(r.filter((s) => s.isLost).map((s) => s.name)).toEqual(['Lost']);
    expect(r.map((s) => s.sortOrder)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it('adds a Won and a Lost when Waboo has none, and never has two Won', () => {
    expect(stagesOf([{ name: 'A', probability: 20 }]).map((s) => [s.name, s.isWon, s.isLost])).toEqual([
      ['A', false, false],
      ['Won', true, false],
      ['Lost', false, true],
    ]);
    const two = stagesOf([{ name: 'X', probability: 100 }, { name: 'Y', probability: 100 }]);
    expect(two.filter((s) => s.isWon)).toHaveLength(1);
    expect(two.find((s) => s.name === 'Y')!.probability).toBe(99);
  });
  it('reads a Waboo lost stage as the Lost stage', () => {
    const r = stagesOf([{ name: 'New', probability: 10 }, { name: 'Closed Lost', probability: 0 }, { name: 'Closed Won', probability: 100 }]);
    expect(r.map((s) => s.name)).toEqual(['New', 'Closed Won', 'Closed Lost']);
  });
  it('is valid for the app (open first, then one Won, then one Lost)', () => {
    const r = stagesOf(support);
    expect(r.map((s) => s.name)).toEqual(['New', 'In Progress', 'Resolved', 'Lost']);
    expect(r.every((s) => /^#[0-9A-F]{6}$/i.test(s.color))).toBe(true);
  });
});

describe('consentOf', () => {
  const rows = [
    { type: 'opt-in', channel: 'whatsapp', status: 'inactive', keywords: ['Allow'], response: 'Thanks, You have been opted-in of your future communications' },
    { type: 'opt-out', channel: 'whatsapp', status: 'inactive', keywords: ['Stop', 'Unsubscribe'], response: 'You have been opted-out of your future communications' },
  ];
  it('takes the Waboo keywords and replies, auto reply off when both were off', () => {
    const c = consentOf(rows)!;
    expect(c.config.optOutKeywords).toEqual({ en: ['Stop', 'Unsubscribe'] });
    expect(c.config.optInKeywords).toEqual({ en: ['Allow'] });
    expect(c.config.optOutReply).toEqual({ en: 'You have been opted-out of your future communications' });
    expect(c.autoReply).toBe(false);
  });
  it('is null with no rows, and turns auto reply on only when both were active', () => {
    expect(consentOf([])).toBeNull();
    expect(consentOf(rows.map((r) => ({ ...r, status: 'active' })))!.autoReply).toBe(true);
    expect(consentOf([{ ...rows[0]!, status: 'active' }, rows[1]!])!.autoReply).toBe(false);
  });
});

describe('planSettings', () => {
  it('lists pipelines in order without duplicates and the lost reasons', () => {
    const p = planSettings(
      {
        pipelines: [{ name: 'Sales Pipeline', stages: sales }, { name: 'sales pipeline', stages: sales }, { name: 'Support Pipeline', stages: support }],
        lostReasons: [{ reason: 'Budget Constraints' }, { reason: 'Not a Good Fit' }, { reason: 'budget constraints' }],
      },
      true,
    );
    expect(p.pipelines.map((x) => x.name)).toEqual(['Sales Pipeline', 'Support Pipeline']);
    expect(p.lostReasons).toEqual(['Budget Constraints', 'Not a Good Fit']);
    expect(p.autoAssign).toBe(true);
    expect(planSettings(undefined, undefined)).toMatchObject({ pipelines: [], lostReasons: [], consent: null, autoAssign: false });
  });
});

describe('derivePlan: the Waboo Pro-Whatsapp plan', () => {
  const cfg = (code: string, status: unknown, limit?: unknown) => ({ code, status, limit });
  const core = {
    subscription: {
      id: 's',
      planCode: 'Pro-Whatsapp',
      name: 'Pro',
      subTotal: 4999,
      config: [
        cfg('analytics_dashboard', true), cfg('automation_builder', true, 15), cfg('flows_for_bot', true, 25), cfg('user_limit', true, 20),
        cfg('segments', true, 40), cfg('monthly_conversation_limit', true, 'Infinity'), cfg('deal', true), cfg('webhook', true), cfg('smart_ai', true),
        cfg('apps', true), cfg('chat_settings', true), cfg('conversation_inbox', true), cfg('broadcast', true), cfg('sms_broadcast', false),
        cfg('email_broadcast', false), cfg('channels', false), cfg('forms', false, 0), cfg('application_forms', false),
      ],
    },
  } as unknown as Parameters<typeof derivePlan>[0];
  const base = {
    limits: { users: 5, segments: 5, flows: 5, contacts: 100000000, monthly_messages: 100000000, api_rate_limit_per_minute: 0, tags: 1000000 },
    features: { automation: true, analytics: true, chatbot_widgets: true, invoicing: true, sms: true, extra_channels: true, form_builder: true, sales_pipeline: true, whatsapp_warmer: true },
  };
  it('opens only what Waboo had and limits only what Waboo limited', () => {
    const p = derivePlan(core, base);
    expect(p.limits).toMatchObject({ users: 20, segments: 40, flows: 40, contacts: 0, monthly_messages: 0, tags: 0, api_rate_limit_per_minute: 0 });
    expect(p.features).toMatchObject({
      automation: true, analytics: true, sales_pipeline: true,
      chatbot_widgets: false, invoicing: false, sms: false, extra_channels: false, form_builder: false, whatsapp_warmer: false,
    });
  });
});
