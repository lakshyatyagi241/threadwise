import { z } from 'zod';

/** The analytics page's list panels (TW-DASH-026, 028, 030) for one window; same window rules as the overview. */
export const analyticsPanelsSchema = z.object({
  /** Senders with their 24-hour counters, busiest first, at most 8 (TW-DASH-026). */
  devices: z.object({
    total: z.number().int(),
    online: z.number().int(),
    /** True when the platform's unofficial-engine switch is off: no devices are listed. */
    unofficialDisabled: z.boolean().optional(),
    rows: z.array(
      z.object({
        uuid: z.string().uuid(),
        label: z.string(),
        sent: z.number().int(),
        online: z.boolean(),
      }),
    ),
  }),
  /** The 8 most recently edited templates with their window sends, busiest first (TW-DASH-028). */
  templates: z.array(
    z.object({
      uuid: z.string().uuid(),
      name: z.string(),
      category: z.string().nullable(),
      language: z.string().nullable(),
      sends: z.number().int(),
    }),
  ),
  /** The five busiest conversations of the window (TW-DASH-028). */
  contacts: z.array(
    z.object({
      uuid: z.string().uuid(),
      title: z.string(),
      phone: z.string().nullable(),
      lastAt: z.string().nullable(),
      messages: z.number().int(),
    }),
  ),
  /** One row per assignee of a conversation created in the window; empty hides the section (TW-DASH-030). */
  team: z.array(
    z.object({
      userUuid: z.string().uuid(),
      name: z.string(),
      email: z.string(),
      conversations: z.number().int(),
      resolved: z.number().int(),
      avgFirstResponseMin: z.number().nullable(),
      avgResolutionMin: z.number().nullable(),
      csatAvg: z.number().nullable(),
      csatCount: z.number().int(),
    }),
  ),
  /** Conversations of the window by the country of the contact's number, top 7; a null code is "Unspecified" (TW-DASH-029). */
  geo: z.array(z.object({ code: z.string().length(2).nullable(), count: z.number().int() })),
  /** The six newest messages of the window, both directions (TW-DASH-029). */
  events: z.array(
    z.object({
      uuid: z.string().uuid(),
      direction: z.enum(['in', 'out']),
      peer: z.string(),
      kind: z.string(),
      status: z.string(),
      at: z.string(),
    }),
  ),
});
export type AnalyticsPanels = z.infer<typeof analyticsPanelsSchema>;
