import { z } from 'zod';

/** The analytics page's list panels (TW-DASH-026, 028, 030) for one window; same window rules as the overview. */
export const analyticsPanelsSchema = z.object({
  /** Senders with their 24-hour counters, busiest first, at most 8 (TW-DASH-026). */
  devices: z.object({
    total: z.int(),
    online: z.int(),
    /** True when the platform's unofficial-engine switch is off: no devices are listed. */
    unofficialDisabled: z.boolean().optional(),
    rows: z.array(
      z.object({
        uuid: z.guid(),
        label: z.string(),
        sent: z.int(),
        online: z.boolean(),
      }),
    ),
  }),
  /** The 8 most recently edited templates with their window sends, busiest first (TW-DASH-028). */
  templates: z.array(
    z.object({
      uuid: z.guid(),
      name: z.string(),
      category: z.string().nullable(),
      language: z.string().nullable(),
      sends: z.int(),
    }),
  ),
  /** The five busiest conversations of the window (TW-DASH-028). */
  contacts: z.array(
    z.object({
      uuid: z.guid(),
      title: z.string(),
      phone: z.string().nullable(),
      lastAt: z.string().nullable(),
      messages: z.int(),
    }),
  ),
  /** One row per assignee of a conversation created in the window; empty hides the section (TW-DASH-030). */
  team: z.array(
    z.object({
      userUuid: z.guid(),
      name: z.string(),
      email: z.string(),
      conversations: z.int(),
      resolved: z.int(),
      avgFirstResponseMin: z.number().nullable(),
      avgResolutionMin: z.number().nullable(),
      csatAvg: z.number().nullable(),
      csatCount: z.int(),
    }),
  ),
  /** Conversations of the window by the country of the contact's number, top 7; a null code is "Unspecified" (TW-DASH-029). */
  geo: z.array(z.object({ code: z.string().length(2).nullable(), count: z.int() })),
  /** The six newest messages of the window, both directions (TW-DASH-029). */
  events: z.array(
    z.object({
      uuid: z.guid(),
      direction: z.enum(['in', 'out']),
      peer: z.string(),
      kind: z.string(),
      status: z.string(),
      at: z.string(),
    }),
  ),
  /**
   * Login devices: the workspace's sign-in sessions (`auth_sessions`) started in the window, counted by browser, operating
   * system and device kind. Counts only: no user, IP, user agent or session id leaves the server.
   */
  loginDevices: z.object({
    /** Sessions that are live right now (not revoked, not expired), regardless of the window. */
    active: z.int(),
    /** Sessions started in the window. */
    total: z.int(),
    byBrowser: z.array(
      z.object({
        key: z.enum(['edge', 'chrome', 'firefox', 'safari', 'opera', 'other']),
        count: z.int(),
        active: z.int(),
      }),
    ),
    byOs: z.array(
      z.object({
        key: z.enum(['android', 'iphone', 'ipad', 'windows', 'mac', 'linux', 'other']),
        count: z.int(),
        active: z.int(),
      }),
    ),
    byKind: z.array(
      z.object({
        key: z.enum(['desktop', 'mobile', 'unknown']),
        count: z.int(),
        active: z.int(),
      }),
    ),
  }),
});
export type AnalyticsPanels = z.infer<typeof analyticsPanelsSchema>;
