/**
 * persona profiles (docs/specs/persona-profiles.md, BL-280). Mirrors migrations/20261230090000_persona_profiles_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 *
 * `personas` and `persona_versions` are PLATFORM tables (no org_id): readable by everyone (drafts excepted), written only on the
 * privileged path. The other three are tenant tables.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';
import { platformOperators } from '../auth-registration-security';

export const personas = pgTable(
  'personas',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    key: text('key').notNull().unique(),
    status: text('status').notNull().default('active'),
    isSystem: boolean('is_system').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    /** The latest published version; null until the first publish. */
    currentVersion: integer('current_version'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    check('chk_personas_key', sql`${t.key} ~ '^[a-z][a-z0-9_]{1,39}$'`),
    check('chk_personas_status', sql`${t.status} IN ('active', 'archived')`),
    check('chk_personas_system_active', sql`NOT ${t.isSystem} OR ${t.status} = 'active'`),
    check(
      'chk_personas_current_version',
      sql`${t.currentVersion} IS NULL OR ${t.currentVersion} > 0`,
    ),
  ],
);

export type PersonasRow = typeof personas.$inferSelect;

export const personaVersions = pgTable(
  'persona_versions',
  {
    personaId: idColumn('persona_id').notNull(),
    version: integer('version').notNull(),
    status: text('status').notNull().default('draft'),
    /** `personaDefinitionSchema` of @crm/contracts. */
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
    compiled: jsonb('compiled').$type<Record<string, unknown>>().notNull().default({}),
    changes: jsonb('changes').$type<unknown[]>().notNull().default([]),
    note: text('note'),
    createdBy: idColumn('created_by'),
    publishedBy: idColumn('published_by'),
    createdAt: createdAt(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.personaId, t.version] }),
    foreignKey({
      name: 'persona_versions_persona_id_fkey',
      columns: [t.personaId],
      foreignColumns: [personas.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'persona_versions_created_by_fkey',
      columns: [t.createdBy],
      foreignColumns: [platformOperators.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'persona_versions_published_by_fkey',
      columns: [t.publishedBy],
      foreignColumns: [platformOperators.id],
    }).onDelete('set null'),
    uniqueIndex('uq_persona_versions_one_draft')
      .on(t.personaId)
      .where(sql`${t.status} = 'draft'`),
    check('chk_persona_versions_version', sql`${t.version} > 0`),
    check('chk_persona_versions_status', sql`${t.status} IN ('draft', 'published', 'superseded')`),
    check(
      'chk_persona_versions_published',
      sql`(${t.status} = 'draft') = (${t.publishedAt} IS NULL)`,
    ),
  ],
);

export type PersonaVersionsRow = typeof personaVersions.$inferSelect;

export const workspacePersona = pgTable(
  'workspace_persona',
  {
    orgId: orgIdColumn(),
    personaKey: text('persona_key').notNull().default('generic'),
    personaVersion: integer('persona_version').notNull().default(1),
    pinned: boolean('pinned').notNull().default(false),
    teamSize: text('team_size'),
    soloUi: text('solo_ui').notNull().default('auto'),
    showAllModules: boolean('show_all_modules').notNull().default(false),
    /** `workspaceOverridesSchema` of @crm/contracts; `{}` = nothing set. */
    workspaceOverrides: jsonb('workspace_overrides')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** `operatorOverridesSchema`; written on the privileged path only (trigger). */
    operatorOverrides: jsonb('operator_overrides')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    operatorNote: text('operator_note'),
    operatorUpdatedBy: idColumn('operator_updated_by'),
    operatorUpdatedAt: timestamp('operator_updated_at', { withTimezone: true }),
    onboarding: jsonb('onboarding').$type<Record<string, unknown>>().notNull().default({}),
    /** Bumped by every change to the row (trigger): the key of every cache of the resolved view. */
    rev: integer('rev').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId] }),
    foreignKey({
      name: 'workspace_persona_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'workspace_persona_persona_key_fkey',
      columns: [t.personaKey],
      foreignColumns: [personas.key],
    }),
    foreignKey({
      name: 'workspace_persona_operator_updated_by_fkey',
      columns: [t.operatorUpdatedBy],
      foreignColumns: [platformOperators.id],
    }).onDelete('set null'),
    index('idx_workspace_persona_key').on(t.personaKey),
    check('chk_workspace_persona_version', sql`${t.personaVersion} > 0`),
    check(
      'chk_workspace_persona_team_size',
      sql`${t.teamSize} IS NULL OR ${t.teamSize} IN ('1', '2-5', '6-20', '21-100', '100+')`,
    ),
    check('chk_workspace_persona_solo_ui', sql`${t.soloUi} IN ('auto', 'on', 'off')`),
    check(
      'chk_workspace_persona_overrides',
      sql`jsonb_typeof(${t.workspaceOverrides}) = 'object' AND jsonb_typeof(${t.operatorOverrides}) = 'object' AND jsonb_typeof(${t.onboarding}) = 'object'`,
    ),
  ],
);

export type WorkspacePersonaRow = typeof workspacePersona.$inferSelect;

export const workspacePersonaApplied = pgTable(
  'workspace_persona_applied',
  {
    orgId: orgIdColumn(),
    presetKind: text('preset_kind').notNull(),
    presetKey: text('preset_key').notNull(),
    entityUuid: uuid('entity_uuid'),
    entityGoneAt: timestamp('entity_gone_at', { withTimezone: true }),
    personaKey: text('persona_key').notNull(),
    personaVersion: integer('persona_version').notNull(),
    appliedBy: idColumn('applied_by'),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.presetKind, t.presetKey] }),
    foreignKey({
      name: 'workspace_persona_applied_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_workspace_persona_applied_by',
      columns: [t.orgId, t.appliedBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    check(
      'chk_workspace_persona_applied_kind',
      sql`${t.presetKind} IN ('booking_type', 'lifecycle_stage', 'pipeline', 'template', 'setting')`,
    ),
  ],
);

export type WorkspacePersonaAppliedRow = typeof workspacePersonaApplied.$inferSelect;

export const workspacePersonaLog = pgTable(
  'workspace_persona_log',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    layer: text('layer').notNull(),
    actorKind: text('actor_kind').notNull(),
    /** A workspace user id or a platform operator id, as `actorKind` says. */
    actorId: bigint('actor_id', { mode: 'number' }),
    action: text('action').notNull(),
    itemId: text('item_id'),
    before: jsonb('before').$type<unknown>(),
    after: jsonb('after').$type<unknown>(),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    foreignKey({
      name: 'workspace_persona_log_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    index('idx_workspace_persona_log_org_created').on(t.orgId, t.createdAt.desc()),
    check(
      'chk_workspace_persona_log_layer',
      sql`${t.layer} IN ('persona_change', 'workspace', 'operator')`,
    ),
    check('chk_workspace_persona_log_actor', sql`${t.actorKind} IN ('user', 'operator')`),
    check(
      'chk_workspace_persona_log_layer_actor',
      sql`${t.layer} <> 'operator' OR ${t.actorKind} = 'operator'`,
    ),
    check(
      'chk_workspace_persona_log_reason',
      sql`${t.actorKind} <> 'operator' OR length(btrim(coalesce(${t.reason}, ''))) >= 5`,
    ),
  ],
);

export type WorkspacePersonaLogRow = typeof workspacePersonaLog.$inferSelect;
