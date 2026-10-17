/**
 * The pure rules of refunding the unused part of a paid app period (BL-077). Integer minor units end to end; no clock, no database.
 */

/** Calendar month arithmetic in UTC with end-of-month clamping (31 Mar - 1 month = 28/29 Feb), the way the payment terms are counted. */
export function shiftMonths(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}

export interface UnusedFacts {
  /** What the payment held, in minor units. */
  paidMinor: bigint;
  /** The end of the period that payment bought. */
  periodEnd: Date;
  billingPeriod: 'monthly' | 'yearly';
  /** The moment the workspace stopped being able to use what it paid for: now, or the moment the app was withdrawn. */
  from: Date;
}

/**
 * The unused part of the last payment: the time from `from` to the end of the period, as a share of that payment's cycle (a month or a
 * year counted back from the period end), rounded DOWN to a minor unit so the operator never returns more than the unused share. A payment
 * made early (the period runs longer than one cycle) is capped at the payment itself; a period already over refunds nothing.
 */
export function unusedMinor(f: UnusedFacts): bigint {
  const cycleStart = shiftMonths(f.periodEnd, f.billingPeriod === 'yearly' ? -12 : -1);
  const cycleMs = f.periodEnd.getTime() - cycleStart.getTime();
  if (cycleMs <= 0 || f.paidMinor <= 0n) return 0n;
  const remainingMs = Math.min(Math.max(f.periodEnd.getTime() - f.from.getTime(), 0), cycleMs);
  return (f.paidMinor * BigInt(remainingMs)) / BigInt(cycleMs);
}

/**
 * What may be returned now: the unused share minus what was already returned on that payment (so running the tool twice never refunds
 * twice), and never more than is left of the payment. Zero or negative means there is nothing to refund.
 */
export function refundableMinor(f: UnusedFacts & { alreadyRefundedMinor: bigint }): bigint {
  const unused = unusedMinor(f);
  const room = f.paidMinor - f.alreadyRefundedMinor;
  const want = unused - f.alreadyRefundedMinor;
  const n = want < room ? want : room;
  return n > 0n ? n : 0n;
}
