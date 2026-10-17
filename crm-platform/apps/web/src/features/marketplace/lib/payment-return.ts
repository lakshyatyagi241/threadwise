/** What the app page says when the buyer comes back from checkout (`?payment=<outcome>`, set by the payments return and by checkout itself). */
export const PAYMENT_RETURN_OUTCOMES = ['success', 'pending', 'failed', 'cancelled'] as const;
export type PaymentReturnOutcome = (typeof PAYMENT_RETURN_OUTCOMES)[number];

/** The outcome in the address, or null for anything else (no banner is drawn from a value we do not know). */
export function paymentReturnOutcome(raw: string | null | undefined): PaymentReturnOutcome | null {
  return (PAYMENT_RETURN_OUTCOMES as readonly string[]).includes(raw ?? '')
    ? (raw as PaymentReturnOutcome)
    : null;
}

export const PAYMENT_RETURN_TONE: Record<PaymentReturnOutcome, 'success' | 'info' | 'danger'> = {
  success: 'success',
  pending: 'info',
  failed: 'danger',
  cancelled: 'info',
};
