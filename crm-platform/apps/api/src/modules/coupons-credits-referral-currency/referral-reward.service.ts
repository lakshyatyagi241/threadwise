import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { REFERRAL_PAYOUT_SOURCE, REFERRAL_REWARDED_EVENT, REFERRAL_SUBJECT } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { WalletLedgerService, WalletSettingsService } from '../wallet-message-billing';
import { CpnStore } from './cpn-store';
import { recordReferralAudit } from './referral-audit';

export type RewardOutcome =
  | { status: 'paid'; amountMinor: number; walletTransactionId: string }
  | { status: 'no_referral' }
  | { status: 'reward_disabled' };

/**
 * The referrer's reward on the referee's first paid order (WD-CPN-033). Triggered by `paygw.order.paid` for the workspace that
 * just paid, so it never runs inside checkout: a failure here is retried by the outbox and cannot fail a payment.
 *
 * Money is moved once, by construction, in three layers: the referral row is locked FOR UPDATE and only an unpaid one qualifies
 * (WaDesk read it unlocked, so two orders finalising together could both pay); the ledger posting carries the idempotency key
 * `referral:<id>`; and the paid stamp is written in the same transaction as the credit.
 */
@Injectable()
export class ReferralRewardService {
  constructor(
    private readonly store: CpnStore,
    private readonly ledger: WalletLedgerService,
    private readonly settings: WalletSettingsService,
    private readonly outbox: OutboxService,
  ) {}

  /** `orgId` is the workspace that paid (the referee's). */
  async rewardFirstPayment(orgId: number): Promise<RewardOutcome> {
    // Read before the transaction: a zero reward leaves the referral unpaid and must not even take the row lock.
    const { referralSignupMinor, currency } = await this.settings.effective();
    if (referralSignupMinor <= 0) return { status: 'reward_disabled' };

    return this.store.tx((tx) => this.rewardIn(tx, orgId, referralSignupMinor, currency));
  }

  private async rewardIn(
    tx: Tx,
    refereeOrgId: number,
    amountMinor: number,
    currency: string,
  ): Promise<RewardOutcome> {
    // The oldest unpaid referral of the paying workspace. A concurrent second event blocks here until the first commits, then
    // re-evaluates the WHERE: the row is paid by then and drops out, so exactly one of them proceeds.
    const found = await tx.execute(sql`
      SELECT id, uuid, referrer_org_id, referrer_user_id, referred_org_id, code_used
      FROM referrals
      WHERE referred_org_id = ${refereeOrgId} AND award_transaction_id IS NULL
      ORDER BY created_at, id
      LIMIT 1
      FOR UPDATE`);
    const r = found.rows[0] as unknown as
      | {
          id: string | number;
          uuid: string;
          referrer_org_id: string | number;
          referrer_user_id: string | number;
          referred_org_id: string | number;
          code_used: string;
        }
      | undefined;
    if (!r) return { status: 'no_referral' };

    const referralId = Number(r.id);
    const referrerOrgId = Number(r.referrer_org_id);
    const referrerUserId = Number(r.referrer_user_id);

    const posted = await this.ledger.post(tx, {
      orgId: referrerOrgId,
      unit: currency,
      type: 'earn',
      direction: 'in',
      amountMinor,
      idempotencyKey: `referral:${referralId}`,
      source: REFERRAL_PAYOUT_SOURCE,
      // No referee name or email: the statement is read by everyone who can read the referrer's wallet.
      description: `Referral reward: a workspace you referred made its first payment (code ${r.code_used})`,
      subject: { type: REFERRAL_SUBJECT, id: referralId },
      meta: { referralId: r.uuid, codeUsed: r.code_used },
      userId: referrerUserId,
      actor: { type: 'system' },
    });
    if (posted.transactionRowId === null || posted.transactionId === null) {
      // The ledger only returns no row for a partial debit; a credit always has one.
      throw new Error(`referral ${r.uuid}: the wallet credit produced no ledger entry`);
    }

    await tx.execute(sql`
      UPDATE referrals SET credits_awarded = ${posted.appliedMinor}, award_transaction_id = ${posted.transactionRowId}
      WHERE id = ${referralId}`);

    await recordReferralAudit(tx, {
      module: 'referrals',
      orgId: referrerOrgId,
      recordId: referralId,
      action: 'update',
      delta: {
        creditsAwarded: { old: 0, new: posted.appliedMinor },
        awardTransactionId: { old: null, new: posted.transactionRowId },
      },
    });
    await this.outbox.emit(tx, {
      orgId: referrerOrgId,
      aggregateModule: 'referrals',
      aggregateId: referralId,
      eventType: REFERRAL_REWARDED_EVENT,
      payload: {
        referralId: r.uuid,
        amountMinor: posted.appliedMinor,
        currency,
        walletTransactionId: posted.transactionId,
        replayed: posted.replayed,
      },
    });
    return {
      status: 'paid',
      amountMinor: posted.appliedMinor,
      walletTransactionId: posted.transactionId,
    };
  }
}
