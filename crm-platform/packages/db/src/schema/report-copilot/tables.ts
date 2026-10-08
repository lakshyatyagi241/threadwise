/**
 * report-copilot: the document library of the AI report assistant. Mirrors migrations/20261111090000_report_copilot_documents.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { platformOperators } from '../auth-registration-security/core';
import { organizations, users } from '../foundation';

/** A workspace's documents; `extracted_text` is what the assistant reads. Tenant table (RLS tenant_isolation). */
export const reportDocuments = pgTable(
  'report_documents',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    name: text('name').notNull(),
    extension: text('extension').notNull(),
    mime: text('mime'),
    sizeBytes: integer('size_bytes').notNull(),
    charCount: integer('char_count').notNull().default(0),
    truncated: boolean('truncated').notNull().default(false),
    status: text('status').notNull().default('ready'),
    failureReason: text('failure_reason'),
    extractedText: text('extracted_text').notNull().default(''),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_report_documents_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_report_documents_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_report_documents_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_report_documents_created_at').on(t.orgId, t.createdAt.desc(), t.id.desc()),
    index('idx_report_documents_created_by').on(t.orgId, t.createdBy),
  ],
);

export type ReportDocumentsRow = typeof reportDocuments.$inferSelect;
export type NewReportDocumentsRow = typeof reportDocuments.$inferInsert;

/** The operator's documents (no org_id; operator-only RLS policy `operator_write`). */
export const platformReportDocuments = pgTable(
  'platform_report_documents',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    name: text('name').notNull(),
    extension: text('extension').notNull(),
    mime: text('mime'),
    sizeBytes: integer('size_bytes').notNull(),
    charCount: integer('char_count').notNull().default(0),
    truncated: boolean('truncated').notNull().default(false),
    status: text('status').notNull().default('ready'),
    failureReason: text('failure_reason'),
    extractedText: text('extracted_text').notNull().default(''),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    foreignKey({
      name: 'fk_platform_report_documents_created_by',
      columns: [t.createdBy],
      foreignColumns: [platformOperators.id],
    }).onDelete('set null'),
    index('idx_platform_report_documents_created_at').on(t.createdAt.desc(), t.id.desc()),
    index('idx_platform_report_documents_created_by').on(t.createdBy),
  ],
);

export type PlatformReportDocumentsRow = typeof platformReportDocuments.$inferSelect;
export type NewPlatformReportDocumentsRow = typeof platformReportDocuments.$inferInsert;
