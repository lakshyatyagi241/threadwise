import { MAX_TEAM_DEPTH } from './scope-sql';

/**
 * `team_and_below` in memory (BL-382): the given teams plus every team below them, for code that already holds the whole team list
 * (the realtime member directory loads every membership of a workspace at once). The SQL twin is `teamTreeIdsSql`; both are
 * cycle-safe and stop at `MAX_TEAM_DEPTH`, and a test keeps them equal.
 *
 * `parentOf` maps a team id to its parent id (null or absent for a top team).
 */
export function withDescendants(
  teamIds: readonly number[],
  parentOf: ReadonlyMap<number, number | null>,
  maxDepth: number = MAX_TEAM_DEPTH,
): number[] {
  const childrenOf = new Map<number, number[]>();
  for (const [id, parent] of parentOf) {
    if (parent === null || parent === undefined) continue;
    const list = childrenOf.get(parent) ?? [];
    list.push(id);
    childrenOf.set(parent, list);
  }
  const seen = new Set<number>(teamIds);
  let frontier = [...seen];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const id of frontier) {
      for (const child of childrenOf.get(id) ?? []) {
        if (seen.has(child)) continue;
        seen.add(child);
        next.push(child);
      }
    }
    frontier = next;
  }
  return [...seen];
}
