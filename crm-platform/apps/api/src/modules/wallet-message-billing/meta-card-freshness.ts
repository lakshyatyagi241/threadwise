import type { MetaCardFreshness } from '@crm/contracts';

/**
 * Meta changes its prices only on the first day of a quarter: 1 January, 1 April, 1 July, 1 October. A card is therefore `due` for
 * a check once a quarter has begun since the operator last imported it, and `upcoming` in the two weeks before the next one.
 * Pure: the clock is passed in. Dates are UTC calendar days (YYYY-MM-DD), compared as text.
 */

const DAY_MS = 86_400_000;
export const UPCOMING_DAYS = 14;

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/** The first day of the quarter `today` falls in, and of the next. */
export function quarterBounds(today: Date): { start: string; next: string } {
  const year = today.getUTCFullYear();
  const startMonth = Math.floor(today.getUTCMonth() / 3) * 3;
  const start = new Date(Date.UTC(year, startMonth, 1));
  const next = new Date(Date.UTC(year, startMonth + 3, 1));
  return { start: iso(start), next: iso(next) };
}

/** `checkedOn` is the day the card was last imported; null means there is no card. */
export function cardFreshness(checkedOn: string | null, today: Date): MetaCardFreshness {
  const { start, next } = quarterBounds(today);
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const daysUntilNext = Math.round((Date.parse(`${next}T00:00:00Z`) - todayUtc) / DAY_MS);
  let state: MetaCardFreshness['state'] = 'current';
  if (checkedOn === null || checkedOn < start) state = 'due';
  else if (daysUntilNext <= UPCOMING_DAYS) state = 'upcoming';
  return { state, quarterStart: start, nextQuarterStart: next, daysUntilNext };
}

/** The most pressing of several cards: `due` beats `upcoming` beats `current`. No card at all is `due`. */
export function mostPressing(list: readonly MetaCardFreshness[], today: Date): MetaCardFreshness {
  const rank = { current: 0, upcoming: 1, due: 2 } as const;
  const [first, ...rest] = list;
  if (!first) return cardFreshness(null, today);
  return rest.reduce((a, b) => (rank[b.state] > rank[a.state] ? b : a), first);
}
