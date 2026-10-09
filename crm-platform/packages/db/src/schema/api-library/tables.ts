/**
 * api-library: the API Library's tables. Mirrors migrations/20261112090000_alib_core.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
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
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';

/** One header as stored: the value of a secret header is encrypted (see ApiLibraryService). */
export interface StoredApiHeader {
  key: string;
  value: string;
  secret: boolean;
}

export const apiLibraryApis = pgTable(
  'api_library_apis',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    name: text('name').notNull(),
    method: text('method').notNull(),
    url: text('url').notNull(),
    payloadType: text('payload_type').notNull().default('application/json'),
    variables: jsonb('variables')
      .$type<Array<{ name: string; source: string; defaultValue: string }>>()
      .notNull()
      .default([]),
    headers: jsonb('headers').$type<StoredApiHeader[]>().notNull().default([]),
    body: jsonb('body').$type<Record<string, unknown> | unknown[] | null>(),
    functionCode: text('function_code'),
    mappingConfig: jsonb('mapping_config')
      .$type<Array<{ path: string; contactProperty: string; defaultValue: string }>>()
      .notNull()
      .default([]),
    responseVariables: jsonb('response_variables').$type<string[]>().notNull().default([]),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_api_library_apis_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_api_library_apis_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_api_library_apis_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    check('chk_api_library_apis_name', sql`${t.name} ~ '^[A-Za-z0-9_]{1,64}$'`),
    check(
      'chk_api_library_apis_method',
      sql`${t.method} in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')`,
    ),
    check(
      'chk_api_library_apis_payload',
      sql`${t.payloadType} in ('application/json', 'multipart/form-data')`,
    ),
    check('chk_api_library_apis_url', sql`btrim(${t.url}) <> '' and char_length(${t.url}) <= 2048`),
    check('chk_api_library_apis_variables', sql`jsonb_typeof(${t.variables}) = 'array'`),
    check('chk_api_library_apis_headers', sql`jsonb_typeof(${t.headers}) = 'array'`),
    check('chk_api_library_apis_mapping', sql`jsonb_typeof(${t.mappingConfig}) = 'array'`),
    check('chk_api_library_apis_resp_vars', sql`jsonb_typeof(${t.responseVariables}) = 'array'`),
    check(
      'chk_api_library_apis_body',
      sql`${t.body} is null or jsonb_typeof(${t.body}) in ('object', 'array')`,
    ),
    check(
      'chk_api_library_apis_function',
      sql`${t.functionCode} is null or char_length(${t.functionCode}) <= 20000`,
    ),
    // `uq_api_library_apis_name` (unique on lower(name)) is an expression index: the SQL migration is its only declaration.
    index('idx_api_library_apis_recent').on(t.orgId, t.createdAt.desc(), t.id.desc()),
    index('idx_api_library_apis_created_by')
      .on(t.orgId, t.createdBy)
      .where(sql`${t.createdBy} is not null`),
  ],
);

export type ApiLibraryApisRow = typeof apiLibraryApis.$inferSelect;
export type NewApiLibraryApisRow = typeof apiLibraryApis.$inferInsert;

/** A stream: no foreign key (the API, user, flow and contact are remembered by id or uuid and the row outlives them). */
export const apiLibraryLogs = pgTable(
  'api_library_logs',
  {
    id: bigint('id', { mode: 'number' })
      .notNull()
      .default(sql`nextval('api_library_logs_id_seq')`),
    orgId: orgIdColumn(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    apiUuid: uuid('api_uuid'),
    apiName: text('api_name').notNull().default(''),
    source: text('source').notNull(),
    method: text('method').notNull(),
    url: text('url').notNull(),
    requestHeaders: jsonb('request_headers').$type<Record<string, string>>().notNull().default({}),
    requestBody: text('request_body'),
    statusCode: integer('status_code'),
    ok: boolean('ok').notNull().default(false),
    durationMs: integer('duration_ms').notNull().default(0),
    errorKind: text('error_kind'),
    error: text('error'),
    responseHeaders: jsonb('response_headers')
      .$type<Record<string, string | string[]>>()
      .notNull()
      .default({}),
    responseBody: text('response_body'),
    responseTruncated: boolean('response_truncated').notNull().default(false),
    userId: idColumn('user_id'),
    contactUuid: uuid('contact_uuid'),
    flowId: idColumn('flow_id'),
    flowRunUuid: uuid('flow_run_uuid'),
    flowNodeId: text('flow_node_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.createdAt] }),
    check('chk_api_library_logs_source', sql`${t.source} in ('test', 'flow', 'automation')`),
    check(
      'chk_api_library_logs_kind',
      sql`${t.errorKind} is null or ${t.errorKind} in ('blocked', 'function', 'timeout', 'network', 'status', 'invalid')`,
    ),
    index('idx_api_library_logs_recent').on(t.orgId, t.createdAt.desc(), t.id.desc()),
    index('idx_api_library_logs_api').on(t.orgId, t.apiUuid, t.createdAt.desc()),
    index('idx_api_library_logs_uuid').on(t.orgId, t.uuid),
  ],
);

export type ApiLibraryLogsRow = typeof apiLibraryLogs.$inferSelect;
export type NewApiLibraryLogsRow = typeof apiLibraryLogs.$inferInsert;
