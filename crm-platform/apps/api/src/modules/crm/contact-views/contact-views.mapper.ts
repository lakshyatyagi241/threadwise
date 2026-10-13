import type { ContactViewResponse } from '@crm/contracts';
import type { ContactViewRow } from './contact-views.repository';

/** What the caller may do with a view: `canEdit` (creator, or shared with them as `can_edit`) and `canManage` (creator). */
export interface ViewAccess {
  canEdit: boolean;
  canManage: boolean;
}

export function toContactViewResponse(
  row: ContactViewRow,
  isFavorite: boolean,
  access: ViewAccess,
  sharedWith: string[] = [],
): ContactViewResponse {
  return {
    id: row.uuid,
    name: row.name,
    filter: row.filter,
    position: row.position,
    isShared: row.isShared,
    shareMode: row.shareMode,
    accessType: row.accessType,
    sharedWith: row.shareMode === 'selected' ? sharedWith : [],
    canEdit: access.canEdit,
    canManage: access.canManage,
    createdBy: row.createdByUuid,
    isFavorite,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
