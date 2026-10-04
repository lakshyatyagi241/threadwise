/**
 * marketing-site-cms: tables ported from WaDesk. Mirrors migrations/20261001100700_cms_wadesk_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { check, primaryKey } from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';

export const announcements = pgTable(
  'announcements',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    text: text('text').notNull(),
    linkUrl: text('link_url'),
    linkLabel: text('link_label'),
    tone: text('tone').notNull().default('info'),
    isActive: boolean('is_active').notNull().default(true),
    dismissible: boolean('dismissible').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    index('idx_announcements_is_active_sort_order').on(t.isActive, t.sortOrder),
    index('idx_announcements_starts_at_expires_at').on(t.startsAt, t.expiresAt),
  ],
);

export type AnnouncementsRow = typeof announcements.$inferSelect;
export type NewAnnouncementsRow = typeof announcements.$inferInsert;

export const blogCategories = pgTable(
  'blog_categories',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [unique('uq_blog_categories_slug').on(t.slug)],
);

export type BlogCategoriesRow = typeof blogCategories.$inferSelect;
export type NewBlogCategoriesRow = typeof blogCategories.$inferInsert;

export const blogPosts = pgTable(
  'blog_posts',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    excerpt: text('excerpt'),
    body: text('body'),
    featuredImage: text('featured_image'),
    categoryId: idColumn('category_id'),
    tags: jsonb('tags'),
    authorName: text('author_name'),
    status: text('status').notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    views: bigint('views', { mode: 'number' }).notNull().default(0),
    isFeatured: boolean('is_featured').notNull().default(false),
    metaTitle: text('meta_title'),
    metaDescription: text('meta_description'),
    metaKeywords: text('meta_keywords'),
    ogImage: text('og_image'),
    canonicalUrl: text('canonical_url'),
    noindex: boolean('noindex').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    unique('uq_blog_posts_slug').on(t.slug),
    foreignKey({
      name: 'fk_blog_posts_category_id',
      columns: [t.categoryId],
      foreignColumns: [blogCategories.id],
    }).onDelete('set null'),
    index('idx_blog_posts_category_id').on(t.categoryId),
    index('idx_blog_posts_status_published_at').on(t.status, t.publishedAt),
  ],
);

export type BlogPostsRow = typeof blogPosts.$inferSelect;
export type NewBlogPostsRow = typeof blogPosts.$inferInsert;

export const contactMessages = pgTable(
  'contact_messages',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    company: text('company'),
    topic: text('topic'),
    message: text('message').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    isRead: boolean('is_read').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [index('idx_contact_messages_is_read_created_at').on(t.isRead, t.createdAt)],
);

export type ContactMessagesRow = typeof contactMessages.$inferSelect;
export type NewContactMessagesRow = typeof contactMessages.$inferInsert;

export const frontendContent = pgTable(
  'frontend_content',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    ckey: text('ckey').notNull(),
    type: text('type').notNull().default('text'),
    draft: text('draft'),
    published: text('published'),
    updatedBy: idColumn('updated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [unique('uq_frontend_content_ckey').on(t.ckey)],
);

export type FrontendContentRow = typeof frontendContent.$inferSelect;
export type NewFrontendContentRow = typeof frontendContent.$inferInsert;

export const guidebookArticles = pgTable(
  'guidebook_articles',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    category: text('category').notNull().default('general'),
    excerpt: text('excerpt'),
    body: text('body'),
    isPublished: boolean('is_published').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    viewsCount: integer('views_count').notNull().default(0),
    helpfulCount: integer('helpful_count').notNull().default(0),
    notHelpfulCount: integer('not_helpful_count').notNull().default(0),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    unique('uq_guidebook_articles_slug').on(t.slug),
    index('idx_guidebook_articles_category_is_published_sort_order').on(
      t.category,
      t.isPublished,
      t.sortOrder,
    ),
  ],
);

export type GuidebookArticlesRow = typeof guidebookArticles.$inferSelect;
export type NewGuidebookArticlesRow = typeof guidebookArticles.$inferInsert;

export const legalPages = pgTable(
  'legal_pages',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    updatedLabel: text('updated_label'),
    effectiveLabel: text('effective_label'),
    sections: jsonb('sections'),
    isPublished: boolean('is_published').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [unique('uq_legal_pages_slug').on(t.slug)],
);

export type LegalPagesRow = typeof legalPages.$inferSelect;
export type NewLegalPagesRow = typeof legalPages.$inferInsert;

export const pricingFaqs = pgTable(
  'pricing_faqs',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    sortOrder: smallint('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    placement: text('placement').notNull().default('pricing'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [index('idx_pricing_faqs_is_active_sort_order').on(t.isActive, t.sortOrder)],
);

export type PricingFaqsRow = typeof pricingFaqs.$inferSelect;
export type NewPricingFaqsRow = typeof pricingFaqs.$inferInsert;

/** One vote per workspace user per article (migrations/20261019090000_cms_guidebook_votes.sql). Tenant data. */
export const guidebookVotes = pgTable(
  'guidebook_votes',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    articleId: idColumn('article_id').notNull(),
    userId: idColumn('user_id').notNull(),
    vote: text('vote').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('guidebook_votes_org_id_article_id_user_id_key').on(t.orgId, t.articleId, t.userId),
    foreignKey({
      name: 'guidebook_votes_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'guidebook_votes_article_id_fkey',
      columns: [t.articleId],
      foreignColumns: [guidebookArticles.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'guidebook_votes_org_id_user_id_fkey',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
    index('idx_guidebook_votes_article').on(t.articleId),
    check('guidebook_votes_vote_check', sql`${t.vote} IN ('helpful', 'not_helpful')`),
  ],
);

export type GuidebookVotesRow = typeof guidebookVotes.$inferSelect;
export type NewGuidebookVotesRow = typeof guidebookVotes.$inferInsert;
