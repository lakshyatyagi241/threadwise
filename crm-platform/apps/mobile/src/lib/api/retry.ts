import { ApiError } from './errors';

/**
 * Retry for reads that feed a live screen. A deploy, a tunnel or a lift takes the API away for a few seconds; failing at once
 * leaves a red screen until someone pulls to refresh. A network error, an unreadable answer or a 5xx is retried with a growing
 * wait (1, 2, 4, 8 s). A 4xx is the server's real answer and is never retried. Mutations are never retried here: a retried
 * POST is the caller's decision, made with the same Idempotency-Key.
 */
export const transientRetry = (failures: number, error: unknown): boolean =>
  !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 4;

export const transientRetryDelay = (attempt: number): number => Math.min(1000 * 2 ** attempt, 8000);
