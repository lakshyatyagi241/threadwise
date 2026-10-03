/**
 * Razorpay payment links with the MERCHANT's own keys (TW-STORE-008, 018). There is no platform-level Razorpay account: the
 * money lands with the shop owner, so every call carries that shop's key id and secret.
 */
export interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
}

export interface PaymentLinkRequest {
  amountMinor: number;
  currency: string;
  /** `WAORD-<order id>`. */
  referenceId: string;
  description: string;
  customer: { name?: string | null; contact?: string | null; email?: string | null };
  /** Razorpay echoes these back in the webhook; they name the order, the shop and the workspace. */
  notes: Record<string, string>;
  callbackUrl: string;
}

export interface PaymentLink {
  shortUrl: string | null;
  id: string | null;
}

export interface RazorpayPort {
  /** Null on any failure (non-2xx, timeout, network): the caller answers "could not create the payment link". */
  createPaymentLink(
    credentials: RazorpayCredentials,
    request: PaymentLinkRequest,
  ): Promise<PaymentLink | null>;
}

export const RAZORPAY_PORT = Symbol('STORE_RAZORPAY_PORT');
