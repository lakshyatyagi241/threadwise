import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * TW-TIB2-034: the Team Performance report. A window (today, this week, this month, read in the workspace's time zone) and an optional
 * channel narrow every figure on it.
 */
export const TEAM_ANALYTICS_RANGES = ['today', 'week', 'month'] as const;
export type TeamAnalyticsRange = (typeof TEAM_ANALYTICS_RANGES)[number];

export const teamAnalyticsQuerySchema = z.object({
  /** Anything else reads as `today`, as Reference did. */
  range: z
    .string()
    .optional()
    .transform((v): TeamAnalyticsRange =>
      (TEAM_ANALYTICS_RANGES as readonly string[]).includes(v ?? '')
        ? (v as TeamAnalyticsRange)
        : 'today',
    ),
  /** Only conversations on this channel (a device or a provider number). */
  channelId: uuidSchema.optional(),
});
export type TeamAnalyticsQuery = z.infer<typeof teamAnalyticsQuerySchema>;

export const teamAnalyticsAgentSchema = z.object({
  userId: uuidSchema,
  name: z.string().nullable(),
  /** Human replies sent in the window; automatic replies are not counted. */
  replies: z.number().int(),
  resolved: z.number().int(),
  /** Mean minutes to the first reply over the conversations resolved in the window that were assigned to this person; one decimal. */
  avgResponseMin: z.number().nullable(),
  /** online, away, busy or offline (offline when the person never set one). */
  status: z.string(),
  /** Open and pending conversations assigned to the person right now. */
  currentLoad: z.number().int(),
  lastSeenAt: z.string().datetime().nullable(),
});
export type TeamAnalyticsAgent = z.infer<typeof teamAnalyticsAgentSchema>;

export const teamAnalyticsResponseSchema = z.object({
  range: z.enum(TEAM_ANALYTICS_RANGES),
  /** Start of the window. */
  since: z.string().datetime(),
  totals: z.object({
    replies: z.number().int(),
    resolved: z.number().int(),
    inbounds: z.number().int(),
    /** Mean minutes to the first reply over every conversation resolved in the window; null when none. */
    avgFirstResponseMin: z.number().nullable(),
  }),
  agents: z.array(teamAnalyticsAgentSchema),
});
export type TeamAnalyticsResponse = z.infer<typeof teamAnalyticsResponseSchema>;
