import type { AttributeResponse } from '@crm/contracts';
import type { AttributeRow } from './attributes.repository';

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function toAttributeResponse(row: AttributeRow): AttributeResponse {
  return {
    id: row.uuid,
    key: row.key,
    name: row.label,
    type: row.fieldType,
    defaultValue: str(row.config?.defaultValue),
    description: str(row.config?.description),
    isActive: row.isActive,
    isHidden: row.isHidden,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
