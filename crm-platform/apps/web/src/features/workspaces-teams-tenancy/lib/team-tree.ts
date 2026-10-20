import type { WspTeam } from '@crm/contracts';

export interface TeamRowItem {
  team: WspTeam;
  /** 0 for a top-level team. */
  level: number;
}

/**
 * The teams as an indented list: every top-level team, each followed by its sub-teams, depth first, siblings by name. A team whose
 * parent is not in the list (the page that holds it was not loaded) is shown at the top so nothing disappears. A loop (which the
 * database refuses) cannot hang the screen: a team is placed once.
 */
export function treeOrder(teams: readonly WspTeam[]): TeamRowItem[] {
  const ids = new Set(teams.map((t) => t.id));
  const byParent = new Map<string | null, WspTeam[]>();
  for (const t of teams) {
    const key = t.parentId !== null && ids.has(t.parentId) ? t.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), t]);
  }
  const byName = (a: WspTeam, b: WspTeam) => a.name.localeCompare(b.name);
  const out: TeamRowItem[] = [];
  const placed = new Set<string>();
  const walk = (parent: string | null, level: number) => {
    for (const t of (byParent.get(parent) ?? []).slice().sort(byName)) {
      if (placed.has(t.id)) continue;
      placed.add(t.id);
      out.push({ team: t, level });
      walk(t.id, level + 1);
    }
  };
  walk(null, 0);
  // Whatever is left sits in a loop the database would have refused; show it rather than hide a team.
  for (const t of teams.slice().sort(byName)) {
    if (placed.has(t.id)) continue;
    placed.add(t.id);
    out.push({ team: t, level: 0 });
    walk(t.id, 1);
  }
  return out;
}

/** The team and every team below it: none of these may become its parent. */
export function descendantIds(teams: readonly WspTeam[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of teams) {
      if (t.parentId !== null && out.has(t.parentId) && !out.has(t.id)) {
        out.add(t.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Levels of the subtree below a team, the team itself counting as 1 (a team with no sub-teams is 1). */
export function subtreeHeight(teams: readonly WspTeam[], id: string): number {
  const kids = teams.filter((t) => t.parentId === id);
  return 1 + kids.reduce((m, k) => Math.max(m, subtreeHeight(teams, k.id)), 0);
}

/**
 * The parents the picker offers for a team: everything but the team and its own sub-teams, each marked unavailable when putting
 * the team (with its sub-teams) under it would go deeper than `maxDepth`. `team` null = a team being created.
 */
export function parentChoices(
  teams: readonly WspTeam[],
  team: WspTeam | null,
  maxDepth: number,
): Array<TeamRowItem & { allowed: boolean }> {
  const blocked = team ? descendantIds(teams, team.id) : new Set<string>();
  const below = team ? subtreeHeight(teams, team.id) : 1;
  return treeOrder(teams)
    .filter((r) => !blocked.has(r.team.id))
    .map((r) => ({ ...r, allowed: r.team.depth + below <= maxDepth }));
}
