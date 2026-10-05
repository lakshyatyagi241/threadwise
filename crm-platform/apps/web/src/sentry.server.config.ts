import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from '@/lib/sentry/options';

// Node runtime: server components, route handlers, server actions.
Sentry.init({ ...sentryOptions(), initialScope: { tags: { service: 'web', runtime: 'node' } } });
