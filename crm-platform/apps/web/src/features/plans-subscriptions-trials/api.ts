import {
  workspaceAddonsResponseSchema,
  cancelSubscriptionResponseSchema,
  publicFaqListResponseSchema,
  pricingFaqListResponseSchema,
  pricingFaqSchema,
  retentionRunResponseSchema,
  type CreatePricingFaqRequest,
  type UpdatePricingFaqRequest,
  attachPlanRequestSchema,
  planSettingsSchema,
  type PlanSettings,
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

export const fetchBillingFaqs = (signal?: AbortSignal) =>
  apiFetch('/billing/faqs', { schema: publicFaqListResponseSchema, signal });

/** The add-on catalogue and what the workspace owns (ADD domain, WD-ADD-033). */
export const fetchAddons = (signal?: AbortSignal) =>
  apiFetch('/addons', { schema: workspaceAddonsResponseSchema, signal });

/** Stops the subscription renewing; the paid period keeps running (WD-PLAN-012). */
export const cancelAutoRenew = () =>
  apiFetch('/billing/subscription/cancel', {
    method: 'POST',
    schema: cancelSubscriptionResponseSchema,
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

export const FAQS_KEY = ['operator', 'pricing-faqs'] as const;

export const fetchPricingFaqs = (signal?: AbortSignal) =>
  operatorFetch('/pricing-faqs', { schema: pricingFaqListResponseSchema, signal });

export const createPricingFaq = (body: CreatePricingFaqRequest) =>
  operatorFetch('/pricing-faqs', { method: 'POST', body, schema: pricingFaqSchema });

export const updatePricingFaq = (id: string, body: UpdatePricingFaqRequest) =>
  operatorFetch(`/pricing-faqs/${id}`, { method: 'PATCH', body, schema: pricingFaqSchema });

export const deletePricingFaq = (id: string) =>
  operatorFetch(`/pricing-faqs/${id}`, { method: 'DELETE' });

/** Data-retention wipe: a dry run by default; a real run carries `confirm: "WIPE"` (WD-PLAN-023). */
export const runRetention = (body: { dryRun: boolean; confirm?: string }) =>
  operatorFetch('/workspace-plans/retention/run', {
    method: 'POST',
    body,
    schema: retentionRunResponseSchema,
  });

export const PLAN_SETTINGS_KEY = ['operator', 'plan-settings'] as const;
export const fetchPlanSettings = (signal?: AbortSignal) =>
  operatorFetch('/plan-settings', { schema: planSettingsSchema, signal });
export const savePlanSettings = (body: PlanSettings) =>
  operatorFetch('/plan-settings', { method: 'PUT', body, schema: planSettingsSchema });
