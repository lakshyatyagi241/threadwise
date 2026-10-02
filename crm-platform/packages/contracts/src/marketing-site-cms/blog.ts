import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { pageInfoSchema } from '../common/pagination';
import { isSafeLink } from './registry';

/** Blog posts and categories (WD-CMS-011/012/029..032). */

export const BLOG_STATUSES = ['draft', 'published'] as const;
export const blogStatusSchema = z.enum(BLOG_STATUSES);
export type BlogStatus = z.infer<typeof blogStatusSchema>;

/** An image address: https, or site-relative. Uploads wait for the media storage domain. */
const imageUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || (isSafeLink(v) && !/^(mailto|tel):/i.test(v) && !v.startsWith('#')), {
    message: 'Use an https:// address or a path starting with /',
  });

export const blogCategorySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
});
export type BlogCategory = z.infer<typeof blogCategorySchema>;

export const blogCategoryListResponseSchema = z.object({ data: z.array(blogCategorySchema) });
export type BlogCategoryListResponse = z.infer<typeof blogCategoryListResponseSchema>;

export const blogPostAdminSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  slug: z.string(),
  excerpt: z.string().nullable(),
  body: z.string().nullable(),
  featuredImage: z.string().nullable(),
  category: blogCategorySchema.nullable(),
  tags: z.array(z.string()),
  authorName: z.string().nullable(),
  status: blogStatusSchema,
  publishedAt: z.string().datetime().nullable(),
  /** Status is published and the date has come: what visitors can actually see (a scheduled post is not live). */
  live: z.boolean(),
  views: z.number().int().nonnegative(),
  isFeatured: z.boolean(),
  metaTitle: z.string().nullable(),
  metaDescription: z.string().nullable(),
  metaKeywords: z.string().nullable(),
  ogImage: z.string().nullable(),
  canonicalUrl: z.string().nullable(),
  noindex: z.boolean(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BlogPostAdmin = z.infer<typeof blogPostAdminSchema>;

export const blogAdminListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: blogStatusSchema.optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(100).default(15),
  cursor: z.string().min(1).max(512).optional(),
});
export type BlogAdminListQuery = z.infer<typeof blogAdminListQuerySchema>;

export const blogAdminListResponseSchema = z.object({
  data: z.array(blogPostAdminSchema),
  page: pageInfoSchema,
  summary: z.object({
    total: z.number().int(),
    published: z.number().int(),
    drafts: z.number().int(),
    views: z.number().int(),
  }),
});
export type BlogAdminListResponse = z.infer<typeof blogAdminListResponseSchema>;

const postFields = {
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().max(200).nullish(),
  excerpt: z.string().trim().max(500).nullish(),
  body: z.string().max(500_000).nullish(),
  featuredImage: imageUrl.nullish(),
  categoryId: uuidSchema.nullish(),
  /** A category created inline; wins over `categoryId` (WaDesk rule). */
  newCategory: z.string().trim().max(120).nullish(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  authorName: z.string().trim().max(120).nullish(),
  status: blogStatusSchema.default('draft'),
  /** An explicit date wins; a future date schedules the post. */
  publishedAt: z.string().datetime({ offset: true }).nullish(),
  isFeatured: z.boolean().default(false),
  metaTitle: z.string().trim().max(200).nullish(),
  metaDescription: z.string().trim().max(320).nullish(),
  metaKeywords: z.string().trim().max(255).nullish(),
  ogImage: imageUrl.nullish(),
  canonicalUrl: z.string().trim().url().max(255).nullish(),
  noindex: z.boolean().default(false),
};

export const createBlogPostRequestSchema = z.object(postFields);
export type CreateBlogPostRequest = z.infer<typeof createBlogPostRequestSchema>;

/** A full replace of the form's fields (the editor sends every field) guarded by the row version. */
export const updateBlogPostRequestSchema = z.object({
  ...postFields,
  rowVersion: z.number().int().positive(),
});
export type UpdateBlogPostRequest = z.infer<typeof updateBlogPostRequestSchema>;

export const toggleBlogPostRequestSchema = z.object({
  rowVersion: z.number().int().positive().optional(),
});
export type ToggleBlogPostRequest = z.infer<typeof toggleBlogPostRequestSchema>;

// --- public --------------------------------------------------------------------------------------------------------

export const blogCardSchema = z.object({
  slug: z.string(),
  title: z.string(),
  excerpt: z.string().nullable(),
  featuredImage: z.string().nullable(),
  category: z.object({ name: z.string(), slug: z.string() }).nullable(),
  authorName: z.string().nullable(),
  publishedAt: z.string().datetime().nullable(),
  readMinutes: z.number().int().min(1),
  isFeatured: z.boolean(),
});
export type BlogCard = z.infer<typeof blogCardSchema>;

export const blogPublicQuerySchema = z.object({
  category: z.string().trim().max(200).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(9),
  cursor: z.string().min(1).max(512).optional(),
});
export type BlogPublicQuery = z.infer<typeof blogPublicQuerySchema>;

export const blogIndexResponseSchema = z.object({
  data: z.array(blogCardSchema),
  page: pageInfoSchema,
  /** The latest live post flagged featured. */
  featured: blogCardSchema.nullable(),
  categories: z.array(z.object({ name: z.string(), slug: z.string() })),
});
export type BlogIndexResponse = z.infer<typeof blogIndexResponseSchema>;

export const blogPostPublicSchema = blogCardSchema.extend({
  /** Sanitised HTML. */
  body: z.string(),
  tags: z.array(z.string()),
  updatedAt: z.string().datetime(),
  seo: z.object({
    title: z.string(),
    description: z.string(),
    ogImage: z.string().nullable(),
    canonicalUrl: z.string().nullable(),
    noindex: z.boolean(),
  }),
  related: z.array(blogCardSchema),
});
export type BlogPostPublic = z.infer<typeof blogPostPublicSchema>;

export const sitemapResponseSchema = z.object({
  posts: z.array(z.object({ slug: z.string(), lastModified: z.string().datetime() })),
  categories: z.array(z.object({ slug: z.string() })),
  legal: z.array(z.object({ slug: z.string() })),
});
export type SitemapResponse = z.infer<typeof sitemapResponseSchema>;
