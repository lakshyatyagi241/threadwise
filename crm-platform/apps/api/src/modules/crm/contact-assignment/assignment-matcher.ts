/** Pure helpers of the assignment engine: the order rules are tried in, the candidates of a rule, and the numbers a list shows. */

interface Orderable {
  id: number;
  isActive: boolean;
  /** True when the rule has no condition: it matches everything. */
  isFallback: boolean;
}

/**
 * The order active rules are tried in: every rule WITH conditions first, in the order the person arranged them, then the rules without
 * (the fallbacks, which match everything), in their arranged order. The input is already in arranged order. A rule that is not active
 * never runs.
 */
export function orderRules<T extends Orderable>(rules: readonly T[]): T[] {
  const active = rules.filter((r) => r.isActive);
  return [...active.filter((r) => !r.isFallback), ...active.filter((r) => r.isFallback)];
}

/** Priority numbers among the active rules (1 runs first); inactive rules have none. Keyed by rule id. */
export function priorities<T extends Orderable>(rules: readonly T[]): Map<number, number> {
  return new Map(orderRules(rules).map((r, i) => [r.id, i + 1]));
}

/** Candidates in the order the rule lists them (people first, then each team's members), without repeats. */
export function candidateOrder(
  userIds: readonly number[],
  teamMemberIds: readonly number[],
): number[] {
  return [...new Set([...userIds, ...teamMemberIds])];
}

/** Two timestamps from the database are the same instant (a `timestamptz` read back twice may differ by the driver's rounding). */
export function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a.getTime() - b.getTime()) < 2;
}
