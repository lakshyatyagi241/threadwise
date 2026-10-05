import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from '@/lib/sentry/options';

// Edge runtime: the proxy (src/proxy.ts).
Sentry.init({ ...sentryOptions(), initialScope: { tags: { service: 'web', runtime: 'edge' } } });
