import type { PaymentStatus } from './types';

export interface SettleInput {
  /** What the buyer owes: invoice total less any withholding. */
  payableMinor: bigint;
  payments?: readonly bigint[];
  credits?: readonly bigint[];
}

export interface SettleResult {
  paidMinor: bigint;
  creditedMinor: bigint;
  amountDueMinor: bigint;
  overpaidMinor: bigint;
  status: PaymentStatus;
}

const sum = (xs: readonly bigint[] | undefined): bigint => {
  let t = 0n;
  for (const x of xs ?? []) {
    if (x < 0n)
      throw new RangeError('payments and credits are non-negative; record a refund separately');
    t += x;
  }
  return t;
};

/** Amount due after payments and applied credits. Never negative; anything beyond the payable is reported as `overpaidMinor`. */
export function settle(input: SettleInput): SettleResult {
  const paid = sum(input.payments);
  const credited = sum(input.credits);
  const applied = paid + credited;
  const due = input.payableMinor - applied;
  const amountDueMinor = due > 0n ? due : 0n;
  const overpaidMinor = due < 0n ? -due : 0n;
  let status: PaymentStatus;
  if (overpaidMinor > 0n) status = 'overpaid';
  else if (amountDueMinor === 0n) status = 'paid';
  else if (applied > 0n) status = 'partially_paid';
  else status = 'unpaid';
  return { paidMinor: paid, creditedMinor: credited, amountDueMinor, overpaidMinor, status };
}
