import type { ContactViewResponse } from '@crm/contracts';
import type { ContactViewRow } from './contact-views.repository';

export function toContactViewResponse(
  row: ContactViewRow,
  isFavorite: boolean,
): ContactViewResponse {
  return {
    id: row.uuid,
    name: row.name,
    filter: row.filter,
    position: row.position,
    isShared: row.isShared,
    createdBy: row.createdByUuid,
    isFavorite,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
