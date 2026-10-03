import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Facebook posts (TW-FB-016 to 018): composed on a connected Page, published now or scheduled, listed with filters, retried and
 * deleted. A scheduled post is held by Meta, not by us.
 */

export const FB_POST_TYPES = ['text', 'link', 'photo', 'multi_photo', 'video', 'reel'] as const;
export const FB_POST_STATUSES = ['draft', 'scheduled', 'published', 'failed'] as const;
export const FB_POST_RANGES = ['7d', '30d', '90d'] as const;

/** Meta caps. */
export const FB_MAX_PHOTOS = 10;
export const FB_MESSAGE_MAX = 60000;

export const createFbPostSchema = z.object({
  pageId: uuidSchema,
  message: z.string().trim().max(FB_MESSAGE_MAX).optional(),
  link: z.string().trim().url().max(2048).optional(),
  /** Public image addresses (uploading a file waits on the storage domain). At most ten; extra ones are dropped. */
  photoUrls: z.array(z.string().trim().url().max(2048)).max(50).optional(),
  /** A public HTTPS video address (Meta fetches it). A video wins over photos. */
  videoUrl: z.string().trim().url().max(2048).optional(),
  asReel: z.boolean().optional(),
  /** When to publish, as an instant: at least 10 minutes and at most 75 days from now. Absent publishes now. */
  scheduledAt: z.string().datetime({ offset: true }).optional(),
});
export type CreateFbPostInput = z.infer<typeof createFbPostSchema>;

export const fbPostSchema = z.object({
  id: uuidSchema,
  pageId: uuidSchema,
  pageName: z.string().nullable(),
  type: z.enum(FB_POST_TYPES),
  /** `draft` is a post whose first attempt did not complete: it is unpublished and retryable, like `failed`. */
  status: z.enum(FB_POST_STATUSES),
  message: z.string().nullable(),
  link: z.string().nullable(),
  photos: z.array(z.string()),
  video: z.string().nullable(),
  /** Meta's id once the post is live or held. */
  fbPostId: z.string().nullable(),
  scheduledPublishTime: z.string().datetime().nullable(),
  publishedAt: z.string().datetime().nullable(),
  /** Why Meta refused it; null when it did not. */
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type FbPost = z.infer<typeof fbPostSchema>;

export const listFbPostsQuerySchema = z.object({
  status: z.enum(['all', 'scheduled', 'published', 'failed']).default('all'),
  type: z.enum(['all', ...FB_POST_TYPES]).default('all'),
  range: z.enum(['all', ...FB_POST_RANGES]).default('all'),
  q: z.string().trim().max(200).optional(),
  /** Only one Page's posts. */
  account: uuidSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
});
export type ListFbPostsQuery = z.infer<typeof listFbPostsQuerySchema>;

export const fbPostListSchema = z.object({
  data: z.array(fbPostSchema),
  /** Over the Page filter only, never over the other filters. `failed` includes drafts. */
  counts: z.object({
    scheduled: z.number().int(),
    published: z.number().int(),
    failed: z.number().int(),
  }),
  typeCounts: z.object({
    all: z.number().int(),
    text: z.number().int(),
    link: z.number().int(),
    photo: z.number().int(),
    multi_photo: z.number().int(),
    video: z.number().int(),
    reel: z.number().int(),
  }),
  /** The filtered list, 15 a page. */
  meta: z.object({
    page: z.number().int(),
    perPage: z.number().int(),
    total: z.number().int(),
    lastPage: z.number().int(),
  }),
  /** The connected Pages, so the composer and the filter can offer them. */
  pages: z.array(z.object({ id: uuidSchema, pageId: z.string(), name: z.string().nullable() })),
});
export type FbPostList = z.infer<typeof fbPostListSchema>;

/** One post of the Page's live feed (the "My posts" grid). Nothing is stored. */
export const fbFeedItemSchema = z.object({
  id: z.string(),
  message: z.string(),
  createdTime: z.string(),
  permalinkUrl: z.string(),
  picture: z.string(),
});
export type FbFeedItem = z.infer<typeof fbFeedItemSchema>;

export const fbMyPostsSchema = z.object({
  pages: z.array(z.object({ id: uuidSchema, pageId: z.string(), name: z.string().nullable() })),
  page: z.object({ id: uuidSchema, pageId: z.string(), name: z.string().nullable() }).nullable(),
  items: z.array(fbFeedItemSchema),
});
export type FbMyPosts = z.infer<typeof fbMyPostsSchema>;
