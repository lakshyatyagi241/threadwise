import type { ModuleKey, StatusOptionResponse } from '@crm/contracts';
import type { StatusOptionRow } from './status-options.repository';

export function toStatusOptionResponse(row: StatusOptionRow): StatusOptionResponse {
  return {
    id: row.uuid,
    moduleKey: row.moduleKey as ModuleKey,
    optionGroup: row.optionGroup,
    value: row.value,
    label: row.label,
    color: row.color,
    position: row.position,
    isDefault: row.isDefault,
    isActive: row.isActive,
    rowVersion: row.rowVersion,
  };
}
