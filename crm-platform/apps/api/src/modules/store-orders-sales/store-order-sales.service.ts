import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES, minorToMajor, type ContactStoreOrdersResponse } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { RbacService } from '../../kernel/rbac/rbac.service';
import {
  assertContactScope,
  CONTACT_RESOLVER,
  ContactActivitiesRepository,
  ContactsRepository,
  ExternalOrderBillingService,
  InvoiceSettingsService,
  type ContactResolverPort,
} from '../crm';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { StoreOrderRepository } from './store-order.repository';
import {
  isCancelled,
  isPaid,
  parseTrigger,
  toExternalOrder,
  toTrueMinor,
  triggerMet,
  type StoreOrderRow,
} from './store-order.rules';

/** What happened to one order in one `syncOrder` / `createInvoiceForOrder` call. Reasons are for logs and tests, never for the buyer. */
export interface StoreOrderSyncResult {
  order: 'not_found' | 'ok';
  contact: 'found' | 'created' | 'linked' | 'skipped' | 'none';
  contactSkipReason?: string;
  salesOrder: 'created' | 'existing' | 'cancelled' | 'skipped_plan' | 'skipped_cancelled' | 'none';
  invoice: 'invoiced' | 'existing' | 'skipped' | 'none';
  invoiceSkipReason?: string;
  payment: 'recorded' | 'none';
}

export interface CreatedStoreInvoice {
  outcome: 'invoiced' | 'existing';
  invoiceId: string;
  invoiceNumber: string | null;
  docType: string;
  salesOrderId: string | null;
  salesOrderNumber: string | null;
}

const ACTIVITY_TYPE = 'store_order';
const SOURCE_TAG = 'Store customer';
const CONTACT_LIST_MAX = 50;

/** Runs `fn` as the system actor of `orgId`, or as the signed-in staff member when the call comes from their own request. */
function runInOrg<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
  const current = RequestContextStore.peek();
  if (current && current.orgId === orgId && current.actorType === 'user') return fn();
  return RequestContextStore.run(
    {
      requestId: current?.requestId ?? `store-order-${randomUUID()}`,
      orgId,
      actorType: 'system',
      actorId: null,
      userId: null,
      ip: current?.ip,
    },
    fn,
  );
}

/** A bookkeeping step the bridge already did for this order (`meta_json.crm.<key>`). */
function metaCrm(order: StoreOrderRow, key: string): boolean {
  const crm = order.metaJson?.crm;
  return typeof crm === 'object' && crm !== null && (crm as Record<string, unknown>)[key] === true;
}

const actingUserId = (): number | null => {
  const ctx = RequestContextStore.peek();
  return ctx?.actorType === 'user' ? ctx.userId : null;
};

/**
 * Store orders inside the CRM's sales module (the owner's decision of 2026-10-05: WaDesk kept the shop's customers and orders as an
 * island; here every order belongs to a contact, a sales order and, when the workspace bills it, an invoice or receipt).
 *
 * For an order that exists (`wa_orders`, written by the storefront checkout, the WhatsApp catalog cart, the AI ordering flow or a mirror):
 *   1. contact: the order's phone is a contact of the workspace (found, or created); a plan that is out of contacts leaves it unlinked;
 *   2. sales order: a confirmed one with the order's lines, discount (spread over the lines), shipping and tax, once;
 *   3. timeline: "Store order #N" on the contact;
 *   4. invoice or receipt, when the workspace's trigger (`invoice_settings.trigger_own`, default `on_paid`) is met and the plan has
 *      `invoicing`: a receipt unless a real tax amount was captured (WaDesk's rule), through the invoicing module's services;
 *   5. payment: an order that is paid has its invoice settled in the ledger.
 *
 * Every step is idempotent (the link columns, `invoices.wa_order_id` and the ledger's gateway payment id say what is already done), so
 * the outbox's at-least-once delivery, a manual retry and the "Create invoice" button never double anything. The order stands whatever
 * the plan blocks: a skipped step is logged and the others still run.
 */
@Injectable()
export class StoreOrderSalesService {
  private readonly logger = new Logger(StoreOrderSalesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly orders: StoreOrderRepository,
    @Inject(CONTACT_RESOLVER) private readonly resolver: ContactResolverPort,
    private readonly billing: ExternalOrderBillingService,
    private readonly invoiceSettings: InvoiceSettingsService,
    private readonly entitlements: PlanEntitlementService,
    private readonly activities: ContactActivitiesRepository,
    private readonly contacts: ContactsRepository,
    private readonly rbac: RbacService,
  ) {}

  // --- the outbox entry point -----------------------------------------------------------------------------------------------

  /**
   * Brings one order's CRM side up to date with its current state. `ref` is the order's uuid (what every event carries) or its number.
   * Reads the order again under a row lock, so a stale event acts on the CURRENT status.
   */
  async syncOrder(
    orgId: number,
    ref: { uuid?: string; id?: number },
  ): Promise<StoreOrderSyncResult> {
    return runInOrg(orgId, async () => {
      const result: StoreOrderSyncResult = {
        order: 'ok',
        contact: 'none',
        salesOrder: 'none',
        invoice: 'none',
        payment: 'none',
      };
      // Stage 1 (one transaction): contact, sales order, timeline. Committed before the invoice so a failure there keeps them.
      const stage1 = await this.db.txAs({ orgId, userId: actingUserId() }, async (tx) => {
        const order = await this.orders.lock(tx, orgId, ref);
        if (!order) return null;
        await this.linkContact(tx, orgId, order, result);
        await this.ensureSalesOrder(tx, orgId, order, result);
        return order;
      });
      if (!stage1) return { ...result, order: 'not_found' };
      // Stage 2 (its own transaction): the invoice and the payment.
      await this.db.txAs({ orgId, userId: actingUserId() }, async (tx) => {
        const order = await this.orders.lock(tx, orgId, { id: stage1.id });
        if (!order) return;
        await this.billOrder(tx, orgId, order, result, { manual: false });
      });
      return result;
    });
  }

  // --- the "Create invoice" button -------------------------------------------------------------------------------------------

  /**
   * Creates the invoice (or receipt) of one store order on request, whatever the workspace's trigger says. `order` is the order's uuid
   * (what the screen holds) or its number. Idempotent: an order that already has an invoice answers with it (`outcome: 'existing'`).
   * Refused with the plan's own problem codes when the plan lacks `invoicing` (PLAN_FEATURE_LOCKED) or is out of `invoices_monthly`
   * (PLAN_LIMIT_REACHED), and with 409 for a cancelled order. A paid order's invoice is settled in the ledger like the automatic one.
   */
  async createInvoiceForOrder(orgId: number, order: string | number): Promise<CreatedStoreInvoice> {
    await this.entitlements.assertFeature(orgId, 'invoicing');
    const ref = typeof order === 'number' ? { id: order } : { uuid: order };
    return runInOrg(orgId, async () => {
      const result: StoreOrderSyncResult = {
        order: 'ok',
        contact: 'none',
        salesOrder: 'none',
        invoice: 'none',
        payment: 'none',
      };
      const orderId = await this.db.txAs({ orgId, userId: actingUserId() }, async (tx) => {
        const row = await this.orders.lock(tx, orgId, ref);
        if (!row) throw AppError.notFound('Order', String(order));
        if (isCancelled(row.status)) {
          throw new AppError(
            ERROR_CODES.CONFLICT,
            'A cancelled order cannot be invoiced.',
            HttpStatus.CONFLICT,
          );
        }
        await this.linkContact(tx, orgId, row, result);
        await this.ensureSalesOrder(tx, orgId, row, result);
        return row.id;
      });
      return this.db.txAs({ orgId, userId: actingUserId() }, async (tx) => {
        const row = await this.orders.lock(tx, orgId, { id: orderId });
        if (!row) throw AppError.notFound('Order', String(order));
        await this.billOrder(tx, orgId, row, result, { manual: true });
        if (result.invoice === 'skipped') {
          throw new AppError(
            ERROR_CODES.PLAN_LIMIT_REACHED,
            "You've reached your plan's monthly invoice limit. Upgrade your plan or wait for the next month.",
            HttpStatus.UNPROCESSABLE_ENTITY,
            [{ path: 'limit', message: 'invoices_monthly' }],
          );
        }
        const after = (await this.orders.lock(tx, orgId, { id: orderId }))!;
        const linked = after.invoiceId
          ? await this.billing.findInvoiceForOrder(tx, orgId, after.id)
          : undefined;
        if (!linked) {
          throw new AppError(
            ERROR_CODES.CONFLICT,
            'This order has nothing to invoice.',
            HttpStatus.CONFLICT,
          );
        }
        const so = (await this.orders.salesOrderOf(tx, orgId, after.id)) ?? null;
        return {
          outcome: result.invoice === 'existing' ? ('existing' as const) : ('invoiced' as const),
          invoiceId: linked.uuid,
          invoiceNumber: linked.number,
          docType: linked.docType,
          salesOrderId: so?.uuid ?? null,
          salesOrderNumber: so?.number ?? null,
        };
      });
    });
  }

  // --- the contact's side ------------------------------------------------------------------------------------------------------

  /**
   * A contact's store orders for its detail page (newest first, at most `limit`, 50 by default). Applies the caller's record scope on
   * contacts exactly like the contact's other sub-resources (an `own` grant reaches only its own contacts, anything else is a 404).
   */
  async listForContact(contactUuid: string, limit = 20): Promise<ContactStoreOrdersResponse> {
    const ctx = RequestContextStore.require();
    const size = Math.min(Math.max(Math.trunc(limit) || 20, 1), CONTACT_LIST_MAX);
    return this.db.tx(async (tx) => {
      const ref = await this.contacts.resolveContactRef(tx, ctx.orgId, contactUuid);
      if (!ref) throw AppError.notFound('Contact', contactUuid);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.read').scope;
      await assertContactScope(tx, this.contacts, ctx.orgId, scope, ctx.userId!, ref.ownerId);
      const rows = await this.orders.forContact(tx, ctx.orgId, ref.id, size);
      const page = rows.slice(0, size);
      return {
        hasMore: rows.length > size,
        data: page.map((r) => ({
          id: r.uuid,
          orderNo: r.id,
          source: r.source,
          status: r.status,
          paymentMethod: r.paymentMethod,
          currency: r.currencyCode,
          total: minorToMajor(toTrueMinor(r.totalMinor, r.currencyCode), r.currencyCode),
          itemCount: r.itemCount,
          placedAt: r.createdAt.toISOString(),
          salesOrder:
            r.salesOrderUuid && r.salesOrderNumber
              ? { id: r.salesOrderUuid, number: r.salesOrderNumber }
              : null,
          invoice:
            r.invoiceUuid && r.invoiceDocType
              ? {
                  id: r.invoiceUuid,
                  number: r.invoiceNumber,
                  docType: r.invoiceDocType as 'tax_invoice' | 'proforma' | 'receipt',
                }
              : null,
        })),
      };
    });
  }

  // --- steps -----------------------------------------------------------------------------------------------------------------------

  /** 1. The order's contact: already linked, or found/created by the order's phone. */
  private async linkContact(
    tx: Tx,
    orgId: number,
    order: StoreOrderRow,
    result: StoreOrderSyncResult,
  ): Promise<void> {
    if (order.contactId !== null) {
      result.contact = 'linked';
      return;
    }
    const link = await this.resolver.findOrCreateByPhone(tx, orgId, {
      phone: order.customerPhone,
      name: order.customerName,
      email: order.customerEmail,
      address: order.customerAddress,
      source: 'store',
      tag: SOURCE_TAG,
      saveProfile: true,
    });
    if (link.outcome === 'skipped') {
      result.contact = 'skipped';
      result.contactSkipReason = link.reason;
      this.logger.warn(
        { orgId, order: order.id, reason: link.reason },
        'store order has no contact link',
      );
      return;
    }
    await this.orders.setContact(tx, orgId, order.id, link.contactId);
    order.contactId = link.contactId;
    result.contact = link.outcome;
  }

  /** 2 and 3. The confirmed sales order (once) and the contact's timeline entry (once). */
  private async ensureSalesOrder(
    tx: Tx,
    orgId: number,
    order: StoreOrderRow,
    result: StoreOrderSyncResult,
  ): Promise<void> {
    await this.logTimeline(tx, orgId, order, 'placedLogged');
    if (order.salesOrderId !== null) {
      result.salesOrder = 'existing';
      if (isCancelled(order.status) && !metaCrm(order, 'cancelled')) {
        await this.cancelSalesOrder(tx, orgId, order, result);
      }
      return;
    }
    if (isCancelled(order.status)) {
      result.salesOrder = 'skipped_cancelled';
      return;
    }
    if (!(await this.entitlements.featureEnabled(orgId, 'invoicing'))) {
      result.salesOrder = 'skipped_plan';
      this.logger.log(
        { orgId, order: order.id },
        'plan has no invoicing: no sales order for the store order',
      );
      return;
    }
    const ext = await this.externalOrder(tx, orgId, order);
    const so = await this.billing.createSalesOrderIn(tx, orgId, ext);
    await this.orders.setSalesOrder(tx, orgId, order.id, so.id);
    order.salesOrderId = so.id;
    result.salesOrder = 'created';
  }

  private async cancelSalesOrder(
    tx: Tx,
    orgId: number,
    order: StoreOrderRow,
    result: StoreOrderSyncResult,
  ): Promise<void> {
    const done = await this.billing.cancelSalesOrderIn(
      tx,
      orgId,
      order.salesOrderId!,
      `Store order #${order.id} was cancelled`,
    );
    if (done) {
      await this.orders.mark(tx, orgId, order.id, 'cancelled');
      result.salesOrder = 'cancelled';
    }
  }

  /** 4 and 5. The invoice when the trigger is met (or on request), then the payment when the order is paid. */
  private async billOrder(
    tx: Tx,
    orgId: number,
    order: StoreOrderRow,
    result: StoreOrderSyncResult,
    opts: { manual: boolean },
  ): Promise<void> {
    if (isCancelled(order.status)) return;
    if (order.salesOrderId === null) {
      result.invoice = 'none';
      return;
    }
    let invoiceId = order.invoiceId;
    if (invoiceId === null) {
      const settings = await this.invoiceSettings.storeOrderPolicy(tx, orgId);
      const wanted = opts.manual || triggerMet(parseTrigger(settings.triggerOwn), order.status);
      if (!wanted) return;
      if (!(await this.entitlements.featureEnabled(orgId, 'invoicing'))) {
        result.invoice = 'skipped';
        result.invoiceSkipReason = 'plan_has_no_invoicing';
        this.logger.log(
          { orgId, order: order.id },
          'plan has no invoicing: no invoice for the store order',
        );
        return;
      }
      const ext = await this.externalOrder(tx, orgId, order, settings.taxLabel);
      const out = await this.billing.invoiceSalesOrderIn(tx, orgId, order.salesOrderId, ext);
      if (out.outcome === 'skipped') {
        result.invoice = 'skipped';
        result.invoiceSkipReason = out.reason;
        return;
      }
      await this.orders.setInvoice(tx, orgId, order.id, out.id);
      order.invoiceId = out.id;
      invoiceId = out.id;
      result.invoice = out.outcome;
    } else {
      result.invoice = 'existing';
    }
    if (isPaid(order.status)) {
      const wrote = await this.billing.recordPaymentIn(tx, orgId, invoiceId, {
        gatewayPaymentId: this.paymentKey(order),
        method: order.waPaymentTxnId ? 'wa_pay' : 'storefront',
        reference: this.paymentReference(order),
        paidAt: new Date(),
      });
      if (wrote) {
        result.payment = 'recorded';
        await this.logTimeline(tx, orgId, order, 'paidLogged');
      }
    }
  }

  /** The ledger's idempotency key for this order's payment: the gateway's own id when there is one, else the order. */
  private paymentKey(order: StoreOrderRow): string {
    return this.paymentReference(order) ?? `wa_order:${order.id}`;
  }

  private paymentReference(order: StoreOrderRow): string | null {
    const meta = order.metaJson ?? {};
    const razorpay = typeof meta.razorpay_payment === 'string' ? meta.razorpay_payment : null;
    const generic = typeof meta.gateway_payment_id === 'string' ? meta.gateway_payment_id : null;
    return razorpay ?? generic ?? order.waPaymentTxnId ?? null;
  }

  private async externalOrder(
    tx: Tx,
    orgId: number,
    order: StoreOrderRow,
    taxLabel?: string | null,
  ) {
    const rows = await this.orders.items(tx, orgId, order.id);
    return toExternalOrder(order, rows, {
      settingsTaxLabel: taxLabel ?? null,
      contactId: order.contactId,
    });
  }

  /** "Store order #N" (placed) / "... paid" on the contact's timeline, once each, so a redelivered event adds nothing. */
  private async logTimeline(
    tx: Tx,
    orgId: number,
    order: StoreOrderRow,
    key: 'placedLogged' | 'paidLogged',
  ): Promise<void> {
    if (order.contactId === null || metaCrm(order, key)) return;
    if (key === 'paidLogged' && !isPaid(order.status)) return;
    const currency = (order.currencyCode || 'USD').toUpperCase();
    const total = minorToMajor(toTrueMinor(order.totalMinor, currency), currency);
    await this.activities.insert(tx, orgId, {
      contactId: order.contactId,
      activityType: ACTIVITY_TYPE,
      title: key === 'placedLogged' ? `Store order #${order.id}` : `Store order #${order.id} paid`,
      body: `${total} ${currency}, ${order.paymentMethod}, from ${order.source}`,
      source: 'system',
      actorId: null,
    });
    await this.contacts.bumpLastActivity(tx, orgId, order.contactId);
    await this.orders.mark(tx, orgId, order.id, key);
  }
}
