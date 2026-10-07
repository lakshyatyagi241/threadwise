import {
  startImpersonationRequestSchema,
  workspaceHubSortSchema,
  workspaceHubStateFilterSchema,
  workspaceHubStatusFilterSchema,
  type StartImpersonationRequest,
  type SuspendWorkspaceHubRequest,
} from '@crm/contracts';
import type { HubListFilters } from '../api';

/** The address' filters (all strings, defaults left out) as the API's list query; a value the API does not know is dropped. */
export function toListFilters(values: Readonly<Record<string, string>>): HubListFilters {
  return {
    q: values.q || undefined,
    status: workspaceHubStatusFilterSchema.catch('all').parse(values.status),
    plan: values.plan || undefined,
    state: workspaceHubStateFilterSchema
      .optional()
      .catch(undefined)
      .parse(values.state || undefined),
    provider: values.provider || undefined,
    lowBalanceOnly: values.low === 'true',
    sort: workspaceHubSortSchema.catch('created').parse(values.sort),
  };
}

export const MIN_IMPERSONATION_REASON = 8;

/** The impersonation request, or null while the reason is shorter than 8 characters (spaces around it do not count). */
export function impersonationDraft(
  reason: string,
  readOnly: boolean,
): StartImpersonationRequest | null {
  const parsed = startImpersonationRequestSchema.safeParse({ reason, readOnly });
  return parsed.success ? parsed.data : null;
}

/** The suspend / reactivate body: the reason only when one was typed. */
export function suspendBody(reason: string): SuspendWorkspaceHubRequest {
  const r = reason.trim();
  return r ? { reason: r } : {};
}
