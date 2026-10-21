/**
 * The visitor's relay (`/api/public/appointments/*`) forwards to the API without a session, so what it may forward is a short
 * allowlist, matched here as a pure function: a method and the path segments after the relay's own prefix. Anything else is a
 * 404 (no such path) or 405 (a path that exists, with another method). Segments are checked against strict patterns, so a
 * traversal (`..`), an encoded slash, a space or an extra segment never reaches the API.
 */

/** An organisation or service slug: letters, digits, dashes and underscores, starting with a letter or digit. */
export const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** A manage link's secret. */
export const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

/** The uuid of an uploaded booking page picture, or the workspace brand kit's logo. */
export const ASSET_ID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|brand-logo)$/;

export type PublicPathMatch =
  | {
      ok: true;
      /** The path under `/v2/public/`, with every segment encoded. */
      path: string;
      method: 'GET' | 'POST';
      /** Only these routes carry a query (`from`, `to`). */
      hasQuery: boolean;
      /** A picture of the booking page (logo, cover): the one answer that may be cached, and that is not JSON. */
      asset?: true;
    }
  | { ok: false; status: 404 | 405 };

interface Route {
  method: 'GET' | 'POST';
  /** Segment checks: a RegExp for a variable segment, a string for a fixed one. */
  shape: ReadonlyArray<RegExp | string>;
  hasQuery?: boolean;
  /** The API serves it under another name than the page's address (`assets` is `booking-assets` there). */
  upstream?: readonly string[];
}

const ROUTES: readonly Route[] = [
  { method: 'GET', shape: ['booking', SLUG] },
  { method: 'GET', shape: ['booking', SLUG, SLUG] },
  { method: 'GET', shape: ['booking', SLUG, SLUG, 'slots'], hasQuery: true },
  { method: 'POST', shape: ['booking', SLUG, SLUG, 'book'] },
  { method: 'GET', shape: ['booking-manage', TOKEN] },
  { method: 'GET', shape: ['booking-manage', TOKEN, 'slots'], hasQuery: true },
  { method: 'POST', shape: ['booking-manage', TOKEN, 'reschedule'] },
  { method: 'POST', shape: ['booking-manage', TOKEN, 'cancel'] },
  // The logo and cover of a booking page: `/api/public/appointments/assets/<workspace>/<picture id>?v=<version>`.
  { method: 'GET', shape: ['assets', SLUG, ASSET_ID], upstream: ['booking-assets'] },
];

const fits = (shape: Route['shape'], segments: readonly string[]): boolean =>
  shape.length === segments.length &&
  shape.every((rule, i) =>
    typeof rule === 'string' ? rule === segments[i] : rule.test(segments[i]!),
  );

/** `HEAD` is read like `GET` (the relay answers it without a body). */
export function matchPublicPath(method: string, segments: readonly string[]): PublicPathMatch {
  const verb = method === 'HEAD' ? 'GET' : method;
  const shaped = ROUTES.filter((r) => fits(r.shape, segments));
  if (shaped.length === 0) return { ok: false, status: 404 };
  const route = shaped.find((r) => r.method === verb);
  if (!route) return { ok: false, status: 405 };
  const upstream = route.upstream ? [...route.upstream, ...segments.slice(1)] : segments;
  return {
    ok: true,
    path: upstream.map(encodeURIComponent).join('/'),
    method: route.method,
    hasQuery: route.hasQuery === true,
    ...(route.upstream ? { asset: true as const } : {}),
  };
}

/** What may be in the `from` / `to` of a slots call: an ISO 8601 instant, nothing that could carry another parameter. */
const INSTANT = /^\d{4}-\d{2}-\d{2}(T[0-9:.]{1,16}(Z|[+-]\d{2}:\d{2})?)?$/;

/** The query string to forward for a slots call: `from` and `to` only, and only when they are instants. */
export function slotsQuery(params: URLSearchParams): string {
  const out = new URLSearchParams();
  for (const key of ['from', 'to'] as const) {
    const value = params.get(key);
    if (value && INSTANT.test(value)) out.set(key, value);
  }
  const text = out.toString();
  return text ? `?${text}` : '';
}
