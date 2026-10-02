import type { TagResponse } from '@crm/contracts';
import type { TagRow } from './tags.repository';

export function toTagResponse(row: TagRow): TagResponse {
  return {
    id: row.uuid,
    name: row.name,
    color: row.color,
    ...(row.contactCount !== undefined ? { contactCount: row.contactCount } : {}),
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
