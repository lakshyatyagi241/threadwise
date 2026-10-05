import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  type GenerateStoreOrderPaymentLinkInput,
  type ListStoreOrdersQuery,
  type SendStoreOrderPaymentLinkInput,
  type StoreOrderCounts,
  type StoreOrderDetail,
  type StoreOrderListResponse,
  type StoreOrderPaymentLinkResponse,
  type StoreOrderStatusResponse,
  type CreateStoreOrderInvoiceResponse,
  type UpdateStoreOrderStatusInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import {
  GatewayLinkService,
  WorkspaceGatewayResolver,
  supportsPaymentLinks,
  type ResolvedGateway,
} from '../../checkout-orders-merchant-payments';
import { phoneDigits } from '../rules/coupon-admin';
import { orderReference } from '../rules/order-reference';
import { paymentLinkNotice, statusNotice } from '../rules/order-notice';
import { planStatusUpdate } from '../rules/order-status';
import {
  buildPayments,
  buildTimeline,
  orderSubtotal,
  parseOrderLines,
  type AuditEntry,
} from '../rules/order-view';
import {
  RECOVERY_NUDGE_SENDER,
  SENDER_DIRECTORY,
  type RecoveryNudgeSender,
  type SenderDirectory,
} from '../_shims/tokens';
import { ShopUrlService } from '../shops/shop-url.service';
import { ShopsRepository, type ShopRow } from '../shops/shops.repository';
import { STORE_ORDER_INVOICE, type StoreOrderInvoicePort } from '../store-order-invoice.port';
import { StoreOrdersRepository, type OrderRow } from './store-orders.repository';

export const ORDER_MODULE = 'wa_orders';

const flatMeta = (m: Record<string, unknown> | null): Record<string, unknown> => m ?? {};

/**
 * The merchant's order screens (Reference `WaOrderController`): list, one order, the status form, the payment-link actions, delete,
 * and the invoice. Every query carries the organization and runs under row-level security.
 *
 * Kept from Reference: an order moves to any status, `notes` and a typed `paymentLink` are saved with it, the buyer is told on WhatsApp
 * when the status changed or a link was typed (best effort: a send failure never blocks the save), delete removes the order and its
 * lines. Differences, on purpose: every action has its own permission, a stale form is refused by `rowVersion`, the status change
 * and the link are audited and published as events (`store.order_status_changed`, `store.order_payment_link_set`) for the consumers
 * (invoicing, CRM) instead of a cache flag, and the buyer message goes out from the workspace's primary sender (Reference used the
 * shop's own number) and is not translated to the buyer's language.
 */
@Injectable()
export class StoreOrdersService {
  private readonly logger = new Logger(StoreOrdersService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: StoreOrdersRepository,
    private readonly shops: ShopsRepository,
    private readonly urls: ShopUrlService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly gateways: WorkspaceGatewayResolver,
    private readonly links: GatewayLinkService,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
    @Inject(RECOVERY_NUDGE_SENDER) private readonly nudges: RecoveryNudgeSender,
    @Inject(STORE_ORDER_INVOICE) private readonly invoices: StoreOrderInvoicePort,
  ) {}

  // ---- reads ---------------------------------------------------------------------------------------------------------

  async list(query: ListStoreOrdersQuery): Promise<StoreOrderListResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      let storefrontId: number | undefined;
      if (query.storefrontId) {
        storefrontId = await this.repo.shopIdByUuid(tx, ctx.orgId, query.storefrontId);
        // A shop of another workspace is invisible under RLS: a filter on it matches nothing, like any unknown shop.
        if (storefrontId === undefined) {
          return { data: [], page: { nextCursor: null, hasMore: false, limit: query.limit } };
        }
      }
      const rows = await this.repo.list(tx, ctx.orgId, { ...query, storefrontId });
      const { items, page } = buildPage(rows, query.limit);
      return { data: items.map(toListItem), page };
    });
  }

  async counts(): Promise<StoreOrderCounts> {
    const ctx = RequestContextStore.require();
    return this.db.tx((tx) => this.repo.counts(tx, ctx.orgId));
  }

  async get(uuid: string): Promise<StoreOrderDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Order', uuid);
      return this.detail(tx, ctx.orgId, row);
    });
  }

  // ---- writes --------------------------------------------------------------------------------------------------------

  async updateStatus(
    uuid: string,
    input: UpdateStoreOrderStatusInput,
  ): Promise<StoreOrderStatusResponse> {
    const ctx = RequestContextStore.require();
    const done = await this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, { lock: true });
      if (!row) throw AppError.notFound('Order', uuid);
      if (input.rowVersion !== undefined && input.rowVersion !== row.rowVersion) {
        throw AppError.rowVersionConflict('Order');
      }
      const plan = planStatusUpdate(row.status, input.status, input.paymentLink, row.customerPhone);
      const ok = await this.repo.updateStatus(
        tx,
        ctx.orgId,
        row.id,
        {
          status: input.status,
          notes: input.notes === undefined ? undefined : input.notes?.trim() || null,
          paymentLink:
            input.paymentLink === undefined ? undefined : input.paymentLink?.trim() || null,
        },
        row.rowVersion,
      );
      if (!ok) throw AppError.rowVersionConflict('Order');

      const after = (await this.repo.findByUuid(tx, ctx.orgId, uuid))!;
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      if (plan.statusChanged) delta.status = { old: row.status, new: after.status };
      if (after.notes !== row.notes)
        delta.notes = { old: Boolean(row.notes), new: Boolean(after.notes) };
      if (after.paymentLink !== row.paymentLink) {
        delta.paymentLink = { old: Boolean(row.paymentLink), new: Boolean(after.paymentLink) };
      }
      await this.audit.record(tx, {
        module: ORDER_MODULE,
        recordId: row.id,
        action: 'update',
        delta,
      });
      if (plan.statusChanged) {
        await this.outbox.emit(tx, {
          aggregateModule: ORDER_MODULE,
          aggregateId: row.id,
          eventType: 'store.order_status_changed',
          payload: {
            orderNo: row.id,
            orderId: row.uuid,
            from: row.status,
            to: after.status,
            invoiceDue: plan.invoiceDue,
          },
        });
      }
      if (plan.linkTyped) {
        await this.outbox.emit(tx, {
          aggregateModule: ORDER_MODULE,
          aggregateId: row.id,
          eventType: 'store.order_payment_link_set',
          payload: { orderNo: row.id, orderId: row.uuid },
        });
      }
      return { row: after, plan, detail: await this.detail(tx, ctx.orgId, after) };
    });

    // After the commit, best effort: a failed send never undoes the save (Reference).
    let notified = false;
    if (done.plan.notifyBuyer) {
      const body = statusNotice({
        orderNo: done.row.id,
        status: done.row.status,
        statusChanged: done.plan.statusChanged,
        link: done.plan.linkTyped ? done.row.paymentLink : null,
        totalMinor: done.row.totalMinor,
        currencyCode: done.row.currencyCode,
      });
      if (body) notified = await this.sendToBuyer(ctx.orgId, done.row.customerPhone, body);
    }
    return { order: done.detail, notified };
  }

  /** Reference `sendPaymentLink`: the operator pastes a link; it is saved on the order and sent to the buyer. */
  async sendPaymentLink(
    uuid: string,
    input: SendStoreOrderPaymentLinkInput,
  ): Promise<StoreOrderPaymentLinkResponse> {
    const ctx = RequestContextStore.require();
    const row = await this.db.tx(async (tx) => {
      const o = await this.repo.findByUuid(tx, ctx.orgId, uuid, { lock: true });
      if (!o) throw AppError.notFound('Order', uuid);
      await this.repo.setPaymentLink(tx, ctx.orgId, o.id, input.paymentLink);
      await this.recordLink(tx, ctx.orgId, o, 'manual');
      return o;
    });
    const sent = await this.sendToBuyer(
      ctx.orgId,
      row.customerPhone,
      paymentLinkNotice({
        customerName: row.customerName,
        totalMinor: row.totalMinor,
        currencyCode: row.currencyCode,
        link: input.paymentLink,
        generated: false,
      }),
    );
    return { ok: true, url: input.paymentLink, sent, gateway: null };
  }

  /**
   * Reference `generatePaymentLink` and `sendCheckout`, on the shared gateway: mints a hosted link on the gateway the order's shop
   * resolves to (or the one the operator picked), saves it on the order and sends it. Razorpay goes through its Payment Links API
   * (a link a buyer opens from WhatsApp); the other gateways through their driver's hosted checkout, when it answers a redirect.
   */
  async generatePaymentLink(
    uuid: string,
    input: GenerateStoreOrderPaymentLinkInput,
  ): Promise<StoreOrderPaymentLinkResponse> {
    const ctx = RequestContextStore.require();
    // Read first and release the connection: the provider call below can take seconds.
    const { order, gateway, shop } = await this.db.tx(async (tx) => {
      const o = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!o) throw AppError.notFound('Order', uuid);
      const g = await this.gateways.resolve(ctx.orgId, o.storefrontId, { slug: input.gateway, tx });
      const s = o.storefrontId
        ? await this.shops.findById(tx, ctx.orgId, o.storefrontId)
        : undefined;
      return { order: o, gateway: g, shop: s };
    });
    if (!gateway) {
      throw new AppError(
        ERROR_CODES.STORE_GATEWAY_NOT_CONFIGURED,
        input.gateway
          ? `Add your ${input.gateway} API keys under Settings > Payments first.`
          : 'Add a payment gateway under Settings > Payments to create links, or paste one manually.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (!supportsPaymentLinks(gateway.slug)) {
      throw new AppError(
        ERROR_CODES.STORE_GATEWAY_UNAVAILABLE,
        `${gateway.name} cannot create a payment link a buyer can open from WhatsApp.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const callback =
      shop && order.recoveryToken
        ? this.urls.trackUrl(shop, order.recoveryToken)
        : `${this.urls.env.webAppUrl}/`;
    const link = await this.mint(ctx.orgId, gateway, order, shop, callback);
    if (!link) {
      throw new AppError(
        ERROR_CODES.STORE_PAYMENT_LINK_FAILED,
        'Could not create the payment link. Check your gateway keys.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    await this.db.tx(async (tx) => {
      const o = await this.repo.findByUuid(tx, ctx.orgId, uuid, { lock: true });
      if (!o) throw AppError.notFound('Order', uuid);
      await this.repo.setPaymentLink(
        tx,
        ctx.orgId,
        o.id,
        link.url,
        {
          payment_link_id: link.id,
          gateway_slug: gateway.slug,
          payment_ref: orderReference(o.id),
        },
        // Reference `createCheckout` stamps the gateway as the order's payment method; the Razorpay link action did not.
        gateway.slug === 'razorpay' ? undefined : gateway.slug,
      );
      await this.recordLink(tx, ctx.orgId, o, gateway.slug);
    });
    const sent = await this.sendToBuyer(
      ctx.orgId,
      order.customerPhone,
      paymentLinkNotice({
        customerName: order.customerName,
        totalMinor: order.totalMinor,
        currencyCode: order.currencyCode,
        link: link.url,
        generated: true,
      }),
    );
    return { ok: true, url: link.url, sent, gateway: gateway.slug };
  }

  async createInvoice(uuid: string): Promise<CreateStoreOrderInvoiceResponse> {
    const ctx = RequestContextStore.require();
    const existing = await this.db.tx(async (tx) => {
      const o = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!o) throw AppError.notFound('Order', uuid);
      return o;
    });
    if (existing.invoiceUuid) {
      return {
        invoiceId: existing.invoiceUuid,
        number: null,
        salesOrderId: existing.salesOrderUuid,
        existing: true,
      };
    }
    const made = await this.invoices.createInvoiceForOrder(uuid);
    await this.db.tx(async (tx) => {
      await this.audit.record(tx, {
        module: ORDER_MODULE,
        recordId: existing.id,
        action: 'update',
        delta: { invoiceId: { old: null, new: true } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: ORDER_MODULE,
        aggregateId: existing.id,
        eventType: 'store.order_invoiced',
        payload: { orderNo: existing.id, orderId: uuid, invoiceId: made.invoiceId },
      });
    });
    return {
      invoiceId: made.invoiceId,
      number: made.number,
      salesOrderId: made.salesOrderId,
      existing: !made.created,
    };
  }

  /** Reference `destroy`: a real delete (its lines go with it, `wa_order_items` cascades). An unknown order is 404. */
  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const gone = await this.repo.delete(tx, ctx.orgId, uuid);
      if (!gone) throw AppError.notFound('Order', uuid);
      await this.audit.record(tx, { module: ORDER_MODULE, recordId: gone.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: ORDER_MODULE,
        aggregateId: gone.id,
        eventType: 'store.order_deleted',
        payload: { orderNo: gone.id, orderId: uuid },
      });
    });
  }

  // ---- internals -----------------------------------------------------------------------------------------------------

  private async recordLink(tx: Tx, orgId: number, o: OrderRow, kind: string): Promise<void> {
    await this.audit.record(tx, {
      module: ORDER_MODULE,
      recordId: o.id,
      action: 'update',
      delta: { paymentLink: { old: Boolean(o.paymentLink), new: true } },
    });
    await this.outbox.emit(tx, {
      orgId,
      aggregateModule: ORDER_MODULE,
      aggregateId: o.id,
      eventType: 'store.order_payment_link_set',
      payload: { orderNo: o.id, orderId: o.uuid, via: kind },
    });
  }

  /** The hosted link on the resolved gateway; null when the provider did not give one. Runs outside any transaction. */
  private async mint(
    orgId: number,
    gateway: ResolvedGateway,
    order: OrderRow,
    shop: ShopRow | undefined,
    callbackUrl: string,
  ): Promise<{ url: string; id: string | null } | null> {
    return this.links.mint(gateway, {
      reference: orderReference(order.id),
      amountMinor: BigInt(order.totalMinor),
      currency: order.currencyCode,
      description: `Order #${order.id} · ${shop?.shopName || 'Store'}`,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      customerPhone: order.customerPhone,
      callbackUrl,
      // Razorpay echoes these in its notification: the shop's own webhook finds the shop and the order through them.
      notes: {
        wa_order_id: String(order.id),
        storefront_id: String(order.storefrontId ?? 0),
        workspace_id: String(orgId),
      },
    });
  }

  private async sendToBuyer(orgId: number, phone: string | null, body: string): Promise<boolean> {
    const to = phoneDigits(phone);
    if (!to) return false;
    try {
      const sender = await this.db.tx((tx) => this.senders.recoverySender(tx, orgId));
      if (!sender) return false;
      await this.nudges.send(orgId, sender, to, body);
      return true;
    } catch (err) {
      this.logger.warn(`[ORDER] buyer message failed: ${(err as Error).message}`);
      return false;
    }
  }

  private async detail(tx: Tx, orgId: number, row: OrderRow): Promise<StoreOrderDetail> {
    let lines = parseOrderLines(row.items);
    if (lines.length === 0) {
      lines = (await this.repo.itemRows(tx, orgId, row.id)).map((i) => ({
        productId: i.product_id === null ? null : Number(i.product_id),
        name: i.name,
        qty: i.quantity,
        priceMinor: Number(i.price_minor),
        lineTotalMinor: i.quantity * Number(i.price_minor),
        image: i.image_url,
        retailerId: i.retailer_id,
      }));
    }
    const history = await this.audit.listByRecord(tx, orgId, ORDER_MODULE, row.id, { limit: 100 });
    const entries: AuditEntry[] = history.items.map((h) => ({
      at: h.at,
      actorType: h.actorType,
      action: h.action,
      delta: h.delta,
    }));
    const timeline = buildTimeline({ source: row.source, createdAt: row.createdAt }, entries);
    const paidEntry = timeline.filter((t) => t.detail?.endsWith('→ paid')).pop();
    const paidAt = row.paymentStatus === 'paid' ? new Date(paidEntry?.at ?? row.updatedAt) : null;
    const available = await this.gateways.available(orgId, row.storefrontId, { tx });

    return {
      ...toListItem(row),
      customerEmail: row.customerEmail,
      customerAddress: row.customerAddress,
      items: lines,
      subtotalMinor: orderSubtotal(lines, row),
      shippingMinor: row.shippingMinor,
      taxMinor: row.taxMinor,
      taxInclusive: row.taxInclusive,
      discountMinor: row.discountMinor,
      couponCode: row.couponCode,
      notes: row.notes,
      paymentLink: row.paymentLink,
      rtoScore: row.rtoScore,
      rtoBand: row.rtoBand,
      payments: buildPayments({
        totalMinor: row.totalMinor,
        currencyCode: row.currencyCode,
        paymentMethod: row.paymentMethod,
        paymentStatus: row.paymentStatus,
        paymentLink: row.paymentLink,
        waPaymentStatus: row.waPaymentStatus,
        waPaymentTxnId: row.waPaymentTxnId,
        meta: flatMeta(row.metaJson),
        paidAt,
      }),
      timeline,
      availableGateways: available.map((g) => ({ slug: g.slug, name: g.name })),
      contactId: row.contactUuid,
      invoiceId: row.invoiceUuid,
      salesOrderId: row.salesOrderUuid,
      rowVersion: row.rowVersion,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

export function toListItem(row: OrderRow) {
  return {
    id: row.uuid,
    orderNo: row.id,
    source: row.source,
    status: row.status,
    paymentStatus: row.paymentStatus,
    paymentMethod: row.paymentMethod,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    itemsCount: row.itemsCount,
    totalMinor: row.totalMinor,
    currencyCode: row.currencyCode,
    storefrontId: row.storefrontUuid,
    storefrontName: row.storefrontName,
    createdAt: row.createdAt.toISOString(),
  };
}
