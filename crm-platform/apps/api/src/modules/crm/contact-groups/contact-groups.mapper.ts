import type { ContactGroupResponse } from '@crm/contracts';
import { personOf } from '../../../common/person-ref';
import type { ContactGroupRow } from './contact-groups.repository';

export function toContactGroupResponse(row: ContactGroupRow): ContactGroupResponse {
  return {
    id: row.uuid,
    name: row.name,
    note: row.note,
    color: row.color,
    memberCount: row.memberCount,
    rowVersion: row.rowVersion,
    createdBy: personOf(row.createdByUuid, row.createdByName),
    updatedBy: personOf(row.updatedByUuid, row.updatedByName),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
