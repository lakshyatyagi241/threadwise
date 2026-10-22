import { addDays } from '../../../common/workspace-calendar';

/**
 * The rules of member leave that need no database (BL-112): what a new or changed range may be, what ending early means, who may
 * touch whose leave, and which delegate stands in. Pure, so the time-zone and edge cases are unit tests.
 */

export type LeaveScope = 'all' | 'team' | 'team_and_below' | 'own';

export interface RangeCheck {
  ok: boolean;
  /** Which field is wrong, for the form. */
  path?: 'startsOn' | 'endsOn';
  message?: string;
}

/**
 * A NEW leave begins today or later (in the workspace calendar); the last day is not before the first. Announcing leave after the
 * fact has no use for routing and would make "started" events for the past.
 */
export function checkNewRange(today: string, startsOn: string, endsOn: string | null): RangeCheck {
  if (startsOn < today) {
    return { ok: false, path: 'startsOn', message: 'The first day cannot be in the past.' };
  }
  if (endsOn !== null && endsOn < startsOn) {
    return { ok: false, path: 'endsOn', message: 'The last day cannot be before the first day.' };
  }
  return { ok: true };
}

/**
 * Changing a leave that exists. A scheduled leave moves freely (its start still not before today). An ACTIVE leave keeps its start
 * (it has begun; the history says so) and its end cannot be before today (to end it now, end it). Ended and cancelled ones are history.
 */
export function checkChangedRange(
  today: string,
  current: { status: string; startsOn: string },
  next: { startsOn: string; endsOn: string | null },
): RangeCheck {
  if (current.status === 'scheduled') return checkNewRange(today, next.startsOn, next.endsOn);
  if (current.status === 'active') {
    if (next.startsOn !== current.startsOn) {
      return {
        ok: false,
        path: 'startsOn',
        message: 'A leave that has begun keeps its first day.',
      };
    }
    if (next.endsOn !== null && next.endsOn < today) {
      return {
        ok: false,
        path: 'endsOn',
        message: 'The last day cannot be before today; end the leave instead.',
      };
    }
    return { ok: true };
  }
  return { ok: false, message: 'This leave is over and cannot be changed.' };
}

/**
 * Ending an active leave now: the person is back TODAY, so the last day away is yesterday, but never before the first day (a leave that
 * starts today and is ended today keeps its single day on record) and never after the end it already had.
 */
export function earlyEndDay(today: string, startsOn: string, endsOn: string | null): string {
  const yesterday = addDays(today, -1);
  const day = yesterday < startsOn ? startsOn : yesterday;
  return endsOn !== null && endsOn < day ? endsOn : day;
}

/** Whether a caller with `scope` on `team.leave.manage` may act on a member: `own` = themselves, `team` = a teammate or themselves, `all` = anyone. */
export function mayManage(
  scope: LeaveScope | null,
  callerId: number,
  targetId: number,
  sharesTeam: boolean,
): boolean {
  if (scope === null) return false;
  if (scope === 'all') return true;
  if (callerId === targetId) return true;
  return (scope === 'team' || scope === 'team_and_below') && sharesTeam;
}
