import { describe, expect, it } from 'vitest';
import { createRoutingRuleSchema } from '@crm/contracts';
import {
  conditionsFromForm,
  editableOf,
  addedOf,
  emptyForm,
  formFromRule,
  moveId,
  payloadFromForm,
  problemsOf,
  splitWords,
} from './form';
import { U1, U2, rule } from './fixtures';

describe('splitWords', () => {
  it('splits on commas and line breaks, trims and drops repeats', () => {
    expect(splitWords('Refund, invoice\nrefund ;  cancel,, ')).toEqual([
      'Refund',
      'invoice',
      'cancel',
    ]);
    expect(splitWords('')).toEqual([]);
  });
});

describe('problemsOf', () => {
  const ok = () => ({ ...emptyForm(), name: 'R', keywords: 'refund', userIds: [U1] });

  it('a new empty form needs a name and somebody to assign to, but no condition: it applies to every conversation', () => {
    expect(emptyForm().onlyWhen).toBe(false);
    expect(problemsOf(emptyForm(), [])).toEqual(['name', 'targets']);
  });
  it('with "Only for conversations that match" on, at least one condition is needed (H13)', () => {
    expect(problemsOf({ ...emptyForm(), name: 'R', userIds: [U1], onlyWhen: true }, [])).toEqual([
      'conditions',
    ]);
    expect(
      problemsOf(
        { ...emptyForm(), name: 'R', userIds: [U1], onlyWhen: true, contactKind: 'new' },
        [],
      ),
    ).toEqual([]);
  });
  it('Everyone else can share over all agents: no list of agents is needed then', () => {
    const f = { ...emptyForm(), name: 'E', isFallback: true, everyone: true };
    expect(problemsOf(f, [])).toEqual([]);
    expect(payloadFromForm(f, [], true).assign).toEqual({
      strategy: 'round_robin',
      userIds: [],
      teamIds: [],
      everyone: true,
    });
  });
  it('a complete form has no problem', () => {
    expect(problemsOf(ok(), [])).toEqual([]);
  });
  it('the fallback needs no condition', () => {
    expect(problemsOf({ ...ok(), keywords: '', isFallback: true }, [])).toEqual([]);
  });
  it('a specific agent is exactly one person and no team', () => {
    expect(problemsOf({ ...ok(), strategy: 'specific', userIds: [U1, U2] }, [])).toEqual([
      'specific',
    ]);
    expect(
      problemsOf({ ...ok(), strategy: 'specific', userIds: [U1], teamIds: ['t'] }, []),
    ).toEqual(['specific']);
  });
  it('more than 20 words is refused here, as the API would', () => {
    const many = Array.from({ length: 21 }, (_, i) => `w${i}`).join(',');
    expect(problemsOf({ ...ok(), keywords: many }, [])).toContain('keywordsMany');
  });
});

describe('payloadFromForm', () => {
  it('builds exactly what the create contract accepts', () => {
    const f = {
      ...emptyForm(),
      name: '  Refunds ',
      description: ' note ',
      keywords: 'Refund, invoice',
      keywordMode: 'all' as const,
      languages: 'EN, ar',
      channelKinds: ['telegram'],
      businessHours: 'outside' as const,
      userIds: [U1, U2],
    };
    const payload = payloadFromForm(f, [], true);
    expect(payload).toMatchObject({
      name: 'Refunds',
      description: 'note',
      isActive: true,
      stopOnMatch: true,
      assign: { strategy: 'round_robin', userIds: [U1, U2], teamIds: [], everyone: false },
      // "Only for conversations that match" is off: the conditions are kept on the rule but it applies to every conversation
      appliesToAll: true,
    });
    expect(payload.conditions).toEqual({
      contactKind: 'any',
      contact: null,
      channelKinds: ['telegram'],
      keywords: { mode: 'all', words: ['Refund', 'invoice'] },
      languages: ['en', 'ar'],
      businessHours: 'outside',
    });
    expect(createRoutingRuleSchema.safeParse(payload).success).toBe(true);
  });
});

describe('the "only when" switch (H13)', () => {
  it('on: the rule matches by its conditions; off: it applies to every conversation and keeps them', () => {
    const f = { ...emptyForm(), name: 'R', userIds: [U1], keywords: 'refund', onlyWhen: true };
    expect(payloadFromForm(f, [], true).appliesToAll).toBe(false);
    const off = payloadFromForm({ ...f, onlyWhen: false }, [], true);
    expect(off.appliesToAll).toBe(true);
    expect(off.conditions?.keywords).toEqual({ mode: 'any', words: ['refund'] });
    expect(createRoutingRuleSchema.safeParse(off).success).toBe(true);
  });
  it('a saved rule opens with the switch and the cards it needs', () => {
    const saved = formFromRule(rule());
    expect(saved.onlyWhen).toBe(true);
    expect(saved.added).toEqual(['channel', 'keywords']);
    const every = formFromRule(rule({ appliesToAll: true }));
    expect(every.onlyWhen).toBe(false);
    expect(every.added).toEqual(['channel', 'keywords']);
    const returning = rule({ conditions: { ...rule().conditions, contactKind: 'returning' } });
    expect(addedOf(returning.conditions)).toEqual(['contactKind', 'channel', 'keywords']);
  });
});

describe('the flow a rule starts', () => {
  const FLOW = '3b2f7c1e-6d1a-4f6e-9a55-3e2f0d7a1b31';

  it('is none by default, and the payload says null so an edit can clear it', () => {
    expect(emptyForm().triggerFlowId).toBe('');
    expect(
      payloadFromForm({ ...emptyForm(), name: 'x', userIds: [U1] }, [], true).triggerFlowId,
    ).toBeNull();
  });

  it('goes to the payload as the flow uuid, and comes back from a saved rule', () => {
    const payload = payloadFromForm(
      { ...emptyForm(), name: 'x', userIds: [U1], triggerFlowId: FLOW },
      [],
      true,
    );
    expect(payload.triggerFlowId).toBe(FLOW);
    expect(
      createRoutingRuleSchema.safeParse({
        ...payload,
        conditions: { ...payload.conditions, channelKinds: ['telegram'] },
      }).success,
    ).toBe(true);
    const saved = rule({ triggerFlow: { id: FLOW, name: 'Welcome', isActive: true } });
    expect(formFromRule(saved).triggerFlowId).toBe(FLOW);
  });

  it('changing the flow is an edit, the engine firing the rule is not', () => {
    const a = rule();
    const b = rule({ triggerFlow: { id: FLOW, name: 'Welcome', isActive: true } });
    expect(editableOf(a)).not.toBe(editableOf(b));
    expect(editableOf(b)).toBe(
      editableOf(
        rule({ triggerFlow: { id: FLOW, name: 'Renamed', isActive: false }, firedCount: 5 }),
      ),
    );
  });
});

describe('formFromRule and editableOf', () => {
  it('round-trips a saved rule into the form and back to the same conditions', () => {
    const r = rule();
    const f = formFromRule(r);
    expect(f).toMatchObject({
      name: 'Refund requests',
      keywords: 'refund, invoice',
      channelKinds: ['whatsapp_cloud'],
      userIds: [U1, U2],
    });
    expect(conditionsFromForm(f, [])).toEqual(r.conditions);
  });
  it('the engine firing a rule (counters and version) is not an edit', () => {
    const a = rule();
    const b = rule({
      firedCount: 99,
      rowVersion: 40,
      lastFiredAt: null,
      updatedAt: '2026-10-06T00:00:00.000Z',
    });
    expect(editableOf(a)).toBe(editableOf(b));
    expect(editableOf(a)).not.toBe(editableOf(rule({ name: 'Other' })));
  });
});

describe('moveId', () => {
  it('moves one item and leaves the list alone at the edges', () => {
    expect(moveId(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b']);
    expect(moveId(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
  });
});

describe('the actions a rule does: assign, mark as spam, or both', () => {
  const kw = { ...emptyForm(), name: 'Scams', keywords: 'scam' };

  it('a rule that only marks spam is valid and sends no assign', () => {
    const f = { ...kw, assigns: false, markSpam: true };
    expect(problemsOf(f, [])).toEqual([]);
    const body = payloadFromForm(f, [], false);
    expect(body).toMatchObject({ markSpam: true, assign: null });
    expect(createRoutingRuleSchema.safeParse(body).success).toBe(true);
  });

  it('a rule with no action says so, and does not claim an agent is missing', () => {
    const f = { ...kw, assigns: false, markSpam: false };
    expect(problemsOf(f, [])).toEqual(['actions']);
  });

  it('assigning needs an agent or team; with the assign off, no target is asked for', () => {
    expect(problemsOf({ ...kw, assigns: true, markSpam: false, userIds: [] }, [])).toEqual([
      'targets',
    ]);
    expect(problemsOf({ ...kw, assigns: false, markSpam: false, userIds: [] }, [])).toEqual([
      'actions',
    ]);
  });

  it('an existing rule that only marks spam opens with the assign switched off', () => {
    const f = formFromRule(rule({ assign: null, markSpam: true }));
    expect(f).toMatchObject({ assigns: false, markSpam: true });
  });

  it('an existing rule with an assignment opens with the assign switched on, and the spam mark off', () => {
    const f = formFromRule(rule());
    expect(f).toMatchObject({ assigns: true, markSpam: false, userIds: [U1, U2] });
  });
});

describe('priority and tags on a rule', () => {
  const base = { ...emptyForm(), name: 'VIP', keywords: 'vip' };

  it('a rule that only sets a priority or adds tags is valid, and sends them', () => {
    const f = { ...base, assigns: false, priority: 'urgent' as const, tags: 'VIP, Refunds' };
    expect(problemsOf(f, [])).toEqual([]);
    const body = payloadFromForm(f, [], false);
    expect(body).toMatchObject({
      priority: 'urgent',
      addTags: [
        { name: 'VIP', color: null },
        { name: 'Refunds', color: null },
      ],
    });
    expect(createRoutingRuleSchema.safeParse(body).success).toBe(true);
  });

  it('no priority and no tags sends nothing for them', () => {
    const body = payloadFromForm({ ...base, assigns: true, userIds: [U1] }, [], true);
    expect(body).toMatchObject({ priority: null, addTags: [] });
  });

  it('more than five tags is refused before saving', () => {
    const f = { ...base, assigns: false, priority: '' as const, tags: 'a, b, c, d, e, f' };
    expect(problemsOf(f, [])).toEqual(['tagsMany']);
  });
});

describe('escalation on a rule', () => {
  const base = { ...emptyForm(), name: 'Wait', keywords: 'wait', assigns: true, userIds: [U1] };

  it('sends the minutes, the reassignment and the priority', () => {
    const f = {
      ...base,
      escalates: true,
      escalateMinutes: '45',
      escalateReassign: true,
      escalatePriority: 'high' as const,
    };
    expect(problemsOf(f, [])).toEqual([]);
    const body = payloadFromForm(f, [], false);
    expect(body).toMatchObject({ escalation: { minutes: 45, reassign: true, priority: 'high' } });
    expect(createRoutingRuleSchema.safeParse(body).success).toBe(true);
  });

  it('no escalation sends null', () => {
    expect(payloadFromForm(base, [], false)).toMatchObject({ escalation: null });
  });

  it('refuses minutes out of range, an empty action, and a reassignment with no agents', () => {
    expect(
      problemsOf({ ...base, escalates: true, escalateMinutes: '0', escalateReassign: true }, []),
    ).toContain('escalationMinutes');
    expect(
      problemsOf(
        {
          ...base,
          escalates: true,
          escalateMinutes: '10',
          escalateReassign: false,
          escalatePriority: '',
        },
        [],
      ),
    ).toContain('escalationAction');
    expect(
      problemsOf(
        {
          ...base,
          assigns: false,
          markSpam: true,
          escalates: true,
          escalateMinutes: '10',
          escalateReassign: true,
        },
        [],
      ),
    ).toContain('escalationAgents');
  });

  it('an existing rule with an escalation opens with it filled in', () => {
    const f = formFromRule(
      rule({ escalation: { minutes: 20, reassign: false, priority: 'urgent' } }),
    );
    expect(f).toMatchObject({
      escalates: true,
      escalateMinutes: '20',
      escalateReassign: false,
      escalatePriority: 'urgent',
    });
  });
});

describe('automatic reply on a rule', () => {
  const base = { ...emptyForm(), name: 'Hours', keywords: 'hours' };

  it('sends the reply text, trimmed, and counts as an action of its own', () => {
    const f = { ...base, assigns: false, autoReplies: true, autoReplyBody: '  Open 9 to 6.  ' };
    expect(problemsOf(f, [])).toEqual([]);
    const body = payloadFromForm(f, [], false);
    expect(body).toMatchObject({ autoReply: { body: 'Open 9 to 6.' } });
    expect(createRoutingRuleSchema.safeParse(body).success).toBe(true);
  });

  it('refuses an empty reply and one over the limit', () => {
    expect(
      problemsOf({ ...base, assigns: false, autoReplies: true, autoReplyBody: '   ' }, []),
    ).toContain('autoReplyEmpty');
    expect(
      problemsOf(
        { ...base, assigns: false, autoReplies: true, autoReplyBody: 'x'.repeat(1025) },
        [],
      ),
    ).toContain('autoReplyLong');
  });

  it('an existing rule with a reply opens with it filled in', () => {
    expect(formFromRule(rule({ autoReply: { body: 'Hi' } }))).toMatchObject({
      autoReplies: true,
      autoReplyBody: 'Hi',
    });
  });
});
