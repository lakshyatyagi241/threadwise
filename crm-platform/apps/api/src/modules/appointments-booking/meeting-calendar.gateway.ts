import { Injectable } from '@nestjs/common';
import type { CalendarProvider } from '@crm/contracts';
import type { CalendarEventRequest } from '../../infra/providers/appointments-booking';
import { CalendarProviders } from './calendar-providers.service';
import { GoogleCalendarConnectService } from './google-calendar-connect.service';
import { MicrosoftCalendarConnectService } from './microsoft-calendar-connect.service';

/** A calendar a contact's meeting can be put on right now. */
export interface MeetingCalendarOption {
  provider: CalendarProvider;
  /** The connected account to show ("ana@example.com"). */
  account: string | null;
  /** The calendar the events go to; null = the account's main calendar. */
  calendarName: string | null;
}

/** A meeting event: the appointment calendar's request with the meeting's uuid as the stable key. */
export type MeetingEventRequest = Omit<CalendarEventRequest, 'appointmentId' | 'calendarId'> & {
  meetingKey: string;
  calendarId: string | null;
};

export interface MeetingEventResult {
  provider: CalendarProvider;
  eventId: string;
  calendarId: string | null;
  /** The Meet or Teams address the calendar made, when it was asked to. */
  joinUrl: string | null;
}

/**
 * The seam through which a contact's meeting uses the workspace's connected Google or Outlook calendar (BL-362): the SAME connection, tokens,
 * refresh and health the appointments use, so there is no second OAuth flow for calendars. The event is addressed by the meeting's uuid
 * where an appointment is addressed by its own, which makes a repeat of the same write find the same event (the adapters are idempotent
 * on that key). This adds no behaviour to the calendar adapters; it only lets another module call them without reaching inside this one.
 *
 * A meeting event is not reconciled against the provider the way an appointment's is (BL-366): a person who edits or deletes it in
 * Google or Outlook is not noticed until the meeting is saved again.
 */
@Injectable()
export class MeetingCalendarGateway {
  constructor(
    private readonly providers: CalendarProviders,
    private readonly google: GoogleCalendarConnectService,
    private readonly microsoft: MicrosoftCalendarConnectService,
  ) {}

  /** The calendars that can be written to now, Google first. */
  async options(orgId: number): Promise<MeetingCalendarOption[]> {
    const [g, m] = await Promise.all([this.google.statusOf(orgId), this.microsoft.statusOf(orgId)]);
    const out: MeetingCalendarOption[] = [];
    if (g.status === 'connected') {
      out.push({ provider: 'google', account: g.account, calendarName: g.calendarName });
    }
    if (m.status === 'connected') {
      out.push({ provider: 'microsoft', account: m.account, calendarName: m.calendarName });
    }
    return out;
  }

  /** The calendar a new event goes to: the workspace's choice (or Google, else Outlook), or null when none is usable. */
  writeProvider(orgId: number): Promise<CalendarProvider | null> {
    return this.providers.writeProvider(orgId);
  }

  /** Creates the event, or updates `existingEventId`. Null = nothing was written (that calendar is not usable). */
  async upsert(
    provider: CalendarProvider,
    orgId: number,
    req: MeetingEventRequest,
  ): Promise<MeetingEventResult | null> {
    const { meetingKey, ...rest } = req;
    const result = await this.providers
      .adapter(provider)
      .upsertEvent({ ...rest, orgId, appointmentId: meetingKey });
    if (!result) return null;
    return {
      provider,
      eventId: result.eventId,
      calendarId: result.calendarId,
      joinUrl: result.meetUrl,
    };
  }

  async remove(
    provider: CalendarProvider,
    orgId: number,
    calendarId: string | null,
    eventId: string,
  ): Promise<void> {
    await this.providers.adapter(provider).deleteEvent(orgId, calendarId, eventId);
  }
}
