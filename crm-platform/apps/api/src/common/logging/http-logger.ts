import { randomUUID } from 'node:crypto';
import type { Options } from 'pino-http';
import { stdSerializers, stdTimeFunctions, type LoggerOptions } from 'pino';
import { LOG_REDACT_PATHS } from '../../modules/platform-infrastructure/observability/log-redaction';
import { RequestContextStore } from '../context/request-context';
import { maskSecretUrl } from './mask-secret-url';

/** A caller-supplied id is kept only when it is short and plain, so it cannot bloat or forge a log line. */
const SAFE_REQUEST_ID = /^[\w.:-]{1,128}$/;

export function resolveRequestId(incoming: unknown): string {
  return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

const MAX_FIELD = 256;
const truncate = (v: unknown): unknown =>
  typeof v === 'string' && v.length > MAX_FIELD ? `${v.slice(0, MAX_FIELD)}...[truncated]` : v;

/** Credentials that end up inside an error text (a connection string, a bearer header echoed by a client library, a JWT). */
const TEXT_SECRETS: [RegExp, string][] = [
  [/(:\/\/[^\s:/@]+:)[^\s@/]+@/g, '$1[secret]@'],
  [/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, '$1 [secret]'],
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g, '[jwt]'],
  [
    /((?:password|passwd|secret|token|api[_-]?key|authorization)["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi,
    '$1[secret]',
  ],
];
const scrubText = (t: string): string => TEXT_SECRETS.reduce((s, [re, to]) => s.replace(re, to), t);

/** pino's error shape (type, message, stack) with credentials removed from the text and an upper bound on its size. */
export function scrubError(err: Error): Record<string, unknown> {
  const out = stdSerializers.err(err) as Record<string, unknown>;
  for (const k of ['message', 'stack'] as const) {
    if (typeof out[k] === 'string') out[k] = truncateLong(scrubText(out[k] as string));
  }
  return out;
}
const truncateLong = (t: string): string =>
  t.length > 8192 ? `${t.slice(0, 8192)}...[truncated]` : t;

/** Field set shared by every backend process: `time` (ISO 8601), `level` (label), `msg`, `service`. */
export function baseLoggerOptions(service: string, level: string): LoggerOptions {
  return {
    level,
    base: { service },
    timestamp: stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: LOG_REDACT_PATHS, remove: true },
    // Also the serializer of the `err` field every `logger.error({ err }, ...)` call in the code base uses.
    serializers: { err: scrubError },
  };
}

/** pino-http options of the API process (the request line, correlation and tenant fields). */
export function apiHttpLoggerOptions(level: string): Options {
  return {
    ...baseLoggerOptions('api', level),
    // One id per request: the context middleware's if it already ran (it sets the response header), else resolved here.
    genReqId: (req, res) => {
      const set = res.getHeader('x-request-id');
      return typeof set === 'string' ? set : resolveRequestId(req.headers['x-request-id']);
    },
    // On EVERY line written inside a request (handler lines too, not only the access line): who, in which tenant.
    mixin: () => {
      const ctx = RequestContextStore.peek();
      return ctx
        ? {
            requestId: ctx.requestId,
            orgId: ctx.orgId || undefined,
            actorType: ctx.actorType,
            actorId: ctx.actorId ?? undefined,
          }
        : {};
    },
    serializers: {
      req: (req) => {
        // `query` and `params` repeat the address unmasked, so they are left out: `url` carries the masked query string.
        const { query: _q, params: _p, ...out } = stdSerializers.req(req) as Record<string, any>;
        return {
          ...out,
          // A push portal's address carries its secret as the last path segment: never in a log line.
          url: maskSecretUrl(out.url),
          headers: Object.fromEntries(
            Object.entries(out.headers ?? {}).map(([k, v]) => [k, truncate(v)]),
          ),
        };
      },
      err: (err: Error) =>
        // pino-http's own "failed with status code 5xx" error repeats what the exception filter already logged with the real stack.
        // A rejection with a non-Error reason has no message; reading it crashed the unhandled-rejection logger itself (found by the Sheet3 #76 live test).
        String(err?.message ?? '').startsWith('failed with status code')
          ? undefined
          : scrubError(err),
    },
    // A 4xx is the caller's doing (info); a 5xx is already logged once at error by the exception filter, so its access line is a warn.
    customLogLevel: (_req, res) => (res.statusCode >= 500 ? 'warn' : 'info'),
    // Health probes fire every few seconds; logging them buries everything that matters.
    autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
  };
}
