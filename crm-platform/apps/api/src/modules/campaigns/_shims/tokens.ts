import type { Tx } from '@crm/db';

/**
 * Stand-ins for what other domains own. Each is an interface here and a default in `open-gates.ts`; when the owner exports the
 * real service, bind it to the same token in `campaigns.module.ts` and delete the default. The sending kit (sender and template
 * directories, engine senders, pacing, warmer and wallet gates) is shared with broadcasts and reached through its public surface.
 */

/** The plan flag `campaign` and the cap `total_campaigns_limit` (plans-subscriptions-trials). */
export interface CampaignPlanGate {
  /** Throws a PLAN_FEATURE_LOCKED problem when the plan has no campaigns. */
  assertEnabled(orgId: number): Promise<void>;
  /**
   * The cap on an increment-only ledger: `created` is how many campaigns this organization ever made, so delete and recreate
   * does not reopen it. Throws PLAN_LIMIT_REACHED. `live` is the number that exist now, for a ledger that is not there yet.
   */
  assertWithinCap(orgId: number, live: number): Promise<void>;
}
export const CAMPAIGN_PLAN_GATE = Symbol('CAMPAIGN_PLAN_GATE');

export interface BilledSend {
  orgId: number;
  /** The recipient's number, digits: the country sets the rate. */
  to: string;
  /** Sends of this month already counted against the plan. */
  usedThisMonth: number;
}

/**
 * Plan-first billing (wallet-message-billing): a send is free under the plan's monthly messages and costs one wallet credit after.
 * `consume` throws `PlanLimitReached` when the cap is reached and the wallet is empty; `settle` is the delivery side.
 */
export interface CampaignBilling {
  /** Resolves false when the plan cap is reached and the wallet is empty: nothing may be sent. */
  consume(send: BilledSend): Promise<boolean>;
  settleDelivered(orgId: number, providerMessageId: string, to: string | null): Promise<void>;
  settleFailed(orgId: number, providerMessageId: string): Promise<void>;
}
export const CAMPAIGN_BILLING = Symbol('CAMPAIGN_BILLING');

/** Starts one flow session per recipient (flow-runtime-engine). Flow campaigns are blocked until it exists. */
export interface CampaignFlowStarter {
  /** True when the runtime can start flows at all. */
  readonly available: boolean;
  start(
    tx: Tx,
    orgId: number,
    input: { flowId: number; contactId: number; campaignId: number; variant: string | null },
  ): Promise<{ ok: boolean; error: string | null }>;
}
export const CAMPAIGN_FLOW_STARTER = Symbol('CAMPAIGN_FLOW_STARTER');

/** Platform settings the sender reads (platform-settings-branding-storage): `campaign_retry_attempts` and the others. */
export interface CampaignSettings {
  retryAttempts: number;
  retryBackoffSec: number;
  autoExpiryEnabled: boolean;
  defaultExpiryHours: number;
}
export interface CampaignSettingsSource {
  get(tx: Tx, orgId: number): Promise<CampaignSettings>;
}
export const CAMPAIGN_SETTINGS = Symbol('CAMPAIGN_SETTINGS');
