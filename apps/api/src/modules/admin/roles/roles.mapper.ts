import type { RoleResponse } from '@crm/contracts';
import type { RoleGrantRow, RoleRow } from './roles.repository';

export function toRoleResponse(row: RoleRow, grantRows: RoleGrantRow[]): RoleResponse {
  return {
    id: row.uuid,
    name: row.name,
    systemKey: row.systemKey,
    isLocked: row.isLocked,
    grants: grantRows.map((g) => ({
      permissionKey: g.permissionKey,
      effect: g.effect,
      recordScope: g.recordScope,
    })),
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
