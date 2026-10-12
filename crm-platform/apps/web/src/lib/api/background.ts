import type { Query } from '@tanstack/react-query';
import { ApiError } from './errors';

/**
 * Marks a query as one of the shell's background reads (notification count, inbox count, balance, plan status, workspace list,
 * act-as status): data the chrome shows on every page that no screen asks for. Put it in the query's `meta`. When such a query
 * fails for good, `BackgroundErrorBanner` tells the person once instead of the figure quietly going stale.
 */
export const BACKGROUND_META = { background: true } as const;

/** A background query that ran out of retries on a server or network failure. A 4xx (signed out, no permission) is handled elsewhere. */
export function isBackgroundFailure(query: Query): boolean {
  if (query.meta?.background !== true || query.state.status !== 'error') return false;
  const e = query.state.error;
  return !(e instanceof ApiError && e.status < 500);
}
