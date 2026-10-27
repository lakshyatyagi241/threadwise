import type { DealStatus, StageKind } from '@crm/contracts';

/**
 * The deal state machine, with no database and no clock of its own (TW-DEAL-008). Reference kept it in model hooks that ran on
 * every writer; here one service applies it in one transaction and these functions are what it asks.
 */

export interface DealStamps {
  status: DealStatus;
  wonAt: Date | null;
  lostAt: Date | null;
}

export const statusOfKind = (kind: StageKind): DealStatus =>
  kind === 'won' ? 'won' : kind === 'lost' ? 'lost' : 'open';

/**
 * Status and stamps for a deal sitting in a stage of `kind`.
 *   won:  status won, won_at kept if it was already won (so a repeat is a no-op), else now; lost_at cleared
 *   lost: status lost, lost_at kept if already lost, else now; won_at cleared
 *   open: status open, both stamps cleared (a reopen)
 * A won -> lost move therefore clears won_at and stamps lost_at, as in Reference.
 */
export function stampsForKind(kind: StageKind, previous: DealStamps | null, now: Date): DealStamps {
  if (kind === 'won') {
    return {
      status: 'won',
      wonAt: previous?.status === 'won' && previous.wonAt ? previous.wonAt : now,
      lostAt: null,
    };
  }
  if (kind === 'lost') {
    return {
      status: 'lost',
      wonAt: null,
      lostAt: previous?.status === 'lost' && previous.lostAt ? previous.lostAt : now,
    };
  }
  return { status: 'open', wonAt: null, lostAt: null };
}

export type StatusTransition = 'won' | 'lost' | 'reopened' | null;

/** The event a status change is worth, if any: arriving at won or lost, or leaving one of them for an open stage. */
export function statusTransition(from: DealStatus | null, to: DealStatus): StatusTransition {
  if (from === to) return null;
  if (to === 'won') return 'won';
  if (to === 'lost') return 'lost';
  return from === null ? null : 'reopened';
}

/**
 * The reason text a deal carries after landing in a stage. Only a lost deal has one: a free-text or catalogue reason given with
 * the move wins, an already-lost deal keeps its reason, and a won or reopened deal drops it (Reference kept a stale reason on a deal
 * that was later won).
 */
export function lostReasonAfter(
  kind: StageKind,
  previousReason: string | null,
  previousStatus: DealStatus | null,
  given: string | null,
): string | null {
  if (kind !== 'lost') return null;
  if (given) return given;
  return previousStatus === 'lost' ? previousReason : null;
}

/** Whole percent, won / (won + lost), half away from zero; 0 when nothing has closed. */
export function winRatePercent(won: number, lost: number): number {
  const closed = won + lost;
  return closed === 0 ? 0 : Math.round((won / closed) * 100);
}

/**
 * The expected close date of an open deal is the day the person expects to win it, so a date that SETS a day already gone is refused (a
 * deal already past its date stays overdue until it is moved forward, won or lost). The clock is the caller's. A day of grace is allowed
 * so a person in a time zone ahead of UTC is not refused for choosing their own today.
 */
export function isPastCloseDate(day: string, now: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const floor = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return day < floor;
}
