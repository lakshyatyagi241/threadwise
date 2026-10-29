import { z } from 'zod';

/**
 * The dashboard's data cards (TW-DASH-006, 011, 013..016, 019): one payload so the page paints once. Money is a minor-unit string;
 * every timestamp is ISO-8601. Ids are uuids.
 */
export const dashWidgetsSchema = z.object({
  contacts: z.object({
    total: z.int(),
    subscribed: z.int(),
    blocked: z.int(),
    /** Percent change of the total against the contacts that existed before the window, one decimal. */
    deltaPct: z.number(),
  }),
  campaigns: z.object({
    running: z.int(),
    scheduled: z.int(),
    paused: z.int(),
    total: z.int(),
    recent: z.array(
      z.object({
        uuid: z.guid(),
        name: z.string().nullable(),
        status: z.string(),
        template: z.string().nullable(),
        category: z.string().nullable(),
        done: z.int(),
        total: z.int(),
        pct: z.int(),
      }),
    ),
  }),
  devices: z.object({
    total: z.int(),
    online: z.int(),
    /** True when the platform's unofficial-engine switch is off: the card then carries no devices and the page hides it. */
    unofficialDisabled: z.boolean().optional(),
    /** The plan's device limit, or Reference's 6 when the plan is unlimited. */
    slotCap: z.int(),
    rows: z.array(
      z.object({
        uuid: z.guid(),
        label: z.string(),
        phone: z.string().nullable(),
        region: z.string().nullable(),
        state: z.enum(['online', 'connecting', 'offline']),
        sent24h: z.int(),
        deliveryPct: z.number(),
      }),
    ),
  }),
  templates: z.object({
    count: z.int(),
    rows: z.array(
      z.object({
        uuid: z.guid(),
        name: z.string(),
        language: z.string().nullable(),
        category: z.string().nullable(),
        type: z.string().nullable(),
        status: z.string(),
        sent: z.int(),
        delivered: z.int(),
        read: z.int(),
        /** Read share of sends, one decimal; null with no sends. Reference labelled this CTR. */
        readRatePct: z.number().nullable(),
        performance: z.int(),
      }),
    ),
  }),
  inbox: z.object({
    unread: z.int(),
    oldestUnreadAt: z.string().nullable(),
    recent: z.array(
      z.object({
        uuid: z.guid(),
        title: z.string(),
        at: z.string().nullable(),
        preview: z.string(),
        unread: z.int(),
      }),
    ),
  }),
  /** Null when the plan has no sales pipeline. */
  pipeline: z
    .object({
      currency: z.string(),
      openValueMinor: z.string(),
      openDeals: z.int(),
      wonThisMonthMinor: z.string(),
      winRatePct: z.int(),
    })
    .nullable(),
  /** Null until a workspace has linked an Instagram account (TW-DASH-008): the band does not render. */
  instagram: z
    .object({
      accountsCount: z.int(),
      accounts: z.array(
        z.object({
          handle: z.string(),
          avatar: z.string().nullable(),
          status: z.string(),
        }),
      ),
      needsReply: z.int(),
      open: z.int(),
      unread: z.int(),
      dmsIn7d: z.int(),
      dmsOut7d: z.int(),
      /** round(min(100, out / in * 100)), 0 with no inbound. */
      replyRatePct: z.int(),
      followers: z.int(),
    })
    .nullable(),
  /** Flow Copilot counters and the six latest flows (TW-DASH-017). Ignores the range. */
  flows: z.object({
    total: z.int(),
    active: z.int(),
    subscribers: z.int(),
    recent: z.array(
      z.object({
        uuid: z.guid(),
        name: z.string(),
        active: z.boolean(),
        trigger: z.string(),
        steps: z.int(),
        subscribers: z.int(),
      }),
    ),
  }),
  /** Connection state read per workspace from the integration tables (TW-DASH-020). */
  integrations: z.object({
    connected: z.int(),
    total: z.int(),
    rows: z.array(
      z.object({
        code: z.enum(['woocommerce', 'shopify', 'google_sheets', 'meta_catalog']),
        connected: z.boolean(),
        /** Events in the last 7 days for WooCommerce; null for the others. */
        events7d: z.int().nullable(),
      }),
    ),
  }),
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
