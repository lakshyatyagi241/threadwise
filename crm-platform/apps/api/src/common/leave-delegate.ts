/** Automatic assignment's use of delegates (BL-112), shared by conversation routing and contact/deal auto-assignment. Pure. */

/**
 * Who stands in for `person` under automatic assignment: their delegate when there is one, active, not away themselves and eligible
 * for the work (`eligible`), else nobody (the caller then tries the team pool). One hop only: a delegate who is on leave is skipped, the
 * chain is NOT followed (a circle of people on leave must not hide the work).
 */
export function pickDelegate(
  delegateOf: ReadonlyMap<number, number>,
  person: number,
  isAway: (id: number) => boolean,
  eligible: (id: number) => boolean,
): number | null {
  const d = delegateOf.get(person);
  if (d === undefined || d === person) return null;
  if (isAway(d) || !eligible(d)) return null;
  return d;
}
