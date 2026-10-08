import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { currencyExponent } from '@crm/contracts';
import { isBlockedAddress } from '../../net/blocked-address';

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

/** One HTTPS call to a fixed IP address while the TLS name and the Host header stay the real host name. */
export type PinnedFetch = (
  ip: string,
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
) => Promise<HttpResponse>;

export const defaultPinnedHttp: PinnedFetch = (ip, url, init) =>
  new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpsRequest(
      {
        host: ip,
        servername: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: init.method,
        headers: { ...init.headers, Host: u.host },
        timeout: HTTP_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode ?? 0, json, text });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('pinned_request_timeout')));
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });

/** True when a failed call was a name-resolution failure (Node reports it on the error or on its cause). */
export function isDnsError(e: unknown): boolean {
  const code = (x: unknown): string => String((x as { code?: unknown } | null)?.code ?? '');
  const c = [code(e), code((e as { cause?: unknown } | null)?.cause)];
  return c.some((v) => v === 'ENOTFOUND' || v === 'EAI_AGAIN' || v === 'ENODATA');
}

export class DnsMissingError extends Error {
  constructor(host: string) {
    super(`${host} DNS is missing (NXDOMAIN)`);
  }
}

/**
 * Resolves a host through DNS-over-HTTPS, Cloudflare first then Google (TW-PAYGW-025 rule 1). Returns a public IPv4 address,
 * or null when neither resolver answers; throws DnsMissingError when a resolver says the name does not exist (Status 3).
 * An answer that is not a public address is ignored, so a poisoned answer cannot point a payment call at the internal network.
 */
export async function resolveViaDoh(host: string, doh: HttpFetch): Promise<string | null> {
  const urls = [
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`,
    `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`,
  ];
  let nx = false;
  for (const u of urls) {
    try {
      const r = asRecord(
        (await doh(u, { method: 'GET', headers: { Accept: 'application/dns-json' } })).json,
      );
      if (r.Status === 3) nx = true;
      const answers = Array.isArray(r.Answer) ? r.Answer : [];
      for (const a of answers) {
        const rec = asRecord(a);
        const ip = typeof rec.data === 'string' ? rec.data : '';
        if (rec.type === 1 && isIP(ip) === 4 && !isBlockedAddress(ip)) return ip;
      }
    } catch {
      // try the next resolver
    }
  }
  if (nx) throw new DnsMissingError(host);
  return null;
}

/**
 * Wraps one HTTP call with the CinetPay behaviour: up to two attempts; on a name-resolution failure the host is resolved through
 * DoH and the call is made against that IP (TLS name unchanged). Everything behind the driver port, injectable for tests.
 */
export function withDnsFallback(
  primary: HttpFetch,
  doh: HttpFetch = defaultHttp,
  pinned: PinnedFetch = defaultPinnedHttp,
): HttpFetch {
  return async (url, init) => {
    let last: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await primary(url, init);
      } catch (e) {
        last = e;
        if (!isDnsError(e)) continue;
        const host = new URL(url).hostname;
        const ip = await resolveViaDoh(host, doh);
        if (ip) return pinned(ip, url, init);
      }
    }
    throw last;
  };
}

/** What identifies a provider plan: the same account, price and cadence is the same plan, so it is created once and reused. */
export interface ProviderPlanKey {
  /** Opaque, stable per provider account (a hash of the key id), so a test key and a live key never share a plan. */
  account: string;
  currency: string;
  amountMinor: bigint;
  unit: 'day' | 'week' | 'month' | 'year';
  count: number;
}

/** Optional store a driver may use to avoid creating a new provider plan on every checkout. A miss or a failure is never fatal. */
export interface ProviderPlanCache {
  find(key: ProviderPlanKey): Promise<string | null>;
  save(key: ProviderPlanKey, providerPlanId: string): Promise<void>;
}

export interface DriverContext {
  credentials: Record<string, string>;
  mode: 'sandbox' | 'live';
  http: HttpFetch;
  /** DNS-over-HTTPS lookups and the pinned-IP call used by the DNS fallback (CinetPay); tests inject fixtures. */
  dohHttp?: HttpFetch;
  pinnedHttp?: PinnedFetch;
  /** The URL a provider posts notifications to (Square signs it into its notification signature). */
  webhookUrl?: string;
  planCache?: ProviderPlanCache;
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
