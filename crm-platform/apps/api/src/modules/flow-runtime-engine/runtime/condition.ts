import { flbIsCondGroup, flbSanitizeConditionGroup, type FlbCondGroup } from '@crm/contracts';
import { asText, isSet, resolveVariable, type VariableBag } from './variables';

export interface ConditionRule {
  variable?: unknown;
  operator?: unknown;
  value?: unknown;
}

/**
 * One rule against the bag (TW-FLR-028). The builder's operator names (`exists`, `gt`, `lt`) and Reference's older ones
 * (`greater_than`, `is_not_empty`) both work; an operator nobody knows is false. Presence tests read the variable itself; every
 * comparison falls back to what the customer last typed (`user_message`) when the named variable is blank.
 */
export function evalRule(bag: VariableBag, rule: ConditionRule): boolean {
  const op = String(rule?.operator ?? 'equals')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_');
  const resolved = resolveVariable(bag, rule?.variable);

  switch (op) {
    case 'exists':
    case 'is_set':
      return isSet(resolved);
    case 'not_exists':
    case 'is_not_set':
      return !isSet(resolved);
  }

  let actual: unknown = resolved || '';
  if (!actual) actual = bag['user_message'] || '';
  const expectedRaw = rule?.value ?? '';
  const raw = asText(actual);
  const u = raw.toLowerCase().trim();
  const v = String(expectedRaw).toLowerCase().trim();
  switch (op) {
    case 'equals':
      return u === v;
    case 'not_equals':
      return u !== v;
    case 'contains':
      return u.includes(v);
    case 'not_contains':
      return !u.includes(v);
    case 'gt':
    case 'greater_than':
      return parseFloat(raw) > parseFloat(String(expectedRaw));
    case 'lt':
    case 'less_than':
      return parseFloat(raw) < parseFloat(String(expectedRaw));
    case 'is_empty':
      return u === '';
    case 'is_not_empty':
      return u !== '';
    case 'starts_with':
      return u.startsWith(v);
    case 'ends_with':
      return u.endsWith(v);
    default:
      return false;
  }
}

/**
 * The AND/OR chain, left to right with each joiner between its two rules (Reference once broke on the first match and turned every
 * chain into an OR). A missing or short joiner list means AND; no rules is false.
 */
export function evaluateConditions(
  bag: VariableBag,
  rules: readonly ConditionRule[] = [],
  joiners: readonly unknown[] = [],
): boolean {
  if (!Array.isArray(rules) || rules.length === 0) return false;
  const js = Array.isArray(joiners) ? joiners : [];
  let met = evalRule(bag, rules[0]!);
  for (let i = 1; i < rules.length; i++) {
    const next = evalRule(bag, rules[i]!);
    met = String(js[i - 1] ?? 'AND').toUpperCase() === 'OR' ? met || next : met && next;
  }
  return met;
}

/**
 * The nested tree (beyond Reference). `and` is every item true, `or` is any item true; each rule goes through the same `evalRule` as the
 * flat chain, so operators and type coercion are identical. An empty group is false, like an empty flat list. The tree is
 * re-sanitised here, so a graph that skipped `compileGraph` still cannot exceed the depth (3) or rule (20) limits.
 */
export function evaluateConditionTree(bag: VariableBag, tree: unknown): boolean {
  const clean = flbSanitizeConditionGroup(tree);
  if (!clean) return false;
  const walk = (g: FlbCondGroup): boolean => {
    if (g.items.length === 0) return false;
    const test = (i: FlbCondGroup['items'][number]) =>
      flbIsCondGroup(i) ? walk(i) : evalRule(bag, i);
    return g.op === 'or' ? g.items.some(test) : g.items.every(test);
  };
  return walk(clean);
}
