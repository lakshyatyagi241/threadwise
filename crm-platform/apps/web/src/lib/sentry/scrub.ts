/**
 * What may leave this app in an error report. Pure functions, no Sentry import, so the browser, Node and edge entry points share
 * them and a test can pin them.
 *
 * Why this exists: several pages are reached by an address that IS the credential (`/q/<token>` a buyer's proposal,
 * `/i/<token>` an invoice, `/b/manage/<token>` a booking, `/reset-password/<token>`), and the SDK records the page address in
 * events, breadcrumbs and (when tracing is on) transaction names. Query strings carry tokens too (`?token=`, `?code=`).
 */
const SECRET_SEGMENTS = [
  /^(\/q\/)[^/?#]+/i,
  /^(\/i\/)[^/?#]+/i,
  /^(\/b\/manage\/)[^/?#]+/i,
  /^(\/reset-password\/)[^/?#]+/i,
  /^(\/confirm-email-change\/)[^/?#]+/i,
];

/** A path or URL with the secret segment replaced and the query string and fragment dropped. */
export function scrubUrl(url: string): string {
  const cut = url.search(/[?#]/);
  const noQuery = cut === -1 ? url : url.slice(0, cut);
  // keep an origin if there is one, scrub the path
  const m = /^(https?:\/\/[^/]+)?(.*)$/i.exec(noQuery);
  const origin = m?.[1] ?? '';
  let path = m?.[2] ?? noQuery;
  for (const pattern of SECRET_SEGMENTS) path = path.replace(pattern, '$1[secret]');
  return `${origin}${path}`;
}

const SECRET_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-workspace-token',
  'x-node-token',
  'x-csrf-token',
]);

/** Headers whose VALUE is a page address (ours: x-crm-path carries the path and query the proxy was asked for; the browser's: referer). */
const ADDRESS_HEADERS = new Set([
  'referer',
  'x-crm-path',
  'x-matched-path',
  'x-invoke-path',
  'x-forwarded-uri',
]);

interface ScrubbableEvent {
  transaction?: string;
  request?: {
    url?: string;
    headers?: Record<string, unknown>;
    cookies?: unknown;
    data?: unknown;
    query_string?: unknown;
  };
  breadcrumbs?: Array<{ data?: Record<string, unknown>; message?: string; category?: string }>;
  contexts?: { trace?: { data?: Record<string, unknown> }; nextjs?: { request_path?: unknown } };
}

/**
 * Applied to every error event and every transaction before it is sent. Removes the request body, cookies and query string,
 * redacts credential headers, and masks secret path segments wherever the address appears.
 */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.transaction) event.transaction = scrubUrl(event.transaction);
  const req = event.request;
  if (req) {
    if (req.url) req.url = scrubUrl(req.url);
    if (req.headers) {
      req.headers = Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [
          k,
          SECRET_HEADERS.has(k.toLowerCase())
            ? '[redacted]'
            : ADDRESS_HEADERS.has(k.toLowerCase()) && typeof v === 'string'
              ? scrubUrl(v)
              : v,
        ]),
      );
    }
    delete req.cookies;
    delete req.data;
    delete req.query_string;
  }
  for (const crumb of event.breadcrumbs ?? []) {
    const d = crumb.data;
    if (!d) continue;
    for (const key of ['url', 'from', 'to']) {
      if (typeof d[key] === 'string') d[key] = scrubUrl(d[key] as string);
    }
  }
  // Next's own request context (from onRequestError) records the path with its query string.
  const next = event.contexts?.nextjs;
  if (next && typeof next.request_path === 'string')
    next.request_path = scrubUrl(next.request_path);
  const trace = event.contexts?.trace?.data;
  if (trace) {
    for (const key of ['url', 'http.url', 'http.target', 'url.full', 'url.path']) {
      if (typeof trace[key] === 'string') trace[key] = scrubUrl(trace[key] as string);
    }
    delete trace['http.query'];
    delete trace['url.query'];
  }
  return event;
}
