import { describe, expect, it } from 'vitest';
import type { AssignmentRules } from '@crm/contracts';
import { addCondition, conditionsOf, newCondition, setValue } from '@/features/segments';
import { companyCatalog, originField } from './catalog';
import { conditionProblems, groupFromRules, rulesFromGroup, serverProblemsOf } from './tree';

const origin = originField('Arrived through', (o) => o);
const catalog = companyCatalog({ label: (id) => id, origin, properties: [] });

const tree: AssignmentRules = {
  type: 'group',
  combinator: 'and',
  children: [
    { type: 'condition', field: 'industry', operator: 'equals', value: 'Retail' },
    {
      type: 'group',
      combinator: 'or',
      children: [
        { type: 'condition', field: 'origin', operator: 'in', value: ['form', 'api'] },
        { type: 'condition', field: 'phone', operator: 'is_empty' },
      ],
    },
  ],
};

describe('groupFromRules / rulesFromGroup', () => {
  it('a rule with no condition is an empty tree, and an empty tree saves as null (the fallback)', () => {
    const root = groupFromRules(null);
    expect(root.children).toEqual([]);
    expect(rulesFromGroup('company', root, catalog)).toEqual({ ok: true, rules: null });
  });

  it('round-trips a nested tree without losing a condition', () => {
    const root = groupFromRules(tree);
    expect(conditionsOf(root).map((c) => c.field)).toEqual(['industry', 'origin', 'phone']);
    expect(rulesFromGroup('company', root, catalog)).toEqual({ ok: true, rules: tree });
  });

  it('does not send a condition that is still missing its value', () => {
    const empty = groupFromRules(null);
    const c = newCondition(catalog.find((f) => f.id === 'industry')!);
    const root = addCondition(empty, empty.id, { ...c, operator: 'equals' });
    expect(conditionProblems(root, catalog)[c.id]).toBe('empty');
    expect(rulesFromGroup('company', root, catalog)).toEqual({ ok: false, reason: 'incomplete' });
    const filled = setValue(root, c.id, 'Retail');
    expect(rulesFromGroup('company', filled, catalog).ok).toBe(true);
  });

  it('refuses a field that does not belong to the module', () => {
    const wrong: AssignmentRules = {
      type: 'group',
      combinator: 'and',
      children: [{ type: 'condition', field: 'title', operator: 'equals', value: 'x' }],
    };
    const root = groupFromRules(wrong);
    // the field is unknown to the company catalog, so the builder flags it before anything is sent
    expect(conditionProblems(root, catalog)[conditionsOf(root)[0]!.id]).toBe('field');
    expect(rulesFromGroup('company', root, catalog).ok).toBe(false);
  });
});

describe('serverProblemsOf', () => {
  const root = groupFromRules(tree);
  const [industry, , phone] = conditionsOf(root);
  it('maps rules.children.N.value onto the condition at that place, nested too', () => {
    const out = serverProblemsOf(root, [
      { path: 'rules.children.0.value', message: 'bad industry' },
      { path: 'rules.children.1.children.1.value', message: 'no value allowed' },
    ]);
    expect(out.conditions[industry!.id]).toBe('bad industry');
    expect(out.conditions[phone!.id]).toBe('no value allowed');
    expect(out.fields).toEqual({});
  });
  it('keeps other messages on their form field', () => {
    const out = serverProblemsOf(root, [
      { path: 'userIds', message: 'Name at least one person or team' },
      { path: 'rules', message: 'at most 50 conditions per rule' },
    ]);
    expect(out.fields).toEqual({
      userIds: 'Name at least one person or team',
      rules: 'at most 50 conditions per rule',
    });
  });
});
