import { segmentRulesSchema } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { buildCatalog, type Lookups } from './fields';
import {
  addCondition,
  addGroup,
  conditionsOf,
  emptyRoot,
  newCondition,
  setValue,
  type Condition,
  type Group,
} from './model';
import { conditionAtPath, fromWire, parseRules, toWire } from './wire';

const lookups: Lookups = {
  stages: [{ value: 'new', label: 'New' }],
  statuses: [],
  tags: [{ value: '4f0a1d6e-6b52-4a55-9d0a-0d8a3b2f1c11', label: 'VIP' }],
  groups: [],
  users: [],
  properties: [{ key: 'visits', label: 'Visits', fieldType: 'integer', options: [] }],
};
const catalog = buildCatalog(lookups);
const field = (id: string) => catalog.find((f) => f.id === id)!;
const TAG = lookups.tags[0]!.value;

function condition(id: string, operator: Condition['operator'], value: Condition['value']): Condition {
  return { ...newCondition(field(id)), operator, value };
}

function sample(): Group {
  let r = emptyRoot();
  r = addCondition(r, r.id, condition('lifecycleStage', 'in', ['new', 'qualified']));
  r = addCondition(r, r.id, condition('custom.visits', 'between', { from: '2', to: '10' }));
  r = addGroup(r, r.id, condition('tags', 'has_any', [TAG]));
  const inner = r.children[2]!.id;
  r = addCondition(r, inner, condition('lastActivityAt', 'more_than_days_ago', '30'));
  r = addCondition(r, inner, condition('unsubscribed', 'is_false', null));
  return r;
}

describe('editor tree to wire', () => {
  it('writes numbers as numbers, days as a number, lists as lists, and no value for "is true"', () => {
    const wire = toWire(sample(), catalog);
    expect(wire).toEqual({
      type: 'group',
      combinator: 'and',
      children: [
        { type: 'condition', field: 'lifecycleStage', operator: 'in', value: ['new', 'qualified'] },
        { type: 'condition', field: 'custom.visits', operator: 'between', value: { from: 2, to: 10 } },
        {
          type: 'group',
          combinator: 'or',
          children: [
            { type: 'condition', field: 'tags', operator: 'has_any', value: [TAG] },
            { type: 'condition', field: 'lastActivityAt', operator: 'more_than_days_ago', value: 30 },
            { type: 'condition', field: 'unsubscribed', operator: 'is_false' },
          ],
        },
      ],
    });
  });

  it('is accepted by the contract schema the API validates with', () => {
    expect(segmentRulesSchema.safeParse(toWire(sample(), catalog)).success).toBe(true);
    expect(parseRules(toWire(sample(), catalog))).not.toBeNull();
  });

  it('trims text and leaves out incomplete conditions', () => {
    let r = emptyRoot();
    r = addCondition(r, r.id, condition('source', 'contains', '  web  '));
    r = addCondition(r, r.id, condition('custom.visits', 'gt', ''));
    const wire = toWire(r, catalog);
    expect(wire.children).toEqual([{ type: 'condition', field: 'source', operator: 'contains', value: 'web' }]);
  });

  it('an empty tree, or one with nothing complete, is not valid rules (the contract needs at least one condition)', () => {
    expect(parseRules(toWire(emptyRoot(), catalog))).toBeNull();
    let r = emptyRoot();
    r = addCondition(r, r.id, condition('custom.visits', 'gt', ''));
    expect(parseRules(toWire(r, catalog))).toBeNull();
  });

  it('a nested group that empties is dropped rather than sent empty', () => {
    let r = emptyRoot();
    r = addCondition(r, r.id, condition('lifecycleStage', 'equals', 'new'));
    r = addGroup(r, r.id, condition('custom.visits', 'gt', ''));
    expect(toWire(r, catalog).children).toHaveLength(1);
  });
});

describe('wire to editor tree', () => {
  it('round-trips: what was saved comes back as the same rules', () => {
    const wire = toWire(sample(), catalog);
    const again = toWire(fromWire(wire), catalog);
    expect(again).toEqual(wire);
  });

  it('turns numbers and ranges back into text the inputs can hold', () => {
    const tree = fromWire(toWire(sample(), catalog));
    const [, visits, group] = tree.children;
    expect((visits as Condition).value).toEqual({ from: '2', to: '10' });
    expect(((group as Group).children[1] as Condition).value).toBe('30');
  });

  it('gives every node its own id', () => {
    const ids = new Set<string>();
    const walk = (g: Group) => {
      ids.add(g.id);
      for (const c of g.children) {
        if (c.kind === 'group') walk(c);
        else ids.add(c.id);
      }
    };
    walk(fromWire(toWire(sample(), catalog)));
    expect(ids.size).toBe(7);
  });

  it('a missing tree is an empty root', () => {
    expect(fromWire(null).children).toEqual([]);
  });
});

describe('conditionAtPath', () => {
  it('finds a condition by the server path (children.1.children.0) and nothing at a group or a bad path', () => {
    const tree = fromWire(toWire(sample(), catalog));
    expect(conditionAtPath(tree, 'children.2.children.0')?.field).toBe('tags');
    expect(conditionAtPath(tree, 'children.0')?.field).toBe('lifecycleStage');
    expect(conditionAtPath(tree, 'children.2')).toBeNull();
    expect(conditionAtPath(tree, 'children.9')).toBeNull();
    expect(conditionAtPath(tree, '')).toBeNull();
  });

  it('survives an edit of a value', () => {
    const tree = fromWire(toWire(sample(), catalog));
    const first = conditionsOf(tree)[0]!;
    expect(setValue(tree, first.id, ['x'])).not.toBe(tree);
  });
});
