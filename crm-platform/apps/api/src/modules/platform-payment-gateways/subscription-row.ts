// Leaf module (no service imports) so the cancel and lifecycle services can share the row shape without an import cycle.
export type SubStatus = 'pending' | 'active' | 'past_due' | 'canceled' | 'expired';

/** One `subscriptions` row as this module reads it. Internal ids stay inside the API. */
export interface SubRow {
  orgId: number;
  id: number;
  userId: number | null;
  gateway: string;
  gatewaySubscriptionId: string | null;
  gatewayPlanId: string | null;
  gatewayCustomerId: string | null;
  planSlug: string | null;
  /** 'plan' renews the workspace plan; 'addon' renews one add-on purchase and never touches the plan window. */
  kind: 'plan' | 'addon';
  workspaceAddonId: number | null;
  billingCycle: 'monthly' | 'yearly';
  status: SubStatus;
  currentPeriodEnd: Date | null;
  renewalsCount: number;
  meta: Record<string, unknown>;
}

export type Raw = Record<string, unknown>;
export const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function toSub(r: Raw): SubRow {
  return {
    orgId: Number(r.org_id),
    id: Number(r.id),
    userId: r.user_id === null || r.user_id === undefined ? null : Number(r.user_id),
    gateway: r.gateway as string,
    gatewaySubscriptionId: text(r.gateway_subscription_id),
    gatewayPlanId: text(r.gateway_plan_id),
    gatewayCustomerId: text(r.gateway_customer_id),
    planSlug: text(r.plan_id),
    kind: r.kind === 'addon' ? 'addon' : 'plan',
    workspaceAddonId:
      r.workspace_addon_id === null || r.workspace_addon_id === undefined
        ? null
        : Number(r.workspace_addon_id),
    billingCycle: r.billing_cycle === 'yearly' ? 'yearly' : 'monthly',
    status: r.status as SubStatus,
    currentPeriodEnd: r.current_period_end ? new Date(r.current_period_end as string) : null,
    renewalsCount: Number(r.renewals_count),
    meta: (r.meta as Record<string, unknown> | null) ?? {},
  };
}
