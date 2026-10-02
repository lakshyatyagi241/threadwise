import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { WalletDeliveryProvider } from '@crm/contracts';
import { PlanEntitlementService, resolveLimit } from '../plans-subscriptions-trials';
import { BillingModeService } from '../bsp-billing-engine';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { RateCardService } from './rate-card.service';
import { WalletLedgerService } from './wallet-ledger.service';
import { WalletLogService } from './wallet-log.service';
import { WalletRepository } from './wallet.repository';
import { WalletSettingsService } from './wallet-settings.service';
import {
  CHANNEL_LABELS,
  decideSettlement,
  monthStart,
  planIsActive,
  shouldAlertLowBalance,
} from './wallet-rules';

export interface SettleDelivered {
  orgId: number;
  provider: WalletDeliveryProvider;
  providerMessageId: string;
  recipient?: string | null;
  category?: string | null;
  source?: string | null;
}

export type SettleOutcome =
  | { status: 'skipped'; reason: 'invalid_input' | 'platform_owned' | 'unknown_workspace' }
  | { status: 'replayed'; chargeStatus: 'free' | 'charged' | 'refunded' }
  | { status: 'free'; reason: string; shortfallMinor: number }
  | { status: 'charged'; chargedMinor: number; shortfallMinor: number; balanceAfterMinor: number };

const NO_ORG = 0;

/**
 * Where money moves for messages (TW-WALLET-009, -010, -011): the single choke point that prices a delivered message, decides
 * free or charged, takes the money and writes the per-message ledger, exactly once per provider message id.
 *
 * The order inside one tenant transaction is the whole design:
 *   1. claim the message id (`usage_charge_keys`, UNIQUE per workspace). A second report of the same id stops here, so a
 *      sent -> delivered -> read sequence, a duplicate webhook and two engines reporting one SID all charge once.
 *   2. take the wallet row lock. Concurrent messages of one workspace queue here, so the balance cannot be overspent and the
 *      monthly quota below is read under the lock (Reference counted without one and could over-grant free messages).
 *   3. count the message against the month, price it, decide, post to the ledger, write the charge row, close the claim.
 * Any failure rolls the whole thing back, claim included, so the event is retried instead of lost. Nothing here is called from a
 * request: a channel emits `message.delivery_reported` and the worker's subscriber calls this.
 */
@Injectable()
export class MessageBillingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WalletRepository,
    private readonly ledger: WalletLedgerService,
    private readonly rates: RateCardService,
    private readonly settings: WalletSettingsService,
    private readonly plans: PlanEntitlementService,
    private readonly mode: BillingModeService,
    private readonly log: WalletLogService,
    private readonly outbox: OutboxService,
  ) {}

  async settleDelivered(input: SettleDelivered): Promise<SettleOutcome> {
    const wamid = input.providerMessageId.trim();
    if (!wamid || input.orgId <= NO_ORG) return { status: 'skipped', reason: 'invalid_input' };

    const entitlements = await this.plans.forOrg(input.orgId);
    if (!entitlements) return { status: 'skipped', reason: 'unknown_workspace' };
    // The platform's own workspaces are never billed, in any mode, and nothing is recorded for them.
    if (entitlements.platformOwned) {
      this.log.line(
        'info',
        'wallet.charge.skipped',
        { orgId: input.orgId, wamid },
        'platform-owned workspace is not billed',
      );
      return { status: 'skipped', reason: 'platform_owned' };
    }
    const monthlyLimit = resolveLimit(entitlements, 'monthly_messages');
    const now = new Date();
    const planActive = planIsActive(entitlements, now);
    const s = await this.settings.effective();
    const category = (input.category ?? '').trim().toLowerCase() || null;
    const source = (input.source ?? '').trim().toLowerCase() || null;

    const outcome = await this.db.txAs({ orgId: input.orgId, userId: null }, async (tx) => {
      // 1. claim
      const claim = await tx.execute(sql`
        INSERT INTO usage_charge_keys (org_id, provider_message_id) VALUES (${input.orgId}, ${wamid})
        ON CONFLICT (org_id, provider_message_id) DO NOTHING RETURNING id`);
      if (claim.rows.length === 0) {
        const seen = await tx.execute(sql`
          SELECT status FROM usage_charge_keys WHERE org_id = ${input.orgId} AND provider_message_id = ${wamid}`);
        const st =
          (seen.rows[0] as { status: 'free' | 'charged' | 'refunded' } | undefined)?.status ??
          'charged';
        return { status: 'replayed', chargeStatus: st } as const;
      }
      const keyId = Number((claim.rows[0] as { id: string | number }).id);

      // 2. lock
      const wallet = await this.repo.lockWallet(tx, input.orgId, s.currency);
      const payPerMessage = await this.mode.isPayPerMessage(tx, input.orgId);

      // 3. count, price, decide
      const month = monthStart(now);
      const counted = await tx.execute(sql`
        INSERT INTO wallet_usage_months (org_id, month, messages) VALUES (${input.orgId}, ${month}::date, 1)
        ON CONFLICT (org_id, month) DO UPDATE SET messages = wallet_usage_months.messages + 1
        RETURNING messages`);
      const usedBefore = Number((counted.rows[0] as { messages: number }).messages) - 1;

      const priced = await this.rates.price(tx, input.recipient, category);
      const decision = decideSettlement({
        priceMinor: priced.priceMinor,
        balanceMinor: wallet.balanceMinor,
        payPerMessage,
        planActive,
        monthlyLimit,
        usedBefore,
      });
      const costMinor = this.rates.costMinor(priced.metaCostMicros);

      let status: 'free' | 'charged' = 'free';
      let chargedMinor = 0;
      let shortfallMinor = 0;
      let freeReason: string | null = null;
      let txRowId: number | null = null;
      let balanceAfter = wallet.balanceMinor;

      if (decision.outcome === 'charge') {
        const label = ['WhatsApp message', priced.country, category].filter(Boolean).join(' · ');
        const posted = await this.ledger.post(tx, {
          orgId: input.orgId,
          unit: s.currency,
          type: 'spend',
          direction: 'out',
          amountMinor: decision.chargedMinor,
          idempotencyKey: `charge:${wamid}`,
          source: 'message.sent',
          description: label,
          meta: {
            wamid,
            provider: input.provider,
            source,
            moneyMinor: decision.chargedMinor,
            costMinor,
          },
          allowPartial: true,
        });
        status = 'charged';
        chargedMinor = posted.appliedMinor;
        shortfallMinor = decision.shortfallMinor + (decision.chargedMinor - posted.appliedMinor);
        txRowId = posted.transactionRowId;
        balanceAfter = posted.balanceAfterMinor;
      } else {
        freeReason = decision.reason;
        shortfallMinor = decision.shortfallMinor;
      }

      const row = await tx.execute(sql`
        INSERT INTO usage_charges
          (org_id, provider, wamid, to_country, category, source, credits, revenue_minor, cost_minor, cost_micros, status,
           wallet_tx_id, meta, price_credits, shortfall_credits, billing_mode, free_reason)
        VALUES (${input.orgId}, ${input.provider}, ${wamid}, ${priced.country}, ${category}, ${source}, ${chargedMinor},
                ${chargedMinor}, ${costMinor}, ${priced.metaCostMicros}, ${status}, ${txRowId},
                ${JSON.stringify({ matched: priced.matched })}, ${priced.priceMinor}, ${shortfallMinor},
                ${payPerMessage ? 'wallet' : 'plan'}, ${freeReason})
        RETURNING id, created_at::text AS created_at`);
      // Carried as TEXT: a JS Date keeps milliseconds, the partition key has microseconds, and the refund must find this exact row.
      const charge = row.rows[0] as { id: string | number; created_at: string };
      await tx.execute(sql`
        UPDATE usage_charge_keys SET charge_id = ${Number(charge.id)}, charge_created_at = ${charge.created_at}::timestamptz,
          status = ${status}
        WHERE org_id = ${input.orgId} AND id = ${keyId}`);

      // Exceptions that need a human; the routine charge is the usage_charges row itself.
      if (status === 'charged' && shortfallMinor > 0) {
        await this.log.event(tx, {
          orgId: input.orgId,
          event: 'wallet.charge.partial',
          severity: 'warning',
          message: `Charged ${chargedMinor} of ${priced.priceMinor} (balance ran out); ${shortfallMinor} not collected`,
          subjectType: 'usage_charge',
          subjectId: Number(charge.id),
          payload: { wamid, priceMinor: priced.priceMinor, chargedMinor, shortfallMinor },
        });
      } else if (freeReason === 'wallet_empty') {
        await this.log.event(tx, {
          orgId: input.orgId,
          event: 'wallet.charge.unbilled',
          severity: 'warning',
          message: `Message delivered with an empty wallet; ${priced.priceMinor} not collected`,
          subjectType: 'usage_charge',
          subjectId: Number(charge.id),
          payload: { wamid, priceMinor: priced.priceMinor, source },
        });
      } else {
        this.log.line(
          'info',
          'wallet.charge.settled',
          {
            orgId: input.orgId,
            wamid,
            status,
            chargedMinor,
            freeReason,
            source: source ? (CHANNEL_LABELS[source] ?? source) : null,
          },
          'message settled',
        );
      }

      // 4. low balance: after a charge, and after a message that found the wallet empty.
      if (
        (status === 'charged' || freeReason === 'wallet_empty') &&
        shouldAlertLowBalance(
          balanceAfter,
          s.lowBalanceThresholdMinor,
          wallet.lowBalanceAlertedAt,
          now,
        )
      ) {
        await this.raiseLowBalance(
          tx,
          input.orgId,
          wallet.id,
          balanceAfter,
          s.lowBalanceThresholdMinor,
          now,
        );
      }

      return status === 'charged'
        ? ({
            status: 'charged',
            chargedMinor,
            shortfallMinor,
            balanceAfterMinor: balanceAfter,
          } as const)
        : ({ status: 'free', reason: freeReason ?? 'rate_is_zero', shortfallMinor } as const);
    });
    return outcome;
  }

  /** The provider later reports the message failed: the exact charge goes back, once (TW-WALLET-011). */
  async settleFailed(
    orgId: number,
    providerMessageId: string,
  ): Promise<{ refunded: boolean; refundedMinor: number }> {
    const wamid = providerMessageId.trim();
    if (!wamid || orgId <= NO_ORG) return { refunded: false, refundedMinor: 0 };
    const s = await this.settings.effective();
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const found = await tx.execute(sql`
        SELECT id, charge_id, charge_created_at::text AS charge_created_at, status FROM usage_charge_keys
        WHERE org_id = ${orgId} AND provider_message_id = ${wamid} FOR UPDATE`);
      const key = found.rows[0] as
        | {
            id: string | number;
            charge_id: string | number | null;
            charge_created_at: string | null;
            status: string;
          }
        | undefined;
      // Never charged (the failure came first), free, or already refunded: nothing to reverse.
      if (!key || key.status !== 'charged' || key.charge_id === null || !key.charge_created_at) {
        return { refunded: false, refundedMinor: 0 };
      }
      const chargeId = Number(key.charge_id);
      const chargeAt = key.charge_created_at;
      const ch = await tx.execute(sql`
        SELECT credits, wamid FROM usage_charges
        WHERE org_id = ${orgId} AND id = ${chargeId} AND created_at = ${chargeAt}::timestamptz FOR UPDATE`);
      const charge = ch.rows[0] as { credits: number; wamid: string } | undefined;
      if (!charge) return { refunded: false, refundedMinor: 0 };

      let refundTx: number | null = null;
      if (charge.credits > 0) {
        const posted = await this.ledger.post(tx, {
          orgId,
          unit: s.currency,
          type: 'refund',
          direction: 'in',
          amountMinor: charge.credits,
          idempotencyKey: `refund:${chargeId}`,
          source: 'message.refund',
          description: 'Refund - message not delivered',
          subject: { type: 'usage_charge', id: chargeId },
          meta: { wamid, moneyMinor: charge.credits },
        });
        refundTx = posted.transactionRowId;
      }
      await tx.execute(sql`
        UPDATE usage_charges SET status = 'refunded', refunded_at = now(), refund_tx_id = ${refundTx}
        WHERE org_id = ${orgId} AND id = ${chargeId} AND created_at = ${chargeAt}::timestamptz`);
      await tx.execute(
        sql`UPDATE usage_charge_keys SET status = 'refunded' WHERE org_id = ${orgId} AND id = ${Number(key.id)}`,
      );
      await this.log.event(tx, {
        orgId,
        event: 'wallet.charge.refunded',
        message: `Refunded ${charge.credits} for an undelivered message`,
        subjectType: 'usage_charge',
        subjectId: chargeId,
        payload: { wamid, refundedMinor: charge.credits },
      });
      return { refunded: true, refundedMinor: charge.credits };
    });
  }

  private async raiseLowBalance(
    tx: Tx,
    orgId: number,
    walletId: number,
    balanceMinor: number,
    thresholdMinor: number,
    now: Date,
  ): Promise<void> {
    await this.repo.markAlerted(tx, orgId, walletId, now);
    await this.outbox.emit(tx, {
      orgId,
      aggregateModule: 'wallets',
      aggregateId: walletId,
      eventType: 'wallet.low_balance',
      payload: { balanceMinor, thresholdMinor },
    });
    await this.log.event(tx, {
      orgId,
      event: 'wallet.low_balance.alerted',
      severity: 'warning',
      message: `Balance ${balanceMinor} is at or under the alert threshold ${thresholdMinor}`,
      subjectType: 'wallet',
      subjectId: walletId,
      payload: { balanceMinor, thresholdMinor },
    });
  }
}
