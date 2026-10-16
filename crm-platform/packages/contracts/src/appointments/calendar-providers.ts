import { z } from 'zod';
import { calendarStatusSchema } from './calendar';

/**
 * More than one calendar provider behind the calendar port (BL-035). A workspace may connect Google and Outlook / Microsoft 365: busy time
 * is read from every connected calendar, but a booking's event is written to exactly ONE of them (`writeProvider`), so a booking never
 * appears twice. The platform operator supplies the Microsoft Entra app once for everyone (console: Microsoft Calendar); a workspace never
 * sees a client id or secret. Setup of that app: docs/runbooks/microsoft-calendar-setup.md.
 */

export const CALENDAR_PROVIDERS = ['google', 'microsoft'] as const;
export const calendarProviderSchema = z.enum(CALENDAR_PROVIDERS);
export type CalendarProvider = z.infer<typeof calendarProviderSchema>;

/** Where Microsoft sends the browser after consent, below the API's own origin: the address the operator registers on the Entra app. */
export const MICROSOFT_CALENDAR_CALLBACK_PATH =
  '/v2/public/appointments/calendar/microsoft/callback';

/**
 * What the Microsoft permission asked of the person is: sign in and read their name (`User.Read`), read and write their calendars
 * (`Calendars.ReadWrite`), and keep access while they are away (`offline_access`). Nothing about mail, files or contacts.
 */
export const MICROSOFT_CALENDAR_SCOPES = [
  'openid',
  'email',
  'offline_access',
  'User.Read',
  'Calendars.ReadWrite',
] as const;
/** A grant without this cannot do the calendar's work (a person can untick a permission on the consent screen). */
export const MICROSOFT_CALENDAR_REQUIRED_SCOPE = 'Calendars.ReadWrite';

/** One provider's state, as the settings card shows it. */
export const calendarProviderStatusSchema = z.object({
  provider: calendarProviderSchema,
  /** `unavailable`: the platform has no app for this provider, or the operator switched it off. */
  status: calendarStatusSchema,
  account: z.string().nullable(),
  calendarId: z.string().nullable(),
  calendarName: z.string().nullable(),
  connectedAt: z.string().datetime().nullable(),
  /** The last failure met using the account (a stable code), cleared by the next success. */
  lastErrorCode: z.string().nullable(),
  /** Bookings are written to this provider's calendar. */
  active: z.boolean(),
});
export type CalendarProviderStatus = z.infer<typeof calendarProviderStatusSchema>;

export const calendarOverviewResponseSchema = z.object({
  /** Where a booking's event is written now; null when no connected provider is usable. */
  writeProvider: calendarProviderSchema.nullable(),
  /** The admin's explicit choice; null = automatic (Google when usable, else Microsoft). */
  preferredProvider: calendarProviderSchema.nullable(),
  providers: z.array(calendarProviderStatusSchema),
  /** Upcoming confirmed bookings (within the back-fill horizon) whose event is not in the calendar bookings go to. */
  backfillPending: z.number().int().min(0),
});
export type CalendarOverviewResponse = z.infer<typeof calendarOverviewResponseSchema>;

/** Which connected calendar receives bookings. `null` goes back to automatic. */
export const setCalendarProviderInputSchema = z.object({
  provider: calendarProviderSchema.nullable(),
});
export type SetCalendarProviderInput = z.infer<typeof setCalendarProviderInputSchema>;

/**
 * Microsoft's redirect lands on the API (no session there), which checks the signed state and sends the browser to the app with a one-time
 * ticket. The same signed-in admin who pressed Connect confirms with it; the code is exchanged only then. A forwarded link opens a page that
 * refuses it, and nothing is ever requested from Microsoft for it.
 */
export const microsoftCalendarConfirmInputSchema = z.object({
  ticket: z.string().min(20).max(4096),
});
export type MicrosoftCalendarConfirmInput = z.infer<typeof microsoftCalendarConfirmInputSchema>;

export const microsoftCalendarConfirmResponseSchema = z.object({
  outcome: z.enum(['connected', 'missing_scope']),
  returnTo: z.string(),
});
export type MicrosoftCalendarConfirmResponse = z.infer<
  typeof microsoftCalendarConfirmResponseSchema
>;

/**
 * What Microsoft's callback adds to the settings page: `?outlook=confirm&ticket=...` (the page then asks the admin to confirm), or `?outlook=` with
 * `denied`, `failed`, `expired` or `not_configured`. A key of its own, so the Google card's `?calendar=` messages are never shown for Outlook.
 */
export const MICROSOFT_CALENDAR_CONFIRM_OUTCOME = 'confirm';

/**
 * Back-fill (BL-035). Bookings made while no calendar was connected (or while it needed reconnecting) get no event, and an event is lost with
 * a replaced account. After a connect, a reconnect or a change of where bookings go, a worker job writes the missing events of the CONFIRMED
 * bookings that have not ended and start within this many days; nothing older and nothing further out is touched. Idempotent: a booking that
 * already has its event in the right calendar is not written again.
 */
export const CALENDAR_BACKFILL_HORIZON_DAYS = 90;

export const calendarBackfillResponseSchema = z.object({
  /** True when a pass was queued; false when no calendar is connected, so there is nowhere to write to. */
  queued: z.boolean(),
  /** Upcoming confirmed bookings whose event is not in the calendar bookings go to right now (within the horizon). */
  pending: z.number().int().min(0),
});
export type CalendarBackfillResponse = z.infer<typeof calendarBackfillResponseSchema>;
