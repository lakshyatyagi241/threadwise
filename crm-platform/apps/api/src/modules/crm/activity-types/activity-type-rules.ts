import { activityCapabilities, type ActivityBehaviour, type UpdateActivityTypeInput } from '@crm/contracts';

/** Pure rules of the sales activities settings, kept out of the repository so a unit test can pin them without a database. */

/** A stable key for a name: lower case, letters and digits, words joined by `_`, at most `max` characters. */
export function slugOf(name: string, max = 50): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max)
    .replace(/_+$/g, '');
  return base || 'item';
}

/** A custom activity's key. A name with no Latin letters or digits (Hindi, Arabic...) falls back to `item`, then the caller adds a number. */
export const customKeyOf = (name: string, attempt = 0): string =>
  `custom_${slugOf(name, 40)}${attempt > 0 ? `_${attempt + 1}` : ''}`;

/** The case- and space-insensitive form two names are compared on. */
export const nameKeyOf = (name: string): string => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');

export interface ActivitySwitches {
  showInCalendar: boolean;
  allowComplete: boolean;
  allowEditCompleted: boolean;
  mobileCheckIn: boolean;
  outcomesEnabled: boolean;
}

/** The switches a new custom activity starts with: the behaviour's own defaults, outcomes on where the behaviour has them. */
export function initialSwitches(behavesAs: ActivityBehaviour): ActivitySwitches {
  const cap = activityCapabilities(behavesAs);
  return {
    showInCalendar: cap.showInCalendar,
    allowComplete: cap.allowComplete,
    allowEditCompleted: false,
    mobileCheckIn: false,
    outcomesEnabled: cap.outcomes,
  };
}

/** The switches in `input` that turn on something the activity's behaviour does not offer (turning one off is always fine). */
export function unsupportedSwitches(
  behavesAs: ActivityBehaviour,
  input: Pick<
    UpdateActivityTypeInput,
    'showInCalendar' | 'allowComplete' | 'allowEditCompleted' | 'mobileCheckIn' | 'outcomesEnabled'
  >,
): string[] {
  const cap = activityCapabilities(behavesAs);
  const bad: string[] = [];
  if (input.showInCalendar === true && !cap.showInCalendar) bad.push('showInCalendar');
  if (input.allowComplete === true && !cap.allowComplete) bad.push('allowComplete');
  if (input.allowEditCompleted === true && !cap.allowEditCompleted) bad.push('allowEditCompleted');
  if (input.mobileCheckIn === true && !cap.mobileCheckIn) bad.push('mobileCheckIn');
  if (input.outcomesEnabled === true && !cap.outcomes) bad.push('outcomesEnabled');
  return bad;
}

/** Whether `ids` is exactly the current list, each once (a reorder must name every current item). */
export function isFullOrder(current: readonly string[], ids: readonly string[]): boolean {
  if (current.length !== ids.length) return false;
  const want = new Set(current);
  return new Set(ids).size === ids.length && ids.every((id) => want.has(id));
}
