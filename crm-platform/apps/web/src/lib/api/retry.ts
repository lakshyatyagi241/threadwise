import { ApiError } from './errors';

/**
 * Retry for reads that feed a live screen (the inbox side panel, tasks, bookings). A deploy or a restart takes the API away for a
 * few seconds; failing at once leaves red panels until someone clicks "Try again", so a network error, an unreadable answer or a 5xx is
 * retried with a growing wait (1, 2, 4, 8 s: about 15 s in all). A 4xx is the server's real answer and is never retried.
 */
export const transientRetry = (failures: number, error: unknown): boolean =>
  !(error instanceof ApiError && error.status < 500) && failures < 4;

export const transientRetryDelay = (attempt: number): number => Math.min(1000 * 2 ** attempt, 8000);
