import type { Appointment, AppointmentStatus } from '../api/schemas';

/**
 * WaDesk's five statuses and what may be done in each. The server is the authority; this table decides which buttons a
 * person sees, so nobody is offered an action that can only fail. `status.test.ts` pins it.
 *
 *   pending   -> confirm, decline, cancel, reschedule, edit notes
 *   confirmed -> complete, no-show (once the start has passed), cancel, reschedule, edit notes
 *   cancelled, declined, completed, no_show -> nothing (WaDesk answers 410 to a change; notes stay editable)
 */
export const OPEN_STATUSES: readonly AppointmentStatus[] = ['pending', 'confirmed'];

export const isOpen = (status: AppointmentStatus): boolean => OPEN_STATUSES.includes(status);

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

export const STATUS_TONE: Record<AppointmentStatus, Tone> = {
  confirmed: 'success',
  pending: 'warning',
  cancelled: 'danger',
  declined: 'danger',
  completed: 'info',
  no_show: 'neutral',
};

export interface AppointmentActions {
  confirm: boolean;
  decline: boolean;
  complete: boolean;
  noShow: boolean;
  cancel: boolean;
  reschedule: boolean;
}

export function actionsFor(
  a: Pick<Appointment, 'status' | 'startsAt'>,
  now: Date,
): AppointmentActions {
  const open = isOpen(a.status);
  const started = Date.parse(a.startsAt) <= now.getTime();
  return {
    confirm: a.status === 'pending',
    decline: a.status === 'pending',
    complete: a.status === 'confirmed',
    noShow: a.status === 'confirmed' && started,
    cancel: open,
    reschedule: open,
  };
}

/** The visitor's page: a booking can be moved or cancelled while it is open and has not started. */
export function visitorCan(
  a: { status: AppointmentStatus; startsAt: string },
  now: Date,
): { reschedule: boolean; cancel: boolean } {
  const open = isOpen(a.status) && Date.parse(a.startsAt) > now.getTime();
  return { reschedule: open, cancel: open };
}

/** The tone of a reminder row in the drawer. */
export const REMINDER_TONE = {
  due: 'success',
  scheduled: 'info',
  skipped: 'neutral',
} as const satisfies Record<string, Tone>;

/** The CSS for a tone, as chips and dots (theme tokens only). */
export const TONE_CHIP: Record<Tone, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  danger: 'border-danger/30 bg-danger/10 text-danger',
  info: 'border-brand/30 bg-brand/10 text-brand dark:text-primary',
  neutral: 'border-border bg-muted text-muted-foreground',
};

export const TONE_DOT: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-brand',
  neutral: 'bg-muted-foreground',
};
