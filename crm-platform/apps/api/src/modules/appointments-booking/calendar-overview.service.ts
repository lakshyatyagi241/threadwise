import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type CalendarBackfillResponse,
  type CalendarOverviewResponse,
  type CalendarProviderStatus,
  type SetCalendarProviderInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { CalendarBackfillQueue } from './calendar-backfill.jobs';
import { CalendarBackfillService } from './calendar-backfill.service';
import { CalendarProviders } from './calendar-providers.service';
import { GoogleCalendarConnectService } from './google-calendar-connect.service';
import { GoogleCalendarTokens } from './google-calendar-tokens.service';
import { MicrosoftCalendarConnectService } from './microsoft-calendar-connect.service';

/** Audit module and outbox aggregate of the workspace's choice of booking calendar. */
export const CALENDAR_PREFERENCE_AUDIT_MODULE = 'appointment_calendar_preference';

/**
 * Every calendar provider of the workspace on one screen, and which of them bookings are written to (BL-035). The per-provider cards keep
 * their own routes (`/appointments/calendar/google/*`, `/microsoft/*`); this is the cross-provider view and the one choice that spans them.
 */
@Injectable()
export class CalendarOverviewService {
  constructor(
    private readonly db: DatabaseService,
    private readonly providers: CalendarProviders,
    private readonly google: GoogleCalendarConnectService,
    private readonly googleTokens: GoogleCalendarTokens,
    private readonly microsoft: MicrosoftCalendarConnectService,
    private readonly backfill: CalendarBackfillService,
    private readonly backfillQueue: CalendarBackfillQueue,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async overview(): Promise<CalendarOverviewResponse> {
    return this.overviewOf(RequestContextStore.require().orgId);
  }

  async overviewOf(orgId: number): Promise<CalendarOverviewResponse> {
    const [gStatus, gConn, ms, write, preferred, backfillPending] = await Promise.all([
      this.google.statusOf(orgId),
      this.googleTokens.connection(orgId, { fresh: true }),
      this.microsoft.statusOf(orgId),
      this.providers.writeProvider(orgId),
      this.providers.preference(orgId),
      this.backfill.pending(orgId),
    ]);
    const google: CalendarProviderStatus = {
      provider: 'google',
      status: gStatus.status,
      account: gStatus.account,
      calendarId: gStatus.calendarId,
      calendarName: gStatus.calendarName,
      connectedAt: gStatus.connectedAt,
      lastErrorCode: gConn?.lastErrorCode ?? null,
      active: write === 'google',
    };
    return {
      writeProvider: write,
      preferredProvider: preferred,
      providers: [google, ms],
      backfillPending,
    };
  }

  /** Chooses which connected calendar receives bookings (`null`: automatic). Takes effect for the next change to a booking. */
  async setProvider(input: SetCalendarProviderInput): Promise<CalendarOverviewResponse> {
    const ctx = RequestContextStore.require();
    if (input.provider !== null) {
      const status = await this.providers.adapter(input.provider).status(ctx.orgId);
      if (!status.connected) {
        throw new AppError(
          ERROR_CODES.APPT_CALENDAR_NOT_CONNECTED,
          'That calendar is not connected, or needs reconnecting.',
          HttpStatus.CONFLICT,
        );
      }
    }
    await this.db.tx(async (tx) => {
      const { id, previous } = await this.providers.writePreference(
        tx,
        ctx.orgId,
        ctx.userId,
        input.provider,
      );
      // Nothing changed (or there was never a row to point the audit at).
      if (previous === input.provider || id === null) return;
      const recordId = id;
      await this.audit.record(tx, {
        module: CALENDAR_PREFERENCE_AUDIT_MODULE,
        recordId,
        action: input.provider === null ? 'delete' : previous === null ? 'insert' : 'update',
        delta: { provider: { old: previous, new: input.provider } },
      });
      await this.outbox.emit(tx, {
        orgId: ctx.orgId,
        aggregateModule: CALENDAR_PREFERENCE_AUDIT_MODULE,
        aggregateId: recordId,
        eventType: 'appointment_calendar.provider_selected',
        payload: { provider: input.provider, previous },
      });
    });
    this.providers.forgetPreference(ctx.orgId);
    return this.overviewOf(ctx.orgId);
  }

  /**
   * "Write the upcoming bookings to the calendar now": queues the back-fill for this workspace (the same job a reconnect queues). Asking
   * again while one is waiting or running is the same job.
   */
  async requestBackfill(): Promise<CalendarBackfillResponse> {
    const orgId = RequestContextStore.require().orgId;
    const [target, pending] = await Promise.all([
      this.providers.writeProvider(orgId),
      this.backfill.pending(orgId),
    ]);
    if (!target) return { queued: false, pending: 0 };
    await this.backfillQueue.enqueue(orgId);
    return { queued: true, pending };
  }
}
