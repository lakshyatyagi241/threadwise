import {
  attachPlanRequestSchema,
  billingPlansResponseSchema,
  billingStatusSchema,
  billingUsageResponseSchema,
  changePlanResponseSchema,
  workspacePlanListResponseSchema,
  workspacePlanSchema,
  type AttachPlanRequest,
  type WorkspacePlanListQuery,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';

/** Workspace side: the staff proxy (`/api/v2/*`). Every call acts on the signed-in workspace. */
export const BILLING_KEYS = {
  plans: ['billing', 'plans'] as const,
  status: ['billing', 'status'] as const,
  usage: ['billing', 'usage'] as const,
};

export const fetchBillingPlans = (signal?: AbortSignal) =>
  apiFetch('/billing/plans', { schema: billingPlansResponseSchema, signal });

export const fetchBillingStatus = (signal?: AbortSignal) =>
  apiFetch('/billing/status', { schema: billingStatusSchema, signal });

export const fetchBillingUsage = (signal?: AbortSignal) =>
  apiFetch('/billing/usage', { schema: billingUsageResponseSchema, signal });

/** Switch to a free plan or a cheaper/equal plan (a dearer one is a checkout). `apiFetch` adds the Idempotency-Key. */
export const changePlan = (planSlug: string) =>
  apiFetch('/billing/plan', {
    method: 'POST',
    body: { planSlug },
    schema: changePlanResponseSchema,
  });

/** Operator console: the same-origin operator proxy (`/api/platform/*`). */
export const WORKSPACE_PLANS_KEY = ['operator', 'workspace-plans'] as const;

export const fetchWorkspacePlans = (q: Partial<WorkspacePlanListQuery>, signal?: AbortSignal) =>
  operatorFetch('/workspace-plans', {
    query: { search: q.search, plan: q.plan, cursor: q.cursor, limit: q.limit },
    schema: workspacePlanListResponseSchema,
    signal,
  });

export const attachWorkspacePlan = (workspaceId: string, body: AttachPlanRequest) =>
  operatorFetch(`/workspace-plans/${workspaceId}`, {
    method: 'PUT',
    body: attachPlanRequestSchema.parse(body),
    schema: workspacePlanSchema,
  });
