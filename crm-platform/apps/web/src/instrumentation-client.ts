import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from '@/lib/sentry/options';

// Browser. Does nothing without a DSN (local development, previews).
Sentry.init({ ...sentryOptions(), initialScope: { tags: { service: 'web' } } });

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
