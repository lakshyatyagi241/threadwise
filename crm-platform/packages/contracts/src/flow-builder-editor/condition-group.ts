/**
 * Nested condition groups for the Condition node (beyond Reference, by explicit request).
 *
 * Reference's Condition is a flat chain of rules (`conditions` + `operators`) folded strictly left to right. A node may now also carry
 * an optional tree, `conditionGroup`: `{ op: 'and' | 'or', items: [rule | group, ...] }`. When the tree is present and valid it
 * wins and the flat arrays are ignored; a flow with only the flat arrays behaves exactly as before.
 *
 * Shared by the editor (web), the simulator, the save-time shaper (`flbToRuntimeData`) and the runtime (`compileGraph`), so every
 * side clamps the same way. The comparison of ONE rule is NOT here: the runtime keeps `evalRule` (condition.ts) and the
 * simulator keeps `checkCond`.
 *
 * Limits: the root group is depth 1 and a group may nest to depth 3; at most 20 rules in the whole tree.
 * An empty group is false (like an empty flat rule list), whatever its `op`.
 */

export const FLB_COND_MAX_DEPTH = 3;
export const FLB_COND_MAX_RULES = 20;

export interface FlbCondRule {
  variable: string;
  operator: string;
  value: string;
}
export interface FlbCondGroup {
  op: 'and' | 'or';
  items: FlbCondItem[];
}
export type FlbCondItem = FlbCondRule | FlbCondGroup;

export const flbIsCondGroup = (i: unknown): i is FlbCondGroup =>
  typeof i === 'object' && i !== null && Array.isArray((i as { items?: unknown }).items);

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, fb = ''): string =>
  v === undefined || v === null ? fb : typeof v === 'object' ? fb : String(v);

/**
 * Cleans an untrusted tree: unknown shapes are dropped, groups past `FLB_COND_MAX_DEPTH` are dropped, rules past
 * `FLB_COND_MAX_RULES` (in reading order) are dropped. Returns null when the input is not a group at all.
 * `cleanVar` normalises variable names (`{{plan}}` to `plan`); it defaults to trimming.
 */
export function flbSanitizeConditionGroup(
  raw: unknown,
  cleanVar: (v: unknown) => string = (v) => text(v).trim(),
): FlbCondGroup | null {
  if (!flbIsCondGroup(raw)) return null;
  let budget = FLB_COND_MAX_RULES;
  const walk = (g: unknown, depth: number): FlbCondGroup | null => {
    if (!flbIsCondGroup(g) || depth > FLB_COND_MAX_DEPTH) return null;
    const items: FlbCondItem[] = [];
    for (const it of g.items as unknown[]) {
      if (flbIsCondGroup(it)) {
        const sub = walk(it, depth + 1);
        if (sub) items.push(sub);
      } else if (isRec(it)) {
        if (budget <= 0) continue;
        budget--;
        items.push({
          variable: cleanVar(it.variable),
          operator: text(it.operator, 'equals'),
          value: text(it.value),
        });
      }
    }
    return { op: text((g as { op?: unknown }).op).toLowerCase() === 'or' ? 'or' : 'and', items };
  };
  return walk(raw, 1);
}

export function flbCondRuleCount(g: FlbCondGroup): number {
  return g.items.reduce((n, i) => n + (flbIsCondGroup(i) ? flbCondRuleCount(i) : 1), 0);
}

/** Depth of the deepest group (a lone root is 1). */
export function flbCondDepth(g: FlbCondGroup): number {
  return 1 + g.items.reduce((m, i) => (flbIsCondGroup(i) ? Math.max(m, flbCondDepth(i)) : m), 0);
}

/**
 * The tree equal to a flat chain. The flat chain is folded strictly left to right with NO AND-over-OR precedence (`A OR B AND C`
 * is `(A OR B) AND C`), so `r1 J1 r2 J2 r3` is `group(J2, [group(J1, [r1, r2]), r3])`. A run of the same joiner is associative
 * and is merged into one group, so only a change of joiner deepens the tree. Returns null when the result would exceed the depth
 * or rule limits (the node then stays on the flat editor). An empty list gives an empty group.
 */
export function flbCondTreeFromFlat(
  rules: readonly unknown[],
  joiners: readonly unknown[] = [],
): FlbCondGroup | null {
  const list = Array.isArray(rules) ? rules : [];
  if (list.length > FLB_COND_MAX_RULES) return null;
  const rule = (r: unknown): FlbCondRule => {
    const x = isRec(r) ? r : {};
    return {
      variable: text(x.variable).trim(),
      operator: text(x.operator, 'equals'),
      value: text(x.value),
    };
  };
  if (list.length === 0) return { op: 'and', items: [] };
  const js = Array.isArray(joiners) ? joiners : [];
  const joinerAt = (i: number): 'and' | 'or' => (text(js[i]).toUpperCase() === 'OR' ? 'or' : 'and');
  let acc: FlbCondGroup = { op: joinerAt(0), items: [rule(list[0])] };
  // `acc` always holds everything folded so far under `acc.op`.
  for (let i = 1; i < list.length; i++) {
    const op = joinerAt(i - 1);
    const next = rule(list[i]);
    if (acc.op === op) {
      acc = { op, items: [...acc.items, next] };
    } else {
      acc = { op, items: [acc, next] };
    }
  }
  return flbCondDepth(acc) > FLB_COND_MAX_DEPTH ? null : acc;
}

export interface FlbCondProblems {
  /** Rules whose variable is blank. */
  incompleteRules: number;
  /** Groups with no items. */
  emptyGroups: number;
}

export function flbCondProblems(g: FlbCondGroup): FlbCondProblems {
  const out: FlbCondProblems = { incompleteRules: 0, emptyGroups: 0 };
  const walk = (grp: FlbCondGroup) => {
    if (grp.items.length === 0) out.emptyGroups++;
    for (const i of grp.items) {
      if (flbIsCondGroup(i)) walk(i);
      else if (!i.variable.trim()) out.incompleteRules++;
    }
  };
  walk(g);
  return out;
}

export const FLB_COND_OP_SYMBOLS: Record<string, string> = {
  equals: '=',
  not_equals: '≠',
  contains: '⊆',
  not_contains: '⊄',
  gt: '>',
  lt: '<',
  exists: 'is set',
};

/** One line for the canvas card: `({{a}} = x AND {{b}} > 3) OR {{c}} is set`. A group with two or more items is parenthesised unless it is the root. */
export function flbCondSummary(g: FlbCondGroup): string {
  const rule = (r: FlbCondRule) => {
    const sym = FLB_COND_OP_SYMBOLS[r.operator || 'equals'] ?? r.operator;
    const left = `{{${r.variable.trim() || '?'}}} ${sym}`;
    return r.operator === 'exists' ? left : `${left} ${r.value.trim() || '?'}`;
  };
  const group = (grp: FlbCondGroup, root: boolean): string => {
    if (grp.items.length === 0) return '()';
    const body = grp.items
      .map((i) => (flbIsCondGroup(i) ? group(i, false) : rule(i)))
      .join(grp.op === 'or' ? ' OR ' : ' AND ');
    return !root && grp.items.length > 1 ? `(${body})` : body;
  };
  return group(g, true);
}
