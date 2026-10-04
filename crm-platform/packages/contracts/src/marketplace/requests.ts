import { z } from 'zod';
import { cursorSchema, pageInfoSchema } from '../common/pagination';
import { uuidSchema } from '../common/ids';
import { marketAppKindSchema, marketRequestStatusSchema, marketSlugSchema } from './enums';
import { marketLinkSchema } from './manifest';

/**
 * "Request an integration" (spec 6.1, M-16): a workspace asks for something that is not listed. Requests are deduplicated by name
 * across the platform (the same name asked for twice is one request with two votes) and a workspace counts once per request, so the
 * operator's report is demand, not noise. A workspace sees the request names and vote counts of everyone, never who voted.
 * Asking and voting need `market.apps.read`.
 */

export const createMarketRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    kind: marketAppKindSchema.default('integration'),
    categorySlug: marketSlugSchema.optional(),
    website: marketLinkSchema.optional(),
    /** What the workspace wants it for. Visible to the platform operator only. */
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type CreateMarketRequestInput = z.infer<typeof createMarketRequestSchema>;

export const marketRequestListQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  kind: marketAppKindSchema.optional(),
  status: marketRequestStatusSchema.optional(),
  sort: z.enum(['votes', 'new']).default('votes'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: cursorSchema.optional(),
});
export type MarketRequestListQuery = z.infer<typeof marketRequestListQuerySchema>;

export const marketRequestSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  kind: marketAppKindSchema,
  categorySlug: z.string().nullable(),
  status: marketRequestStatusSchema,
  voteCount: z.number().int(),
  /** This workspace has voted for (or created) the request. */
  hasVoted: z.boolean(),
  createdAt: z.string().datetime(),
});
export type MarketRequest = z.infer<typeof marketRequestSchema>;

export const marketRequestListSchema = z.object({
  data: z.array(marketRequestSchema),
  page: pageInfoSchema,
});
export type MarketRequestList = z.infer<typeof marketRequestListSchema>;

/** The answer to asking: the request, and whether it already existed (then the ask counted as a vote). */
export const marketRequestResultSchema = z.object({
  request: marketRequestSchema,
  created: z.boolean(),
});
export type MarketRequestResult = z.infer<typeof marketRequestResultSchema>;
