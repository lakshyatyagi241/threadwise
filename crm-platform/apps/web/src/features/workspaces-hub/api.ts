import {
  startImpersonationResponseSchema,
  workspaceHubDetailSchema,
  workspaceHubListResponseSchema,
  workspacePlanSchema,
  type ListWorkspaceHubQuery,
  type StartImpersonationRequest,
  type SuspendWorkspaceHubRequest,
} from '@crm/contracts';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';

/**
 * Operator console: through the same-origin operator proxy (`/api/platform/*` becomes `/v2/platform/*`).
 * The list and the actions below live in the hub's own endpoints; plan, provider and wallet changes reuse their domains' calls.
 */
export const hubKeys = {
  all: ['operator', 'workspaces-hub'] as const,
  list: (q: Record<string, string>) => ['operator', 'workspaces-hub', 'list', q] as const,
  detail: (id: string) => ['operator', 'workspaces-hub', 'detail', id] as const,
  plan: (id: string) => ['operator', 'workspaces-hub', 'plan', id] as const,
};

export type HubListFilters = Partial<
  Pick<ListWorkspaceHubQuery, 'q' | 'status' | 'plan' | 'state' | 'provider' | 'sort' | 'cursor'>
> & { lowBalanceOnly?: boolean; limit?: number };

export const fetchHubList = (f: HubListFilters, signal?: AbortSignal) =>
  operatorFetch('/workspaces', {
    query: {
      q: f.q,
      status: f.status && f.status !== 'all' ? f.status : undefined,
      plan: f.plan,
      state: f.state,
      provider: f.provider,
      lowBalanceOnly: f.lowBalanceOnly ? 'true' : undefined,
      sort: f.sort,
      limit: f.limit ?? 25,
      cursor: f.cursor,
    },
    schema: workspaceHubListResponseSchema,
    signal,
  });

export const fetchHubDetail = (id: string, signal?: AbortSignal) =>
  operatorFetch(`/workspaces/${id}`, { schema: workspaceHubDetailSchema, signal });

/** The suspend and reactivate answers carry nothing the screen needs: it refetches the list or the detail. */
export const suspendWorkspace = (id: string, body: SuspendWorkspaceHubRequest) =>
  operatorFetch(`/workspaces/${id}/suspend`, {
    method: 'POST',
    body,
  });

export const unsuspendWorkspace = (id: string, body: SuspendWorkspaceHubRequest) =>
  operatorFetch(`/workspaces/${id}/unsuspend`, {
    method: 'POST',
    body,
  });

export const impersonateOwner = (id: string, body: StartImpersonationRequest) =>
  operatorFetch(`/workspaces/${id}/impersonate`, {
    method: 'POST',
    body,
    schema: startImpersonationResponseSchema,
  });

/** One workspace's plan state (the attach dialog's input), from the plans domain. */
export const fetchWorkspacePlan = (id: string, signal?: AbortSignal) =>
  operatorFetch(`/workspace-plans/${id}`, { schema: workspacePlanSchema, signal });
