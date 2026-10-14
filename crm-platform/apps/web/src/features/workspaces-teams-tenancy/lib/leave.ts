import type { MemberLeave } from '@crm/contracts';

/**
 * Leave dates are calendar days (`YYYY-MM-DD`) in the WORKSPACE's time zone. They are shown as a plain date in the person's language and
 * never go through the browser's zone: a Date built at UTC midnight and formatted in UTC is the same day everywhere.
 */
export function formatDay(day: string, locale: string, withYear = false): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** `day` plus `n` days, on the calendar (no zone, no daylight saving). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (negative when b is earlier). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export const SOON_DAYS = 14;

export type LeaveBadge = { kind: 'now'; until: string | null } | { kind: 'soon'; from: string };

/** What the members table shows beside a person: away now (until when), or leave that starts within two weeks. */
export function leaveBadge(
  leaves: readonly MemberLeave[],
  memberId: string,
  today: string,
): LeaveBadge | null {
  const mine = leaves.filter((l) => l.memberId === memberId);
  const now = mine.find((l) => l.onLeaveNow);
  if (now) return { kind: 'now', until: now.endsOn };
  const next = mine
    .filter((l) => l.status === 'scheduled' && l.startsOn > today)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0];
  if (next && daysBetween(today, next.startsOn) <= SOON_DAYS) {
    return { kind: 'soon', from: next.startsOn };
  }
  return null;
}

export interface LeaveDraft {
  startsOn: string;
  endsOn: string;
  openEnded: boolean;
  reason: string;
}

export type LeaveProblem = 'startRequired' | 'startPast' | 'endRequired' | 'endBeforeStart';

/** Checks the add-leave form against the workspace's today. Mirrors the server's rules; the server stays the authority. */
export function validateLeave(
  d: LeaveDraft,
  today: string,
):
  | { ok: true; input: { startsOn: string; endsOn: string | null; reason: string | null } }
  | { ok: false; problem: LeaveProblem } {
  if (!d.startsOn) return { ok: false, problem: 'startRequired' };
  if (d.startsOn < today) return { ok: false, problem: 'startPast' };
  if (!d.openEnded) {
    if (!d.endsOn) return { ok: false, problem: 'endRequired' };
    if (d.endsOn < d.startsOn) return { ok: false, problem: 'endBeforeStart' };
  }
  const reason = d.reason.trim();
  return {
    ok: true,
    input: {
      startsOn: d.startsOn,
      endsOn: d.openEnded ? null : d.endsOn,
      reason: reason === '' ? null : reason,
    },
  };
}

/** The day the person is back: the day after their last day away. Null for an open-ended leave. */
export function returnDay(leave: Pick<MemberLeave, 'endsOn'> | null): string | null {
  return leave?.endsOn ? addDays(leave.endsOn, 1) : null;
}
