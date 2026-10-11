/**
 * faq-knowledge: the FAQ knowledge base with semantic matching (ADR-0021). Mirrors migrations/20261114090000_faq_core.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';
import { flows } from '../flow-builder-editor';

/** The embedding width the table stores: every model the platform allows answers in this many dimensions (ADR-0021). */
export const FAQ_EMBEDDING_DIMENSIONS = 3072;

/**
 * pgvector's half-precision vector. Never selected by the list queries; the matcher writes and compares it in raw SQL
 * (`embedding <=> $1::halfvec`), so the app only ever binds it as the text form `[0.1,0.2,...]`.
 */
export const halfvec = customType<{ data: string; driverData: string }>({
  dataType: () => `halfvec(${FAQ_EMBEDDING_DIMENSIONS})`,
});

export const faqSettings = pgTable(
  'faq_settings',
  {
    orgId: orgIdColumn(),
    enabled: boolean('enabled').notNull().default(false),
    threshold: numeric('threshold', { precision: 4, scale: 3 }).notNull().default('0.450'),
    minMargin: numeric('min_margin', { precision: 4, scale: 3 }).notNull().default('0.000'),
    logQueries: boolean('log_queries').notNull().default(true),
    tunedModel: text('tuned_model'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId] }),
    foreignKey({
      name: 'faq_settings_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check('ck_faq_settings_threshold', sql`${t.threshold} between 0.050 and 0.990`),
    check('ck_faq_settings_margin', sql`${t.minMargin} between 0.000 and 0.500`),
  ],
);

export const faqs = pgTable(
  'faqs',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    question: text('question').notNull(),
    answerType: text('answer_type').notNull().default('text'),
    answerText: text('answer_text'),
    flowId: idColumn('flow_id'),
    category: text('category'),
    status: text('status').notNull().default('active'),
    thresholdOverride: numeric('threshold_override', { precision: 4, scale: 3 }),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('faqs_org_id_uuid_key').on(t.orgId, t.uuid),
    foreignKey({
      name: 'faqs_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_faqs_flow',
      columns: [t.orgId, t.flowId],
      foreignColumns: [flows.orgId, flows.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_faqs_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    check('ck_faqs_answer_type', sql`${t.answerType} in ('text', 'flow')`),
    check('ck_faqs_status', sql`${t.status} in ('active', 'paused')`),
    check(
      'ck_faqs_answer_shape',
      sql`(${t.answerType} = 'text' and ${t.answerText} is not null and btrim(${t.answerText}) <> '') or (${t.answerType} = 'flow')`,
    ),
    check(
      'ck_faqs_threshold_override',
      sql`${t.thresholdOverride} is null or ${t.thresholdOverride} between 0.050 and 0.990`,
    ),
    // `uq_faqs_question` (unique on lower(btrim(question))) is an expression index: the SQL migration is its only declaration.
    index('idx_faqs_status').on(t.orgId, t.status),
    index('idx_faqs_flow')
      .on(t.orgId, t.flowId)
      .where(sql`${t.flowId} is not null`),
    index('idx_faqs_category')
      .on(t.orgId, t.category)
      .where(sql`${t.category} is not null`),
  ],
);

export type FaqsRow = typeof faqs.$inferSelect;

export const faqVariations = pgTable(
  'faq_variations',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    faqId: idColumn('faq_id').notNull(),
    text: text('text').notNull(),
    source: text('source').notNull().default('manual'),
    embedState: text('embed_state').notNull().default('pending'),
    embedding: halfvec('embedding'),
    embeddingModel: text('embedding_model'),
    embeddedAt: timestamp('embedded_at', { withTimezone: true }),
    embedAttempts: smallint('embed_attempts').notNull().default(0),
    embedError: text('embed_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('faq_variations_org_id_uuid_key').on(t.orgId, t.uuid),
    foreignKey({
      name: 'faq_variations_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_faq_variations_faq',
      columns: [t.orgId, t.faqId],
      foreignColumns: [faqs.orgId, faqs.id],
    }).onDelete('cascade'),
    check(
      'ck_faq_variations_source',
      sql`${t.source} in ('question', 'manual', 'ai', 'import', 'learned')`,
    ),
    check('ck_faq_variations_state', sql`${t.embedState} in ('pending', 'ready', 'failed')`),
    check(
      'ck_faq_variations_ready',
      sql`${t.embedState} <> 'ready' or (${t.embedding} is not null and ${t.embeddingModel} is not null)`,
    ),
    // `uq_faq_variations_text` (unique on faq_id and lower(btrim(text))) is an expression index: the SQL migration declares it.
    index('idx_faq_variations_faq').on(t.orgId, t.faqId),
    index('idx_faq_variations_pending')
      .on(t.orgId, t.id)
      .where(sql`${t.embedState} = 'pending'`),
  ],
);

export type FaqVariationsRow = typeof faqVariations.$inferSelect;

/** One match decision: the "why" view, the unanswered list and threshold tuning read it. Swept after 90 days. */
export const faqMatchLogs = pgTable(
  'faq_match_logs',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    createdAt: createdAt(),
    origin: text('origin').notNull().default('inbound'),
    conversationId: idColumn('conversation_id'),
    channelId: idColumn('channel_id'),
    query: text('query'),
    queryLength: integer('query_length').notNull().default(0),
    outcome: text('outcome').notNull(),
    tier: text('tier'),
    matchedFaqId: idColumn('matched_faq_id'),
    score: numeric('score', { precision: 5, scale: 4 }),
    secondScore: numeric('second_score', { precision: 5, scale: 4 }),
    matchedText: text('matched_text'),
    candidates: jsonb('candidates')
      .$type<Array<{ faqUuid: string; question: string; score: number; text: string }>>()
      .notNull()
      .default([]),
    embeddingModel: text('embedding_model'),
    latencyMs: integer('latency_ms'),
    error: text('error'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('faq_match_logs_org_id_uuid_key').on(t.orgId, t.uuid),
    foreignKey({
      name: 'faq_match_logs_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_faq_match_logs_faq',
      columns: [t.orgId, t.matchedFaqId],
      foreignColumns: [faqs.orgId, faqs.id],
    }).onDelete('set null'),
    check('ck_faq_match_logs_origin', sql`${t.origin} in ('inbound', 'test')`),
    check(
      'ck_faq_match_logs_outcome',
      sql`${t.outcome} in ('answered', 'flow_started', 'below_threshold', 'low_margin', 'no_faqs', 'provider_error', 'not_sent')`,
    ),
    index('idx_faq_match_logs_created').on(t.orgId, t.createdAt.desc()),
    index('idx_faq_match_logs_faq')
      .on(t.orgId, t.matchedFaqId, t.createdAt.desc())
      .where(sql`${t.matchedFaqId} is not null`),
    index('idx_faq_match_logs_unanswered')
      .on(t.orgId, t.createdAt.desc())
      .where(
        sql`${t.origin} = 'inbound' and ${t.outcome} in ('below_threshold', 'low_margin', 'no_faqs') and ${t.resolvedAt} is null`,
      ),
  ],
);

export type FaqMatchLogsRow = typeof faqMatchLogs.$inferSelect;
