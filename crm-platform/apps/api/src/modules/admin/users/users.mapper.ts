import type { UserResponse } from '@crm/contracts';
import type { TeamTree, UserRoleRow, UserRow, UserTeamRow } from './users.repository';

/** How far up the tree a manager is looked for; the database refuses anything deeper than a few levels anyway. */
const MAX_HOPS = 10;

/**
 * The managers of one person: for the primary team, the nearest manager at or above that team who is somebody other than the person
 * (a team's own manager is managed by the manager of its parent team); when the primary team has none, or there is no primary team,
 * the same for every team the person is on, each manager once. A pure function of the rows, so it is testable without a database.
 */
export function managersOf(
  userId: number,
  rows: UserTeamRow[],
  tree: TeamTree = new Map(),
): UserResponse['managers'] {
  const mine = rows.filter((r) => r.userId === userId);
  const nearest = (teamId: number) => {
    let cur: number | null = teamId;
    for (let hop = 0; hop < MAX_HOPS && cur !== null; hop += 1) {
      const node = tree.get(cur);
      if (node?.lead && node.lead.userId !== userId) return node.lead;
      cur = node?.parentId ?? null;
    }
    return null;
  };
  const pick = (list: UserTeamRow[]) => {
    const seen = new Map<string, string>();
    for (const r of list) {
      const lead = nearest(r.teamId);
      if (lead) seen.set(lead.uuid, lead.name);
    }
    return [...seen].map(([id, fullName]) => ({ id, fullName }));
  };
  const primary = pick(mine.filter((r) => r.isPrimary));
  return primary.length > 0 ? primary : pick(mine);
}

/** Row -> API shape. Roles and teams come pre-joined so this stays a pure mapper. */
export function toUserResponse(
  row: UserRow,
  roleRows: UserRoleRow[],
  teams: { rows: UserTeamRow[]; tree: TeamTree } = { rows: [], tree: new Map() },
): UserResponse {
  return {
    id: row.uuid,
    email: row.email,
    fullName: row.fullName,
    status: row.status as UserResponse['status'],
    roles: roleRows.map((r) => ({ id: r.roleUuid, name: r.roleName })),
    teams: teams.rows
      .filter((t) => t.userId === row.id)
      .map((t) => ({
        id: t.teamUuid,
        name: t.teamName,
        color: t.teamColor,
        role: t.role,
        isPrimary: t.isPrimary,
      })),
    managers: managersOf(row.id, teams.rows, teams.tree),
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
