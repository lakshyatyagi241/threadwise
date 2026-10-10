import * as Sentry from '@sentry/react-native';
import type { ComponentType } from 'react';
import { env } from '@/config/env';

/** The one rule for "is error reporting on": a DSN was provided. */
const isConfigured = (): boolean => Boolean(env.sentryDsn);

/**
 * Error reporting is off until `EXPO_PUBLIC_SENTRY_DSN` is set. `sendDefaultPii: false` keeps IP addresses and user details
 * out of events; the app attaches an opaque user id only (see `identifyUser`), never an email or a name.
 */
export function initObservability(): void {
  if (!isConfigured()) return;
  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.variant,
    enabled: env.variant !== 'development',
    sendDefaultPii: false,
    tracesSampleRate: env.variant === 'production' ? 0.1 : 1,
  });
}

/**
 * Wraps the root component for Sentry's app-start timing and touch breadcrumbs, but only when `initObservability` started Sentry.
 * `Sentry.wrap` without a prior `Sentry.init` prints "App Start Span could not be finished" on every development launch.
 */
export function withObservability<P extends Record<string, unknown>>(
  Root: ComponentType<P>,
): ComponentType<P> {
  return isConfigured() ? Sentry.wrap(Root) : Root;
}

export function identifyUser(userId: string | null): void {
  Sentry.setUser(userId ? { id: userId } : null);
}
