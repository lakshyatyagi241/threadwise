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
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import type { DriverOrder, PaymentResult } from '../../infra/providers/platform-payment-gateways';
import { CheckoutSettingsService, type CheckoutSettings } from './checkout-settings.service';
import { FulfilmentService } from './fulfilment.service';
import { acceptsCurrency, availableCurrencies } from './gateway-rules';
import { GatewayService, type GatewayRow } from './gateway.service';
import { recordOrderEvent } from './order-events';
import {
  billingPeriodFor,
  breakdown,
  convertMinor,
  majorToMinor,
  newOrderNumber,
  yearlyMinor,
  type Breakdown,
  type PlanPricingFacts,
} from './order-pricing';
import { OrdersRepository, type OrderRow } from './orders.repository';

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
  kind: 'plan' | 'wallet_topup';
  itemName: string;
  itemSubtitle: string | null;
  period: 'monthly' | 'yearly';
  periods: Array<'monthly' | 'yearly'>;
  currency: string;
  available: string[];
  gateways: GatewayRow[];
  parts: Breakdown;
  walletCreditMinor: number | null;
  planSlug: string | null;
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
    if (plan.kind !== 'plan') {
      throw unavailable('Add-ons are not purchasable yet.', ERROR_CODES.PAYGW_PLAN_NOT_PURCHASABLE);
    }
    if (plan.isFree || plan.isCustomQuote) {
      throw unavailable(
        'This plan is not sold through checkout. Free plans are switched on the Plans page; custom quotes go through sales.',
        ERROR_CODES.PAYGW_PLAN_NOT_PURCHASABLE,
      );
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
      kind: 'plan',
      itemName: plan.name,
      itemSubtitle: plan.subtitle,
      period,
      periods: [
        ...(plan.billingUnit === 'years' ? [] : (['monthly'] as const)),
        ...(billingPeriodFor(plan, 'yearly', s.yearlyToggleEnabled) === 'yearly' ? (['yearly'] as const) : []),
      ],
      currency,
      available: list,
      gateways: active.filter((g) => acceptsCurrency(g.supported_currencies, currency)),
      parts,
      walletCreditMinor: null,
      planSlug: plan.slug,
    };
  }

  private async priceWallet(
    tx: Tx,
    query: PaygwWalletQuoteQuery,
    s: CheckoutSettings,
  ): Promise<Priced> {
    const base = s.defaultCurrency;
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
    // The grant is the PRE-tax amount in platform-currency minor units (tax is not credited): 1 minor unit = 1 credit.
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
      planSlug: null,
    };
  }

  private toQuote(p: Priced, s: CheckoutSettings): PaygwQuote {
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
      })),
    };
  }

  async quotePlan(planSlug: string, query: PaygwQuoteQuery): Promise<PaygwQuote> {
    const s = await this.settings.load();
    const priced = await this.db.tx((tx) => this.pricePlan(tx, planSlug, query, s));
    return this.toQuote(priced, s);
  }

  async quoteWallet(query: PaygwWalletQuoteQuery): Promise<PaygwQuote> {
    const s = await this.settings.load();
    const priced = await this.db.tx((tx) => this.priceWallet(tx, query, s));
    return this.toQuote(priced, s);
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
  ): Promise<PlaceOrderResponse> {
    const ctx = RequestContextStore.require();
    if (!ctx.userId) throw AppError.unauthenticated();
    // Coupons belong to CPN, which is not built: refuse rather than silently charge full price for a code the buyer typed.
    if (coupon) {
      throw unavailable('Coupons are not available yet.', ERROR_CODES.PAYGW_COUPON_UNAVAILABLE);
    }
    const s = await this.settings.load();

    // 1. validate + price, no writes. The gateway check precedes creation: an inactive gateway leaves no order behind.
    const gateway = await this.gateways.byUuid(gatewayUuid);
    if (!gateway || !gateway.is_active)
      throw unavailable('That gateway is not currently available.');
    const { priced, user } = await this.db.tx(async (tx) => {
      const p = await price(tx, s);
      const u = await tx.execute(
        sql`SELECT full_name, email::text AS email FROM users WHERE org_id = ${ctx.orgId} AND id = ${ctx.userId}`,
      );
      return { priced: p, user: u.rows[0] as { full_name: string; email: string } | undefined };
    });
    if (!acceptsCurrency(gateway.supported_currencies, priced.currency)) {
      throw unavailable(
        `${gateway.name} does not support ${priced.currency}.`,
        ERROR_CODES.PAYGW_CURRENCY_UNSUPPORTED,
      );
    }

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
    };
    const base = this.config.get('APP_URL', { infer: true });
    const urls = {
      returnUrl: `${base}/v2/payments/return/${gateway.slug}?o=${order.returnToken}`,
      notifyUrl: `${base}/v2/payments/webhook/${gateway.slug}`,
    };
    let result: PaymentResult;
    try {
      result = await this.gateways.driverFor(gateway).initiate(driverOrder, urls);
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
    if (result.status === 'failed' || (!result.redirectUrl && !result.clientAction)) {
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
            idempotencyKey: idempotencyKey ?? null,
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
