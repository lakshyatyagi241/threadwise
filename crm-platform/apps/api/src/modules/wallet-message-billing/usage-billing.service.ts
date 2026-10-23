import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES, type WalletReportedKind, type WalletUsageReported } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { BillingModeService } from '../bsp-billing-engine';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { BillingCurrencyService } from './billing-currency.service';
import { MessageBillingService } from './message-billing.service';
import { countryOfPhone } from './phone-country';
import { UsageSettingsService } from './usage-settings.service';
import {
  USAGE_KIND_LABELS,
  freeReasonOf,
  priceUsage,
  usageStatementLabel,
  type UsagePrice,
} from './usage-rules';
import { WalletLedgerService } from './wallet-ledger.service';
import { WalletLogService } from './wallet-log.service';
import { WalletRepository } from './wallet.repository';

/** One usage to settle: the parsed `usage.reported` event plus the workspace it belongs to. */
export type SettleUsage = WalletUsageReported & { orgId: number };

export type UsageOutcome =
  | { status: 'skipped'; reason: 'invalid_input' | 'platform_owned' | 'unknown_workspace' }
  | { status: 'replayed'; chargeStatus: 'free' | 'charged' | 'refunded' }
  | { status: 'free'; reason: string; shortfallMinor: number }
  | { status: 'charged'; chargedMinor: number; shortfallMinor: number; balanceAfterMinor: number };

const NO_ORG = 0;

/** What a refund of each kind says on the statement. */
const REFUND_TEXT: Record<WalletReportedKind, string> = {
  sms: 'Refund - SMS not delivered',
  email: 'Refund - email not sent',
  whatsapp_call: 'Refund - call not connected',
  voice_call: 'Refund - call not connected',
  ai: 'Refund - AI call failed',
  translation: 'Refund - translation failed',
  enrichment: 'Refund - lookup failed',
  chat_message: 'Refund - message not delivered',
};

/**
 * Where money moves for everything that is not a WhatsApp message: SMS, email, WhatsApp and voice calls, AI, translation, contact
 * lookups and the other chat channels. It is the sibling of `MessageBillingService.settleDelivered` and keeps its design:
 *   1. claim `<kind>:<usage id>` in `usage_charge_keys` (UNIQUE per workspace), so a usage reported twice charges once;
 *   2. take the wallet row lock, so concurrent usages of one workspace queue and the balance cannot be overspent;
 *   3. price it, post the spend to the ledger, write the customer's expense row (`usage_charges`) and close the claim.
 * Any failure rolls the whole thing back, claim included, so the report is retried instead of lost. A wallet that cannot cover the
 * whole price pays what it has (the work already happened) and the rest is written to the wallet log as a shortfall.
 */
@Injectable()
export class UsageBillingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WalletRepository,
    private readonly ledger: WalletLedgerService,
    private readonly billing: BillingCurrencyService,
    private readonly rates: UsageSettingsService,
    private readonly plans: PlanEntitlementService,
    private readonly mode: BillingModeService,
    private readonly log: WalletLogService,
    private readonly messages: MessageBillingService,
  ) {}

  /** Settles one usage in its own tenant transaction (the worker's path). */
  async settle(input: SettleUsage): Promise<UsageOutcome> {
    const pre = await this.precheck(input);
    if (pre) return pre;
    return this.db.txAs({ orgId: input.orgId, userId: null }, (tx) => this.charge(tx, input));
  }

  /** Settles one usage inside the caller's transaction (an AI call charged with the row it produced). Same rules as `settle`. */
  async settleIn(tx: Tx, input: SettleUsage): Promise<UsageOutcome> {
    const pre = await this.precheck(input);
    if (pre) return pre;
    return this.charge(tx, input);
  }

  private async charge(tx: Tx, input: SettleUsage): Promise<UsageOutcome> {
    const usageId = input.usageId.trim();
    const key = `${input.kind}:${usageId}`;
    const orgId = input.orgId;
    const rates = await this.rates.rates();
    const label = usageStatementLabel(input.kind, input.label, countryOfPhone(input.recipient));
    const source = (input.source ?? '').trim().toLowerCase() || null;
    const subjectName = (input.subjectName ?? '').trim() || null;

    const claim = await tx.execute(sql`
      INSERT INTO usage_charge_keys (org_id, provider_message_id) VALUES (${orgId}, ${key})
      ON CONFLICT (org_id, provider_message_id) DO NOTHING RETURNING id`);
    if (claim.rows.length === 0) {
      const seen = await tx.execute(sql`
        SELECT status FROM usage_charge_keys WHERE org_id = ${orgId} AND provider_message_id = ${key}`);
      const st =
        (seen.rows[0] as { status: 'free' | 'charged' | 'refunded' } | undefined)?.status ??
        'charged';
      return { status: 'replayed', chargeStatus: st };
    }
    const keyId = Number((claim.rows[0] as { id: string | number }).id);

    const currency = await this.billing.forOrg(tx, orgId);
    const wallet = await this.repo.lockWallet(tx, orgId, currency);
    const payPerMessage = await this.mode.isPayPerMessage(tx, orgId);

    const price = priceUsage(rates, {
      kind: input.kind,
      units: input.units,
      vendorCostUsd: input.vendorCostUsd ?? null,
    });
    const priceMinor = await this.priceInCurrency(price, currency);

    let status: 'free' | 'charged' = 'free';
    let chargedMinor = 0;
    let shortfallMinor = 0;
    let freeReason: string | null = null;
    let txRowId: number | null = null;
    let balanceAfter = wallet.balanceMinor;

    if (price.basis === 'none') {
      freeReason = freeReasonOf(price);
    } else if (wallet.balanceMinor <= 0) {
      freeReason = 'wallet_empty';
      shortfallMinor = priceMinor;
    } else {
      const wanted = Math.min(priceMinor, wallet.balanceMinor);
      const posted = await this.ledger.post(tx, {
        orgId,
        unit: currency,
        type: 'spend',
        direction: 'out',
        amountMinor: wanted,
        idempotencyKey: `charge:${key}`,
        source: `usage.${input.kind}`,
        description: label,
        meta: {
          usageId,
          kind: input.kind,
          units: input.units,
          provider: input.provider ?? null,
          source,
          moneyMinor: wanted,
          ...(price.basis === 'cost_plus'
            ? { vendorCostUsd: price.costUsd, markupBps: price.markupBps }
            : { unitMinor: price.unitMinor }),
        },
        allowPartial: true,
      });
      status = 'charged';
      chargedMinor = posted.appliedMinor;
      shortfallMinor = priceMinor - posted.appliedMinor;
      txRowId = posted.transactionRowId;
      balanceAfter = posted.balanceAfterMinor;
    }

    const row = await tx.execute(sql`
      INSERT INTO usage_charges
        (org_id, provider, wamid, to_country, source, credits, revenue_minor, status, wallet_tx_id, meta, price_credits,
         shortfall_credits, billing_mode, free_reason, currency, template_name, subject_name, kind, units)
      VALUES (${orgId}, ${input.provider ?? null}, ${usageId}, ${countryOfPhone(input.recipient)}, ${source}, ${chargedMinor},
              ${chargedMinor}, ${status}, ${txRowId},
              ${JSON.stringify({ basis: price.basis, ...(price.basis === 'none' ? { reason: price.reason } : {}) })},
              ${priceMinor}, ${shortfallMinor}, ${payPerMessage ? 'wallet' : 'plan'}, ${freeReason}, ${currency}, ${null},
              ${subjectName ?? (input.label?.trim() || null)}, ${input.kind}, ${Math.max(0, Math.trunc(input.units))})
      RETURNING id, created_at::text AS created_at`);
    // Carried as TEXT: a JS Date keeps milliseconds, the partition key has microseconds, and the refund must find this exact row.
    const charge = row.rows[0] as { id: string | number; created_at: string };
    await tx.execute(sql`
      UPDATE usage_charge_keys SET charge_id = ${Number(charge.id)}, charge_created_at = ${charge.created_at}::timestamptz,
        status = ${status}
      WHERE org_id = ${orgId} AND id = ${keyId}`);

    if (status === 'charged' && shortfallMinor > 0) {
      await this.log.event(tx, {
        orgId,
        event: 'wallet.charge.partial',
        severity: 'warning',
        message: `${label}: charged ${chargedMinor} of ${priceMinor} (balance ran out); ${shortfallMinor} not collected`,
        subjectType: 'usage_charge',
        subjectId: Number(charge.id),
        payload: { kind: input.kind, usageId, priceMinor, chargedMinor, shortfallMinor },
      });
    } else if (freeReason === 'wallet_empty') {
      await this.log.event(tx, {
        orgId,
        event: 'wallet.charge.unbilled',
        severity: 'warning',
        message: `${label} used with an empty wallet; ${priceMinor} not collected`,
        subjectType: 'usage_charge',
        subjectId: Number(charge.id),
        payload: { kind: input.kind, usageId, priceMinor, source },
      });
    } else {
      this.log.line(
        'info',
        'wallet.usage.settled',
        { orgId, kind: input.kind, usageId, status, chargedMinor, freeReason },
        'usage settled',
      );
    }

    if (status === 'charged' || freeReason === 'wallet_empty') {
      await this.messages.alertIfLow(tx, orgId, wallet, balanceAfter, currency);
    }

    return status === 'charged'
      ? { status: 'charged', chargedMinor, shortfallMinor, balanceAfterMinor: balanceAfter }
      : { status: 'free', reason: freeReason ?? 'rate_is_zero', shortfallMinor };
  }

  /** The provider later says the usage failed (the SMS bounced, the call never connected): the exact charge goes back, once. */
  async settleFailed(orgId: number, kind: WalletReportedKind, usageId: string) {
    const id = usageId.trim();
    if (!id || orgId <= NO_ORG) return { refunded: false, refundedMinor: 0, balanceAfterMinor: 0 };
    return this.messages.settleFailed(orgId, `${kind}:${id}`, {
      description: REFUND_TEXT[kind],
      source: `usage.${kind}.refund`,
    });
  }

  /**
   * Refuses BEFORE the work is done when the wallet cannot pay for it: 422 `WALLET_EMPTY`. A free usage (price 0, switched off), a
   * platform-owned workspace and an unknown workspace pass. For a cost-plus kind the cost is unknown beforehand, so any positive balance
   * passes. A failure to look anything up lets the work through, like the message launch gate: billing trouble never blocks a customer.
   */
  async assertCanAfford(orgId: number, kind: WalletReportedKind, units = 1): Promise<void> {
    let need: { balance: number; priceMinor: number } | null;
    try {
      need = await this.balanceAndPrice(orgId, kind, units);
    } catch {
      return;
    }
    if (!need) return;
    if (need.balance < Math.max(1, need.priceMinor)) {
      throw new AppError(
        ERROR_CODES.WALLET_EMPTY,
        kind === 'ai'
          ? 'Your wallet balance is empty. Top up to use AI features.'
          : `Your wallet balance is too low for this ${USAGE_KIND_LABELS[kind].toLowerCase()}. Top up to continue.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'balanceMinor', message: String(need.balance) }],
      );
    }
  }

  /** Null when nothing needs checking (platform-owned, unknown workspace, a free usage). */
  private async balanceAndPrice(
    orgId: number,
    kind: WalletReportedKind,
    units: number,
  ): Promise<{ balance: number; priceMinor: number } | null> {
    const entitlements = await this.plans.forOrg(orgId);
    if (!entitlements || entitlements.platformOwned) return null;
    const rates = await this.rates.rates();
    // A cost-plus kind has no price until the vendor answers: ask for any positive balance with a stand-in cost.
    const price = priceUsage(rates, { kind, units, vendorCostUsd: 0.000001 });
    if (price.basis === 'none') return null;
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const unit = await this.billing.forOrg(tx, orgId);
      const balance = (await this.repo.peekWallet(tx, orgId, unit))?.balanceMinor ?? 0;
      return {
        balance,
        priceMinor: price.basis === 'unit' ? await this.priceInCurrency(price, unit) : 1,
      };
    });
  }

  /** Why a usage is not settled at all: no workspace, or the platform's own. Null = go on. */
  private async precheck(input: SettleUsage): Promise<UsageOutcome | null> {
    if (!input.usageId.trim() || input.orgId <= NO_ORG) {
      return { status: 'skipped', reason: 'invalid_input' };
    }
    const entitlements = await this.plans.forOrg(input.orgId);
    if (!entitlements) return { status: 'skipped', reason: 'unknown_workspace' };
    // The platform's own workspaces are never billed, in any mode, and nothing is recorded for them.
    if (entitlements.platformOwned) {
      this.log.line(
        'info',
        'wallet.usage.skipped',
        { orgId: input.orgId, kind: input.kind, usageId: input.usageId },
        'platform-owned workspace is not billed',
      );
      return { status: 'skipped', reason: 'platform_owned' };
    }
    return null;
  }

  /** The price in hundredths of the workspace's billing currency; a real price never rounds down to 0. */
  private async priceInCurrency(price: UsagePrice, currency: string): Promise<number> {
    if (price.basis === 'unit') {
      return Math.max(1, await this.billing.fromPlatform(price.platformMinor, currency));
    }
    if (price.basis === 'cost_plus') return this.billing.fromUsd(price.chargeUsd, currency);
    return 0;
  }
}
