import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // First, so a slow start of what follows is measured too. Event-loop metrics for this process: same monitor as the API.
    const { startWebRuntimeMonitor } = await import('./lib/observability/runtime-monitor');
    startWebRuntimeMonitor();
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Errors from server components, route handlers and the proxy.
export const onRequestError = Sentry.captureRequestError;
