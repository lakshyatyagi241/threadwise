import * as Sentry from '@sentry/react-native';
import { env } from '@/config/env';

/**
 * Error reporting is off until `EXPO_PUBLIC_SENTRY_DSN` is set. `sendDefaultPii: false` keeps IP addresses and user details
 * out of events; the app attaches an opaque user id only (see `identifyUser`), never an email or a name.
 */
export function initObservability(): void {
  if (!env.sentryDsn) return;
  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.variant,
    enabled: env.variant !== 'development',
    sendDefaultPii: false,
    tracesSampleRate: env.variant === 'production' ? 0.1 : 1,
  });
}

export function identifyUser(userId: string | null): void {
  Sentry.setUser(userId ? { id: userId } : null);
}
