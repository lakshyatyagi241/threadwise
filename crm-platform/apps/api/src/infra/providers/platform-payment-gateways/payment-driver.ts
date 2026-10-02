import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The port every gateway driver implements (WD-PAYGW-008, 048). It knows nothing about plans, workspaces or wallets: a
 * driver is built from credentials + mode + an HTTP function and is handed a vendor-neutral order, so platform billing,
 * merchant checkout and booking deposits can all use the same adapters.
 */

export interface DriverOrder {
  /** Our reference. EVERY provider gets it in its own metadata field so notifications can be matched without a session. */
  orderNumber: string;
  /** Exact amount in the currency's minor unit (see majorToMinor: zero- and three-decimal currencies are right). */
  amountMinor: bigint;
  /** The same amount as a decimal string in major units, for providers that take that form. */
  amountMajor: string;
  currency: string;
  description: string;
  customerName?: string | null;
  customerEmail?: string | null;
  /** The provider's own id for this payment, set after `initiate` (needed to confirm it). */
  gatewayOrderId?: string | null;
}

export interface DriverUrls {
  /** Where the provider sends the buyer back (carries our opaque return token). */
  returnUrl: string;
  /** Where the provider posts asynchronous notifications. */
  notifyUrl: string;
}

export type PaymentStatus = 'pending' | 'paid' | 'failed';

/** A widget the browser runs with these parameters. No server-rendered HTML ever reaches the buyer. */
export interface ClientAction {
  provider: 'razorpay';
  params: Record<string, string | number | boolean>;
}

export interface PaymentResult {
  status: PaymentStatus;
  redirectUrl?: string;
  clientAction?: ClientAction;
  gatewayOrderId?: string;
  gatewayPaymentId?: string;
  payload?: Record<string, unknown>;
  /** Machine-ish reason, stored verbatim in orders.failure_reason. `cancelled_by_user` is a decline, not a fault. */
  error?: string;
}

export const CANCELLED_BY_USER = 'cancelled_by_user';

export const pending = (extra: Partial<PaymentResult> = {}): PaymentResult => ({
  status: 'pending',
  ...extra,
});
export const paid = (
  gatewayPaymentId?: string,
  payload?: Record<string, unknown>,
): PaymentResult => ({
  status: 'paid',
  gatewayPaymentId,
  payload,
});
export const failed = (error: string, payload?: Record<string, unknown>): PaymentResult => ({
  status: 'failed',
  error,
  payload,
});

/** A verified notification that money arrived. Anything else a provider sends is ignored by the receiver. */
export interface WebhookPayment {
  orderNumber?: string;
  gatewayOrderId?: string;
  gatewayPaymentId?: string;
  /** What the provider says it collected; the receiver refuses a payment that does not match the order. */
  amountMinor?: bigint;
  currency?: string;
  payload?: Record<string, unknown>;
}

export interface PaymentDriver {
  readonly slug: string;
  /** Start the payment. Never throws for a provider failure: returns `failed('<slug>_exception: ...')`. */
  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult>;
  /**
   * The buyer came back. `params` = query string merged with the POST body. Confirm with the provider (or verify a signature);
   * a redirect parameter alone is never proof of payment.
   */
  confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult>;
  /** Authenticate a provider notification. false = reject. Constant-time comparisons only. */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): Promise<boolean>;
  /** The payment a verified notification announces, or null when it is some other event. */
  parseWebhook(body: unknown): WebhookPayment | null;
  /**
   * Stop a recurring subscription from renewing (WD-PLAN-012). The period already paid for keeps running. Optional: a driver without a
   * recurring product leaves it out and the caller records that the remote cancel was not possible. Never throws for a provider
   * failure: returns `{ ok: false, reason }`.
   */
  cancelSubscription?(ref: SubscriptionRef): Promise<CancelResult>;
}

/** What a gateway needs to find one subscription (the ids it handed us when the subscription was created). */
export interface SubscriptionRef {
  gatewaySubscriptionId: string;
  gatewayCustomerId: string | null;
  gatewayPlanId: string | null;
}

export interface CancelResult {
  ok: boolean;
  /** Machine-ish reason on failure, stored on the subscription so a failed remote cancel is visible. */
  reason?: string;
}

/** One HTTP call, injectable so drivers are tested against fixtures and never touch the network in tests. */
export interface HttpResponse {
  status: number;
  json: unknown;
  text: string;
}
export type HttpFetch = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
) => Promise<HttpResponse>;

export const HTTP_TIMEOUT_MS = 45_000;

export const defaultHttp: HttpFetch = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
};

export interface DriverContext {
  credentials: Record<string, string>;
  mode: 'sandbox' | 'live';
  http: HttpFetch;
}

export const basicAuth = (user: string, pass: string): string =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

export const hmacHex = (algo: 'sha256', secret: string, data: string | Buffer): string =>
  createHmac(algo, secret).update(data).digest('hex');

/** Constant-time string equality that does not throw on different lengths. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

export const isOk = (r: HttpResponse): boolean => r.status >= 200 && r.status < 300;

/** Never let a vendor error body (which may echo secrets or PII) into a stored reason longer than needed. */
export const brief = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).slice(0, 200);
