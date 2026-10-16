import {
  WIZARD_FOLLOW_UP_MAX,
  WIZARD_FOLLOW_UP_WAIT_MAX,
  WIZARD_FOLLOW_UP_WAIT_MIN,
  type WizardFollowUp,
} from '@crm/contracts';

export type WaitUnit = 'minutes' | 'hours' | 'days';

export const WAIT_UNITS: readonly WaitUnit[] = ['minutes', 'hours', 'days'];

const MINUTES_PER: Record<WaitUnit, number> = { minutes: 1, hours: 60, days: 1440 };

/** The largest unit that holds the wait in whole numbers (90 minutes stays minutes, 120 is 2 hours, 2880 is 2 days). */
export function unitOf(waitMinutes: number): WaitUnit {
  if (waitMinutes % MINUTES_PER.days === 0) return 'days';
  if (waitMinutes % MINUTES_PER.hours === 0) return 'hours';
  return 'minutes';
}

/** The number to show for a wait in the given unit (whole when the unit came from {@link unitOf}). */
export const amountIn = (waitMinutes: number, unit: WaitUnit): number =>
  Math.max(1, Math.round(waitMinutes / MINUTES_PER[unit]));

/** A number in a unit as the contract's minutes, kept inside 1 minute to 7 days. */
export const toMinutes = (amount: number, unit: WaitUnit): number =>
  Math.min(
    WIZARD_FOLLOW_UP_WAIT_MAX,
    Math.max(WIZARD_FOLLOW_UP_WAIT_MIN, Math.round(amount) * MINUTES_PER[unit]),
  );

/** The largest amount a unit can hold inside the 7 days limit. */
export const maxAmount = (unit: WaitUnit): number =>
  Math.floor(WIZARD_FOLLOW_UP_WAIT_MAX / MINUTES_PER[unit]);

/** What a new step starts as: wait for a reply for an hour, then send a template (not chosen yet). */
export const newFollowUp = (): WizardFollowUp => ({
  trigger: 'not_replied',
  waitMinutes: 60,
  action: { kind: 'template', templateId: null },
});

export const canAddFollowUp = (followUps: readonly WizardFollowUp[]): boolean =>
  followUps.length < WIZARD_FOLLOW_UP_MAX;

/** Read and reply tracking is Meta's: only a Cloud API number (or none picked yet, which step 1 already flags) can have follow-ups. */
export const supportsFollowUps = (senderKey: string | null): boolean =>
  senderKey === null || senderKey.startsWith('waba:');

/** `followUps.2.action` -> 2 (null for the list itself). */
export function followUpIndexOf(path: string): number | null {
  const m = /^followUps\.(\d+)/.exec(path);
  return m ? Number(m[1]) : null;
}
