import { z } from 'zod';

/**
 * iCal (ICS) calendars (BL-035, part 2), both directions:
 *
 *  - IN: a workspace subscribes to a calendar it cannot connect with OAuth (an Apple or Fastmail calendar, a timetable, a calendar published as a
 *    secret ICS address). The feed is READ ONLY and only ever contributes BUSY TIME: no event of it is imported, shown, stored or sent anywhere. The
 *    worker fetches it every 15 minutes; the slot engine reads the stored intervals and never waits on a remote calendar.
 *  - OUT: a staff member subscribes their own calendar app to their bookings, through a link only they hold.
 *
 * The feed address is a secret (published-calendar addresses usually carry a token): it is sealed at rest, never returned and never logged. Only its
 * host is shown.
 */

/** Feeds a workspace may subscribe to. */
export const ICS_FEED_LIMIT = 10;
export const ICS_FEED_NAME_MAX = 80;
export const ICS_FEED_URL_MAX = 2000;
/** The most a feed may contribute: a calendar with more busy blocks than this is read up to the cap and says it was cut. */
export const ICS_FEED_MAX_INTERVALS = 5000;
/** How far ahead a feed's busy time is stored (days); older than a day is not kept. */
export const ICS_FEED_HORIZON_DAYS = 180;
/** How often the worker re-reads a healthy feed (minutes). */
export const ICS_FEED_REFRESH_MINUTES = 15;
/** A feed whose last good read is older than this contributes nothing (days): stale busy time that nobody can see is worse than none. */
export const ICS_FEED_STALE_DAYS = 7;

export const ICS_FEED_STATUSES = ['pending', 'ok', 'error'] as const;
export const icsFeedStatusSchema = z.enum(ICS_FEED_STATUSES);
export type IcsFeedStatus = z.infer<typeof icsFeedStatusSchema>;

/** Why a feed could not be read, by a stable code (the page words it in the reader's language). */
export const ICS_FEED_ERRORS = [
  'unreachable',
  'timeout',
  'not_found',
  'forbidden',
  'server_error',
  'redirect_loop',
  'not_a_calendar',
  'too_large',
  'blocked_address',
] as const;
export const icsFeedErrorSchema = z.enum(ICS_FEED_ERRORS);
export type IcsFeedError = z.infer<typeof icsFeedErrorSchema>;

export const icsFeedWarningsSchema = z.object({
  /** Events whose time zone is unknown here were read in the workspace's zone. */
  unknownZone: z.number().int().min(0).default(0),
  /** Recurrence rules this reader does not support were read as their first occurrence only. */
  unsupportedRule: z.number().int().min(0).default(0),
  /** The feed has more than the cap: the busy time is incomplete. */
  truncated: z.boolean().default(false),
});
export type IcsFeedWarnings = z.infer<typeof icsFeedWarningsSchema>;

export const icsFeedSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /** The host the address points at, for display ("calendar.google.com"). Never the path or the query: those may hold the secret. */
  host: z.string(),
  isActive: z.boolean(),
  /** Whether an all-day event blocks its days. */
  blockAllDay: z.boolean(),
  status: icsFeedStatusSchema,
  errorCode: icsFeedErrorSchema.nullable(),
  lastFetchedAt: z.string().datetime().nullable(),
  lastSuccessAt: z.string().datetime().nullable(),
  /** The calendar's own name, when the feed says one. */
  calendarName: z.string().nullable(),
  /** Events read, and busy blocks they make within the horizon. */
  eventCount: z.number().int().min(0),
  busyCount: z.number().int().min(0),
  warnings: icsFeedWarningsSchema,
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
});
export type IcsFeed = z.infer<typeof icsFeedSchema>;

export const icsFeedListResponseSchema = z.object({ data: z.array(icsFeedSchema) });
export type IcsFeedListResponse = z.infer<typeof icsFeedListResponseSchema>;

/** `https://`, `http://` or `webcal://` (read as https). The address is checked, and the feed is read once, before it is saved. */
export const createIcsFeedInputSchema = z.object({
  name: z.string().trim().min(1).max(ICS_FEED_NAME_MAX),
  url: z.string().trim().min(8).max(ICS_FEED_URL_MAX),
  blockAllDay: z.boolean().default(true),
});
export type CreateIcsFeedInput = z.infer<typeof createIcsFeedInputSchema>;

export const updateIcsFeedInputSchema = z
  .object({
    name: z.string().trim().min(1).max(ICS_FEED_NAME_MAX).optional(),
    isActive: z.boolean().optional(),
    blockAllDay: z.boolean().optional(),
    rowVersion: z.number().int().min(1),
  })
  .refine((v) => v.name !== undefined || v.isActive !== undefined || v.blockAllDay !== undefined, {
    message: 'nothing to change',
  });
export type UpdateIcsFeedInput = z.infer<typeof updateIcsFeedInputSchema>;

// --- OUT: a person's bookings as a subscribable feed ---------------------------------------------------------------------

/** How far back and ahead the bookings feed reaches (days). */
export const BOOKINGS_FEED_PAST_DAYS = 30;
export const BOOKINGS_FEED_FUTURE_DAYS = 180;

export const bookingsFeedLinkSchema = z.object({
  /** The link to give to a calendar app; null while the person has none. Anyone who holds it sees the person's bookings: treat it as a password. */
  url: z.string().url().nullable(),
  createdAt: z.string().datetime().nullable(),
  /** The last time a calendar app read it. */
  lastUsedAt: z.string().datetime().nullable(),
});
export type BookingsFeedLink = z.infer<typeof bookingsFeedLinkSchema>;
