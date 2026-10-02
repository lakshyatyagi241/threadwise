import type { DealStatus, StageKind } from '@crm/contracts';

/**
 * The deal state machine, with no database and no clock of its own (WD-DEAL-008). WaDesk kept it in model hooks that ran on
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
 * A won -> lost move therefore clears won_at and stamps lost_at, as in WaDesk.
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
 * the move wins, an already-lost deal keeps its reason, and a won or reopened deal drops it (WaDesk kept a stale reason on a deal
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
