import type { FieldSectionResponse, ModuleKey } from '@crm/contracts';
import type { FieldSectionRow } from './field-sections.repository';

export function toFieldSectionResponse(row: FieldSectionRow): FieldSectionResponse {
  return {
    id: row.uuid,
    moduleKey: row.moduleKey as ModuleKey,
    name: row.name,
    position: row.position,
    isActive: row.isActive,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
