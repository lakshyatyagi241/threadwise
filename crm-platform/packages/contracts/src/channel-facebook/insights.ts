import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Facebook Page insights (TW-FB-019): the live Graph metrics, blended with what this system knows locally, so the screen is never
 * empty. A metric Meta no longer has is simply absent from `kpis`.
 */

export const insightsQuerySchema = z.object({
  page: uuidSchema.optional(),
  /** The viewer's time zone (IANA), for the 14 day trend. UTC when absent or unknown. */
  tz: z.string().trim().max(64).optional(),
});
export type InsightsQuery = z.infer<typeof insightsQuerySchema>;

const pageBrief = z.object({ id: uuidSchema, pageId: z.string(), name: z.string().nullable() });

export const fbInsightsSchema = z.object({
  pages: z.array(pageBrief),
  page: pageBrief.nullable(),
  identity: z
    .object({
      name: z.string(),
      category: z.string(),
      username: z.string().nullable(),
      avatar: z.string().nullable(),
      pageId: z.string(),
    })
    .nullable(),
  followers: z.number().int().nullable(),
  /** Live 28 day metrics by name (page_impressions, page_post_engagements, ...). */
  kpis: z.record(z.string(), z.number()),
  local: z.object({
    convos: z.number().int(),
    convosOpen: z.number().int(),
    msgIn: z.number().int(),
    msgOut: z.number().int(),
    posts: z.number().int(),
    postsPublished: z.number().int(),
    postsScheduled: z.number().int(),
  }),
  /** Messages in and out per day over the last 14 days, oldest first; `days` are `YYYY-MM-DD` in the viewer's time zone. */
  trend: z.object({
    days: z.array(z.string()),
    in: z.array(z.number().int()),
    out: z.array(z.number().int()),
  }),
  /** Posts made here, by type. */
  contentMix: z.record(z.string(), z.number()),
  /** Threads by status (open, pending, resolved, closed). */
  convoMix: z.record(z.string(), z.number()),
  /** Up to six recent posts: live from Meta first, this system's own when Meta lists none. */
  posts: z.array(
    z.object({
      message: z.string(),
      created: z.string(),
      permalink: z.string(),
      picture: z.string(),
      /** `live` for a post read from Meta, else the type of the local post. */
      type: z.string(),
      status: z.string().nullable(),
      stats: z.object({ impressions: z.number(), engaged: z.number() }),
    }),
  ),
});
export type FbInsights = z.infer<typeof fbInsightsSchema>;
