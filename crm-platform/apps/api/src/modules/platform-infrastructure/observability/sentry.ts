import * as Sentry from '@sentry/node';
import { maskSecretUrl } from '../../../common/logging/mask-secret-url';
import { redactHeaders } from './log-redaction';

export type ServiceName = 'api' | 'worker';

let enabled = false;

/**
 * Starts error reporting when `SENTRY_DSN` is set, and does nothing at all when it is not (TW-INFRA-018).
 *
 * Errors only: tracing stays off unless `SENTRY_TRACES_SAMPLE_RATE` is set explicitly. "Off" has to be said as a rate of 0: left
 * undefined, Sentry 8 still opens a span for every incoming request and sends it as a transaction carrying the full URL, query
 * string included (found by the end-to-end test: a webhook secret in the path went out). With a rate set, transactions are
 * scrubbed the same way as errors. The process-wide handlers are ours (see process-handlers.ts), so Sentry's own are removed
 * rather than run twice.
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
    sendDefaultPii: false,
    tracesSampleRate: Number.isFinite(traces) && traces > 0 && traces <= 1 ? traces : 0,
    integrations: (defaults) =>
      defaults.filter((i) => i.name !== 'OnUncaughtException' && i.name !== 'OnUnhandledRejection'),
    initialScope: { tags: { service } },
    beforeSend: scrubSentryEvent,
    beforeSendTransaction: scrubSentryTransaction,
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

const URL_KEYS = ['url', 'http.url', 'http.target', 'http.route'] as const;

interface ScrubbableTransaction extends ScrubbableEvent {
  contexts?: { trace?: { data?: Record<string, unknown> } };
}

/**
 * The same rules for a performance transaction: its name and trace data are made of the request address (path and query), and the
 * query is dropped from every field that holds one.
 */
export function scrubSentryTransaction<T extends ScrubbableTransaction>(event: T): T {
  scrubSentryEvent(event);
  const data = event.contexts?.trace?.data;
  if (data) {
    for (const key of URL_KEYS) {
      const value = data[key];
      if (typeof value === 'string') data[key] = maskSecretUrl(value.split('?')[0] ?? value);
    }
    delete data['http.query'];
  }
  return event;
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
