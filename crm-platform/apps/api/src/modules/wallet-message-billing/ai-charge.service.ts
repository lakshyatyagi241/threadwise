import { Injectable, Logger } from '@nestjs/common';
import type { Tx } from '@crm/db';
import { aiCostUsd } from './ai-cost';
import { UsageBillingService } from './usage-billing.service';

export interface AiChargeInput {
  orgId: number;
  /** What the money was spent on, shown on the statement and in the expense log: `AI lead scoring`. */
  label: string;
  /** What the vendor charged, in US dollars. */
  costUsd: number;
  /** Where it came from, e.g. `ai.lead_scoring` (the `ai.` prefix is dropped on the expense row). */
  source: string;
  /** The vendor or model that answered, for the expense log. */
  provider?: string | null;
}

/**
 * AI features that run on the platform's own vendor key are paid from the workspace wallet (a workspace on its own key pays its vendor
 * directly and is never charged here). `assertCanAfford` refuses BEFORE the vendor is called, so an empty wallet cannot spend the
 * platform's money; `charge` takes the vendor's real cost plus the markup afterwards, converted into the workspace's billing currency,
 * and writes the customer's expense row. The platform's own workspaces are never charged. A wallet that cannot cover the whole cost
 * pays what it has (the call already happened) and the shortfall is written to the wallet log.
 *
 * It is the AI face of `UsageBillingService`: the price, the ledger posting and the expense row all live there.
 */
@Injectable()
export class AiChargeService {
  private readonly logger = new Logger(AiChargeService.name);

  constructor(private readonly usage: UsageBillingService) {}

  /** Throws 422 `WALLET_EMPTY` when the wallet cannot pay for even the smallest charge. */
  async assertCanAfford(orgId: number): Promise<void> {
    await this.usage.assertCanAfford(orgId, 'ai');
  }

  /**
   * The one line an AI call site adds BEFORE it calls a vendor: refuses (422 `WALLET_EMPTY`) when the platform's key would pay for the
   * call and the wallet cannot. A workspace on its own key, or no key at all, passes: the platform pays nothing there.
   */
  async guardCall(orgId: number, keySource: 'admin' | 'workspace' | 'none'): Promise<void> {
    if (keySource === 'admin') await this.assertCanAfford(orgId);
  }

  /**
   * The one line an AI call site adds AFTER the vendor answered: charges the call to the wallet when the platform's key paid for it.
   * The cost is the vendor's own figure when it gave one, else the model's price, else the provider's blended rate (see `aiCostUsd`).
   * `usageId` names this ONE call (a run id, a request id, a message id): charging it again takes nothing. Never throws.
   */
  async chargeCall(call: {
    orgId: number;
    keySource: 'admin' | 'workspace' | 'none';
    /** The feature, as the customer reads it: `AI lead scoring`. */
    label: string;
    /** Where it came from, short: `lead_scoring`, `inbox_ai`, `kb_embedding`. */
    source: string;
    usageId: string;
    provider: string;
    model?: string | null;
    promptTokens: number;
    completionTokens: number;
    /** The vendor's own cost for the call in US dollars, when it reports one (OpenRouter's `usage.cost`). */
    reportedCostUsd?: number | null;
  }): Promise<number> {
    if (call.keySource !== 'admin') return 0;
    const costUsd = aiCostUsd({
      provider: call.provider,
      model: call.model,
      promptTokens: call.promptTokens,
      completionTokens: call.completionTokens,
      reportedCostUsd: call.reportedCostUsd,
    });
    return this.chargeQuietly(
      {
        orgId: call.orgId,
        label: call.label,
        costUsd,
        source: call.source,
        provider: call.provider,
      },
      call.usageId,
    );
  }

  /**
   * Takes the cost of one AI call inside `tx`. `idempotencyKey` names the call: charging it again takes nothing. Returns the amount
   * taken (hundredths of the workspace's billing currency).
   */
  async charge(tx: Tx, input: AiChargeInput, idempotencyKey: string): Promise<number> {
    if (!(input.costUsd > 0)) return 0;
    const out = await this.usage.settleIn(tx, {
      orgId: input.orgId,
      kind: 'ai',
      usageId: idempotencyKey,
      status: 'used',
      units: 1,
      label: input.label,
      source: input.source.replace(/^ai\./, ''),
      provider: input.provider ?? null,
      vendorCostUsd: input.costUsd,
    });
    return out.status === 'charged' ? out.chargedMinor : 0;
  }

  /**
   * The same, in its own transaction, for a call site with no transaction of its own. Never throws: the vendor answer is already in
   * the caller's hands and a billing fault must not take it away. The fault is logged, and the next report of the same call retries.
   */
  async chargeQuietly(input: AiChargeInput, idempotencyKey: string): Promise<number> {
    if (!(input.costUsd > 0)) return 0;
    try {
      const out = await this.usage.settle({
        orgId: input.orgId,
        kind: 'ai',
        usageId: idempotencyKey,
        status: 'used',
        units: 1,
        label: input.label,
        source: input.source.replace(/^ai\./, ''),
        provider: input.provider ?? null,
        vendorCostUsd: input.costUsd,
      });
      return out.status === 'charged' ? out.chargedMinor : 0;
    } catch (err) {
      this.logger.error(
        { err, orgId: input.orgId, source: input.source },
        '[WALLET] could not charge an AI call',
      );
      return 0;
    }
  }
}
