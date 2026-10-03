import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { pageInfoSchema } from '../common/pagination';

/** The help centre (TW-CMS-044..050): authored by the operator, read inside the signed-in app. */

export const guidebookSlugSchema = z
  .string()
  .trim()
  .max(160)
  .regex(/^[a-z0-9-]*$/, 'Lowercase letters, digits and hyphens only');

export const guidebookArticleAdminSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  title: z.string(),
  category: z.string(),
  excerpt: z.string().nullable(),
  body: z.string().nullable(),
  isPublished: z.boolean(),
  sortOrder: z.number().int(),
  views: z.number().int(),
  helpful: z.number().int(),
  notHelpful: z.number().int(),
  publishedAt: z.string().datetime().nullable(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type GuidebookArticleAdmin = z.infer<typeof guidebookArticleAdminSchema>;

export const guidebookAdminListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(12),
  cursor: z.string().min(1).max(512).optional(),
});
export type GuidebookAdminListQuery = z.infer<typeof guidebookAdminListQuerySchema>;

export const guidebookAdminListResponseSchema = z.object({
  data: z.array(guidebookArticleAdminSchema),
  page: pageInfoSchema,
  categories: z.array(z.string()),
  /** Reference named the views tile `views_30d` but summed all time; this is all time and says so. */
  summary: z.object({
    total: z.number().int(),
    published: z.number().int(),
    drafts: z.number().int(),
    views: z.number().int(),
    helpful: z.number().int(),
    notHelpful: z.number().int(),
  }),
});
export type GuidebookAdminListResponse = z.infer<typeof guidebookAdminListResponseSchema>;

const fields = {
  title: z.string().trim().min(1).max(200),
  slug: guidebookSlugSchema.nullish(),
  category: z.string().trim().min(1).max(80).default('general'),
  excerpt: z.string().trim().max(500).nullish(),
  body: z.string().max(200_000).nullish(),
  isPublished: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(1_000_000).default(0),
};
export const createGuidebookArticleRequestSchema = z.object(fields);
export type CreateGuidebookArticleRequest = z.infer<typeof createGuidebookArticleRequestSchema>;
export const updateGuidebookArticleRequestSchema = z.object({
  ...fields,
  rowVersion: z.number().int().positive(),
});
export type UpdateGuidebookArticleRequest = z.infer<typeof updateGuidebookArticleRequestSchema>;

export const toggleGuidebookArticleRequestSchema = z.object({
  rowVersion: z.number().int().positive().optional(),
});
export type ToggleGuidebookArticleRequest = z.infer<typeof toggleGuidebookArticleRequestSchema>;

// --- in-app reader ---------------------------------------------------------------------------------------------------

export const guidebookCardSchema = z.object({
  slug: z.string(),
  title: z.string(),
  category: z.string(),
  excerpt: z.string().nullable(),
  readMinutes: z.number().int().min(1),
});
export type GuidebookCard = z.infer<typeof guidebookCardSchema>;

export const guidebookBrowseQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  cursor: z.string().min(1).max(512).optional(),
});
export type GuidebookBrowseQuery = z.infer<typeof guidebookBrowseQuerySchema>;

export const guidebookBrowseResponseSchema = z.object({
  data: z.array(guidebookCardSchema),
  page: pageInfoSchema,
  /** Sidebar counts: all-time per category, ignoring the search and the category filter. */
  categories: z.array(z.object({ name: z.string(), count: z.number().int() })),
  totalPublished: z.number().int(),
});
export type GuidebookBrowseResponse = z.infer<typeof guidebookBrowseResponseSchema>;

export const guidebookVoteSchema = z.enum(['helpful', 'not_helpful']);
export type GuidebookVote = z.infer<typeof guidebookVoteSchema>;

export const guidebookArticleSchema = guidebookCardSchema.extend({
  /** Markdown rendered to sanitised HTML on the server. */
  bodyHtml: z.string(),
  updatedAt: z.string().datetime(),
  /** The signed-in user's own vote, if any. */
  myVote: guidebookVoteSchema.nullable(),
  related: z.array(guidebookCardSchema),
});
export type GuidebookArticle = z.infer<typeof guidebookArticleSchema>;

export const guidebookVoteRequestSchema = z.object({ vote: guidebookVoteSchema });
export type GuidebookVoteRequest = z.infer<typeof guidebookVoteRequestSchema>;
export const guidebookVoteResponseSchema = z.object({ vote: guidebookVoteSchema });
export type GuidebookVoteResponse = z.infer<typeof guidebookVoteResponseSchema>;

/** The editor's preview pane: the same renderer readers get, so what the author sees is what is published. */
export const guidebookPreviewRequestSchema = z.object({ body: z.string().max(200_000) });
export type GuidebookPreviewRequest = z.infer<typeof guidebookPreviewRequestSchema>;
export const guidebookPreviewResponseSchema = z.object({ html: z.string() });
export type GuidebookPreviewResponse = z.infer<typeof guidebookPreviewResponseSchema>;
