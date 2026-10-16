import {
  calendarBackfillResponseSchema,
  calendarConnectStartResponseSchema,
  calendarListResponseSchema,
  calendarOverviewResponseSchema,
  microsoftCalendarConfirmResponseSchema,
  type CalendarBackfillResponse,
  type CalendarListResponse,
  type CalendarOverviewResponse,
  type CalendarProvider,
  type MicrosoftCalendarConfirmResponse,
} from '@crm/contracts';
import { call } from './http';

/**
 * The calendar calls beyond Google's card: Outlook / Microsoft 365 and where bookings are written (BL-035). Always the real API: these have no stand-in for the development switch, so with it on they fail visibly instead of faking an answer.
 * Wire shapes are used as they are (the contract already is the view model).
 */
export const calendarsApi = {
  overview(signal?: AbortSignal): Promise<CalendarOverviewResponse> {
    return call('/appointments/calendar/overview', {
      schema: calendarOverviewResponseSchema,
      signal,
    });
  },
  /** Which connected calendar receives bookings; `null` is automatic. */
  setWriteProvider(provider: CalendarProvider | null): Promise<CalendarOverviewResponse> {
    return call('/appointments/calendar/provider', {
      method: 'PUT',
      body: { provider },
      schema: calendarOverviewResponseSchema,
    });
  },
  /** Writes the upcoming bookings that are missing from the calendar, now. */
  backfill(): Promise<CalendarBackfillResponse> {
    return call('/appointments/calendar/backfill', {
      method: 'POST',
      body: {},
      schema: calendarBackfillResponseSchema,
    });
  },

  // Outlook / Microsoft 365
  async startOutlookConnect(returnTo: string): Promise<string> {
    const r = await call('/appointments/calendar/microsoft/start', {
      method: 'POST',
      body: { returnTo },
      schema: calendarConnectStartResponseSchema,
    });
    return r.url;
  },
  confirmOutlook(ticket: string): Promise<MicrosoftCalendarConfirmResponse> {
    return call('/appointments/calendar/microsoft/confirm', {
      method: 'POST',
      body: { ticket },
      schema: microsoftCalendarConfirmResponseSchema,
    });
  },
  outlookCalendars(signal?: AbortSignal): Promise<CalendarListResponse> {
    return call('/appointments/calendar/microsoft/calendars', {
      schema: calendarListResponseSchema,
      signal,
    });
  },
  selectOutlookCalendar(calendarId: string): Promise<void> {
    return call('/appointments/calendar/microsoft/calendar', {
      method: 'PUT',
      body: { calendarId },
    });
  },
  disconnectOutlook(): Promise<void> {
    return call('/appointments/calendar/microsoft/disconnect', { method: 'POST', body: {} });
  },
};
