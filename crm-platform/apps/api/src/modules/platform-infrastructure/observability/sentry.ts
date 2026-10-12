import * as Sentry from '@sentry/node';
import { maskSecretUrl } from '../../../common/logging/mask-secret-url';
import { isSecretHeader, redactHeaders } from './log-redaction';

export type ServiceName = 'api' | 'worker';

let enabled = false;

/**
 * What the SDK may attach to a report. Sentry 11 collects nearly everything unless told otherwise (Sentry 8 had one switch,
 * `sendDefaultPii: false`, that this replaces): the user, cookies, query strings, request and response bodies, bound database
 * values, queue job arguments and the value of every local variable in a stack frame. Each of those can hold a password, a token
 * or customer data and none can be inspected for them, so they are off. Request headers stay (the scrub below redacts the ones that
 * carry credentials); response headers do not, because `set-cookie` is one of them and the scrub does not look there.
 */
export const NO_EXTRA_DATA = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: true, response: false },
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
} satisfies Sentry.NodeOptions['dataCollection'];

/**
 * Starts error reporting when `SENTRY_DSN` is set, and does nothing at all when it is not (TW-INFRA-018).
 *
 * Errors only: tracing stays off unless `SENTRY_TRACES_SAMPLE_RATE` is set explicitly. "Off" has to be said as a rate of 0: left
 * undefined, Sentry 8 still opened a span for every incoming request and sent it as a transaction carrying the full URL, query
 * string included (found by the end-to-end test: a webhook secret in the path went out). With a rate set, every span is scrubbed
 * the same way as errors (Sentry 11 streams spans, so `beforeSendSpan` is the hook; `beforeSendTransaction` is ignored in that mode and
 * a secret in `url.full` went out until the end-to-end test ran with tracing on). The process-wide handlers are ours (see
 * process-handlers.ts), so Sentry's own are removed rather than run twice.
 *
 * Read straight from the process environment, before Nest and its config module exist: it has to be running by the time
 * anything can fail. So `SENTRY_DSN` must be in the real environment (compose, orchestrator), not only in a `.env` file.
 */
export function initSentry(service: ServiceName, env: NodeJS.ProcessEnv = process.env): boolean {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn || enabled) return enabled;

  const traces = Number(env.SENTRY_TRACES_SAMPLE_RATE);
  Sentry.init({
    dsn,
    environment: env.NODE_ENV ?? 'development',
    release: env.GIT_SHA || undefined,
    serverName: undefined, // the container id says nothing a person can use
    dataCollection: NO_EXTRA_DATA,
    tracesSampleRate: Number.isFinite(traces) && traces > 0 && traces <= 1 ? traces : 0,
    integrations: (defaults) =>
      defaults.filter((i) => i.name !== 'OnUncaughtException' && i.name !== 'OnUnhandledRejection'),
    initialScope: { tags: { service } },
    beforeSend: scrubSentryEvent,
    beforeSendSpan: scrubSentrySpan,
  });
  enabled = true;
  return true;
}

export const sentryEnabled = (): boolean => enabled;

interface ScrubbableEvent {
  /** The name of the request being handled when the error happened: `GET /path`. */
  transaction?: string;
  request?: {
    url?: string;
    headers?: Record<string, unknown>;
    cookies?: unknown;
    data?: unknown;
    query_string?: unknown;
  };
  breadcrumbs?: Array<{ data?: Record<string, unknown> }>;
}

/**
 * Removes what must not leave the building before an event is sent: credentials in headers, cookies, the request body (it can
 * hold a password or a token and cannot be inspected for them), the query string, and secrets embedded in a URL path.
 */
export function scrubSentryEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.transaction) event.transaction = maskSecretUrl(event.transaction);
  if (event.request) {
    const req = event.request;
    if (req.url) req.url = maskSecretUrl(req.url.split('?')[0] ?? req.url);
    req.headers = redactHeaders(req.headers);
    delete req.cookies;
    delete req.data;
    delete req.query_string;
  }
  for (const crumb of event.breadcrumbs ?? []) {
    const url = crumb.data?.url;
    if (typeof url === 'string' && crumb.data)
      crumb.data.url = maskSecretUrl(url.split('?')[0] ?? url);
  }
  return event;
}

/** Span attributes that hold an address: the query is cut from them and the secret in the path is masked. */
const URL_KEYS = ['url', 'url.full', 'url.path', 'http.url', 'http.target', 'http.route'] as const;
/** Span attributes that are only a query or a fragment. */
const QUERY_KEYS = ['url.query', 'url.fragment', 'http.query'] as const;

/**
 * A header on a span is an attribute named `http.request.header.<name>`. Sentry blanks the ones whose name looks like a credential
 * (`authorization`, `cookie`, anything with `token` or `secret`) but not a signature (`x-hub-signature-256`), which can be replayed
 * inside its window, so the list this API knows (`SECRET_HEADERS`) is applied here too.
 */
const HEADER_ATTRIBUTE = /^http\.(?:request|response)\.header\.(.+)$/;

interface ScrubbableSpan {
  name?: string;
  /** A value is the raw value, or `{ value, unit? }`. */
  attributes?: Record<string, unknown>;
}

const isValueObject = (v: unknown): v is { value: unknown } =>
  typeof v === 'object' && v !== null && 'value' in v;

const scrubAttribute = (v: unknown, cutQuery: boolean): unknown => {
  if (typeof v === 'string') return maskSecretUrl(cutQuery ? (v.split('?')[0] ?? v) : v);
  if (isValueObject(v)) return { ...v, value: scrubAttribute(v.value, cutQuery) };
  return v;
};

/**
 * The same rules for a performance span: Sentry 11 sends one span per request, database call and outgoing call, each named and
 * described by its address. The query is dropped from every attribute that holds an address, and the secret in a path is masked in
 * the name and in every string attribute, not only the ones known today (the names changed between Sentry 8 and 11: `http.url`
 * became `url.full`).
 */
export function scrubSentrySpan<T extends ScrubbableSpan>(span: T): T {
  if (span.name) span.name = maskSecretUrl(span.name);
  const attrs = span.attributes;
  if (!attrs) return span;
  for (const [key, value] of Object.entries(attrs)) {
    const header = HEADER_ATTRIBUTE.exec(key)?.[1];
    if (header !== undefined) {
      if (isSecretHeader(header)) attrs[key] = ['[redacted]'];
      continue;
    }
    attrs[key] = scrubAttribute(value, (URL_KEYS as readonly string[]).includes(key));
  }
  for (const key of QUERY_KEYS) delete attrs[key];
  return span;
}

/** Reports an unexpected failure (a 5xx). Never throws and never blocks the response. */
export function reportServerError(
  err: unknown,
  context: { requestId?: string; path?: string },
): void {
  if (!enabled) return;
  try {
    Sentry.withScope((scope) => {
      if (context.requestId) scope.setTag('requestId', context.requestId);
      if (context.path)
        scope.setTag('path', maskSecretUrl(context.path.split('?')[0] ?? context.path));
      Sentry.captureException(err);
    });
  } catch {
    /* reporting must never be the thing that fails */
  }
}

/** Waits (up to `timeoutMs`) for queued events to be sent: call before the process exits. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!enabled) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    /* nothing to do */
  }
}
