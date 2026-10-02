/**
 * Stand-ins for what other domains own. Each is an interface here and a default in `open-gates.ts`; when the owner exports the
 * real service, bind it to the same token in `shopify-woocommerce.module.ts` and delete the default.
 */

export type StoreKind = 'shopify' | 'woocommerce';

/** The plan features `integration_shopify` and `integration_woocommerce` (plans-subscriptions-trials). */
export interface EcomPlanGate {
  /** Throws a PLAN_FEATURE_LOCKED problem when the plan does not include the integration. */
  assertIntegration(orgId: number, kind: StoreKind): Promise<void>;
}
export const ECOM_PLAN_GATE = Symbol('ECOM_PLAN_GATE');
