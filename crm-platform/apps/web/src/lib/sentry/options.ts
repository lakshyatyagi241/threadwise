import * as Sentry from '@sentry/nextjs';
import { scrubEvent, scrubLog } from './scrub';

/**
 * Settings shared by the browser, Node and edge entry points. Errors are always on once a DSN is present. Tracing is off unless
 * a rate is set, and Session Replay is not used at all: this app shows customers' conversations and contact details, which a
 * screen recording would capture.
 *
 * The browser build can only read variables that start with NEXT_PUBLIC_ and that were present when the image was built, so the
 * DSN, the release and the tracing rate each have a public name; the server also accepts the plain names set at run time.
 */
const num = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0;
};

export function sentryOptions() {
  return {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN || undefined,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.NEXT_PUBLIC_GIT_SHA || undefined,
    // Said as 0, not left out: with no rate the SDK still sends a transaction per request.
    tracesSampleRate: num(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE),
    sendDefaultPii: false,
    // A `console.error` is a caught failure someone chose to print, so it is an issue; a `console.warn` is a searchable Sentry log.
    // Both go through the same scrub as an error report before they leave.
    integrations: [
      Sentry.captureConsoleIntegration({ levels: ['error'] }),
      Sentry.consoleLoggingIntegration({ levels: ['warn'] }),
    ],
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    beforeSendLog: scrubLog,
  };
}
