import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  currencyExponent,
  type ErrorCode,
  type PaygwBilling,
  type PaygwQuote,
  type PaygwQuoteQuery,
  type PaygwWalletQuoteQuery,
  type PlaceOrderResponse,
  type PlacePlanOrderRequest,
  type PlaceWalletOrderRequest,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { BillingCurrencyService } from '../wallet-message-billing';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { AddonEntitlementService } from '../addons-extension-registry';
import type { DriverOrder, PaymentResult } from '../../infra/providers/platform-payment-gateways';
import { CheckoutSettingsService, type CheckoutSettings } from './checkout-settings.service';
import { CouponService, type CouponResolution } from './coupon.service';
import { FulfilmentService } from './fulfilment.service';
import { acceptsCurrency, availableCurrencies } from './gateway-rules';
import { GatewayService, type GatewayRow } from './gateway.service';
import { assertMarketplacePack } from './marketplace-pack';
import { recordOrderEvent } from './order-events';
import {
  billingPeriodFor,
  breakdown,
  convertMinor,
  majorToMinor,
  minorToMajor,
  newOrderNumber,
  yearlyMinor,
  type Breakdown,
  type PlanPricingFacts,
} from './order-pricing';
import { OrdersRepository, type OrderRow } from './orders.repository';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
import { planInterval, shouldRecur } from './subscription-rules';

interface PlanRow extends PlanPricingFacts {
  slug: string;
  name: string;
  subtitle: string | null;
  amount: string;
  offerAmount: string | null;
  currency: string;
  billingDuration: number;
  isActive: boolean;
}

interface Priced {
  kind: 'plan' | 'addon' | 'wallet_topup';
  itemName: string;
  itemSubtitle: string | null;
  period: 'monthly' | 'yearly';
  periods: Array<'monthly' | 'yearly'>;
  currency: string;
  available: string[];
  gateways: GatewayRow[];
  parts: Breakdown;
  walletCreditMinor: number | null;
  /** The wallet a top-up credits (the workspace's billing currency), fixed at order time; null for a plan. */
  walletUnit: string | null;
  planSlug: string | null;
  /** What a recurring checkout needs to know about the plan (null for wallet top-ups). */
  term: PlanTerm | null;
  /** The price before any coupon, period-adjusted, in `currency` (what a coupon is measured against). */
  subtotalMinor: bigint;
}

interface PlanTerm {
  name: string;
  unit: 'days' | 'weeks' | 'months' | 'years';
  duration: number;
  isFree: boolean;
  isLifetime: boolean;
  isCustomQuote: boolean;
  /** The plan's list amount, major units. */
  listAmount: string;
}

const unavailable = (message: string, code: ErrorCode = ERROR_CODES.PAYGW_GATEWAY_UNAVAILABLE) =>
  new AppError(code, message, HttpStatus.UNPROCESSABLE_ENTITY);

/**
 * Plan and wallet checkout for a workspace (WD-PAYGW-009, 011, 031). The quote and the order share ONE pricing function, so what
 * the buyer sees is what the server bills (WaDesk recomputed in two places and let the coupon preview drift).
 *
 * Order of operations for a purchase, and why:
 *   1. validate and price without writing anything (a bad gateway or currency must not leave an order behind);
 *   2. insert the pending order and its audit/outbox row, COMMIT;
 *   3. call the provider with no transaction open (a slow provider must never hold a database connection);
 *   4. record the outcome with a conditional update.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly gateways: GatewayService,
    private readonly settings: CheckoutSettingsService,
    private readonly orders: OrdersRepository,
    private readonly fulfilment: FulfilmentService,
    private readonly outbox: OutboxService,
    private readonly coupons: CouponService,
    private readonly subscriptions: SubscriptionLifecycleService,
    private readonly entitlements: AddonEntitlementService,
    private readonly billing: BillingCurrencyService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ---- reads ---------------------------------------------------------------------------------------------------------

  private async loadPlan(tx: Tx, slug: string): Promise<PlanRow> {
    const res = await tx.execute(sql`
      SELECT slug, name, subtitle, kind, amount::text AS amount, offer_amount::text AS offer_amount, currency, billing_unit,
             billing_duration, is_free, is_lifetime, is_custom_quote, is_active
      FROM plans WHERE slug = ${slug}`);
    const r = res.rows[0] as Record<string, unknown> | undefined;
    if (!r || !r.is_active) throw AppError.notFound('Plan', slug);
    return {
      slug: r.slug as string,
      name: r.name as string,
      subtitle: (r.subtitle as string | null) ?? null,
      kind: r.kind as 'plan' | 'addon',
      amount: r.amount as string,
      offerAmount: (r.offer_amount as string | null) ?? null,
      currency: r.currency as string,
      billingUnit: r.billing_unit as PlanRow['billingUnit'],
      billingDuration: Number(r.billing_duration),
      isFree: r.is_free as boolean,
      isLifetime: r.is_lifetime as boolean,
      isCustomQuote: r.is_custom_quote as boolean,
      isActive: true,
    };
  }

  private async rates(tx: Tx, fallbackCurrency: string) {
    const res = await tx.execute(
      sql`SELECT code, exchange_rate::text AS rate FROM currencies WHERE is_active ORDER BY code`,
    );
    const rows = res.rows as Array<{ code: string; rate: string }>;
    return {
      enabled: rows.length > 0 ? rows.map((r) => r.code.toUpperCase()) : [fallbackCurrency],
      rates: new Map(rows.map((r) => [r.code.toUpperCase(), r.rate] as const)),
    };
  }

  /** The reasons a plan cannot be bought online, checked identically by the quote and by the order. */
  private async assertPurchasable(
    tx: Tx,
    plan: PlanRow,
    rates: ReadonlyMap<string, string>,
  ): Promise<void> {
    if (plan.isFree || plan.isCustomQuote) {
      throw unavailable(
        plan.kind === 'addon'
          ? 'This add-on is not sold through checkout.'
          : 'This plan is not sold through checkout. Free plans are switched on the Plans page; custom quotes go through sales.',
        ERROR_CODES.PAYGW_PLAN_NOT_PURCHASABLE,
      );
    }
    if (plan.kind === 'addon') {
      // The add-on that sells a Marketplace app follows the Marketplace's rules instead (the app is on offer and paid, not already included
      // in the plan, not paid far ahead), and needs no paid plan: it is a subscription of its own, not a boost on top of one.
      const orgId = RequestContextStore.require().orgId;
      if (
        await assertMarketplacePack(tx, orgId, plan.slug, (key) =>
          this.entitlements.featureEnabled(orgId, key),
        )
      )
        return;
      // An add-on sits on top of an active paid plan (WD-ADD-033). WaDesk enforced this only in the view; a direct POST bypassed it.
      const base = await tx.execute(sql`
        SELECT p.is_free, p.is_custom_quote, s.plan_ends_at
        FROM organizations o
        LEFT JOIN plans p ON p.slug = o.plan AND p.kind = 'plan'
        LEFT JOIN org_plan_state s ON s.org_id = o.id
        WHERE o.id = ${RequestContextStore.require().orgId}`);
      const b = base.rows[0] as
        | { is_free: boolean | null; is_custom_quote: boolean | null; plan_ends_at: string | null }
        | undefined;
      const paidActive =
        b !== undefined &&
        b.is_free === false &&
        (b.plan_ends_at === null || new Date(b.plan_ends_at) > new Date());
      if (!paidActive) {
        throw unavailable(
          'Add-ons need an active paid plan. Choose or renew a plan first.',
          ERROR_CODES.PAYGW_PLAN_NOT_PURCHASABLE,
        );
      }
      return;
    }
    // Downgrade guard, server-side (WaDesk enforced it only on the page, so a direct POST bypassed it).
    const cur = await tx.execute(sql`
      SELECT p.slug, p.amount::text AS amount, p.currency, p.is_free, p.is_custom_quote
      FROM organizations o JOIN plans p ON p.slug = o.plan WHERE o.id = ${RequestContextStore.require().orgId}`);
    const c = cur.rows[0] as
      | {
          slug: string;
          amount: string;
          currency: string;
          is_free: boolean;
          is_custom_quote: boolean;
        }
      | undefined;
    if (c && c.slug !== plan.slug && !c.is_free && !c.is_custom_quote) {
      const currentMinor = majorToMinor(c.amount, c.currency);
      const targetMinor = majorToMinor(plan.amount, plan.currency);
      const comparable =
        currentMinor === null || targetMinor === null
          ? null
          : convertMinor(currentMinor, c.currency, plan.currency, rates);
      if (comparable !== null && targetMinor !== null && targetMinor < comparable) {
        throw unavailable(
          'Downgrades are not available online. Contact support to move to a lower plan.',
          ERROR_CODES.PAYGW_DOWNGRADE_NOT_ALLOWED,
        );
      }
    }
  }

  private chooseCurrency(
    requested: string | undefined,
    preferred: string,
    available: string[],
  ): { currency: string; list: string[] } {
    const wanted = requested && available.includes(requested) ? requested : preferred;
    return {
      currency: wanted,
      list: available.includes(wanted) ? available : [wanted, ...available],
    };
  }

  private async pricePlan(
    tx: Tx,
    planSlug: string,
    query: PaygwQuoteQuery,
    s: CheckoutSettings,
  ): Promise<Priced> {
    const plan = await this.loadPlan(tx, planSlug);
    const { enabled, rates } = await this.rates(tx, s.defaultCurrency);
    await this.assertPurchasable(tx, plan, rates);

    const active = await this.gateways.activeRows();
    const available = availableCurrencies(
      enabled,
      active.map((g) => g.supported_currencies),
    );
    const { currency, list } = this.chooseCurrency(query.currency, plan.currency, available);

    const chargeable = plan.offerAmount ?? plan.amount;
    const listMinor = majorToMinor(chargeable, plan.currency);
    const converted =
      listMinor === null ? null : convertMinor(listMinor, plan.currency, currency, rates);
    if (converted === null) {
      throw unavailable(
        `This plan cannot be priced in ${currency}.`,
        ERROR_CODES.PAYGW_CURRENCY_UNSUPPORTED,
      );
    }
    const period = billingPeriodFor(plan, query.period, s.yearlyToggleEnabled);
    // A natively yearly plan's price is already the yearly price; a monthly plan sold yearly is 12 months less the discount.
    const subtotal =
      period === 'yearly' && plan.billingUnit !== 'years'
        ? yearlyMinor(converted, s.yearlyDiscountPct)
        : converted;
    const parts = breakdown(subtotal, currency, 0n, s.taxEnabled ? s.taxRate : '0');
    return {
      kind: plan.kind === 'addon' ? 'addon' : 'plan',
      itemName: plan.name,
      itemSubtitle: plan.subtitle,
      period,
      periods: [
        ...(plan.billingUnit === 'years' ? [] : (['monthly'] as const)),
        ...(billingPeriodFor(plan, 'yearly', s.yearlyToggleEnabled) === 'yearly'
          ? (['yearly'] as const)
          : []),
      ],
      currency,
      available: list,
      gateways: active.filter((g) => acceptsCurrency(g.supported_currencies, currency)),
      parts,
      walletCreditMinor: null,
      walletUnit: null,
      planSlug: plan.slug,
      term: {
        name: plan.name,
        unit: plan.billingUnit,
        duration: plan.billingDuration,
        isFree: plan.isFree,
        isLifetime: plan.isLifetime,
        isCustomQuote: plan.isCustomQuote,
        listAmount: chargeable,
      },
      subtotalMinor: subtotal,
    };
  }

  private async priceWallet(
    tx: Tx,
    query: PaygwWalletQuoteQuery,
    s: CheckoutSettings,
  ): Promise<Priced> {
    // The wallet being topped up is the one in the workspace's billing currency (USD, INR, ...): the amount is entered in it, the
    // gateway charges it by default, and exactly that amount is credited. The platform default currency is only the fallback.
    const walletUnit = await this.billing.forOrg(tx, RequestContextStore.require().orgId);
    const base = walletUnit;
    const baseMinor = majorToMinor(query.amount, base);
    if (
      baseMinor === null ||
      baseMinor < 10n ** BigInt(currencyExponent(base)) /* at least 1.00 */
    ) {
      throw unavailable(
        `Enter an amount of at least 1 ${base} to add to your wallet.`,
        ERROR_CODES.PAYGW_AMOUNT_TOO_LOW,
      );
    }
    const { enabled, rates } = await this.rates(tx, base);
    const active = await this.gateways.activeRows();
    const available = availableCurrencies(
      enabled,
      active.map((g) => g.supported_currencies),
    );
    const { currency, list } = this.chooseCurrency(query.currency, base, available);
    const billed = convertMinor(baseMinor, base, currency, rates);
    const back = billed === null ? null : convertMinor(billed, currency, base, rates);
    if (billed === null || back === null) {
      throw unavailable(
        `Wallet top-ups cannot be priced in ${currency}.`,
        ERROR_CODES.PAYGW_CURRENCY_UNSUPPORTED,
      );
    }
    const parts = breakdown(billed, currency, 0n, s.taxEnabled ? s.taxRate : '0');
    // The grant is the PRE-tax amount in the wallet's own minor units (tax is not credited): 1 minor unit = 1 credit.
    return {
      kind: 'wallet_topup',
      itemName: 'Wallet top-up',
      itemSubtitle: null,
      period: 'monthly',
      periods: ['monthly'],
      currency,
      available: list,
      gateways: active.filter((g) => acceptsCurrency(g.supported_currencies, currency)),
      parts,
      walletCreditMinor: Number(back),
      walletUnit,
      planSlug: null,
      term: null,
      subtotalMinor: billed,
    };
  }

  private driverCanRecur(g: GatewayRow): boolean {
    const d = this.gateways.driverFor(g);
    return d.supportsRecurring?.() === true && !!d.createSubscription;
  }

  private toQuote(p: Priced, s: CheckoutSettings, coupon: CouponResolution | null): PaygwQuote {
    return {
      kind: p.kind,
      itemName: p.itemName,
      itemSubtitle: p.itemSubtitle,
      billingPeriod: p.period,
      periods: p.periods,
      currency: p.currency,
      availableCurrencies: p.available,
      subtotal: p.parts.subtotal,
      discount: p.parts.discount,
      taxRate: s.taxEnabled ? s.taxRate : '0',
      taxLabel: s.taxLabel,
      tax: p.parts.tax,
      total: p.parts.total,
      walletCreditMinor: p.walletCreditMinor,
      gateways: p.gateways.map((g) => ({
        id: g.uuid,
        name: g.name,
        description: g.description ?? '',
        mode: g.mode,
        autoRenew:
          p.kind === 'plan' &&
          p.term !== null &&
          shouldRecur({
            platformEnabled: s.recurringEnabled,
            driverSupports: this.driverCanRecur(g),
            isFree: p.term.isFree,
            isLifetime: p.term.isLifetime,
            isCustomQuote: p.term.isCustomQuote,
            planAmount: p.term.listAmount,
            autoRenew: true,
            period: p.period,
          }),
      })),
      coupon: coupon
        ? {
            code: coupon.code,
            ok: coupon.ok,
            message: coupon.message,
            discount: minorToMajor(coupon.discountMinor, p.currency),
          }
        : null,
      countries: s.countries,
      refund: { enabled: s.refundEnabled, days: s.refundDays },
    };
  }

  /**
   * Measures a coupon against the priced item and rebuilds the breakdown with the discount (before tax). Done outside the tenant
   * transaction: coupons are operator-only data read through the module's privileged store. A refused coupon leaves the price
   * as it was and carries the reason. Wallet top-ups take no coupon (WaDesk disables the field there).
   */
  private async withCoupon(
    p: Priced,
    code: string | undefined,
    s: CheckoutSettings,
  ): Promise<{ priced: Priced; coupon: CouponResolution | null }> {
    if (!code?.trim() || p.kind === 'wallet_topup') return { priced: p, coupon: null };
    const ctx = RequestContextStore.require();
    const coupon = await this.coupons.resolve({
      code,
      planSlug: p.planSlug,
      subtotalMinor: p.subtotalMinor,
      currency: p.currency,
      orgId: ctx.orgId,
      userId: ctx.userId ?? null,
    });
    if (!coupon.ok) return { priced: p, coupon };
    return {
      priced: {
        ...p,
        parts: breakdown(
          p.subtotalMinor,
          p.currency,
          coupon.discountMinor,
          s.taxEnabled ? s.taxRate : '0',
        ),
      },
      coupon,
    };
  }

  async quotePlan(planSlug: string, query: PaygwQuoteQuery): Promise<PaygwQuote> {
    const s = await this.settings.load();
    const base = await this.db.tx((tx) => this.pricePlan(tx, planSlug, query, s));
    const { priced, coupon } = await this.withCoupon(base, query.coupon, s);
    return this.toQuote(priced, s, coupon);
  }

  async quoteWallet(query: PaygwWalletQuoteQuery): Promise<PaygwQuote> {
    const s = await this.settings.load();
    const priced = await this.db.tx((tx) => this.priceWallet(tx, query, s));
    return this.toQuote(priced, s, null);
  }

  // ---- placing an order ----------------------------------------------------------------------------------------------

  placePlanOrder(
    planSlug: string,
    req: PlacePlanOrderRequest,
    idempotencyKey?: string,
  ): Promise<PlaceOrderResponse> {
    return this.place(
      (tx, s) => this.pricePlan(tx, planSlug, { currency: req.currency, period: req.period }, s),
      req.gatewayId,
      req.billing,
      req.coupon,
      idempotencyKey,
      req.autoRenew === true,
    );
  }

  placeWalletOrder(
    req: PlaceWalletOrderRequest,
    idempotencyKey?: string,
  ): Promise<PlaceOrderResponse> {
    return this.place(
      (tx, s) => this.priceWallet(tx, { amount: req.amount, currency: req.currency }, s),
      req.gatewayId,
      req.billing,
      undefined,
      idempotencyKey,
    );
  }

  private async place(
    price: (tx: Tx, s: CheckoutSettings) => Promise<Priced>,
    gatewayUuid: string,
    billing: PaygwBilling,
    coupon: string | undefined,
    idempotencyKey: string | undefined,
    autoRenew = false,
  ): Promise<PlaceOrderResponse> {
    const ctx = RequestContextStore.require();
    if (!ctx.userId) throw AppError.unauthenticated();
    const s = await this.settings.load();

    // 1. validate + price, no writes. The gateway check precedes creation: an inactive gateway leaves no order behind.
    const gateway = await this.gateways.byUuid(gatewayUuid);
    if (!gateway || !gateway.is_active)
      throw unavailable('That gateway is not currently available.');
    const { unpriced, user } = await this.db.tx(async (tx) => {
      const p = await price(tx, s);
      const u = await tx.execute(
        sql`SELECT full_name, email::text AS email FROM users WHERE org_id = ${ctx.orgId} AND id = ${ctx.userId}`,
      );
      return { unpriced: p, user: u.rows[0] as { full_name: string; email: string } | undefined };
    });
    // The coupon is judged again here, authoritatively (the preview was advisory): a refused code stops the purchase instead of
    // silently charging full price for a code the buyer typed.
    const { priced, coupon: resolved } = await this.withCoupon(unpriced, coupon, s);
    if (resolved && !resolved.ok) {
      throw new AppError(
        ERROR_CODES.PAYGW_COUPON_REJECTED,
        resolved.message,
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'coupon', message: resolved.message }],
      );
    }
    if (!acceptsCurrency(gateway.supported_currencies, priced.currency)) {
      throw unavailable(
        `${gateway.name} does not support ${priced.currency}.`,
        ERROR_CODES.PAYGW_CURRENCY_UNSUPPORTED,
      );
    }

    // Recurring (WD-PAYGW-012 rule 1): the driver decides whether it can, the plan and the buyer whether it should.
    const driver = this.gateways.driverFor(gateway);
    const t = priced.term;
    const recurring =
      t !== null &&
      priced.kind === 'plan' &&
      shouldRecur({
        platformEnabled: s.recurringEnabled,
        driverSupports: driver.supportsRecurring?.() === true && !!driver.createSubscription,
        isFree: t.isFree,
        isLifetime: t.isLifetime,
        isCustomQuote: t.isCustomQuote,
        planAmount: t.listAmount,
        autoRenew,
        period: priced.period,
      });

    // 2. the pending order, with its audit row and outbox event, committed before the provider is called.
    const order = await this.insertOrder(
      ctx.orgId,
      ctx.userId,
      gateway,
      priced,
      billing,
      user,
      s,
      idempotencyKey,
      resolved,
      recurring,
    );

    // 3. the provider, outside any transaction.
    const driverOrder: DriverOrder = {
      orderNumber: order.orderNumber,
      amountMinor: priced.parts.totalMinor,
      amountMajor: priced.parts.total,
      currency: priced.currency,
      description: priced.itemName,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      planName: priced.itemName,
      ...(recurring && t
        ? {
            recurring: (({ interval, count }) => ({ interval, count }))(
              planInterval(t.unit, t.duration),
            ),
          }
        : {}),
    };
    const base = this.config.get('APP_URL', { infer: true });
    const urls = {
      returnUrl: `${base}/v2/payments/return/${gateway.slug}?o=${order.returnToken}`,
      notifyUrl: `${base}/v2/payments/webhook/${gateway.slug}`,
    };
    let result: PaymentResult;
    try {
      result = recurring
        ? await driver.createSubscription!(driverOrder, urls)
        : await driver.initiate(driverOrder, urls);
    } catch (e) {
      result = {
        status: 'failed',
        error: `exception: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200),
      };
    }

    // 4. the outcome.
    if (result.status === 'paid') {
      await this.fulfilment.fulfil(order, {
        gatewayPaymentId: result.gatewayPaymentId,
        payload: result.payload,
      });
      return { orderNumber: order.orderNumber, orderId: order.uuid, next: { type: 'paid' } };
    }
    if (
      result.status === 'failed' ||
      (!result.redirectUrl && !result.clientAction && !result.formPost && !result.instructions)
    ) {
      const reason = result.error ?? 'provider_returned_nothing_usable';
      await this.db.tx(async (tx) => {
        if (
          await this.orders.markUnpaid(tx, order.orgId, order.id, 'failed', reason, result.payload)
        ) {
          await recordOrderEvent(tx, this.outbox, order, 'failed', { reason });
        }
      });
      this.logger.warn(
        { order: order.orderNumber, gateway: gateway.slug, reason },
        'payment could not be started',
      );
      throw new AppError(
        ERROR_CODES.PAYGW_PROVIDER_ERROR,
        'Payment provider error. Try again or pick a different gateway.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    await this.db.tx((tx) =>
      this.orders.setProviderInfo(tx, order.orgId, order.id, result.gatewayOrderId, result.payload),
    );
    if (recurring) {
      // WD-PAYGW-012 rule 4: failing to record the row never fails the payment (renewals just cannot be matched later).
      try {
        const p = result.payload ?? {};
        const id = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
        await this.subscriptions.recordPending(order, gateway.slug, {
          gatewaySubscriptionId: id(p.gateway_subscription_id) ?? id(p.subscription),
          gatewayPlanId: id(p.gateway_plan_id),
          gatewayCustomerId: id(p.gateway_customer_id) ?? id(p.customer),
        });
      } catch (err) {
        this.logger.error(
          { err, order: order.orderNumber },
          'recording the pending subscription failed',
        );
      }
    }
    if (result.instructions) {
      return {
        orderNumber: order.orderNumber,
        orderId: order.uuid,
        next: {
          type: 'instructions',
          kind: result.instructions.kind,
          rows: result.instructions.rows,
          notes: result.instructions.notes,
          amount: priced.parts.total,
          currency: priced.currency,
        },
      };
    }
    if (result.formPost) {
      return {
        orderNumber: order.orderNumber,
        orderId: order.uuid,
        next: { type: 'form_post', url: result.formPost.url, fields: result.formPost.fields },
      };
    }
    if (result.clientAction) {
      return {
        orderNumber: order.orderNumber,
        orderId: order.uuid,
        next: {
          type: 'client_action',
          provider: result.clientAction.provider,
          params: result.clientAction.params,
        },
      };
    }
    return {
      orderNumber: order.orderNumber,
      orderId: order.uuid,
      next: { type: 'redirect', url: result.redirectUrl! },
    };
  }

  private async insertOrder(
    orgId: number,
    userId: number,
    gateway: GatewayRow,
    p: Priced,
    b: PaygwBilling,
    user: { full_name: string; email: string } | undefined,
    s: CheckoutSettings,
    idempotencyKey: string | undefined,
    coupon: CouponResolution | null,
    autoRenew: boolean,
  ): Promise<OrderRow> {
    const orgName = await this.db.tx(async (tx) => {
      const r = await tx.execute(sql`SELECT name FROM organizations WHERE id = ${orgId}`);
      return (r.rows[0] as { name: string } | undefined)?.name ?? null;
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      const orderNumber = newOrderNumber(new Date(), (n) =>
        Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join(''),
      );
      try {
        return await this.db.tx(async (tx) => {
          const order = await this.orders.insert(tx, {
            orgId,
            userId,
            orderNumber,
            kind: p.kind,
            planSlug: p.planSlug,
            billingPeriod: p.period,
            autoRenew,
            gatewayId: Number(gateway.id),
            gatewaySlug: gateway.slug,
            currency: p.currency,
            amount: p.parts.total,
            discountAmount: p.parts.discount,
            taxRate: s.taxEnabled ? s.taxRate : '0',
            taxAmount: p.parts.tax,
            totalAmount: p.parts.total,
            customerName: b.customerName ?? user?.full_name ?? null,
            customerEmail: b.customerEmail ?? user?.email ?? null,
            billingCompany: b.company ?? orgName,
            billingAddress: b.address ?? null,
            billingCity: b.city ?? null,
            billingPostal: b.postal ?? null,
            billingCountry: b.country ?? null,
            billingTaxId: b.taxId ?? null,
            walletTopupMinor: p.walletCreditMinor,
            walletUnit: p.walletUnit,
            idempotencyKey: idempotencyKey ?? null,
            couponId: coupon?.ok ? coupon.couponId : null,
            couponCode: coupon?.ok ? coupon.code : null,
          });
          await recordOrderEvent(tx, this.outbox, order, 'created', { gateway: gateway.slug });
          return order;
        });
      } catch (err) {
        const e = err as { code?: string; constraint?: string };
        if (e.code === '23505' && e.constraint === 'uq_orders_order_number') continue;
        if (e.code === '23505' && e.constraint === 'uq_orders_idempotency_key') {
          throw new AppError(
            ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
            'An order with this Idempotency-Key already exists.',
            HttpStatus.CONFLICT,
          );
        }
        throw err;
      }
    }
    throw new AppError(
      ERROR_CODES.INTERNAL,
      'Could not allocate an order number.',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
