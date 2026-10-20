import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES } from '@crm/contracts';
import { resolveLimit, PlanEntitlementService } from '../plans-subscriptions-trials';
import { BillingModeService } from '../bsp-billing-engine';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { countryOfPhone } from './phone-country';
import { BillingCurrencyService } from './billing-currency.service';
import { RateCardService } from './rate-card.service';
import { WalletLogService } from './wallet-log.service';
import { WalletRepository } from './wallet.repository';
import { WalletSettingsService } from './wallet-settings.service';
import { launchVerdict, monthStart, planIsActive } from './wallet-rules';
import { cacheMetrics } from '@crm/observability';

const cache = cacheMetrics('wallet_send_ok');

export interface LaunchRequest {
  orgId: number;
  /** campaign | broadcast | scheduled: what is being launched, for the log. */
  source: string;
  recipients: number;
  /** The recipients' numbers when the caller has them, so the estimate follows each country's price. */
  phones?: readonly string[];
  /** Template category when known (marketing for a campaign). */
  category?: string | null;
  /** No wallet-log row for a refusal (the per-message check refuses once per message, the caller logs the stop). */
  silent?: boolean;
  /** A message whose price is 0 passes even with an empty wallet (the per-message check; a launch is refused on an empty wallet). */
  freeAllowed?: boolean;
}

export interface SendRequest {
  orgId: number;
  /** campaign | broadcast | scheduled | flow: what is sending, for the log. */
  source: string;
  /** The recipient's number: its country sets the price. */
  to?: string | null;
  /** Template category when known (marketing for a campaign). */
  category?: string | null;
}

/** An `ok` verdict is reused this long: the balance only moves when a delivery settles, so a loop does not re-read it per recipient. */
const SEND_OK_TTL_MS = 3_000;

const EMPTY_MESSAGE = 'Your message wallet is empty. Top up to start sending.';

/**
 * The launch-time wallet precheck for bulk sends (TW-WALLET-013). Because charging happens after delivery, an empty wallet could
 * otherwise blast a whole campaign for free; broadcasts, campaigns and scheduled batches call `assertCanLaunch` before they
 * create a single row.
 *
 * Kept from Reference: platform-owned workspaces pass; a workspace still inside its plan's free monthly messages passes with an empty
 * wallet; a refusal is written to the workspace's wallet log; a failure to LOOK UP any of this lets the send through (fail open,
 * logged as a warning) because a billing read must never be the reason a legitimate send stops.
 * Changed: Reference computed an estimate and never compared it (a wallet of 1 credit launched 50,000 recipients). Here the balance
 * must cover `launchCoveragePercent` of the estimated cost (platform setting, default 100; 0 restores "block only when empty").
 */
@Injectable()
export class WalletGateService {
  private readonly logger = new Logger(WalletGateService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WalletRepository,
    private readonly rates: RateCardService,
    private readonly billing: BillingCurrencyService,
    private readonly settings: WalletSettingsService,
    private readonly plans: PlanEntitlementService,
    private readonly mode: BillingModeService,
    private readonly log: WalletLogService,
  ) {}

  private readonly sendOk = new Map<string, number>();

  /**
   * The per-message check of a bulk run, called before EVERY recipient (the launch gate alone lets a long run, or several campaigns
   * started on the same balance, keep sending after the wallet is spent). Same rules as the launch gate for one message: platform
   * workspaces, a free price and the plan's free allowance pass; otherwise the balance must cover this message's price.
   * Throws 422 `WALLET_EMPTY`; a failure to look anything up lets the send through, like the launch gate.
   */
  async assertCanSend(req: SendRequest): Promise<void> {
    const country = req.to ? countryOfPhone(req.to) : null;
    const key = `${req.orgId}|${country ?? ''}|${req.category ?? ''}`;
    const until = this.sendOk.get(key);
    if (until !== undefined && until > Date.now()) {
      cache.hit();
      return;
    }
    cache.miss();
    try {
      await this.assertCanLaunch({
        orgId: req.orgId,
        source: req.source,
        recipients: 1,
        ...(req.to ? { phones: [req.to] } : {}),
        category: req.category ?? null,
        silent: true,
        freeAllowed: true,
      });
    } catch (err) {
      this.sendOk.delete(key);
      throw err;
    }
    this.sendOk.set(key, Date.now() + SEND_OK_TTL_MS);
    if (this.sendOk.size > 500) this.sendOk.clear();
  }

  /** Throws 422 `WALLET_EMPTY` (with the shortfall in `details`) when the launch must not start; resolves otherwise. */
  async assertCanLaunch(req: LaunchRequest): Promise<void> {
    let verdict: ReturnType<typeof launchVerdict>;
    let balanceMinor = 0;
    let estimateMinor: number | null = null;
    try {
      const judged = await this.evaluate(req);
      if (!judged) return;
      ({ verdict, balanceMinor, estimateMinor } = judged);
    } catch (err) {
      this.logger.warn(
        { err, orgId: req.orgId },
        '[WALLET] launch precheck failed, the send is allowed',
      );
      return;
    }
    if (verdict.ok) return;

    const message =
      verdict.reason === 'empty'
        ? EMPTY_MESSAGE
        : "Your wallet balance doesn't cover this send. Top up to start sending.";
    if (!req.silent)
      await this.db
        .txAs({ orgId: req.orgId, userId: null }, (tx) =>
          this.log.event(tx, {
            orgId: req.orgId,
            event: 'wallet.launch.blocked',
            severity: 'warning',
            message: `${req.source} launch refused (${verdict.reason}) for ${req.recipients} recipients`,
            payload: {
              source: req.source,
              recipients: req.recipients,
              balanceMinor,
              estimateMinor,
              reason: verdict.reason,
            },
          }),
        )
        .catch((err: unknown) =>
          this.logger.warn({ err }, '[WALLET] could not log a refused launch'),
        );
    throw new AppError(ERROR_CODES.WALLET_EMPTY, message, HttpStatus.UNPROCESSABLE_ENTITY, [
      { path: 'reason', message: verdict.reason },
      { path: 'balanceMinor', message: String(balanceMinor) },
      { path: 'estimateMinor', message: String(estimateMinor ?? 0) },
    ]);
  }

  /**
   * What a send to `recipients` people would meet at the wallet right now: the verdict, the balance and the estimate (hundredths of the
   * workspace's billing currency). Null when the workspace is unknown. May throw (a billing read failed): the callers decide what that
   * means (the launch gate lets the send through, the composer's quote shows no estimate).
   */
  private async evaluate(req: LaunchRequest): Promise<{
    verdict: ReturnType<typeof launchVerdict>;
    balanceMinor: number;
    estimateMinor: number | null;
    currency: string;
  } | null> {
    const entitlements = await this.plans.forOrg(req.orgId);
    if (!entitlements) return null;
    const s = await this.settings.effective();
    const now = new Date();
    const facts = await this.db.txAs({ orgId: req.orgId, userId: null }, async (tx) => {
      // The balance and the estimate are both in the workspace's billing currency.
      const unit = await this.billing.forOrg(tx, req.orgId);
      const wallet = await this.repo.peekWallet(tx, req.orgId, unit);
      const used = await tx.execute(sql`
        SELECT messages FROM wallet_usage_months WHERE org_id = ${req.orgId} AND month = ${monthStart(now)}::date`);
      const payPerMessage = await this.mode.isPayPerMessage(tx, req.orgId);
      // One price per destination country, by the resolver that charges a delivered message (margins, Meta's card for this
      // currency and fixed prices included), so the estimate is the price it will really be charged at.
      const prices = new Map<string | null, number>();
      const countries = new Set<string | null>([null]);
      for (const phone of req.phones ?? []) countries.add(countryOfPhone(phone));
      for (const country of countries) {
        const priced = await this.rates.priceFor(
          tx,
          req.orgId,
          country,
          req.category ?? 'marketing',
          unit,
        );
        prices.set(country, priced.priceMinor);
      }
      return {
        balance: wallet?.balanceMinor ?? 0,
        usedThisMonth: Number((used.rows[0] as { messages?: number } | undefined)?.messages ?? 0),
        payPerMessage,
        prices,
        currency: unit,
      };
    });
    const balanceMinor = facts.balance;
    const monthlyLimit = resolveLimit(entitlements, 'monthly_messages');
    const planActive = planIsActive(entitlements, now);

    // Plan mode pays only for what exceeds the allowance.
    let estimateMinor: number | null = null;
    let chargeable: number;
    if (facts.payPerMessage || !planActive) chargeable = req.recipients;
    else if (monthlyLimit <= 0) chargeable = 0;
    else chargeable = Math.max(0, facts.usedThisMonth + req.recipients - monthlyLimit);
    const price = (phone: string | null) =>
      facts.prices.get(phone ? countryOfPhone(phone) : null) ?? facts.prices.get(null) ?? 0;
    if (chargeable > 0) {
      if (req.phones && req.phones.length > 0) {
        // The first `chargeable` numbers stand for the chargeable part; for a mixed audience this is an upper-bound sample.
        const sample = req.phones.slice(0, chargeable);
        const sum = sample.reduce((acc, p) => acc + price(p), 0);
        estimateMinor =
          sample.length >= chargeable ? sum : sum + (chargeable - sample.length) * price(null);
      } else {
        estimateMinor = chargeable * price(null);
      }
    } else {
      estimateMinor = 0;
    }

    const verdict = launchVerdict({
      platformOwned: entitlements.platformOwned,
      payPerMessage: facts.payPerMessage,
      planActive,
      monthlyLimit,
      usedThisMonth: facts.usedThisMonth,
      recipients: req.recipients,
      balanceMinor,
      estimateMinor,
      coveragePercent: s.launchCoveragePercent,
      freeAllowed: req.freeAllowed === true,
    });
    return { verdict, balanceMinor, estimateMinor, currency: facts.currency };
  }

  /**
   * The composer's view of a send, never throwing: the estimate, the currency and whether the wallet covers it. Null when it cannot be
   * worked out (unknown workspace, a billing read failed): the composer then shows no figure and the send is judged by `assertCanLaunch`.
   */
  async quote(
    req: LaunchRequest,
  ): Promise<{ estimateMinor: number | null; currency: string; covered: boolean } | null> {
    try {
      const judged = await this.evaluate(req);
      if (!judged) return null;
      return {
        estimateMinor: judged.estimateMinor,
        currency: judged.currency,
        covered: judged.verdict.ok,
      };
    } catch (err) {
      this.logger.warn({ err, orgId: req.orgId }, '[WALLET] send quote failed');
      return null;
    }
  }
}
