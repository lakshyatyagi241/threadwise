import { hasRoutingConditions, type RoutingRule } from '@crm/contracts';

/**
 * The Auto-assignment page shows ONE pipeline (spec H14): the contact's own agent (the switches at the top), then the rules in priority order,
 * then "Everyone else" (the one fallback rule), then the waiting queue. These helpers read the rules the API returned; nothing here decides
 * for the server.
 */

/** The rules the list shows in order: every rule except the fallback, which is pinned last as "Everyone else". */
export function pipelineRules(rules: readonly RoutingRule[]): RoutingRule[] {
  return rules.filter((r) => !r.isFallback);
}

/** The single "Everyone else" rule, or undefined when the workspace never set one (conversations then wait in the queue). */
export function everyoneElseOf(rules: readonly RoutingRule[]): RoutingRule | undefined {
  return rules.find((r) => r.isFallback);
}

/** What "Everyone else" does now: `evenly` over all agents, `listed` people or teams, or `queue` (no row, or the row is switched off). */
export type EveryoneElseMode = 'evenly' | 'listed' | 'queue';

export function everyoneElseMode(rule: RoutingRule | undefined): EveryoneElseMode {
  if (!rule || !rule.isActive) return 'queue';
  if (rule.assign?.everyone) return 'evenly';
  return 'listed';
}

/** A rule that matches every conversation: "Only for conversations that match" is off. A rule with no condition and no switch never matches. */
export function isCatchAll(rule: RoutingRule): boolean {
  return !rule.isFallback && rule.appliesToAll;
}

/** A rule that has conditions switched on but none left (a hand-edited row): it can never match. */
export function neverMatches(rule: RoutingRule): boolean {
  return !rule.isFallback && !rule.appliesToAll && !hasRoutingConditions(rule.conditions);
}

/**
 * The rules that can never run because an active catch-all above them stops evaluation (`stopOnMatch`). Keyed by the rule that blocks
 * them (its name), in list order. A catch-all that does not stop ("Keeps checking") blocks nobody. Switched-off rules are not warned about.
 * Honest limit: the catch-all only stops a conversation when it finds somebody available; if its agents are all away the rules below it
 * still get a turn, so the warning says "unless nobody is available".
 */
export function shadowedRules(
  ordered: readonly RoutingRule[],
): Array<{ blocker: RoutingRule; blocked: RoutingRule[] }> {
  const out: Array<{ blocker: RoutingRule; blocked: RoutingRule[] }> = [];
  let blocker: RoutingRule | null = null;
  for (const r of ordered) {
    if (!r.isActive) continue;
    if (blocker) {
      const last = out[out.length - 1]!;
      last.blocked.push(r);
      continue;
    }
    if (isCatchAll(r) && r.stopOnMatch) {
      blocker = r;
      out.push({ blocker: r, blocked: [] });
    }
  }
  return out.filter((x) => x.blocked.length > 0);
}

/** The ids of every rule a catch-all above blocks, for the "Never runs" mark on its row. */
export function shadowedIds(ordered: readonly RoutingRule[]): Set<string> {
  return new Set(shadowedRules(ordered).flatMap((x) => x.blocked.map((r) => r.id)));
}

/** The list with the item at `from` moved to `to` (drag and drop, and the arrows). */
export function movedIds(ids: readonly string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return [...ids];
  const next = [...ids];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
