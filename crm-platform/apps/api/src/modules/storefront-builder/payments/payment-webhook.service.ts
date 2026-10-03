import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES, type RazorpayWebhookResponse } from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { ORDERS_GATEWAY, type OrdersGateway } from '../_shims/tokens';
import { ShopsRepository } from '../shops/shops.repository';
import { StorefrontPaymentService } from './storefront-payment.service';

/** Events that settle an order; every other event is acknowledged and ignored so Razorpay stops retrying. */
const PAID_EVENTS = new Set(['payment_link.paid', 'payment.captured', 'order.paid']);

const reject = (status: HttpStatus, reason: string) =>
  new AppError(ERROR_CODES.STORE_WEBHOOK_REJECTED, reason, status);

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};

/**
 * The Razorpay webhook that turns an order `paid` (WD-STORE-018), hardened per decision D-04.
 *
 * Order of events, and why: parse the body; find the shop from the event's notes; verify the signature with THAT shop's
 * webhook secret BEFORE reading or touching any order (WaDesk resolved the shop from unauthenticated payload notes and only
 * then checked, and never tied the order to the shop); then apply the event only when the order belongs to the verifying
 * shop, the amount and currency equal the order total, and the order is not cancelled. A replay finds the order already paid
 * and changes nothing. A shop without a webhook secret fails closed.
 *
 * Public: the route has no session. The shop is found through the SECURITY DEFINER lookup by id (migration 20261010200100).
 */
@Injectable()
export class PaymentWebhookService {
  private readonly logger = new Logger(PaymentWebhookService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly shops: ShopsRepository,
    private readonly payments: StorefrontPaymentService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(ORDERS_GATEWAY) private readonly orders: OrdersGateway,
  ) {}

  async razorpay(
    raw: Buffer | undefined,
    signature: string | undefined,
  ): Promise<RazorpayWebhookResponse> {
    let json: Json;
    try {
      const parsed: unknown = JSON.parse(raw?.toString('utf8') ?? '');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('not an object');
      json = parsed as Json;
    } catch {
      throw reject(HttpStatus.BAD_REQUEST, 'invalid_json');
    }

    const payload = obj(json.payload);
    const entity = obj(obj(payload.payment_link).entity ?? obj(payload.payment).entity);
    const notes = obj(entity.notes);
    const shopId = Number(notes.storefront_id);
    const found =
      Number.isInteger(shopId) && shopId > 0
        ? (await this.db.primary.execute(sql`SELECT * FROM store_public_lookup_id(${shopId})`))
            .rows[0]
        : undefined;
    const hit = found as
      { storefront_id: number | string; store_org_id: number | string } | undefined;
    if (!hit) throw reject(HttpStatus.NOT_FOUND, 'storefront_unknown');
    const orgId = Number(hit.store_org_id);

    return this.db.txAs({ orgId }, async (tx) => {
      const shop = await this.shops.findById(tx, orgId, Number(hit.storefront_id));
      if (!shop) throw reject(HttpStatus.NOT_FOUND, 'storefront_unknown');

      // The signature first: nothing below runs for a request the shop's own secret did not sign.
      if (!raw || !this.payments.verifyWebhook(shop, raw, signature)) {
        this.logger.warn(`[STOREFRONT-PAY] webhook signature mismatch (shop ${shop.id})`);
        throw reject(HttpStatus.BAD_REQUEST, 'bad_signature');
      }

      const event = typeof json.event === 'string' ? json.event : '';
      if (!PAID_EVENTS.has(event)) return { ok: true as const, ignored: event };

      // The order: from the notes, else the digits of the reference id (`WAORD-<id>`).
      let orderId = Number(notes.wa_order_id);
      if (!Number.isInteger(orderId) || orderId < 1) {
        orderId = Number(String(entity.reference_id ?? '').replace(/\D+/g, ''));
      }
      if (!Number.isInteger(orderId) || orderId < 1) return { ok: true as const, order: null };

      const order = await this.orders.findForPayment(tx, orgId, orderId);
      if (!order) return { ok: true as const, order: null };

      // Tied to the verifying shop: a merchant with a valid secret cannot settle somebody else's order.
      if (order.storefrontId !== shop.id) {
        this.logger.warn(`[STOREFRONT-PAY] order ${orderId} does not belong to shop ${shop.id}`);
        return { ok: true as const, order: null, rejected: 'order_not_in_shop' as const };
      }
      // A replay: already settled, nothing to do.
      if (order.status === 'paid') return { ok: true as const, order: order.id };
      if (order.status === 'cancelled') {
        return { ok: true as const, order: null, rejected: 'order_cancelled' as const };
      }
      // Full amount and same currency, or it is not this order's payment.
      const amount = Number(entity.amount);
      const currency = String(entity.currency ?? '').toUpperCase();
      if (
        !Number.isFinite(amount) ||
        amount !== order.totalMinor ||
        currency !== (order.currencyCode || 'INR').toUpperCase()
      ) {
        this.logger.warn(`[STOREFRONT-PAY] amount/currency mismatch on order ${orderId}`);
        return { ok: true as const, order: null, rejected: 'amount_mismatch' as const };
      }

      const paymentEntity = obj(obj(payload.payment).entity);
      await this.orders.markPaid(tx, orgId, order.id, {
        paymentLink: typeof entity.short_url === 'string' ? entity.short_url : null,
        meta: {
          paid_via: 'razorpay_link',
          razorpay_payment: typeof paymentEntity.id === 'string' ? paymentEntity.id : null,
          razorpay_plink: typeof entity.id === 'string' ? entity.id : null,
        },
      });

      // The machine is the actor: the audit row says so, in this organization.
      const base = RequestContextStore.require();
      await RequestContextStore.run(
        { ...base, orgId, actorType: 'system', actorId: null, userId: null },
        () =>
          this.audit.record(tx, {
            module: 'wa_orders',
            recordId: order.id,
            action: 'update',
            delta: { status: { old: order.status, new: 'paid' } },
          }),
      );
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: 'wa_orders',
        aggregateId: order.id,
        eventType: 'store.order_paid',
        payload: {
          orderNo: order.id,
          orderId: order.uuid,
          storefrontId: shop.uuid,
          totalMinor: order.totalMinor,
          currencyCode: order.currencyCode,
          via: 'razorpay_link',
        },
      });
      return { ok: true as const, order: order.id };
    });
  }
}
