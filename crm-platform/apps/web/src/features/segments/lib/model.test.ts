import { describe, expect, it } from 'vitest';
import {
  MAX_CONDITIONS,
  MAX_DEPTH,
  addCondition,
  addGroup,
  canAddCondition,
  canAddGroup,
  changeField,
  changeOperator,
  conditionsOf,
  convertValue,
  countConditions,
  emptyRoot,
  findNode,
  levelOf,
  moveNode,
  newCondition,
  pruneIncomplete,
  removeNode,
  setCombinator,
  setValue,
  signature,
  treeDepth,
  valueProblem,
  type Condition,
  type FieldShape,
  type Group,
} from './model';
import { operatorsForKind } from './operators';

const stage: FieldShape = {
  id: 'lifecycleStage',
  kind: 'option',
  operators: operatorsForKind('option'),
};
const tags: FieldShape = { id: 'tags', kind: 'tags', operators: operatorsForKind('tags') };
const created: FieldShape = { id: 'createdAt', kind: 'date', operators: operatorsForKind('date') };
const score: FieldShape = {
  id: 'leadScore',
  kind: 'number',
  operators: operatorsForKind('number'),
};
const source: FieldShape = { id: 'source', kind: 'text', operators: operatorsForKind('text') };
const kinds: Record<string, FieldShape> = {
  lifecycleStage: stage,
  tags,
  createdAt: created,
  leadScore: score,
  source,
};
const kindOf = (f: string) => kinds[f]?.kind ?? null;

const withCondition = (field: FieldShape, patch: Partial<Condition> = {}) => ({
  ...newCondition(field),
  ...patch,
});

describe('building the tree', () => {
  it('starts empty and adds a condition with the field first operator and an empty value', () => {
    const r = emptyRoot();
    const next = addCondition(r, r.id, newCondition(stage));
    expect(r.children).toHaveLength(0);
    expect(next.children).toHaveLength(1);
    const c = next.children[0] as Condition;
    expect(c).toMatchObject({ field: 'lifecycleStage', operator: 'equals', value: '' });
  });

  it('a date condition starts as "in the last N days", with an empty number', () => {
    expect(newCondition(created)).toMatchObject({ operator: 'in_last_days', value: '' });
  });

  it('adds a group with the opposite combinator, seeded so it is never empty', () => {
    const r = emptyRoot();
    const next = addGroup(r, r.id, newCondition(tags));
    const g = next.children[0];
    expect(g?.kind).toBe('group');
    if (g?.kind === 'group') {
      expect(g.combinator).toBe('or');
      expect(g.children).toHaveLength(1);
    }
  });

  it('refuses a group below the third level and the 51st condition', () => {
    let r = emptyRoot();
    r = addGroup(r, r.id, newCondition(tags));
    const level2 = r.children[0]!.id;
    r = addGroup(r, level2, newCondition(tags));
    const level3 = (r.children[0] as Group).children[1]!.id;
    expect(levelOf(r, level3)).toBe(MAX_DEPTH);
    expect(canAddGroup(r, level3)).toBe(false);
    expect(addGroup(r, level3, newCondition(tags))).toBe(r);
    expect(treeDepth(r)).toBe(MAX_DEPTH);

    let full = emptyRoot();
    // 50 conditions in groups of 50 children at most
    for (let i = 0; i < MAX_CONDITIONS; i++)
      full = addCondition(full, full.id, newCondition(stage));
    expect(countConditions(full)).toBe(MAX_CONDITIONS);
    expect(canAddCondition(full, full.id)).toBe(false);
    expect(addCondition(full, full.id, newCondition(stage))).toBe(full);
  });

  it('a group holds at most 50 children even when the tree has room', () => {
    let r = emptyRoot();
    for (let i = 0; i < 49; i++) r = addCondition(r, r.id, newCondition(stage));
    r = addGroup(r, r.id, newCondition(stage));
    expect(r.children).toHaveLength(50);
    expect(canAddCondition(r, r.id)).toBe(false);
  });

  it('changes the combinator of one group only', () => {
    let r = emptyRoot();
    r = addGroup(r, r.id, newCondition(tags));
    const inner = r.children[0]!.id;
    r = setCombinator(r, inner, 'and');
    expect((r.children[0] as Group).combinator).toBe('and');
    r = setCombinator(r, r.id, 'or');
    expect(r.combinator).toBe('or');
  });
});

describe('editing a condition', () => {
  const base = () => {
    const r = emptyRoot();
    const c = withCondition(stage, { operator: 'in', value: ['new', 'won'] });
    return { r: addCondition(r, r.id, c), id: c.id };
  };

  it('a new field resets the operator and the value (they belonged to the old field)', () => {
    const { r, id } = base();
    const next = changeField(r, id, score);
    expect(conditionsOf(next)[0]).toMatchObject({
      field: 'leadScore',
      operator: 'equals',
      value: '',
    });
  });

  it('choosing the same field again changes nothing', () => {
    const { r, id } = base();
    expect(changeField(r, id, stage)).toBe(r);
  });

  it('switching between "is" and "is any of" keeps what was chosen', () => {
    const r0 = emptyRoot();
    const c = withCondition(stage, { operator: 'equals', value: 'qualified' });
    let r = addCondition(r0, r0.id, c);
    r = changeOperator(r, c.id, stage, 'in');
    expect(conditionsOf(r)[0]?.value).toEqual(['qualified']);
    r = changeOperator(r, c.id, stage, 'equals');
    expect(conditionsOf(r)[0]?.value).toBe('qualified');
  });

  it('a different input shape starts empty; "is empty" drops the value', () => {
    const r0 = emptyRoot();
    const c = withCondition(score, { operator: 'gt', value: '40' });
    let r = addCondition(r0, r0.id, c);
    r = changeOperator(r, c.id, score, 'between');
    expect(conditionsOf(r)[0]?.value).toEqual({ from: '', to: '' });
    r = changeOperator(r, c.id, score, 'is_empty');
    expect(conditionsOf(r)[0]?.value).toBeNull();
  });

  it('a number typed under "greater than" survives a switch to "equals"', () => {
    const r0 = emptyRoot();
    const c = withCondition(score, { operator: 'gt', value: '40' });
    let r = addCondition(r0, r0.id, c);
    r = changeOperator(r, c.id, score, 'equals');
    expect(conditionsOf(r)[0]?.value).toBe('40');
  });

  it('sets a value', () => {
    const { r, id } = base();
    expect(conditionsOf(setValue(r, id, ['x']))[0]?.value).toEqual(['x']);
  });

  it('convertValue maps single and list inputs of the same sort only', () => {
    expect(convertValue('a', 'one', 'pick')).toEqual(['a']);
    expect(convertValue(['a', 'b'], 'pick', 'one')).toBe('a');
    expect(convertValue('a', 'text', 'tokens')).toEqual(['a']);
    expect(convertValue('a', 'text', 'pick')).toEqual([]);
    expect(convertValue('2026-01-01', 'date', 'days')).toBe('');
  });
});

describe('removing and moving', () => {
  it('removes a condition, and an emptied nested group with it; the root stays', () => {
    let r = emptyRoot();
    const keep = newCondition(stage);
    r = addCondition(r, r.id, keep);
    const seed = newCondition(tags);
    r = addGroup(r, r.id, seed);
    expect(countConditions(r)).toBe(2);
    r = removeNode(r, seed.id);
    expect(r.children).toHaveLength(1);
    expect(removeNode(r, r.id)).toBe(r);
    const empty = removeNode(r, keep.id);
    expect(empty.children).toHaveLength(0);
    expect(empty.kind).toBe('group');
  });

  it('moves a node among its siblings and stops at the ends', () => {
    let r = emptyRoot();
    const a = newCondition(stage);
    const b = newCondition(tags);
    r = addCondition(addCondition(r, r.id, a), r.id, b);
    expect(moveNode(r, a.id, -1)).toBe(r);
    expect(moveNode(r, b.id, 1)).toBe(r);
    const swapped = moveNode(r, a.id, 1);
    expect(swapped.children.map((c) => c.id)).toEqual([b.id, a.id]);
    expect(findNode(swapped, b.id)).not.toBeNull();
  });
});

describe('valueProblem', () => {
  const c = (field: FieldShape, operator: Condition['operator'], value: Condition['value']) =>
    withCondition(field, { operator, value });

  it('needs a value for every operator that takes one', () => {
    expect(valueProblem(c(stage, 'equals', ''), 'option')).toBe('empty');
    expect(valueProblem(c(stage, 'equals', 'new'), 'option')).toBeNull();
    expect(valueProblem(c(tags, 'has_any', []), 'tags')).toBe('empty');
    expect(valueProblem(c(tags, 'has_any', ['t1']), 'tags')).toBeNull();
    expect(valueProblem(c(tags, 'is_empty', null), 'tags')).toBeNull();
  });

  it('text must not be blank or longer than 255 characters', () => {
    expect(valueProblem(c(source, 'contains', '   '), 'text')).toBe('empty');
    expect(valueProblem(c(source, 'contains', 'x'.repeat(256)), 'text')).toBe('tooLong');
    expect(valueProblem(c(source, 'in', ['web', 'x'.repeat(256)]), 'text')).toBe('tooLong');
  });

  it('numbers must be numbers; a range must run from low to high', () => {
    expect(valueProblem(c(score, 'gt', 'abc'), 'number')).toBe('number');
    expect(valueProblem(c(score, 'gt', '40'), 'number')).toBeNull();
    expect(valueProblem(c(score, 'between', { from: '50', to: '10' }), 'number')).toBe('range');
    expect(valueProblem(c(score, 'between', { from: '10', to: '50' }), 'number')).toBeNull();
    expect(valueProblem(c(score, 'between', { from: '10', to: '' }), 'number')).toBe('empty');
    expect(valueProblem(c(score, 'in', ['1', 'x']), 'number')).toBe('number');
  });

  it('days are whole numbers from 0 to 3650', () => {
    expect(valueProblem(c(created, 'in_last_days', '30'), 'date')).toBeNull();
    expect(valueProblem(c(created, 'in_last_days', '0'), 'date')).toBeNull();
    expect(valueProblem(c(created, 'in_last_days', '3.5'), 'date')).toBe('days');
    expect(valueProblem(c(created, 'in_last_days', '3651'), 'date')).toBe('days');
    expect(valueProblem(c(created, 'more_than_days_ago', ''), 'date')).toBe('empty');
  });

  it('dates must be real days; a range must not run backwards', () => {
    expect(valueProblem(c(created, 'before', '2026-02-31'), 'date')).toBe('date');
    expect(valueProblem(c(created, 'before', '2026-02-27'), 'date')).toBeNull();
    expect(
      valueProblem(c(created, 'between', { from: '2026-03-01', to: '2026-01-01' }), 'date'),
    ).toBe('range');
    expect(
      valueProblem(c(created, 'between', { from: '2026-01-01', to: '2026-03-01' }), 'date'),
    ).toBeNull();
  });
});

describe('pruneIncomplete and signature', () => {
  it('drops incomplete conditions and the groups they emptied, and counts them', () => {
    let r = emptyRoot();
    const ok = withCondition(stage, { value: 'new' });
    r = addCondition(r, r.id, ok);
    r = addCondition(r, r.id, withCondition(tags, { value: [] }));
    r = addGroup(r, r.id, withCondition(source, { operator: 'contains', value: '' }));
    r = addCondition(r, r.id, withCondition(stage, { field: 'gone', value: 'x' }));
    const { tree, dropped } = pruneIncomplete(r, kindOf);
    expect(dropped).toBe(3);
    expect(tree.children.map((c) => c.id)).toEqual([ok.id]);
  });

  it('two trees with the same rules have the same signature, whatever their ids', () => {
    const make = () => {
      const r = emptyRoot();
      return addCondition(r, r.id, withCondition(stage, { value: 'new' }));
    };
    expect(signature(make())).toBe(signature(make()));
    const r = make();
    expect(signature(setValue(r, conditionsOf(r)[0]!.id, 'won'))).not.toBe(signature(make()));
  });
});
