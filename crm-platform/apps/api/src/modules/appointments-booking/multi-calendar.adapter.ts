import { Injectable, Logger } from '@nestjs/common';
import { CALENDAR_PROVIDERS, type CalendarProvider } from '@crm/contracts';
import type {
  CalendarBusyInterval,
  CalendarEventRequest,
  CalendarEventResult,
  CalendarEventState,
  CalendarFreeBusyOptions,
  CalendarStatus,
  CalendarSyncPort,
} from '../../infra/providers/appointments-booking';
import { CalendarProviders } from './calendar-providers.service';

/**
 * The calendar port the booking code talks to (`APPOINTMENT_CALENDAR`): it fronts the provider adapters of a workspace.
 *
 *  - Busy time is the UNION of every connected calendar (a meeting in Outlook blocks a slot even when bookings are written to Google). A
 *    calendar id a booking type names belongs to the provider bookings are written to; the others are read from their own chosen calendar.
 *    One provider failing does not hide the others' busy time; only when every source fails does the call throw (the caller then offers
 *    slots without calendar data and logs it).
 *  - An event is written to exactly one provider (`CalendarProviders.writeProvider`), and a later change or delete goes to the provider that
 *    holds the event (the caller names it), so switching provider leaves no orphan edit.
 */
@Injectable()
export class MultiCalendarAdapter implements CalendarSyncPort {
  readonly provider = 'multi';
  private readonly logger = new Logger(MultiCalendarAdapter.name);

  constructor(private readonly providers: CalendarProviders) {}

  /** Connected means a booking's event would be written right now; `account` is that provider's account. */
  async status(orgId: number): Promise<CalendarStatus> {
    const write = await this.providers.writeProvider(orgId);
    if (!write) {
      // Show the account of a grant that exists but cannot be used (needs reconnecting), as the single adapters do.
      for (const p of CALENDAR_PROVIDERS) {
        const s = await this.providers.adapter(p).status(orgId);
        if (s.account) return { connected: false, account: s.account };
      }
      return { connected: false, account: null };
    }
    return this.providers.adapter(write).status(orgId);
  }

  writeTarget(orgId: number): Promise<string | null> {
    return this.providers.writeProvider(orgId);
  }

  async freeBusy(
    orgId: number,
    calendarId: string | null,
    from: Date,
    to: Date,
    options?: CalendarFreeBusyOptions,
  ): Promise<CalendarBusyInterval[]> {
    const [connected, write] = await Promise.all([
      this.providers.connected(orgId),
      this.providers.writeProvider(orgId),
    ]);
    if (connected.length === 0) return [];
    const settled = await Promise.allSettled(
      connected.map((p) =>
        this.providers
          .adapter(p)
          .freeBusy(orgId, p === write ? calendarId : null, from, to, options),
      ),
    );
    const busy: CalendarBusyInterval[] = [];
    let failure: unknown;
    let failed = 0;
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') busy.push(...r.value);
      else {
        failed += 1;
        failure ??= r.reason;
        this.logger.warn(
          { orgId, provider: connected[i], err: String(r.reason) },
          'one calendar could not be read: its busy time is left out',
        );
      }
    });
    if (failed === connected.length) throw failure;
    return busy;
  }

  async upsertEvent(request: CalendarEventRequest): Promise<CalendarEventResult | null> {
    const write = await this.providers.writeProvider(request.orgId);
    if (!write) return null;
    return this.providers.adapter(write).upsertEvent(request);
  }

  async deleteEvent(
    orgId: number,
    calendarId: string | null,
    eventId: string,
    provider?: string,
  ): Promise<void> {
    const target = await this.target(orgId, provider);
    if (!target) return;
    await this.providers.adapter(target).deleteEvent(orgId, calendarId, eventId);
  }

  async readEvent(
    orgId: number,
    calendarId: string | null,
    eventId: string,
    provider?: string,
  ): Promise<CalendarEventState> {
    const target = await this.target(orgId, provider);
    if (!target) return { kind: 'missing' };
    return this.providers.adapter(target).readEvent(orgId, calendarId, eventId);
  }

  async calendarExists(
    orgId: number,
    calendarId: string | null,
    provider?: string,
  ): Promise<boolean> {
    const target = await this.target(orgId, provider);
    if (!target) return false;
    return this.providers.adapter(target).calendarExists(orgId, calendarId);
  }

  private async target(orgId: number, provider?: string): Promise<CalendarProvider | null> {
    if (provider === 'google' || provider === 'microsoft') return provider;
    return this.providers.writeProvider(orgId);
  }
}
