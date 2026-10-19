import { deploymentsResponseSchema, type DeploymentStatus } from '@crm/contracts';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';

/** Operator console, through the same-origin operator proxy (`/api/platform/*` becomes `/v2/platform/*`). */
const ROOT = '/deployments';

/** The list polls; a hidden tab stops (react-query's default), and a failed poll keeps the last good rows on screen. */
export const DEPLOYMENTS_POLL_MS = 5_000;

/** How many rows one load asks for. The server says when more exist (`truncated`). */
export const DEPLOYMENTS_LIMIT = 200;

export const deploymentsKeys = {
  all: ['operator', 'deployments'] as const,
  list: (status: DeploymentStatus | null) =>
    ['operator', 'deployments', 'list', status ?? 'all'] as const,
};

export const fetchDeployments = (status: DeploymentStatus | null, signal?: AbortSignal) =>
  operatorFetch(ROOT, {
    query: { status: status ?? undefined, limit: DEPLOYMENTS_LIMIT },
    schema: deploymentsResponseSchema,
    signal,
  });
