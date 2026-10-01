/**
 * meta-ads: tables ported from WaDesk. Mirrors migrations/20261001101900_mads_wadesk_schema.sql.
 * The SQL migration is the source of truth (ADR-0004); `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
  foreignKey,
  index,
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
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';

export const metaCampaigns = pgTable(
  'meta_campaigns',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    facebookId: text('facebook_id'),
    metaAdsetId: text('meta_adset_id'),
    metaCreativeId: text('meta_creative_id'),
    metaAdId: text('meta_ad_id'),
    metaImageHash: text('meta_image_hash'),
    metaLastError: text('meta_last_error'),
    metaSyncedAt: timestamp('meta_synced_at', { withTimezone: true }),
    name: text('name').notNull(),
    creativeTitle: text('creative_title'),
    creativeBody: text('creative_body'),
    creativeLinkUrl: text('creative_link_url'),
    ctwaPhone: text('ctwa_phone'),
    ctwaMessage: text('ctwa_message'),
    targeting: jsonb('targeting'),
    objective: text('objective').notNull().default('OUTCOME_TRAFFIC'),
    optimizationGoal: text('optimization_goal').notNull().default('LINK_CLICKS'),
    status: text('status').notNull().default('PAUSED'),
    type: text('type').notNull().default('campaign'),
    ctwaCta: text('ctwa_cta'),
    ctwaEnabled: boolean('ctwa_enabled').notNull().default(false),
    dailyBudget: numeric('daily_budget', { precision: 12, scale: 2 }).notNull().default('0.00'),
    lifetimeBudget: numeric('lifetime_budget', { precision: 12, scale: 2 }),
    budgetLevel: text('budget_level').notNull().default('adset'),
    bidStrategy: text('bid_strategy'),
    bidAmount: bigint('bid_amount', { mode: 'number' }),
    specialAdCategories: jsonb('special_ad_categories'),
    insights: jsonb('insights'),
    adSetCount: smallint('ad_set_count').notNull().default(1),
    adCount: smallint('ad_count').notNull().default(1),
    creativeImage: text('creative_image'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_meta_campaigns_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_meta_campaigns_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_meta_campaigns_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_meta_campaigns_facebook_id').on(t.orgId, t.facebookId),
    index('idx_meta_campaigns_status').on(t.orgId, t.status),
    index('idx_meta_campaigns_user_id_meta_ad_id').on(t.orgId, t.userId, t.metaAdId),
    index('idx_meta_campaigns_user_id_optimization_goal').on(t.orgId, t.userId, t.optimizationGoal),
    index('idx_meta_campaigns_user_id_status').on(t.orgId, t.userId, t.status),
  ],
);

export type MetaCampaignsRow = typeof metaCampaigns.$inferSelect;
export type NewMetaCampaignsRow = typeof metaCampaigns.$inferInsert;
