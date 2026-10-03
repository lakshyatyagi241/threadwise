import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema, pageResponseSchema } from '../common/pagination';

/**
 * Product reviews (TW-CAT-027). They arrive `pending` from the public shop and show on the product page only once approved.
 */
export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const reviewStatusSchema = z.enum(REVIEW_STATUSES);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

export const REVIEWS_PAGE_SIZE = 30;

export const reviewResponseSchema = z.object({
  id: uuidSchema,
  product: z.object({ id: uuidSchema, name: z.string(), slug: z.string() }).nullable(),
  customerName: z.string().nullable(),
  rating: z.number().int().min(1).max(5),
  body: z.string().nullable(),
  status: reviewStatusSchema,
  createdAt: z.string().datetime(),
});
export type ReviewResponse = z.infer<typeof reviewResponseSchema>;

export const listReviewsQuerySchema = paginationQuerySchema.omit({ order: true }).extend({
  limit: z.coerce.number().int().min(1).max(100).default(REVIEWS_PAGE_SIZE),
  /** An unknown value falls back to `pending`, as Reference did. */
  status: reviewStatusSchema.catch('pending').default('pending'),
});
export type ListReviewsQuery = z.infer<typeof listReviewsQuerySchema>;

export const listReviewsResponseSchema = pageResponseSchema(reviewResponseSchema).extend({
  meta: z.object({
    counts: z.object({
      pending: z.number().int(),
      approved: z.number().int(),
      rejected: z.number().int(),
    }),
  }),
});
export type ListReviewsResponse = z.infer<typeof listReviewsResponseSchema>;

export const moderateReviewSchema = z.object({ status: reviewStatusSchema });
export type ModerateReviewInput = z.infer<typeof moderateReviewSchema>;

/** What the public shop posts (STORE-016): the product it reviews is named by the id the shop page carries. */
export const submitReviewSchema = z.object({
  productId: uuidSchema,
  name: z.string().trim().min(1).max(120),
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().max(1000).nullish(),
});
export type SubmitReviewInput = z.infer<typeof submitReviewSchema>;
