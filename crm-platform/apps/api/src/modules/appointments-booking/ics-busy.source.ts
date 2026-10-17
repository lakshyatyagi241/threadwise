import { Injectable } from '@nestjs/common';
import { ICS_FEED_STALE_DAYS } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import type { CalendarBusyInterval } from '../../infra/providers/appointments-booking';
import { IcsFeedsRepository } from './ics-feeds.repository';

/**
 * The iCal feeds as a busy-time source for the calendar port (BL-035). It reads what the worker stored (`calendar_ics_busy`): one indexed query,
 * never a call to a remote calendar, so a slot lookup cannot wait on somebody else's server. Intervals are already merged per feed; the port's
 * caller joins them with the other sources'.
 */
@Injectable()
export class IcsBusySource {
  constructor(
    private readonly db: DatabaseService,
    private readonly feeds: IcsFeedsRepository,
  ) {}

  async busy(orgId: number, from: Date, to: Date): Promise<CalendarBusyInterval[]> {
    return this.db.txAs({ orgId, userId: null }, (tx) =>
      this.feeds.busyBetween(tx, orgId, from, to, ICS_FEED_STALE_DAYS),
    );
  }
}
