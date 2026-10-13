import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { BillingCurrencyService } from './billing-currency.service';
import { WalletLedgerService } from './wallet-ledger.service';
import { WalletLogService } from './wallet-log.service';
import { WalletRepository } from './wallet.repository';
import { AI_MARKUP_BPS, aiChargeUsd } from './wallet-rules';

export interface AiChargeInput {
  orgId: number;
  /** What the money was spent on, shown on the statement: `AI lead scoring`. */
  label: string;
  /** What the vendor charged, in US dollars. */
  costUsd: number;
  /** Ledger `source`, e.g. `ai.lead_scoring`. */
  source: string;
}

const EMPTY_MESSAGE = 'Your wallet balance is empty. Top up to use AI features.';

/**
 * AI features that run on the platform's own vendor key are paid from the workspace wallet (a workspace on its own key pays its vendor
 * directly and is never charged here). `assertCanAfford` refuses BEFORE the vendor is called, so an empty wallet cannot spend the
 * platform's money; `charge` takes the vendor's real cost afterwards, inside the caller's transaction, converted into the workspace's
 * billing currency. The platform's own workspaces are never charged. A wallet that cannot cover the whole cost pays what it has
 * (the call already happened) and the shortfall is written to the wallet log.
 */
@Injectable()
export class AiChargeService {
  private readonly logger = new Logger(AiChargeService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WalletRepository,
    private readonly ledger: WalletLedgerService,
    private readonly billing: BillingCurrencyService,
    private readonly plans: PlanEntitlementService,
    private readonly log: WalletLogService,
  ) {}

  /** Throws 422 `WALLET_EMPTY` when the wallet cannot pay for even the smallest charge. */
  async assertCanAfford(orgId: number): Promise<void> {
    const entitlements = await this.plans.forOrg(orgId);
    if (!entitlements || entitlements.platformOwned) return;
    const balance = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const unit = await this.billing.forOrg(tx, orgId);
      return (await this.repo.peekWallet(tx, orgId, unit))?.balanceMinor ?? 0;
    });
    if (balance <= 0) {
      throw new AppError(ERROR_CODES.WALLET_EMPTY, EMPTY_MESSAGE, HttpStatus.UNPROCESSABLE_ENTITY, [
        { path: 'balanceMinor', message: String(balance) },
      ]);
    }
  }

  /** Takes the cost of one AI call inside `tx`. Returns the amount taken (hundredths of the workspace's billing currency). */
  async charge(tx: Tx, input: AiChargeInput, idempotencyKey: string): Promise<number> {
    if (!(input.costUsd > 0)) return 0;
    const entitlements = await this.plans.forOrg(input.orgId);
    if (!entitlements || entitlements.platformOwned) return 0;
    const unit = await this.billing.forOrg(tx, input.orgId);
    const wantedMinor = await this.billing.fromUsd(aiChargeUsd(input.costUsd), unit);
    const posted = await this.ledger.post(tx, {
      orgId: input.orgId,
      unit,
      type: 'spend',
      direction: 'out',
      amountMinor: wantedMinor,
      idempotencyKey,
      source: input.source,
      description: input.label,
      meta: { costUsd: input.costUsd, markupBps: AI_MARKUP_BPS, moneyMinor: wantedMinor },
      allowPartial: true,
    });
    if (posted.appliedMinor < wantedMinor) {
      await this.log.event(tx, {
        orgId: input.orgId,
        event: 'wallet.ai_charge.partial',
        severity: 'warning',
        message: `${input.label}: charged ${posted.appliedMinor} of ${wantedMinor} (balance ran out)`,
        payload: { source: input.source, wantedMinor, appliedMinor: posted.appliedMinor },
      });
    }
    return posted.appliedMinor;
  }
}
