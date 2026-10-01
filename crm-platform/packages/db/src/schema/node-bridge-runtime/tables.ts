/**
 * node-bridge-runtime: tables ported from WaDesk. Mirrors migrations/20261001101200_node_wadesk_schema.sql.
 * The SQL migration is the source of truth (ADR-0004); `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations } from '../foundation';

export const googleFormSessions = pgTable(
  'google_form_sessions',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    flowSessionId: text('flow_session_id').notNull(),
    googleFormId: text('google_form_id').notNull(),
    contactPhone: text('contact_phone'),
    saveVariable: text('save_variable'),
    resumePort: text('resume_port').notNull().default('submitted'),
    answersJson: jsonb('answers_json'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    webhookToken: text('webhook_token').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_google_form_sessions_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_google_form_sessions_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_google_form_sessions_webhook_token').on(t.webhookToken),
    index('idx_google_form_sessions_contact_phone').on(t.orgId, t.contactPhone),
    index('idx_google_form_sessions_expires_at').on(t.orgId, t.expiresAt),
    index('idx_google_form_sessions_flow_session_id').on(t.orgId, t.flowSessionId),
    index('idx_google_form_sessions_google_form_id').on(t.orgId, t.googleFormId),
  ],
);

export type GoogleFormSessionsRow = typeof googleFormSessions.$inferSelect;
export type NewGoogleFormSessionsRow = typeof googleFormSessions.$inferInsert;
