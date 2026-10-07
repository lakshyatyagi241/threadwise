import { describe, expect, it } from 'vitest';
import {
  FLB_COND_MAX_DEPTH,
  FLB_COND_MAX_RULES,
  flbCondRuleCount,
  flbCondDepth,
  type FlbCondGroup,
} from '@crm/contracts';
import {
  addGroup,
  addRule,
  blankRule,
  canAddGroup,
  canAddRule,
  conditionTreeOf,
  patchRule,
  removeAt,
  setGroupOp,
} from './condition-tree';

const rule = (variable: string, value = 'x') => ({ variable, operator: 'equals', value });
const root: FlbCondGroup = {
  op: 'and',
  items: [rule('a'), { op: 'or', items: [rule('b'), rule('c')] }],
};

describe('conditionTreeOf', () => {
  it('prefers the saved tree and ignores the flat arrays', () => {
    const m = conditionTreeOf({ conditionGroup: root, conditions: [rule('zzz')] })!;
    expect(m.from).toBe('tree');
    expect(m.tree).toEqual(root);
  });

  it('converts a flat chain (left to right, no precedence)', () => {
    const m = conditionTreeOf({
      conditions: [rule('a'), rule('b'), rule('c')],
      operators: ['OR', 'AND'],
    })!;
    expect(m.from).toBe('flat');
    expect(m.tree).toEqual({
      op: 'and',
      items: [{ op: 'or', items: [rule('a'), rule('b')] }, rule('c')],
    });
  });

  it('returns null for a chain too alternating for the tree, keeping the flat editor', () => {
    const rules = Array.from({ length: 6 }, (_, i) => rule(`v${i}`));
    expect(
      conditionTreeOf({ conditions: rules, operators: ['OR', 'AND', 'OR', 'AND', 'OR'] }),
    ).toBeNull();
  });

  it('a node with nothing yields an empty group', () => {
    expect(conditionTreeOf({})!.tree).toEqual({ op: 'and', items: [] });
  });
});

describe('tree edits are pure and path based', () => {
  it('sets op, patches a rule, removes a rule and a group', () => {
    const frozen = JSON.stringify(root);
    expect(setGroupOp(root, [1], 'and').items[1]).toMatchObject({ op: 'and' });
    expect(
      (patchRule(root, [1, 0], { variable: 'q' }).items[1] as FlbCondGroup).items[0],
    ).toMatchObject({ variable: 'q' });
    expect(removeAt(root, [0]).items).toHaveLength(1);
    expect(removeAt(root, [1]).items).toEqual([rule('a')]);
    expect(removeAt(root, [])).toBe(root);
    expect(JSON.stringify(root)).toBe(frozen);
  });

  it('adds a rule or a group in the group at the path', () => {
    expect(addRule(root, []).items).toHaveLength(3);
    expect((addRule(root, [1]).items[1] as FlbCondGroup).items).toHaveLength(3);
    expect(addGroup(root, [1]).items[1]).toMatchObject({
      items: [rule('b'), rule('c'), { op: 'and', items: [blankRule()] }],
    });
  });

  it('refuses a group at depth 3 and a rule at 20 rules', () => {
    expect(canAddGroup([])).toBe(true);
    expect(canAddGroup([0])).toBe(true);
    expect(canAddGroup([0, 0])).toBe(false);
    let g: FlbCondGroup = { op: 'and', items: [] };
    for (let i = 0; i < 30; i++) g = addRule(g, []);
    expect(flbCondRuleCount(g)).toBe(FLB_COND_MAX_RULES);
    expect(canAddRule(g)).toBe(false);
    let d: FlbCondGroup = { op: 'and', items: [] };
    d = addGroup(d, []);
    d = addGroup(d, [0]);
    expect(flbCondDepth(addGroup(d, [0, 0]))).toBe(FLB_COND_MAX_DEPTH);
  });
});
