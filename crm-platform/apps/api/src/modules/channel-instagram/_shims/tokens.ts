/**
 * Stand-ins for what other domains own. Each is an interface here and a default in `open-gates.ts`; when the owner exports the
 * real service, bind it to the same token in `channel-instagram.module.ts` and delete the default.
 */

/** The plan flag `access_instagram` (plans-subscriptions-trials). */
export interface InstagramPlanGate {
  /** Throws a PLAN_FEATURE_LOCKED problem when the plan does not include the Instagram channel. */
  assertChannel(orgId: number): Promise<void>;
}
export const INSTAGRAM_PLAN_GATE = Symbol('INSTAGRAM_PLAN_GATE');
