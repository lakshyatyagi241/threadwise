import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/** Viber insights (TW-VIB-016): message volume, active users and delivery rates for one channel over the last 7 days. Read only. */

export const viberInsightsQuerySchema = z.object({
  /** The channel to read (the oldest one when absent). */
  channel: uuidSchema.optional(),
  /** The viewer's time zone (IANA), for the seven days. UTC when absent or unknown. */
  tz: z.string().trim().max(64).optional(),
});
export type ViberInsightsQuery = z.infer<typeof viberInsightsQuerySchema>;

export const viberInsightsSchema = z.object({
  channels: z.array(z.object({ id: uuidSchema, name: z.string().nullable() })),
  /** The channel the numbers are for: the one asked for, else the oldest; null with no channel. */
  channelId: uuidSchema.nullable(),
  /** Seven days, oldest first, one row per day (a day with nothing is zeros). */
  rows: z.array(z.object({ date: z.string(), in: z.number().int(), out: z.number().int() })),
  totals: z.object({
    in: z.number().int(),
    out: z.number().int(),
    /** Threads with a message from the user in the window. */
    users: z.number().int(),
    delivered: z.number().int(),
    seen: z.number().int(),
    failed: z.number().int(),
  }),
});
export type ViberInsights = z.infer<typeof viberInsightsSchema>;
