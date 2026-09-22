import type { UserResponse } from '@crm/contracts';
import type { UserRoleRow, UserRow } from './users.repository';

/** Row -> API shape. Roles come pre-joined so this stays a pure mapper. */
export function toUserResponse(row: UserRow, roleRows: UserRoleRow[]): UserResponse {
  return {
    id: row.uuid,
    email: row.email,
    fullName: row.fullName,
    status: row.status as UserResponse['status'],
    roles: roleRows.map((r) => ({ id: r.roleUuid, name: r.roleName })),
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
