'use client';

import { OutlookCard } from './settings-outlook';
import { BookingsFeedCard } from './settings-bookings-feed';
import { IcsFeedsCard } from './settings-ics-feeds';
import { WriteTargetCard } from './settings-write-target';

/**
 * The calendar cards beyond Google's (BL-035), in the order a person meets them: connect Outlook, say where bookings are written (only when there is a
 * choice, or bookings are waiting for their event), subscribe to other calendars for busy time, and subscribe their own calendar app to their bookings.
 */
export function CalendarsSection() {
  return (
    <>
      <OutlookCard />
      <WriteTargetCard />
      <IcsFeedsCard />
      <BookingsFeedCard />
    </>
  );
}
