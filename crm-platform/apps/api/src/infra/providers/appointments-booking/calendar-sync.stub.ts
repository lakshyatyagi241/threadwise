import { Injectable } from '@nestjs/common';
import type {
  CalendarBusyInterval,
  CalendarEventRequest,
  CalendarEventState,
  CalendarEventResult,
  CalendarStatus,
  CalendarSyncPort,
} from './calendar-sync.port';

/**
 * The calendar adapter until the integrations domain ships a real one: nothing is connected, nothing is written, nothing is busy.
 * Bookings work without a calendar (Reference: "Bookings work without this"), so this is the correct behaviour for a workspace that
 * has none, not a failure.
 */
@Injectable()
export class NoCalendarSync implements CalendarSyncPort {
  readonly provider = 'none';

  async status(): Promise<CalendarStatus> {
    return { connected: false, account: null };
  }

  async freeBusy(): Promise<CalendarBusyInterval[]> {
    return [];
  }

  async upsertEvent(_request: CalendarEventRequest): Promise<CalendarEventResult | null> {
    return null;
  }

  async deleteEvent(): Promise<void> {
    /* nothing was ever written */
  }

  async readEvent(): Promise<CalendarEventState> {
    return { kind: 'missing' };
  }

  async calendarExists(): Promise<boolean> {
    return false;
  }
}
