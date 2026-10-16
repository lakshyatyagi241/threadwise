'use client';

import { OutlookCard } from './settings-outlook';
import { WriteTargetCard } from './settings-write-target';

/**
 * The calendar cards beyond Google's (BL-035), in the order a person meets them: connect Outlook, then say where bookings are written (only when there is a
 * choice, or bookings are waiting for their event).
 */
export function CalendarsSection() {
  return (
    <>
      <OutlookCard />
      <WriteTargetCard />
    </>
  );
}
