import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { currencyExponent } from '@crm/contracts';

/**
 * The port every gateway driver implements (TW-PAYGW-008, 048). It knows nothing about plans, workspaces or wallets: a
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
  /** Item name for providers that name the plan they create (recurring only). */
  planName?: string;
  /** Renewal cadence for `createSubscription` (TW-PAYGW-012). */
  recurring?: { interval: 'day' | 'week' | 'month' | 'year'; count: number };
  /** The order is an auto-renew checkout (the driver then sets up the subscription when the buyer returns). */
  isRecurring?: boolean;
  /** A support reference (never an internal id) some providers want in their metadata, e.g. the workspace slug. */
  workspaceRef?: string;
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
  provider: 'razorpay' | 'paddle' | 'cashfree' | 'hyperpay' | 'braintree';
  params: Record<string, string | number | boolean>;
}

/** Reference returned an auto-submitting HTML form for some gateways; here the browser builds the POST from plain fields. */
export interface FormPost {
  url: string;
  fields: Record<string, string>;
}

/** Offline gateways: nothing is charged, the buyer is shown what to do and then uploads proof (TW-PAYGW-013). */
export interface ManualInstructions {
  kind: 'bank_transfer' | 'offline';
  /** Label + value rows, only the ones the operator filled in. */
  rows: Array<{ label: string; value: string }>;
  notes: string | null;
}

export interface PaymentResult {
  status: PaymentStatus;
  redirectUrl?: string;
  clientAction?: ClientAction;
  formPost?: FormPost;
  instructions?: ManualInstructions;
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
   * Stop a recurring subscription from renewing (TW-PLAN-012). The period already paid for keeps running. Optional: a driver without a
   * recurring product leaves it out and the caller records that the remote cancel was not possible. Never throws for a provider
   * failure: returns `{ ok: false, reason }`.
   */
  cancelSubscription?(ref: SubscriptionRef): Promise<CancelResult>;
  /** Recurring (TW-PAYGW-012/029/030). A driver that leaves these out is always charged one-time. */
  supportsRecurring?(): boolean;
  createSubscription?(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult>;
  /** The subscription event a verified notification announces, or null. Matches orders by OUR order number only. */
  parseSubscriptionWebhook?(body: unknown): SubscriptionEvent | null;
  /** Poll the provider for the state of one subscription (the reconciler); null = cannot tell. */
  fetchSubscription?(ref: SubscriptionRef): Promise<SubscriptionState | null>;
}

export interface SubscriptionEvent {
  type: 'created' | 'renewed' | 'canceled' | 'payment_failed';
  subscriptionId: string | null;
  gatewayPlanId?: string | null;
  paymentId?: string | null;
  /** Unix seconds, ISO string or null: when the paid period ends according to the provider. */
  periodEnd?: string | number | null;
  /** Our order number when the provider echoed it (first charge); renewals carry only the subscription id. */
  orderNumber?: string | null;
}

export interface SubscriptionState {
  status: 'active' | 'past_due' | 'canceled' | 'expired';
  periodEnd?: string | number | null;
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
  /** The URL a provider posts notifications to (Square signs it into its notification signature). */
  webhookUrl?: string;
}

export const basicAuth = (user: string, pass: string): string =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

export const hmacHex = (
  algo: 'sha256' | 'sha512' | 'sha1' | 'md5',
  secret: string,
  data: string | Buffer,
): string => createHmac(algo, secret).update(data).digest('hex');

export const hmacB64 = (
  algo: 'sha256' | 'sha512' | 'sha1',
  secret: string,
  data: string | Buffer,
): string => createHmac(algo, secret).update(data).digest('base64');

export const hashHex = (algo: 'sha256' | 'sha512' | 'sha1' | 'md5', data: string): string =>
  createHash(algo).update(data).digest('hex');

export const bearer = (token: string): string => `Bearer ${token}`;

/** application/x-www-form-urlencoded body from a flat record; undefined values are dropped. */
export const urlForm = (
  rec: Record<string, string | number | boolean | undefined | null>,
): string =>
  new URLSearchParams(
    Object.entries(rec)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, String(v)] as [string, string]),
  ).toString();

export const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

/** Runs a driver step and turns a thrown error into `failed('<slug>_exception: ...')`: a driver never throws for a provider failure. */
export async function guard(
  slug: string,
  fn: () => Promise<PaymentResult>,
): Promise<PaymentResult> {
  try {
    return await fn();
  } catch (e) {
    return failed(`${slug}_exception: ${brief(e)}`);
  }
}

/** Case-insensitive header read (Node lower-cases, tests may not). */
export const header = (h: Record<string, string | undefined>, name: string): string | undefined =>
  h[name] ?? h[name.toLowerCase()];

/** Provider date (unix seconds or any date string) as ISO, or null. */
export function toIso(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const d =
    typeof v === 'number' || /^\d{9,11}$/.test(String(v))
      ? new Date(Number(v) * 1000)
      : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A provider's decimal amount (major units) as exact minor units; null when it is not a number. */
export function minorOf(amountMajor: unknown, currency: string): bigint | null {
  const n = typeof amountMajor === 'number' ? amountMajor : Number(amountMajor);
  if (!Number.isFinite(n)) return null;
  return BigInt(Math.round(n * 10 ** currencyExponent(currency)));
}

/** What the provider says it collected must equal the order. Currency is optional where the API omits it. */
export function moneyMatches(o: DriverOrder, amountMajor: unknown, currency?: unknown): boolean {
  if (currency !== undefined && currency !== null && String(currency).toUpperCase() !== o.currency)
    return false;
  return minorOf(amountMajor, o.currency) === o.amountMinor;
}

/** Same check for providers that report minor units. */
export function minorMatches(o: DriverOrder, amountMinor: unknown, currency?: unknown): boolean {
  if (currency !== undefined && currency !== null && String(currency).toUpperCase() !== o.currency)
    return false;
  try {
    return BigInt(String(amountMinor)) === o.amountMinor;
  } catch {
    return false;
  }
}

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

/** A form-encoded notification body as a flat record (last value wins). */
export function parseForm(raw: Buffer | string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(raw.toString('utf8')).entries());
}

/** Appends query parameters to a URL that may already have a query string. */
export function withQuery(url: string, params: Record<string, string>): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${new URLSearchParams(params).toString()}`;
}

/** A notification body as a flat record: JSON object, else form-encoded, else empty (callers then reject it). */
export function notificationFields(raw: Buffer | string): Record<string, unknown> {
  const text = raw.toString('utf8');
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return /^[^=&\s]+=/.test(text) ? parseForm(text) : {};
  }
}
