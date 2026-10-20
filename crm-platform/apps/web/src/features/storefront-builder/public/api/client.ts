import {
  abandonCartResponseSchema,
  checkoutResponseSchema,
  couponQuoteResponseSchema,
  problemSchema,
  publicHomeSchema,
  publicReviewResponseSchema,
  type AbandonCartInput,
  type CheckoutInput,
  type CouponQuoteInput,
  type PublicHome,
  type PublicReviewInput,
} from '@crm/contracts';
import type { ZodType, ZodTypeDef } from 'zod';

/**
 * Browser calls of the public shop. They go to the shop's own route handlers (`/s/<slug>/...`, same origin, so they work on a
 * custom domain), which forward to the API. Failures come back as values: the page decides what the buyer reads.
 */
export type CallResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      /** `network` when nothing answered, `api` for any HTTP failure, `shape` when a 2xx body was not what the contract says. */
      kind: 'network' | 'api' | 'shape';
      status: number;
      /** The problem's stable code, e.g. STORE_COUPON_INVALID, when the body is a problem+json. */
      code: string | null;
      /** The first field message, else the problem's detail. Shown only when no localized text exists for the code. */
      message: string | null;
    };

const shop = (slug: string) => `/s/${encodeURIComponent(slug)}`;

async function call<T>(
  url: string,
  init: RequestInit,
  schema: ZodType<T, ZodTypeDef, unknown>,
): Promise<CallResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(30000),
      ...init,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...init.headers },
    });
  } catch {
    return { ok: false, kind: 'network', status: 0, code: null, message: null };
  }
  const text = await res.text().catch(() => '');
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const p = problemSchema.safeParse(json);
    return {
      ok: false,
      kind: 'api',
      status: res.status,
      code: p.success ? p.data.code : null,
      message: p.success ? (p.data.errors?.[0]?.message ?? p.data.detail ?? null) : null,
    };
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, kind: 'shape', status: res.status, code: null, message: null };
}

const postJson = (
  slug: string,
  action: string,
  body: unknown,
  idempotencyKey?: string,
): [string, RequestInit] => [
  `${shop(slug)}/${action}`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  },
];

/** `idempotencyKey` makes a retry of the same click safe on the server. */
export const postCheckout = (slug: string, input: CheckoutInput, idempotencyKey?: string) =>
  call(...postJson(slug, 'checkout', input, idempotencyKey), checkoutResponseSchema);

export const postCoupon = (slug: string, input: CouponQuoteInput) =>
  call(...postJson(slug, 'coupon', input), couponQuoteResponseSchema);

export const postReview = (slug: string, input: PublicReviewInput) =>
  call(...postJson(slug, 'review', input), publicReviewResponseSchema);

export const postAbandon = (slug: string, input: AbandonCartInput) =>
  call(...postJson(slug, 'abandon', input), abandonCartResponseSchema);

/** The next page of the catalog ("Show more"). */
export const fetchMoreProducts = (slug: string, page: number): Promise<CallResult<PublicHome>> =>
  call(`${shop(slug)}/more?page=${page}`, { method: 'GET' }, publicHomeSchema);
