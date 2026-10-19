import type { AssignmentRule } from '@crm/contracts';

/**
 * The list shows rules in three groups, each in the order of its places: the active rules with conditions (priority 1, 2, ...), then the
 * active fallbacks (they run after every other rule, whatever their place), then the paused rules (never prioritised). A rule moves
 * inside its own group; sending the whole list in this order keeps the stored order and what is shown the same.
 */
export type RuleGroup = 'conditional' | 'fallback' | 'paused';

export const ruleGroup = (r: Pick<AssignmentRule, 'isActive' | 'isFallback'>): RuleGroup =>
  !r.isActive ? 'paused' : r.isFallback ? 'fallback' : 'conditional';

const ORDER: Record<RuleGroup, number> = { conditional: 0, fallback: 1, paused: 2 };

/** The rules of one module in display order. */
export function sortRules<T extends AssignmentRule>(rules: readonly T[]): T[] {
  return [...rules].sort(
    (a, b) => ORDER[ruleGroup(a)] - ORDER[ruleGroup(b)] || a.position - b.position,
  );
}

/** `items` with the item at `from` moved to `to` (clamped); an unchanged copy when nothing moves. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items];
  if (from < 0 || from >= out.length) return out;
  const target = Math.max(0, Math.min(out.length - 1, to));
  if (target === from) return out;
  const [item] = out.splice(from, 1);
  out.splice(target, 0, item!);
  return out;
}

/**
 * The ids to send after moving `id` onto the place of `overId` (a drop) or one step (an arrow). Null when the move is not allowed
 * (another group, the same place, an unknown rule).
 */
export function reorderIds(
  sorted: readonly AssignmentRule[],
  id: string,
  target: { overId: string } | { step: -1 | 1 },
): string[] | null {
  const from = sorted.findIndex((r) => r.id === id);
  if (from === -1) return null;
  const to =
    'overId' in target ? sorted.findIndex((r) => r.id === target.overId) : from + target.step;
  if (to < 0 || to >= sorted.length || to === from) return null;
  if (ruleGroup(sorted[from]!) !== ruleGroup(sorted[to]!)) return null;
  return moveItem(
    sorted.map((r) => r.id),
    from,
    to,
  );
}
