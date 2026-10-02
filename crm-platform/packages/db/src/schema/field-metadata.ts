import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from './columns';

/**
 * Tier-2 custom-field registry (Phase 8, docs/phase-plan.md). `module_key`
 * is generic — 'contacts' today, 'companies' reuses these same tables later.
 */

export const fieldSections = pgTable(
  'field_sections',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull(),
    moduleKey: text('module_key').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('field_sections_org_id_uuid_key').on(t.orgId, t.uuid),
    index('idx_field_sections_org_module').on(t.orgId, t.moduleKey, t.position),
  ],
);

export const fields = pgTable(
  'fields',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull(),
    moduleKey: text('module_key').notNull(),
    sectionId: idColumn('section_id'),
    /** Storage key inside the target module's `data` jsonb column. */
    key: text('key').notNull(),
    label: text('label').notNull(),
    fieldType: text('field_type').notNull(),
    isRequired: boolean('is_required').notNull().default(false),
    isHidden: boolean('is_hidden').notNull().default(false),
    isReadOnly: boolean('is_read_only').notNull().default(false),
    isMasked: boolean('is_masked').notNull().default(false),
    isUnique: boolean('is_unique').notNull().default(false),
    isQuickCreate: boolean('is_quick_create').notNull().default(false),
    isGlobalSearch: boolean('is_global_search').notNull().default(false),
    isSystem: boolean('is_system').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    position: integer('position').notNull().default(0),
    /** Type-specific: currency->{code}, rating->{max}, formula->{expression}, etc. */
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    /** Self-FK: type-change versioning — the field this one replaced. */
    replacesFieldId: idColumn('replaces_field_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('fields_org_id_uuid_key').on(t.orgId, t.uuid),
    uniqueIndex('uq_fields_org_module_key').on(t.orgId, t.moduleKey, t.key),
    index('idx_fields_org_module').on(t.orgId, t.moduleKey, t.position),
    index('idx_fields_section').on(t.orgId, t.sectionId),
  ],
);

export const fieldOptions = pgTable(
  'field_options',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull(),
    fieldId: idColumn('field_id').notNull(),
    value: text('value').notNull(),
    label: text('label').notNull(),
    position: integer('position').notNull().default(0),
    isHidden: boolean('is_hidden').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('field_options_org_id_uuid_key').on(t.orgId, t.uuid),
    index('idx_field_options_field').on(t.orgId, t.fieldId, t.position),
  ],
);

/** Field-level: shows/hides the whole dependent field. */
export const fieldDependencies = pgTable(
  'field_dependencies',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull(),
    fieldId: idColumn('field_id').notNull(),
    dependsOnFieldId: idColumn('depends_on_field_id').notNull(),
    dependsOnOptionId: idColumn('depends_on_option_id'),
    dependsOnValue: text('depends_on_value'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('field_dependencies_org_id_uuid_key').on(t.orgId, t.uuid),
    index('idx_field_dependencies_field').on(t.orgId, t.fieldId),
    index('idx_field_dependencies_depends_on').on(t.orgId, t.dependsOnFieldId),
  ],
);

/** Option-level, many:many: which child options a parent option permits. */
export const fieldOptionDependencies = pgTable(
  'field_option_dependencies',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull(),
    parentOptionId: idColumn('parent_option_id').notNull(),
    childOptionId: idColumn('child_option_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('field_option_dependencies_org_id_uuid_key').on(t.orgId, t.uuid),
    uniqueIndex('field_option_dependencies_org_id_parent_child_key').on(
      t.orgId,
      t.parentOptionId,
      t.childOptionId,
    ),
  ],
);

/** Per-module enum groups: lifecycle_stage, deal_status, subscription statuses, ... */
export const statusOptions = pgTable(
  'status_options',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull(),
    moduleKey: text('module_key').notNull(),
    optionGroup: text('option_group').notNull(),
    value: text('value').notNull(),
    label: text('label').notNull(),
    color: text('color'),
    position: integer('position').notNull().default(0),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    /** Lifecycle stages only: entering one stamps the contact's won_at / lost_at (never both). */
    isWon: boolean('is_won').notNull().default(false),
    isLost: boolean('is_lost').notNull().default(false),
    /**
     * Contact statuses only: the lifecycle_stage option this status belongs to. NULL = valid in every stage. A composite
     * FK (org_id, stage_option_id) -> status_options(org_id, id) in the migration; the service checks the target's group.
     */
    stageOptionId: idColumn('stage_option_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('status_options_org_id_uuid_key').on(t.orgId, t.uuid),
    uniqueIndex('status_options_org_id_module_key_option_group_value_key').on(
      t.orgId,
      t.moduleKey,
      t.optionGroup,
      t.value,
    ),
    index('idx_status_options_org_group').on(t.orgId, t.moduleKey, t.optionGroup, t.position),
    index('idx_status_options_stage')
      .on(t.orgId, t.stageOptionId)
      .where(sql`stage_option_id IS NOT NULL`),
    // uq_status_options_one_default (migration 20261009090000): one default per scope, i.e. per (org, module, group,
    // COALESCE(stage_option_id, 0)). An expression index, so it is not declared here (verify-schema cannot reflect it).
  ],
);

export type FieldSection = typeof fieldSections.$inferSelect;
export type Field = typeof fields.$inferSelect;
export type NewField = typeof fields.$inferInsert;
export type FieldOption = typeof fieldOptions.$inferSelect;
export type StatusOption = typeof statusOptions.$inferSelect;
