/**
 * Payment gateway contract (Easebuzz at launch).
 *
 * Two money flows run through it:
 *   1. wallet top-up   — org pays us, credit lands on the prepaid wallet
 *   2. exam fee        — candidate pays us, later settled to the institute
 *
 * Flow 2 makes us an intermediary holding third-party money. That has an RBI
 * PA/PG compliance track attached. The schema is ready; do not
 * switch it on for real money until that is signed off.
 */

export interface InitiatePaymentParams {
  /** Our order id — must be unique per org. Stored on payment_transactions. */
  orderId: string;
  amount: number;
  currency: string;
  purpose: 'wallet_topup' | 'exam_fee';
  payer: { name: string; email: string; phone: string };
  successUrl: string;
  failureUrl: string;
}

export interface InitiatePaymentResult {
  /** Where to send the browser. */
  redirectUrl: string;
  gatewayOrderId: string;
}

export interface VerifiedPayment {
  orderId: string;
  gatewayTxnId: string;
  amount: number;
  status: 'success' | 'failed';
  raw: unknown;
}

export interface PaymentGateway {
  readonly name: string;

  initiate(params: InitiatePaymentParams): Promise<InitiatePaymentResult>;

  /**
   * Verifies the webhook/redirect hash and returns the payment.
   *
   * Callers MUST treat this as the only source of truth for "was it paid" —
   * never the browser redirect parameters, which the user controls.
   */
  verifyCallback(payload: Record<string, unknown>): VerifiedPayment;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
