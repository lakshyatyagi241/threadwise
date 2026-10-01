/**
 * channel-tiktok: tables ported from WaDesk. Mirrors migrations/20261001102200_tt_wadesk_schema.sql.
 * The SQL migration is the source of truth (ADR-0004); `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
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
import { organizations, users } from '../foundation';

export const tiktokAccounts = pgTable(
  'tiktok_accounts',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    openId: text('open_id').notNull(),
    unionId: text('union_id'),
    displayName: text('display_name'),
    username: text('username'),
    avatarUrl: text('avatar_url'),
    bio: text('bio'),
    isVerified: boolean('is_verified').notNull().default(false),
    followerCount: bigint('follower_count', { mode: 'number' }),
    followingCount: bigint('following_count', { mode: 'number' }),
    likesCount: bigint('likes_count', { mode: 'number' }),
    videoCount: bigint('video_count', { mode: 'number' }),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    accessToken: text('access_token'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    refreshToken: text('refresh_token'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }),
    scopes: jsonb('scopes'),
    status: text('status').notNull().default('connected'),
    connectMethod: text('connect_method').notNull().default('oauth'),
    lastError: text('last_error'),
    metaJson: jsonb('meta_json'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_tiktok_accounts_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_tiktok_accounts_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_tiktok_accounts_open_id').on(t.orgId, t.openId),
    foreignKey({
      name: 'fk_tiktok_accounts_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
  ],
);

export type TiktokAccountsRow = typeof tiktokAccounts.$inferSelect;
export type NewTiktokAccountsRow = typeof tiktokAccounts.$inferInsert;

export const tiktokPosts = pgTable(
  'tiktok_posts',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    tiktokAccountId: idColumn('tiktok_account_id').notNull(),
    userId: idColumn('user_id'),
    type: text('type').notNull().default('video'),
    status: text('status').notNull().default('draft'),
    caption: text('caption'),
    mediaJson: jsonb('media_json'),
    publishId: text('publish_id'),
    tiktokPostId: text('tiktok_post_id'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    error: text('error'),
    metaJson: jsonb('meta_json'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_tiktok_posts_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_tiktok_posts_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_tiktok_posts_tiktok_account_id',
      columns: [t.orgId, t.tiktokAccountId],
      foreignColumns: [tiktokAccounts.orgId, tiktokAccounts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_tiktok_posts_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_tiktok_posts_tiktok_account_id').on(t.orgId, t.tiktokAccountId),
  ],
);

export type TiktokPostsRow = typeof tiktokPosts.$inferSelect;
export type NewTiktokPostsRow = typeof tiktokPosts.$inferInsert;

export const tiktokShops = pgTable(
  'tiktok_shops',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    shopId: text('shop_id'),
    shopName: text('shop_name'),
    shopCipher: text('shop_cipher'),
    shopCode: text('shop_code'),
    region: text('region'),
    sellerName: text('seller_name'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    accessToken: text('access_token'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    refreshToken: text('refresh_token'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }),
    status: text('status').notNull().default('connected'),
    lastError: text('last_error'),
    metaJson: jsonb('meta_json'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_tiktok_shops_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_tiktok_shops_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_tiktok_shops_shop_id').on(t.orgId, t.shopId),
    foreignKey({
      name: 'fk_tiktok_shops_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
  ],
);

export type TiktokShopsRow = typeof tiktokShops.$inferSelect;
export type NewTiktokShopsRow = typeof tiktokShops.$inferInsert;
