import { z } from 'zod';

/**
 * The dashboard's data cards (TW-DASH-006, 011, 013..016, 019): one payload so the page paints once. Money is a minor-unit string;
 * every timestamp is ISO-8601. Ids are uuids.
 */
export const dashWidgetsSchema = z.object({
  contacts: z.object({
    total: z.number().int(),
    subscribed: z.number().int(),
    blocked: z.number().int(),
    /** Percent change of the total against the contacts that existed before the window, one decimal. */
    deltaPct: z.number(),
  }),
  campaigns: z.object({
    running: z.number().int(),
    scheduled: z.number().int(),
    paused: z.number().int(),
    total: z.number().int(),
    recent: z.array(
      z.object({
        uuid: z.string().uuid(),
        name: z.string().nullable(),
        status: z.string(),
        template: z.string().nullable(),
        category: z.string().nullable(),
        done: z.number().int(),
        total: z.number().int(),
        pct: z.number().int(),
      }),
    ),
  }),
  devices: z.object({
    total: z.number().int(),
    online: z.number().int(),
    /** The plan's device limit, or Reference's 6 when the plan is unlimited. */
    slotCap: z.number().int(),
    rows: z.array(
      z.object({
        uuid: z.string().uuid(),
        label: z.string(),
        phone: z.string().nullable(),
        region: z.string().nullable(),
        state: z.enum(['online', 'connecting', 'offline']),
        sent24h: z.number().int(),
        deliveryPct: z.number(),
      }),
    ),
  }),
  templates: z.object({
    count: z.number().int(),
    rows: z.array(
      z.object({
        uuid: z.string().uuid(),
        name: z.string(),
        language: z.string().nullable(),
        category: z.string().nullable(),
        type: z.string().nullable(),
        status: z.string(),
        sent: z.number().int(),
        delivered: z.number().int(),
        read: z.number().int(),
        /** Read share of sends, one decimal; null with no sends. Reference labelled this CTR. */
        readRatePct: z.number().nullable(),
        performance: z.number().int(),
      }),
    ),
  }),
  inbox: z.object({
    unread: z.number().int(),
    oldestUnreadAt: z.string().nullable(),
    recent: z.array(
      z.object({
        uuid: z.string().uuid(),
        title: z.string(),
        at: z.string().nullable(),
        preview: z.string(),
        unread: z.number().int(),
      }),
    ),
  }),
  /** Null when the plan has no sales pipeline. */
  pipeline: z
    .object({
      currency: z.string(),
      openValueMinor: z.string(),
      openDeals: z.number().int(),
      wonThisMonthMinor: z.string(),
      winRatePct: z.number().int(),
    })
    .nullable(),
  activity: z.array(
    z.object({
      at: z.string(),
      actor: z.string().nullable(),
      module: z.string(),
      action: z.string(),
    }),
  ),
});
export type DashWidgets = z.infer<typeof dashWidgetsSchema>;
