import type { Appointment, CalendarDriftReason } from '../api/schemas';

/**
 * The "Calendar out of sync" badge (TW-GACC-011), as pure rules. An appointment is out of sync only while it is a confirmed booking whose
 * Google event the reconcile found different; a cancelled, declined or finished booking never shows it.
 */
export function isOutOfSync(a: Pick<Appointment, 'status' | 'calendarSync'>): a is Pick<
  Appointment,
  'status'
> & {
  calendarSync: NonNullable<Appointment['calendarSync']> & {
    state: 'drifted';
    reason: CalendarDriftReason;
  };
} {
  return (
    a.status === 'confirmed' &&
    a.calendarSync?.state === 'drifted' &&
    a.calendarSync.reason !== null
  );
}

/** What "Accept Google's change" will do, so the confirmation can say it before it happens. */
export function acceptEffect(reason: CalendarDriftReason): 'cancel' | 'reschedule' | 'acknowledge' {
  switch (reason) {
    case 'event_deleted':
    case 'event_missing':
      return 'cancel';
    case 'time_changed':
      return 'reschedule';
    case 'attendees_changed':
      return 'acknowledge';
  }
}
