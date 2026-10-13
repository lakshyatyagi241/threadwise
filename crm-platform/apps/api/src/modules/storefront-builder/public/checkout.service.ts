import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  ERROR_CODES,
  type CheckoutInput,
  type CheckoutResponse,
  type CouponQuoteInput,
  type CouponQuoteResponse,
} from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { StorefrontProductsReader } from '../../catalog-products';
import {
  COUPON_DIRECTORY,
  ORDERS_GATEWAY,
  SENDER_DIRECTORY,
  type CouponDirectory,
  type OrderLine,
  type OrdersGateway,
  type SenderDirectory,
} from '../_shims/tokens';
import { CartRecoveryService } from '../recovery/cart-recovery.service';
import { digitsOnly, hasValidPhone, storedPhone } from '../rules/phone';
import { compareLines, computeTotals, lineKey, type PricedLine } from '../rules/pricing';
import { scoreRto } from '../rules/rto';
import { buildWaUrl, trackPath } from '../rules/shop-url';
import { randomToken } from '../rules/token';
import { ShopUrlService } from '../shops/shop-url.service';
import { ShopsRepository } from '../shops/shops.repository';
import { CartPricingService } from './cart-pricing.service';
import { PublicShopLoader } from './public-shop.loader';

const ITEMS_UNAVAILABLE = 'Those items are no longer available. Please refresh and try again.';
const IDEM_TTL_SECONDS = 24 * 3600;
const IN_FLIGHT = '__in_flight__';
const IDEM_KEY_MAX = 128;

/**
 * The server-side checkout and the coupon quote (TW-STORE-013, 014).
 *
 * Every price comes from the database; the client sends ids and quantities. The whole order is ONE transaction: re-price,
 * take the stock under a row lock, resolve and count the coupon, score the COD risk, write the order, cancel the buyer's
 * cart recovery and write the `store.order_placed` outbox event. Nothing after the order (WhatsApp Pay auto-charge,
 * notifications, invoices) runs in this request: those are consumers of the event, so a failure there can never turn a
 * placed order into a 500 (Reference's post-order handlers caught nothing).
 *
 * Differences from Reference, all recorded in the parity file: stock is taken atomically for the quantity actually ordered
 * (decision D-08; Reference read then wrote and could oversell), an `Idempotency-Key` makes a double submit return the first
 * order, an ineligible coupon is still ignored silently (D-06, kept) but a free-shipping coupon is only recorded when it is
 * really redeemable (Reference recorded and counted an expired or under-minimum one).
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly loader: PublicShopLoader,
    private readonly pricing: CartPricingService,
    private readonly shops: ShopsRepository,
    private readonly urls: ShopUrlService,
    private readonly recovery: CartRecoveryService,
    private readonly outbox: OutboxService,
    private readonly products: StorefrontProductsReader,
    @Inject(ORDERS_GATEWAY) private readonly orders: OrdersGateway,
    @Inject(COUPON_DIRECTORY) private readonly coupons: CouponDirectory,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async checkout(
    slug: string,
    input: CheckoutInput,
    idempotencyKey?: string,
  ): Promise<CheckoutResponse> {
    if (!hasValidPhone(input.phone))
      throw AppError.validation('Please enter a valid phone number.');
    const handle = await this.loader.resolve(slug);

    if (idempotencyKey !== undefined && idempotencyKey.length > IDEM_KEY_MAX) {
      throw AppError.validation('Idempotency-Key is too long.');
    }
    const idem = idempotencyKey
      ? `store_idem:${handle.orgId}:${handle.storefrontId}:${idempotencyKey}`
      : null;
    if (idem) {
      const replay = await this.reserve(idem);
      if (replay) return replay;
    }

    try {
      const response = await this.place(handle, input);
      if (idem) await this.remember(idem, response);
      return response;
    } catch (err) {
      // The order failed: free the key so a genuine retry can go through.
      if (idem) await this.redis.del(idem).catch(() => undefined);
      throw err;
    }
  }

  async quote(slug: string, input: CouponQuoteInput): Promise<CouponQuoteResponse> {
    const handle = await this.loader.resolve(slug);
    return this.db.txAs({ orgId: handle.orgId }, async (tx) => {
      const shop = await this.loader.shop(tx, handle);
      const { subtotalMinor } = await this.pricing.price(tx, handle, input.items);
      const coupon = await this.coupons.resolve(tx, handle.orgId, handle.storefrontId, input.code);
      const totals = computeTotals({ subtotalMinor, shipping: shop.shipping, coupon });
      // One generic message for every reason (unknown, inactive, expired, used up, below the minimum, other shop): no code enumeration.
      if (!coupon || !totals.couponValid) {
        throw new AppError(
          ERROR_CODES.STORE_COUPON_INVALID,
          'That code is not valid for this cart.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      return {
        code: coupon.code,
        discountMinor: totals.discountMinor,
        shippingMinor: totals.shippingMinor,
        totalMinor: totals.totalMinor,
        freeShipping: totals.freeShipping,
      };
    });
  }

  // --- the order -------------------------------------------------------------------------------------------------------

  private async place(
    handle: { orgId: number; storefrontId: number },
    input: CheckoutInput,
  ): Promise<CheckoutResponse> {
    const { orgId, storefrontId } = handle;
    return this.db.txAs({ orgId }, async (tx) => {
      const shop = await this.loader.shop(tx, handle);

      // 1. Re-price from the database, clamped to the stock the products show now.
      const priced = await this.pricing.price(tx, handle, input.items);
      if (priced.lines.length === 0) throw itemsUnavailable();

      // 2. Take the stock under a row lock, in a fixed order (no deadlock between two carts). Someone else may have taken
      //    units since the read: the line shrinks to what was really taken, and a line left with nothing is dropped.
      const lines: PricedLine[] = [];
      for (const line of [...priced.lines].sort(compareLines)) {
        const stock = line.variant ? line.variant.stockQty : line.product.stockQty;
        if (stock === null) {
          lines.push(line);
          continue;
        }
        const taken = await this.products.takeStock(
          tx,
          orgId,
          line.product.id,
          line.qty,
          line.variant?.id,
        );
        if (taken >= 1) lines.push({ ...line, qty: Math.min(taken, line.qty) });
      }
      if (lines.length === 0) throw itemsUnavailable();
      // The buyer's own order of lines is kept.
      const order = new Map(priced.lines.map((l, i) => [lineKey(l), i]));
      lines.sort((a, b) => (order.get(lineKey(a)) ?? 0) - (order.get(lineKey(b)) ?? 0));
      const subtotalMinor = lines.reduce((s, l) => s + l.unitPriceMinor * l.qty, 0);

      // 3. Coupon, row-locked and re-checked against the locked row. An unknown or ineligible code is IGNORED, not an error.
      const coupon = input.coupon
        ? await this.coupons.resolve(tx, orgId, storefrontId, input.coupon, { lock: true })
        : null;
      const totals = computeTotals({ subtotalMinor, shipping: shop.shipping, coupon });
      const couponApplied =
        coupon !== null && totals.couponValid && (totals.discountMinor > 0 || coupon.freeShipping);
      if (couponApplied) await this.coupons.increment(tx, orgId, coupon.id);

      // 4. Phone, payment method, COD risk (compared as digits: the stored "+" no longer hides a returning buyer).
      const phone = storedPhone(input.phone);
      const digits = digitsOnly(input.phone);
      const method = input.paymentMethod === 'cod' ? 'cod' : 'prepaid';
      let rto: { score: number; band: string } | null = null;
      if (method === 'cod') {
        const [history, average] = await Promise.all([
          this.orders.phoneHistory(tx, orgId, digits),
          this.orders.averageTotalMinor(tx, orgId),
        ]);
        rto = scoreRto({
          phoneDigits: digits,
          totalMinor: totals.totalMinor,
          history,
          averageTotalMinor: average,
        });
      }

      // 5. The order row.
      const address = input.address?.trim() || null;
      const note = input.note?.trim() || null;
      const recoveryToken = randomToken(40);
      const placed = await this.orders.create(tx, orgId, {
        storefrontId,
        customerPhone: phone,
        customerName: input.name.trim() || null,
        customerEmail: input.email?.trim() || null,
        customerAddress: address,
        items: lines.map(toOrderLine),
        totalMinor: totals.totalMinor,
        shippingMinor: totals.shippingMinor,
        discountMinor: couponApplied ? totals.discountMinor : 0,
        couponCode: couponApplied ? coupon.code : null,
        currencyCode: shop.currencyCode || 'INR',
        paymentMethod: method,
        rtoScore: rto?.score ?? null,
        rtoBand: rto?.band ?? null,
        recoveryToken,
        // The address is kept in the notes too so the order screen shows it without a change.
        notes: address ? `Delivery address: ${address}${note ? `\n${note}` : ''}` : note,
      });

      // 6. In the same transaction, database only: the cart converted, and the event consumers wait for.
      await this.recovery.cancelOnOrder(tx, orgId, storefrontId, digits);
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: 'wa_orders',
        aggregateId: placed.id,
        eventType: 'store.order_placed',
        payload: {
          orderNo: placed.id,
          orderId: placed.uuid,
          storefrontId: shop.uuid,
          customerPhone: digits,
          totalMinor: totals.totalMinor,
          currencyCode: shop.currencyCode || 'INR',
          paymentMethod: method,
          couponCode: couponApplied ? coupon.code : null,
          itemCount: lines.length,
        },
      });

      // 7. The WhatsApp hand-off: the order is already on record.
      const [waNumber, orgName] = await Promise.all([
        this.senders.waNumber(tx, orgId, shop.deviceId),
        this.shops.orgName(tx, orgId),
      ]);
      const waUrl = buildWaUrl({
        waNumber,
        shopName: shop.shopName || orgName || 'the store',
        orderNo: placed.id,
        totalMinor: totals.totalMinor,
        currencyCode: shop.currencyCode || 'INR',
        customerName: input.name.trim() || null,
        trackUrl: this.urls.trackUrl(shop, recoveryToken),
      });
      return {
        orderNo: placed.id,
        waUrl,
        trackUrl: trackPath(shop.slug, recoveryToken),
        message: `Order placed! ${waUrl ? 'Opening WhatsApp…' : "We'll be in touch shortly."}`,
      };
    });
  }

  // --- idempotency (anonymous callers: the global interceptor needs a signed-in tenant) -------------------------------------

  /** Reserves the key. Returns the first response when the key was already used; throws 409 while the first request is running. */
  private async reserve(key: string): Promise<CheckoutResponse | null> {
    try {
      const reserved = await this.redis.set(key, IN_FLIGHT, 'EX', IDEM_TTL_SECONDS, 'NX');
      if (reserved === 'OK') return null;
      const stored = await this.redis.get(key);
      if (stored === IN_FLIGHT || stored === null) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          'A request with this Idempotency-Key is still in flight',
          HttpStatus.CONFLICT,
        );
      }
      return JSON.parse(stored) as CheckoutResponse;
    } catch (err) {
      if (err instanceof AppError) throw err;
      // Redis down: the checkout still works, without replay protection.
      this.logger.warn({ err: String(err) }, '[STORE] idempotency store unavailable');
      return null;
    }
  }

  private async remember(key: string, response: CheckoutResponse): Promise<void> {
    await this.redis
      .set(key, JSON.stringify(response), 'EX', IDEM_TTL_SECONDS)
      .catch((err: unknown) =>
        this.logger.warn({ err: String(err) }, '[STORE] idempotency store failed'),
      );
  }
}

const itemsUnavailable = () =>
  new AppError(
    ERROR_CODES.STORE_ITEMS_UNAVAILABLE,
    ITEMS_UNAVAILABLE,
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

function toOrderLine(l: PricedLine): OrderLine {
  return {
    product_id: l.product.id,
    name: l.product.name,
    qty: l.qty,
    price_minor: l.unitPriceMinor,
    image: l.variant?.imageUrl || l.product.imageUrl,
    retailer_id: l.variant
      ? l.variant.retailerId
      : l.product.metaRetailerId || l.product.sku || null,
    ...(l.variant ? { variant_id: l.variant.uuid, variant_title: l.variant.title } : {}),
  };
}
