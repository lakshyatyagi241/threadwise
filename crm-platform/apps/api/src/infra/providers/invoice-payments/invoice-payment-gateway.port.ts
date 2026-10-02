/**
 * The port between invoicing and whatever collects an invoice payment online (TW-PAY-015).
 *
 * Infra knows nothing about invoices or tenants: the request is plain data (an attempt id the domain made up, an amount, a
 * currency), the adapter answers with what the buyer should do, and verifies the provider's webhook signature. Real gateway
 * adapters (Stripe, Razorpay ...) implement the same interface later; only `manual` and the generic `hmac_generic` skeleton exist.
 *
 * Rules every adapter keeps (the webhook-handler skill):
 *  - `verifyWebhookSignature` hashes the RAW body, compares in constant time, and returns false on any doubt (no secret, a
 *    missing or malformed header, a timestamp outside the tolerance). It never defaults to true.
 *  - the browser's return URL is display-only; an adapter never turns redirect parameters into "paid".
 */

export interface CheckoutRequest {
  /** The domain's own id of this attempt (a uuid); the provider echoes it back as the reference of the payment. */
  attemptId: string;
  /** Whole minor units of `currency`. */
  amountMinor: bigint;
  currency: string;
  /** Number and description to show on the provider's page. */
  invoiceNumber: string;
  description: string;
}

export interface CheckoutResult {
  /** `redirect`: send the buyer to `url`; `instructions`: nothing hosted, the page shows how to pay; `unavailable`. */
  kind: 'redirect' | 'instructions' | 'unavailable';
  url?: string;
  /** The provider's id of the checkout, kept on the attempt. */
  externalId?: string;
}

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export interface InvoicePaymentGateway {
  /** The provider key stored on a connection and an attempt. */
  readonly provider: string;
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;
  /** `secret` is the connection's decrypted signing secret. `now` is injectable for the replay-tolerance test. */
  verifyWebhookSignature(
    rawBody: Buffer,
    headers: WebhookHeaders,
    secret: string,
    now?: Date,
  ): boolean;
}

/** All adapters by provider key. */
export const INVOICE_PAYMENT_GATEWAYS = Symbol('INVOICE_PAYMENT_GATEWAYS');
export type InvoicePaymentGateways = ReadonlyMap<string, InvoicePaymentGateway>;
