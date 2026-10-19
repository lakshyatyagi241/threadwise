import type { UserResponse } from '@crm/contracts';
import type { UserRoleRow, UserRow, UserTeamRow } from './users.repository';

/**
 * The managers of one person: the manager of their primary team when that is somebody other than themself, otherwise the
 * managers of every team they are on (each once). A pure function of the rows, so it is testable without a database.
 */
export function managersOf(userId: number, rows: UserTeamRow[]): UserResponse['managers'] {
  const mine = rows.filter((r) => r.userId === userId);
  const pick = (list: UserTeamRow[]) => {
    const seen = new Map<string, string>();
    for (const r of list) {
      if (r.leadUuid && r.leadName && r.leadUserId !== userId) seen.set(r.leadUuid, r.leadName);
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
  teamRows: UserTeamRow[] = [],
): UserResponse {
  return {
    id: row.uuid,
    email: row.email,
    fullName: row.fullName,
    status: row.status as UserResponse['status'],
    roles: roleRows.map((r) => ({ id: r.roleUuid, name: r.roleName })),
    teams: teamRows
      .filter((t) => t.userId === row.id)
      .map((t) => ({
        id: t.teamUuid,
        name: t.teamName,
        color: t.teamColor,
        role: t.role,
        isPrimary: t.isPrimary,
      })),
    managers: managersOf(row.id, teamRows),
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
