import type { Appointment } from '../api/schemas';
import { isOpen } from './status';

export type ReminderState = 'scheduled' | 'due' | 'skipped';

export interface ReminderRow {
  offsetMinutes: number;
  label: string | null;
  /** The moment the reminder goes (or went) out. */
  at: string;
  state: ReminderState;
}

/**
 * The reminders of a booking, from its booking type's offsets. The API does not record per-reminder delivery, so the state is
 * what the schedule says: `skipped` when the booking is no longer open or was made after the reminder's moment (WaDesk sends
 * nothing then), `scheduled` while the moment is ahead, `due` once it has been reached. Furthest first, as the type lists them.
 */
export function deriveReminders(
  a: Pick<Appointment, 'startsAt' | 'status' | 'createdAt'>,
  offsets: ReadonlyArray<{ offsetMinutes: number; label: string | null }>,
  now: Date,
): ReminderRow[] {
  const start = Date.parse(a.startsAt);
  const booked = Date.parse(a.createdAt);
  return [...offsets]
    .sort((x, y) => y.offsetMinutes - x.offsetMinutes)
    .map((r) => {
      const at = start - r.offsetMinutes * 60_000;
      const state: ReminderState =
        !isOpen(a.status) || at <= booked ? 'skipped' : at > now.getTime() ? 'scheduled' : 'due';
      return {
        offsetMinutes: r.offsetMinutes,
        label: r.label,
        at: new Date(at).toISOString(),
        state,
      };
    });
}
