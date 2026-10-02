import type { ContactGroupResponse } from '@crm/contracts';
import type { ContactGroupRow } from './contact-groups.repository';

export function toContactGroupResponse(row: ContactGroupRow): ContactGroupResponse {
  return {
    id: row.uuid,
    name: row.name,
    note: row.note,
    color: row.color,
    memberCount: row.memberCount,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
