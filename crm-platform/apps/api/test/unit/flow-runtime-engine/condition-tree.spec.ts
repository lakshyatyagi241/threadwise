import { describe, expect, it } from 'vitest';
import {
  FLB_COND_MAX_DEPTH,
  FLB_COND_MAX_RULES,
  flbCondDepth,
  flbCondRuleCount,
  flbCondTreeFromFlat,
  flbSanitizeConditionGroup,
  flbToRuntimeData,
  type FlbCondGroup,
} from '@crm/contracts';
import { compileGraph } from '../../../src/modules/flow-runtime-engine/graph/compile-graph';
import {
  evaluateConditions,
  evaluateConditionTree,
} from '../../../src/modules/flow-runtime-engine/runtime/condition';
import { CORE_EXECUTORS } from '../../../src/modules/flow-runtime-engine/runtime/nodes';
import type { VariableBag } from '../../../src/modules/flow-runtime-engine/runtime/variables';
import type { NodeContext } from '../../../src/modules/flow-runtime-engine/runtime/types';

// Nested condition groups (beyond WaDesk, by request). An empty group is false, like an empty flat list.
const r = (variable: string, operator = 'equals', value = '') => ({ variable, operator, value });
const bag = (v: Record<string, string>): VariableBag => ({ user_message: '', ...v }) as VariableBag;

describe('evaluateConditionTree', () => {
  const vars = bag({ plan: 'pro', age: '20', city: 'Pune' });

  it('and / or over rules', () => {
    const and = { op: 'and', items: [r('plan', 'equals', 'pro'), r('age', 'gt', '18')] };
    const or = { op: 'or', items: [r('plan', 'equals', 'free'), r('age', 'gt', '18')] };
    expect(evaluateConditionTree(vars, and)).toBe(true);
    expect(
      evaluateConditionTree(vars, { ...and, items: [...and.items, r('city', 'equals', 'x')] }),
    ).toBe(false);
    expect(evaluateConditionTree(vars, or)).toBe(true);
    expect(evaluateConditionTree(vars, { op: 'or', items: [r('plan', 'equals', 'free')] })).toBe(
      false,
    );
  });

  it('nests: (plan=pro AND (age<18 OR city=Pune))', () => {
    const t = {
      op: 'and',
      items: [
        r('plan', 'equals', 'pro'),
        { op: 'or', items: [r('age', 'lt', '18'), r('city', 'equals', 'pune')] },
      ],
    };
    expect(evaluateConditionTree(vars, t)).toBe(true);
    expect(evaluateConditionTree(bag({ plan: 'pro', age: '30', city: 'Goa' }), t)).toBe(false);
  });

  it('an empty group is false, like an empty flat list, and so is a nested empty group', () => {
    expect(evaluateConditions(vars, [], [])).toBe(false);
    expect(evaluateConditionTree(vars, { op: 'and', items: [] })).toBe(false);
    expect(evaluateConditionTree(vars, { op: 'or', items: [] })).toBe(false);
    expect(
      evaluateConditionTree(vars, {
        op: 'or',
        items: [{ op: 'and', items: [] }, r('plan', 'equals', 'pro')],
      }),
    ).toBe(true);
    expect(evaluateConditionTree(vars, { op: 'and', items: [{ op: 'or', items: [] }] })).toBe(
      false,
    );
    expect(evaluateConditionTree(vars, 'nope')).toBe(false);
  });

  it('uses the flat per-rule comparison: coercion, user_message fallback, unknown operator', () => {
    expect(
      evaluateConditionTree(bag({ n: ' 10 ' }), { op: 'and', items: [r('n', 'gt', '9')] }),
    ).toBe(true);
    expect(
      evaluateConditionTree(bag({ n: 'abc' }), { op: 'and', items: [r('n', 'gt', '1')] }),
    ).toBe(false);
    expect(
      evaluateConditionTree(bag({ x: 'Hello' }), { op: 'and', items: [r('x', 'EQUALS', 'hello')] }),
    ).toBe(true);
    expect(
      evaluateConditionTree(bag({ user_message: 'hi' }), {
        op: 'and',
        items: [r('', 'equals', 'hi')],
      }),
    ).toBe(true);
    expect(evaluateConditionTree(vars, { op: 'and', items: [r('plan', 'bogus', 'pro')] })).toBe(
      false,
    );
  });

  it('clamps depth to 3 and rules to 20 (deeper groups and extra rules are dropped)', () => {
    const deep = {
      op: 'and',
      items: [
        r('plan', 'equals', 'pro'),
        {
          op: 'and',
          items: [{ op: 'and', items: [{ op: 'and', items: [r('plan', 'equals', 'pro')] }] }],
        },
      ],
    };
    const clean = flbSanitizeConditionGroup(deep)!;
    expect(flbCondDepth(clean)).toBe(FLB_COND_MAX_DEPTH);
    // the depth-4 group (holding a TRUE rule) is dropped, leaving an empty depth-3 group: false
    expect(evaluateConditionTree(vars, deep)).toBe(false);
    const many = { op: 'or', items: Array.from({ length: 30 }, () => r('plan', 'equals', 'pro')) };
    expect(flbCondRuleCount(flbSanitizeConditionGroup(many)!)).toBe(FLB_COND_MAX_RULES);
  });
});

describe('flat chain to tree conversion keeps the exact left-to-right semantics', () => {
  const NAMES = ['a', 'b', 'c'];
  const rnd = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

  it('equal truth tables on random chains and random variable assignments', () => {
    const next = rnd(42);
    let converted = 0;
    let refused = 0;
    for (let round = 0; round < 400; round++) {
      const n = 1 + Math.floor(next() * 8);
      const rules = Array.from({ length: n }, () =>
        r(NAMES[Math.floor(next() * 3)]!, 'equals', 'y'),
      );
      const joiners = Array.from({ length: n - 1 }, () => (next() < 0.5 ? 'OR' : 'AND'));
      const tree = flbCondTreeFromFlat(rules, joiners);
      if (!tree) {
        refused++;
        expect(n).toBeGreaterThan(3); // only chains that alternate more than the depth allows are refused
        continue;
      }
      converted++;
      expect(flbCondDepth(tree)).toBeLessThanOrEqual(FLB_COND_MAX_DEPTH);
      for (let mask = 0; mask < 8; mask++) {
        const v = bag(Object.fromEntries(NAMES.map((k, i) => [k, mask & (1 << i) ? 'y' : 'n'])));
        expect(evaluateConditionTree(v, tree)).toBe(evaluateConditions(v, rules, joiners));
      }
    }
    expect(converted).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(0);
  });

  it('no precedence: A OR B AND C is (A OR B) AND C; same joiners merge', () => {
    const rules = [r('a', 'equals', 'y'), r('b', 'equals', 'y'), r('c', 'equals', 'y')];
    expect(flbCondTreeFromFlat(rules, ['OR', 'AND'])).toEqual({
      op: 'and',
      items: [{ op: 'or', items: [rules[0], rules[1]] }, rules[2]],
    });
    expect(flbCondTreeFromFlat(rules, ['AND', 'AND'])).toEqual({ op: 'and', items: rules });
    expect(flbCondTreeFromFlat(rules, [])).toEqual({ op: 'and', items: rules });
  });

  it('refuses over-limit chains and maps an empty list to an empty group', () => {
    const many = Array.from({ length: 21 }, () => r('a'));
    expect(flbCondTreeFromFlat(many, [])).toBeNull();
    expect(flbCondTreeFromFlat([], [])).toEqual({ op: 'and', items: [] });
  });
});

describe('compile seam and executor', () => {
  const tree: FlbCondGroup = {
    op: 'or',
    items: [r('{{plan}}', 'equals', 'pro'), { op: 'and', items: [r('@age', 'gt', '1')] }],
  };
  const node = (data: Record<string, unknown>) =>
    compileGraph({
      flowNodes: [
        { id: 't', type: 'trigger', data: {}, isStart: true },
        { id: 'c', type: 'condition', data },
      ],
      flowEdges: [],
    }).nodes.find((n) => n.id === 'c')!;

  it('compileGraph passes a sanitised tree through, and omits it when absent or malformed', () => {
    const p = node({ conditions: [r('x')], conditionGroup: tree }).props as Record<string, unknown>;
    expect((p.conditionGroup as FlbCondGroup).items[0]).toEqual(r('plan', 'equals', 'pro'));
    expect(((p.conditionGroup as FlbCondGroup).items[1] as FlbCondGroup).items[0]).toMatchObject({
      variable: 'age',
    });
    expect(p.conditions).toHaveLength(1);
    expect('conditionGroup' in (node({ conditions: [r('x')] }).props as object)).toBe(false);
    expect('conditionGroup' in (node({ conditionGroup: 'junk' }).props as object)).toBe(false);
  });

  it('the editor-side shaper (flbToRuntimeData) and the runtime compile agree', () => {
    const shaped = flbToRuntimeData({
      type: 'condition',
      data: { conditionGroup: tree },
    }) as Record<string, unknown>;
    expect(shaped.conditionGroup).toEqual(
      (node({ conditionGroup: tree }).props as Record<string, unknown>).conditionGroup,
    );
    const deep = {
      op: 'and',
      items: [{ op: 'and', items: [{ op: 'and', items: [{ op: 'and', items: [r('a')] }] }] }],
    };
    const a = flbToRuntimeData({ type: 'condition', data: { conditionGroup: deep } }) as Record<
      string,
      unknown
    >;
    const b = node({ conditionGroup: deep }).props as Record<string, unknown>;
    expect(a.conditionGroup).toEqual(b.conditionGroup);
  });

  const run = async (props: Record<string, unknown>, vars: Record<string, string>) => {
    const notes: string[] = [];
    const ex = CORE_EXECUTORS.find((e) => e.types.includes('Condition'))!;
    const res = await ex.execute({
      run: { vars },
      node: { id: 'c', type: 'Condition', props },
      note: (t: string) => notes.push(t),
    } as unknown as NodeContext);
    return res as { port: number };
  };

  it('the executor: the tree wins over the flat arrays; flat flows are unchanged; a junk tree falls back to flat', async () => {
    const flat = { conditions: [r('plan', 'equals', 'pro')], logicOperators: [] };
    expect((await run({ ...flat }, { plan: 'pro' })).port).toBe(1);
    expect(
      (
        await run(
          { ...flat, conditionGroup: { op: 'and', items: [r('plan', 'equals', 'free')] } },
          { plan: 'pro' },
        )
      ).port,
    ).toBe(2);
    expect(
      (await run({ ...flat, conditionGroup: { op: 'and', items: [] } }, { plan: 'pro' })).port,
    ).toBe(2);
    expect((await run({ ...flat, conditionGroup: 'junk' }, { plan: 'pro' })).port).toBe(1);
  });
});
