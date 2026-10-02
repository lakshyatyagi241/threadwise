import type { RoleResponse } from '@crm/contracts';
import type { RoleGrantRow, RoleRow } from './roles.repository';

export interface RoleViewContext {
  userCount: number;
  grantable: boolean;
  editable: boolean;
}

export function toRoleResponse(
  row: RoleRow,
  grantRows: RoleGrantRow[],
  view: RoleViewContext,
): RoleResponse {
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
    userCount: view.userCount,
    isPreset: row.systemKey !== null,
    grantable: view.grantable,
    editable: view.editable,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
