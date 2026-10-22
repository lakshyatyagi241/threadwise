import type {
  FieldDependencyResponse,
  FieldOptionDependencyResponse,
  FieldOptionResponse,
  FieldResponse,
  FieldType,
  ModuleKey,
} from '@crm/contracts';
import type { FieldRow } from './fields.repository';
import type { FieldOptionRow } from './field-options.repository';
import type { FieldDependencyRow, FieldOptionDependencyRow } from './field-dependencies.repository';

export function toFieldOptionResponse(row: FieldOptionRow): FieldOptionResponse {
  return {
    id: row.uuid,
    fieldId: row.fieldUuid,
    value: row.value,
    label: row.label,
    position: row.position,
    isHidden: row.isHidden,
    rowVersion: row.rowVersion,
  };
}

export function toFieldResponse(
  row: FieldRow,
  options?: FieldOptionRow[],
  /** How many options the field has in all (an option-backed field only); `options` may hold fewer or none. */
  optionCount?: number,
): FieldResponse {
  return {
    id: row.uuid,
    moduleKey: row.moduleKey as ModuleKey,
    sectionId: row.sectionUuid,
    key: row.key,
    label: row.label,
    fieldType: row.fieldType as FieldType,
    isRequired: row.isRequired,
    isHidden: row.isHidden,
    isReadOnly: row.isReadOnly,
    isMasked: row.isMasked,
    isUnique: row.isUnique,
    isQuickCreate: row.isQuickCreate,
    isGlobalSearch: row.isGlobalSearch,
    isSystem: row.isSystem,
    isActive: row.isActive,
    position: row.position,
    config: row.config,
    // No write path sets this yet — type-change versioning (create a
    // replacement field, point it at this one) is a follow-on, not part of
    // Phase 8's CRUD surface. Always null until that lands.
    replacesFieldId: null,
    options: options?.map(toFieldOptionResponse),
    optionCount,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toFieldDependencyResponse(row: FieldDependencyRow): FieldDependencyResponse {
  return {
    id: row.uuid,
    fieldId: row.fieldUuid,
    dependsOnFieldId: row.dependsOnFieldUuid,
    dependsOnOptionId: row.dependsOnOptionUuid,
    dependsOnValue: row.dependsOnValue,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toFieldOptionDependencyResponse(
  row: FieldOptionDependencyRow,
): FieldOptionDependencyResponse {
  return {
    id: row.uuid,
    parentFieldId: row.parentFieldUuid,
    parentOptionId: row.parentOptionUuid,
    childFieldId: row.childFieldUuid,
    childOptionId: row.childOptionUuid,
    createdAt: row.createdAt.toISOString(),
  };
}
