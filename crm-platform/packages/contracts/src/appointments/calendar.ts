import { z } from 'zod';

/**
 * The workspace's external calendar (TW-APPT-028, 029; EXT-APPT-08, decision D-08). One Google account per workspace, connected by an
 * admin through Google's consent screen. The platform operator supplies the Google OAuth client (console: Google Calendar); a
 * workspace never sees a client id or secret. Bookings work without any of this.
 */

/**
 * `unavailable`: the platform has no Google client (or the operator switched it off), so there is nothing to connect.
 * `disconnected`: it could be connected. `connected`: events are written and busy time is read.
 * `needs_reconnect`: Google refused the stored grant (revoked, expired, password changed): nothing is written or read until an admin
 * connects again.
 */
export const CALENDAR_STATUSES = [
  'unavailable',
  'disconnected',
  'connected',
  'needs_reconnect',
] as const;
export const calendarStatusSchema = z.enum(CALENDAR_STATUSES);
export type CalendarStatus = z.infer<typeof calendarStatusSchema>;

export const calendarStatusResponseSchema = z.object({
  /** Which adapter serves the workspace (`google`; `none` only where no adapter is registered). */
  provider: z.string(),
  /** True only when events are being written and busy time read right now. */
  connected: z.boolean(),
  /** The connected Google account ("ana@example.com"), also while it needs reconnecting. */
  account: z.string().nullable(),
  status: calendarStatusSchema,
  /** The calendar bookings are written to (`primary` until an admin picks another). */
  calendarId: z.string().nullable(),
  calendarName: z.string().nullable(),
  connectedAt: z.string().datetime().nullable(),
});
export type CalendarStatusResponse = z.infer<typeof calendarStatusResponseSchema>;

/** Where Google sends the browser after consent, below the API's own origin: the address the operator registers on the OAuth client. */
export const GOOGLE_CALENDAR_CALLBACK_PATH = '/v2/public/appointments/calendar/google/callback';

/** A path inside this app to land on after Google's consent screen: never a full URL (no open redirect). */
export const calendarReturnPathSchema = z
  .string()
  .max(200)
  .regex(/^\/(?!\/)[^\s\\]*$/, 'must be a path inside the app');

export const calendarConnectStartInputSchema = z.object({
  returnTo: calendarReturnPathSchema.optional(),
});
export type CalendarConnectStartInput = z.infer<typeof calendarConnectStartInputSchema>;

export const calendarConnectStartResponseSchema = z.object({
  /** Google's consent URL: send the browser there. */
  url: z.string().url(),
  /** The `state` in the URL is good for this long; after it the callback answers `expired`. */
  expiresInSeconds: z.number().int(),
});
export type CalendarConnectStartResponse = z.infer<typeof calendarConnectStartResponseSchema>;

export const calendarOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  primary: z.boolean(),
  timezone: z.string().nullable(),
  /** `owner` or `writer`: a calendar the account can only read is never offered. */
  accessRole: z.string(),
});
export type CalendarOption = z.infer<typeof calendarOptionSchema>;

export const calendarListResponseSchema = z.object({ data: z.array(calendarOptionSchema) });
export type CalendarListResponse = z.infer<typeof calendarListResponseSchema>;

/** A spreadsheet of the connected Google account, for the booking type's sheet picker. */
export const spreadsheetOptionSchema = z.object({ id: z.string(), name: z.string() });
export type SpreadsheetOption = z.infer<typeof spreadsheetOptionSchema>;
export const spreadsheetListResponseSchema = z.object({ data: z.array(spreadsheetOptionSchema) });
export type SpreadsheetListResponse = z.infer<typeof spreadsheetListResponseSchema>;

export const selectCalendarInputSchema = z.object({
  calendarId: z.string().trim().min(1).max(300),
});
export type SelectCalendarInput = z.infer<typeof selectCalendarInputSchema>;

/** What Google sends the callback: the consent result, or the reason it did not happen. Nothing here is trusted until `state` verifies. */
export const calendarCallbackQuerySchema = z.object({
  code: z.string().max(2048).optional(),
  state: z.string().max(2048).optional(),
  error: z.string().max(200).optional(),
  scope: z.string().max(2048).optional(),
});
export type CalendarCallbackQuery = z.infer<typeof calendarCallbackQuerySchema>;

/** The `?calendar=` outcome the callback appends to the page it sends the browser back to. */
export const CALENDAR_CALLBACK_OUTCOMES = [
  'connected',
  'denied',
  'failed',
  'expired',
  'not_configured',
  'missing_scope',
] as const;
export type CalendarCallbackOutcome = (typeof CALENDAR_CALLBACK_OUTCOMES)[number];
