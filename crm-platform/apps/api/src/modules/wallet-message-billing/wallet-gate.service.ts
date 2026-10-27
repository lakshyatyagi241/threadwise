import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES } from '@crm/contracts';
import { getRuntimeMonitor, type Counter } from '@crm/observability';
import { PlanEntitlementService, resolveLimit } from '../plans-subscriptions-trials';
import { BillingModeService } from '../bsp-billing-engine';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { countryOfPhone } from './phone-country';
import { BillingCurrencyService } from './billing-currency.service';
import { RateCardService } from './rate-card.service';
import { WalletLogService } from './wallet-log.service';
import { WalletRepository } from './wallet.repository';
import { WalletSettingsService } from './wallet-settings.service';
import { UsageBillingService } from './usage-billing.service';
import {
  isChargedLaunch,
  launchVerdict,
  monthStart,
  planIsActive,
  type LaunchFacts,
} from './wallet-rules';

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

/**
 * How long a send's hold lasts when its delivery report never comes (a message accepted by the provider and then lost). Reports
 * normally arrive within minutes; a hold that outlives its delivery only makes the balance look smaller until it lapses.
 */
export const WALLET_HOLD_TTL_SECONDS = 10 * 60;

const EMPTY_MESSAGE = 'Your message wallet is empty. Top up to start sending.';
const INSUFFICIENT_MESSAGE =
  "Your wallet balance doesn't cover this send. Top up to start sending.";

/**
 * The launch-time wallet precheck for bulk sends (TW-WALLET-013). Because charging happens after delivery, an empty wallet could
 * otherwise blast a whole campaign for free; broadcasts, campaigns and scheduled batches call `assertCanLaunch` before they
 * create a single row.
 *
 * Kept from Reference: platform-owned workspaces pass; a workspace still inside its plan's free monthly messages passes with an empty
 * wallet; a refusal is written to the workspace's wallet log. A failure to LOOK UP the wallet fails differently by kind: a single send
 * lets through (fail open, logged) because a billing read must not stop a one-off message; a bulk launch is refused with a retryable
 * 503, since it would otherwise run unchecked (#1067).
 * Changed: Reference computed an estimate and never compared it (a wallet of 1 credit launched 50,000 recipients). Here the balance
 * must cover `launchCoveragePercent` of the estimated cost (platform setting, default 100; 0 restores "block only when empty").
 */
@Injectable()
export class WalletGateService {
  private readonly logger = new Logger(WalletGateService.name);
  private unchecked?: Counter;

  /** Counts a bulk launch refused because the wallet balance could not be read. Nothing is counted before the monitor starts. */
  private countUncheckedRefusal(source: string): void {
    const monitor = getRuntimeMonitor();
    if (!monitor) return;
    this.unchecked ??= monitor.metrics.counter(
      'crm_wallet_launch_unchecked_refusals_total',
      'Bulk launches refused because the wallet balance could not be read, by source',
    );
    this.unchecked.inc(1, { source });
  }

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WalletRepository,
    private readonly rates: RateCardService,
    private readonly billing: BillingCurrencyService,
    private readonly settings: WalletSettingsService,
    private readonly plans: PlanEntitlementService,
    private readonly mode: BillingModeService,
    private readonly log: WalletLogService,
    private readonly usage: UsageBillingService,
  ) {}

  /**
   * The per-message check of a bulk run, called before EVERY recipient (the launch gate alone lets a long run, or several campaigns
   * started on the same balance, keep sending after the wallet is spent). Same rules as the launch gate for one message: platform
   * workspaces, a free price and the plan's free allowance pass without a hold. On the balance path the message's price is held
   * (`holdMinor`) before the send is allowed, so concurrent sends queue on the wallet row and cannot all pass one balance (#1066).
   * Throws 422 `WALLET_EMPTY`; a failure to look anything up, or to take the hold, lets the send through, like the launch gate.
   */
  async assertCanSend(req: SendRequest): Promise<void> {
    const launch: LaunchRequest = {
      orgId: req.orgId,
      source: req.source,
      recipients: 1,
      ...(req.to ? { phones: [req.to] } : {}),
      category: req.category ?? null,
      silent: true,
      freeAllowed: true,
    };
    let judged: Awaited<ReturnType<WalletGateService['evaluate']>>;
    try {
      judged = await this.evaluate(launch);
    } catch (err) {
      this.logger.warn(
        { err, orgId: req.orgId },
        '[WALLET] send precheck failed, the send is allowed',
      );
      return;
    }
    if (!judged) return;
    if (!judged.verdict.ok) this.refuse(judged.verdict.reason, judged);
    if (!judged.charged || judged.estimateMinor === null || judged.estimateMinor <= 0) return;

    const estimateMinor = judged.estimateMinor;
    let held: number | null;
    try {
      held = await this.db.retry.txAs({ orgId: req.orgId, userId: null }, (tx) =>
        this.repo.holdMinor(tx, req.orgId, judged.currency, estimateMinor, WALLET_HOLD_TTL_SECONDS),
      );
    } catch (err) {
      this.logger.warn({ err, orgId: req.orgId }, '[WALLET] send hold failed, the send is allowed');
      return;
    }
    if (held === null) this.refuse('insufficient', judged);
  }

  /** Throws 422 `WALLET_EMPTY` for a refused send, with the shortfall in `details`. */
  private refuse(
    reason: 'empty' | 'insufficient',
    judged: { balanceMinor: number; estimateMinor: number | null },
  ): never {
    throw new AppError(
      ERROR_CODES.WALLET_EMPTY,
      reason === 'empty' ? EMPTY_MESSAGE : INSUFFICIENT_MESSAGE,
      HttpStatus.UNPROCESSABLE_ENTITY,
      [
        { path: 'reason', message: reason },
        { path: 'balanceMinor', message: String(judged.balanceMinor) },
        { path: 'estimateMinor', message: String(judged.estimateMinor ?? 0) },
      ],
    );
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
      // A bulk launch must not go ahead unchecked (owner decision, #1067): the caller gets a retryable 503 and tries again.
      this.logger.warn(
        { err, orgId: req.orgId },
        '[WALLET] launch precheck failed, the launch is refused',
      );
      this.countUncheckedRefusal(req.source);
      throw new AppError(
        ERROR_CODES.SERVICE_UNAVAILABLE,
        'Your wallet could not be checked just now. Try again in a moment.',
        HttpStatus.SERVICE_UNAVAILABLE,
        undefined,
        true,
      );
    }
    if (verdict.ok) return;

    const message = verdict.reason === 'empty' ? EMPTY_MESSAGE : INSUFFICIENT_MESSAGE;
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
   * The launch check of an SMS or email run (TW-WALLET-013): the balance must cover one message per recipient at the operator's SMS or
   * email price, before any row exists (422 `WALLET_EMPTY` otherwise). These are priced by usage billing, not by the WhatsApp card that
   * `assertCanLaunch` reads. One segment per SMS is assumed here (a lower bound); the SMS engine checks each message again before it
   * leaves. A failed lookup lets the launch through, like the other gates. Nothing to send (0 recipients) passes.
   */
  async assertCanLaunchUsage(
    orgId: number,
    kind: 'sms' | 'email',
    recipients: number,
  ): Promise<void> {
    if (recipients <= 0) return;
    await this.usage.assertCanAfford(orgId, kind, recipients);
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
    /** Whether the send is paid from the wallet (a hold is needed) rather than passing free. */
    charged: boolean;
  } | null> {
    const entitlements = await this.plans.forOrg(req.orgId);
    if (!entitlements) return null;
    const s = await this.settings.effective();
    const now = new Date();
    const facts = await this.db.txAs({ orgId: req.orgId, userId: null }, async (tx) => {
      // The balance and the estimate are both in the workspace's billing currency.
      const unit = await this.billing.forOrg(tx, req.orgId);
      const wallet = await this.repo.peekWallet(tx, req.orgId, unit);
      const payPerMessage = await this.mode.isPayPerMessage(tx, req.orgId);
      const used = await tx.execute(sql`
        SELECT messages FROM wallet_usage_months WHERE org_id = ${req.orgId} AND month = ${monthStart(now)}::date`);
      const usedThisMonth = Number(
        (used.rows[0] as { messages: number } | undefined)?.messages ?? 0,
      );
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
        prices,
        currency: unit,
        payPerMessage,
        usedThisMonth,
      };
    });
    const balanceMinor = facts.balance;

    // Recipients beyond the plan's monthly allowance are charged: the allowance covers the first ones (launchVerdict).
    const price = (phone: string | null) =>
      facts.prices.get(phone ? countryOfPhone(phone) : null) ?? facts.prices.get(null) ?? 0;
    let estimateMinor: number | null = 0;
    if (req.recipients > 0) {
      if (req.phones && req.phones.length > 0) {
        // The first `recipients` numbers stand for the audience; for a mixed audience this is an upper-bound sample.
        const sample = req.phones.slice(0, req.recipients);
        const sum = sample.reduce((acc, p) => acc + price(p), 0);
        estimateMinor =
          sample.length >= req.recipients
            ? sum
            : sum + (req.recipients - sample.length) * price(null);
      } else {
        estimateMinor = req.recipients * price(null);
      }
    }

    const launchFacts: LaunchFacts = {
      platformOwned: entitlements.platformOwned,
      payPerMessage: facts.payPerMessage,
      planActive: planIsActive(entitlements, now),
      monthlyLimit: resolveLimit(entitlements, 'monthly_messages'),
      usedThisMonth: facts.usedThisMonth,
      recipients: req.recipients,
      balanceMinor,
      estimateMinor,
      coveragePercent: s.launchCoveragePercent,
      freeAllowed: req.freeAllowed === true,
    };
    return {
      verdict: launchVerdict(launchFacts),
      balanceMinor,
      estimateMinor,
      currency: facts.currency,
      charged: isChargedLaunch(launchFacts),
    };
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
