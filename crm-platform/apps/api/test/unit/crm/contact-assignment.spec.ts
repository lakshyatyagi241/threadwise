import { describe, expect, it } from 'vitest';
import {
  assignmentRulesSchema,
  checkAssignmentRules,
  createAssignmentRuleSchema,
  legacyConditionsToRules,
  type AssignmentRules,
} from '@crm/contracts';
import {
  candidateOrder,
  orderRules,
  priorities,
  sameInstant,
} from '../../../src/modules/crm/contact-assignment/assignment-matcher';
import { originOf } from '../../../src/modules/crm/contact-assignment/contact-assignment.consumer';

const rule = (id: number, over: Partial<{ isActive: boolean; isFallback: boolean }> = {}) => ({
  id,
  isActive: true,
  isFallback: false,
  ...over,
});

const tree = (children: unknown[], combinator: 'and' | 'or' = 'and'): AssignmentRules =>
  assignmentRulesSchema.parse({ type: 'group', combinator, children });
const cond = (field: string, operator: string, value?: unknown) => ({
  type: 'condition',
  field,
  operator,
  ...(value === undefined ? {} : { value }),
});

describe('orderRules and priorities', () => {
  it('runs rules with conditions first, in arranged order, and the fallbacks (no condition) after them', () => {
    const rules = [rule(1, { isFallback: true }), rule(2), rule(3, { isFallback: true }), rule(4)];
    expect(orderRules(rules).map((r) => r.id)).toEqual([2, 4, 1, 3]);
  });

  it('never runs, and never numbers, an inactive rule', () => {
    const rules = [rule(1), rule(2, { isActive: false }), rule(3, { isFallback: true })];
    expect(orderRules(rules).map((r) => r.id)).toEqual([1, 3]);
    const p = priorities(rules);
    expect(p.get(1)).toBe(1);
    expect(p.get(3)).toBe(2);
    expect(p.has(2)).toBe(false);
  });
});

describe('candidateOrder, sameInstant and originOf', () => {
  it("lists the named people first, then the teams' members, once each", () => {
    expect(candidateOrder([3, 1], [1, 2, 3, 4])).toEqual([3, 1, 2, 4]);
  });

  it('treats timestamps read back from the database as one instant', () => {
    const a = new Date('2027-01-15T10:00:00.000Z');
    expect(sameInstant(a, new Date(a.getTime()))).toBe(true);
    expect(sameInstant(a, new Date(a.getTime() + 5))).toBe(false);
    expect(sameInstant(null, null)).toBe(true);
    expect(sameInstant(a, null)).toBe(false);
  });

  it('maps how a record arrived', () => {
    expect(originOf('import')).toBe('import');
    expect(originOf('whatsapp')).toBe('inbound');
    expect(originOf('form')).toBe('form');
    expect(originOf('lead_source')).toBe('lead');
    expect(originOf(undefined)).toBe('manual');
  });
});

describe('the rule tree', () => {
  it('accepts the Freshsales example: country is US AND mobile is not empty, with a nested OR', () => {
    const t = tree([
      cond('countryCode', 'equals', '+1'),
      {
        type: 'group',
        combinator: 'or',
        children: [cond('phone', 'is_not_empty'), cond('email', 'is_not_empty')],
      },
    ]);
    expect(checkAssignmentRules('contact', t)).toEqual([]);
  });

  it('only offers each module its own fields', () => {
    expect(checkAssignmentRules('deal', tree([cond('value', 'gte', 1000)]))).toEqual([]);
    expect(checkAssignmentRules('contact', tree([cond('value', 'gte', 1000)]))[0]?.message).toMatch(
      /not a field/,
    );
    expect(checkAssignmentRules('company', tree([cond('industry', 'equals', 'Retail')]))).toEqual([]);
    // deals have no custom properties; contacts take company properties, companies do not
    expect(checkAssignmentRules('deal', tree([cond('custom.tier', 'equals', 'gold')]))).toHaveLength(1);
    expect(checkAssignmentRules('company', tree([cond('company.tier', 'equals', 'gold')]))).toHaveLength(1);
    expect(checkAssignmentRules('contact', tree([cond('company.tier', 'equals', 'gold')]))).toEqual([]);
    expect(checkAssignmentRules('company', tree([cond('custom.tier', 'equals', 'gold')]))).toEqual([]);
  });

  it('checks the operator against the field kind and the value against the operator', () => {
    expect(checkAssignmentRules('deal', tree([cond('value', 'contains', 'x')]))[0]?.message).toMatch(
      /not available/,
    );
    expect(checkAssignmentRules('deal', tree([cond('value', 'between', { from: 5, to: 1 })]))).toHaveLength(1);
    expect(checkAssignmentRules('contact', tree([cond('tags', 'has_any', ['not-a-uuid'])]))).toHaveLength(1);
    expect(checkAssignmentRules('contact', tree([cond('origin', 'in', ['import', 'form'])]))).toEqual([]);
  });

  it('refuses a fourth level of groups and unknown keys', () => {
    const deep = {
      type: 'group',
      combinator: 'and',
      children: [
        {
          type: 'group',
          combinator: 'and',
          children: [
            {
              type: 'group',
              combinator: 'and',
              children: [{ type: 'group', combinator: 'and', children: [cond('name', 'is_empty')] }],
            },
          ],
        },
      ],
    };
    expect(assignmentRulesSchema.safeParse(deep).success).toBe(false);
    expect(
      assignmentRulesSchema.safeParse({ type: 'group', combinator: 'and', children: [cond('name', 'is_empty')], extra: 1 })
        .success,
    ).toBe(false);
  });

  it('a rule needs a pool, and a specific-user rule exactly one person', () => {
    const base = { name: 'R', subject: 'deal', strategy: 'round_robin' };
    expect(createAssignmentRuleSchema.safeParse(base).success).toBe(false);
    const u1 = '11111111-1111-4111-8111-111111111111';
    const u2 = '22222222-2222-4222-8222-222222222222';
    expect(createAssignmentRuleSchema.safeParse({ ...base, userIds: [u1] }).success).toBe(true);
    expect(createAssignmentRuleSchema.safeParse({ ...base, strategy: 'fixed', userIds: [u1, u2] }).success).toBe(false);
    expect(createAssignmentRuleSchema.safeParse({ ...base, strategy: 'fixed', userIds: [u1] }).success).toBe(true);
    // defaults: no condition (a fallback), skip offline, not reassigning on update, active
    const parsed = createAssignmentRuleSchema.parse({ ...base, userIds: [u1] });
    expect(parsed).toMatchObject({ rules: null, skipOffline: true, reassignOnUpdate: false, isActive: true });
  });
});

describe('legacyConditionsToRules (rules saved before the field-by-field builder)', () => {
  it('no flat condition means no tree (a fallback)', () => {
    expect(legacyConditionsToRules({})).toBeNull();
    expect(legacyConditionsToRules(null)).toBeNull();
  });

  it('turns every flat list into a condition that must hold, and phone prefixes into an OR', () => {
    const t = legacyConditionsToRules({
      sources: ['Website'],
      countryCodes: ['+91'],
      phonePrefixes: ['91', '44'],
      lifecycleStages: ['new'],
      tagIds: ['3f2b9a50-1c1a-4f6e-9d2b-0d1b6a7f1e11'],
      origins: ['form'],
      properties: [{ key: 'plan', equals: 'Pro' }],
      pipelineIds: ['3f2b9a50-1c1a-4f6e-9d2b-0d1b6a7f1e12'],
      valueMin: 100,
      valueMax: 900,
    });
    expect(t).not.toBeNull();
    expect(assignmentRulesSchema.safeParse(t).success).toBe(true);
    const fields = t!.children.map((c) => (c.type === 'condition' ? c.field : `group:${c.combinator}`));
    expect(fields).toEqual([
      'source',
      'countryCode',
      'group:or',
      'lifecycleStage',
      'tags',
      'origin',
      'custom.plan',
      'pipeline',
      'value',
      'value',
    ]);
  });
});
