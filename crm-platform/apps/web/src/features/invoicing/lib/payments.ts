import { isDay } from './dates';
import { minorToInput, parseMajor } from './money';

export type PaymentProblem =
  | 'amountInvalid'
  | 'amountZero'
  | 'dateInvalid'
  | 'dateFuture'
  | 'tooMuch'
  | 'referenceTooLong'
  | 'noteTooLong';

export const REFERENCE_MAX = 191;
export const NOTE_MAX = 2000;

export interface PaymentFormCheck {
  /** The amount as the API wants it: a decimal string in major units of the currency ("125.50"), or null when it is not usable. */
  amount: string | null;
  /** The same amount in minor units, for comparing with the balance. */
  amountMinor: number | null;
  problems: Partial<Record<'amount' | 'paidAt' | 'reference' | 'note', PaymentProblem>>;
  /** More than the invoice still owes: allowed after a warning (`allowOverpayment`), since a customer may genuinely overpay. */
  overpays: boolean;
}

/** The amount and date of a "Record payment" form. `balanceMinor` is what the invoice still owes (`amountsMinor.balance`). */
export function checkPayment(
  f: { amount: string; paidAt: string; reference: string; note: string },
  currency: string,
  balanceMinor: number,
  today: string,
): PaymentFormCheck {
  const problems: PaymentFormCheck['problems'] = {};
  const minor = parseMajor(f.amount, currency);
  if (minor === null) problems.amount = 'amountInvalid';
  else if (minor <= 0) problems.amount = 'amountZero';
  if (!isDay(f.paidAt)) problems.paidAt = 'dateInvalid';
  else if (f.paidAt > today) problems.paidAt = 'dateFuture';
  if (f.reference.length > REFERENCE_MAX) problems.reference = 'referenceTooLong';
  if (f.note.length > NOTE_MAX) problems.note = 'noteTooLong';
  const amountMinor = problems.amount ? null : minor;
  return {
    amount: amountMinor === null ? null : minorToInput(amountMinor, currency),
    amountMinor,
    problems,
    overpays: amountMinor !== null && amountMinor > balanceMinor,
  };
}

/** A refund amount: positive and no more than what is left to refund (`PaymentResponse.refundable`, in minor units). */
export function checkRefund(
  amountText: string,
  currency: string,
  refundableMinor: number,
): { amount: string | null; amountMinor: number | null; problem?: PaymentProblem } {
  const minor = parseMajor(amountText, currency);
  if (minor === null) return { amount: null, amountMinor: null, problem: 'amountInvalid' };
  if (minor <= 0) return { amount: null, amountMinor: null, problem: 'amountZero' };
  if (minor > refundableMinor) return { amount: null, amountMinor: null, problem: 'tooMuch' };
  return { amount: minorToInput(minor, currency), amountMinor: minor };
}
