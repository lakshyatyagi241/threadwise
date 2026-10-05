import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { OutboxSubscriberRegistry } from '../../../src/kernel/outbox/outbox-subscribers';
import {
  STORE_ORDER_EVENTS,
  StoreOrderSalesConsumer,
} from '../../../src/modules/store-orders-sales/store-order-sales.consumer';
import { StoreOrderSalesService } from '../../../src/modules/store-orders-sales/store-order-sales.service';
import type { StoreOrderRow } from '../../../src/modules/store-orders-sales/store-order.rules';

const baseOrder = (over: Partial<StoreOrderRow> = {}): StoreOrderRow => ({
  id: 12,
  uuid: '11111111-1111-4111-8111-111111111111',
  source: 'storefront',
  status: 'new',
  customerPhone: '919876543210',
  customerName: 'Asha',
  customerEmail: null,
  customerAddress: null,
  itemsJson: [{ name: 'Tea', qty: 1, price_minor: 10000, retailer_id: 'T' }],
  totalMinor: 10000,
  shippingMinor: 0,
  taxMinor: 0,
  taxInclusive: false,
  taxLinesJson: null,
  discountMinor: 0,
  couponCode: null,
  paymentMethod: 'prepaid',
  currencyCode: 'INR',
  notes: null,
  metaJson: null,
  waPaymentTxnId: null,
  contactId: null,
  salesOrderId: null,
  invoiceId: null,
  createdAt: new Date('2026-10-05T10:00:00Z'),
  ...over,
});

/**
 * The service over fakes. `state` is the order row the repository hands out under its lock; the fake write methods update it, the way the
 * database would, so a second call sees what the first one linked (that is what idempotency rests on).
 */
function build(opts: {
  order?: Partial<StoreOrderRow>;
  invoicing?: boolean;
  trigger?: string;
  link?: unknown;
  invoiceOutcome?: unknown;
}) {
  const state: StoreOrderRow = baseOrder(opts.order);
  const orders = {
    lock: vi.fn(async () => ({ ...state })),
    items: vi.fn(async () => []),
    setContact: vi.fn(async (_tx, _o, _id, contactId: number) => {
      state.contactId = contactId;
    }),
    setSalesOrder: vi.fn(async (_tx, _o, _id, soId: number) => {
      state.salesOrderId = soId;
    }),
    setInvoice: vi.fn(async (_tx, _o, _id, invId: number) => {
      state.invoiceId = invId;
    }),
    mark: vi.fn(async (_tx, _o, _id, key: string) => {
      state.metaJson = {
        ...(state.metaJson ?? {}),
        crm: { ...((state.metaJson?.crm as object) ?? {}), [key]: true },
      };
    }),
    salesOrderOf: vi.fn(async () => ({ uuid: 'so-uuid', number: 'SO-1' })),
  };
  const resolver = {
    findOrCreateByPhone: vi.fn(
      async () => opts.link ?? { outcome: 'created', contactId: 5, contactUuid: 'c-5' },
    ),
  };
  const billing = {
    createSalesOrderIn: vi.fn(async () => ({ id: 70, uuid: 'so', number: 'SO-1', created: true })),
    invoiceSalesOrderIn: vi.fn(
      async () =>
        opts.invoiceOutcome ?? {
          outcome: 'invoiced',
          id: 90,
          uuid: 'inv',
          number: 'RCT-1',
          docType: 'receipt',
          totalMinor: 10000n,
        },
    ),
    recordPaymentIn: vi.fn(async () => true),
    cancelSalesOrderIn: vi.fn(async () => true),
    findInvoiceForOrder: vi.fn(async () => ({
      uuid: 'inv',
      number: 'RCT-1',
      docType: 'receipt',
    })),
  };
  const settings = {
    storeOrderPolicy: vi.fn(async () => ({
      triggerOwn: opts.trigger ?? 'on_paid',
      taxLabel: null,
    })),
  };
  const entitlements = {
    featureEnabled: vi.fn(async () => opts.invoicing ?? true),
    assertFeature: vi.fn(async () => {
      if (opts.invoicing === false) {
        throw new AppError(ERROR_CODES.PLAN_FEATURE_LOCKED, 'locked', 422);
      }
    }),
  };
  const activities = { insert: vi.fn(async () => ({ id: 1, uuid: 'a' })) };
  const contacts = { bumpLastActivity: vi.fn(async () => undefined) };
  const db = { txAs: vi.fn(async (_t: unknown, fn: (tx: unknown) => unknown) => fn({})) };
  const svc = new StoreOrderSalesService(
    db as never,
    orders as never,
    resolver as never,
    billing as never,
    settings as never,
    entitlements as never,
    activities as never,
    contacts as never,
    {} as never,
  );
  return { svc, state, orders, resolver, billing, settings, entitlements, activities, contacts };
}

const REF = { uuid: '11111111-1111-4111-8111-111111111111' };

describe('StoreOrderSalesService.syncOrder', () => {
  it('a new order gets its contact, a sales order and a timeline entry, and no invoice before it is paid', async () => {
    const t = build({});
    const r = await t.svc.syncOrder(1, REF);
    expect(r).toMatchObject({
      contact: 'created',
      salesOrder: 'created',
      invoice: 'none',
      payment: 'none',
    });
    expect(t.orders.setContact).toHaveBeenCalledWith(expect.anything(), 1, 12, 5);
    expect(t.orders.setSalesOrder).toHaveBeenCalledWith(expect.anything(), 1, 12, 70);
    expect(t.activities.insert).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.objectContaining({
        title: 'Store order #12',
        activityType: 'store_order',
        source: 'system',
      }),
    );
    expect(t.billing.invoiceSalesOrderIn).not.toHaveBeenCalled();
  });

  it('is idempotent: a second delivery creates nothing again', async () => {
    const t = build({});
    await t.svc.syncOrder(1, REF);
    const second = await t.svc.syncOrder(1, REF);
    expect(second).toMatchObject({ contact: 'linked', salesOrder: 'existing' });
    expect(t.resolver.findOrCreateByPhone).toHaveBeenCalledTimes(1);
    expect(t.billing.createSalesOrderIn).toHaveBeenCalledTimes(1);
    expect(t.activities.insert).toHaveBeenCalledTimes(1);
  });

  it('invoices a paid order (default trigger on_paid), records the payment once and never duplicates', async () => {
    const t = build({ order: { status: 'paid' } });
    const first = await t.svc.syncOrder(1, REF);
    expect(first).toMatchObject({ invoice: 'invoiced', payment: 'recorded' });
    expect(t.billing.invoiceSalesOrderIn).toHaveBeenCalledTimes(1);
    expect(t.orders.setInvoice).toHaveBeenCalledWith(expect.anything(), 1, 12, 90);
    expect(t.billing.recordPaymentIn).toHaveBeenCalledWith(
      expect.anything(),
      1,
      90,
      expect.objectContaining({ gatewayPaymentId: 'wa_order:12', method: 'storefront' }),
    );

    // redelivery of the paid event: the order already holds its invoice, so nothing new is made
    t.billing.recordPaymentIn.mockResolvedValue(false);
    const second = await t.svc.syncOrder(1, REF);
    expect(second.invoice).toBe('existing');
    expect(t.billing.invoiceSalesOrderIn).toHaveBeenCalledTimes(1);
    expect(t.billing.createSalesOrderIn).toHaveBeenCalledTimes(1);
  });

  it('does not invoice again when wa_orders.invoice_id is already set', async () => {
    const t = build({ order: { status: 'paid', salesOrderId: 70, invoiceId: 90, contactId: 5 } });
    const r = await t.svc.syncOrder(1, REF);
    expect(r.invoice).toBe('existing');
    expect(t.billing.invoiceSalesOrderIn).not.toHaveBeenCalled();
    expect(t.billing.createSalesOrderIn).not.toHaveBeenCalled();
  });

  it('honours the trigger: on_placed invoices at once, manual never', async () => {
    const placed = build({ trigger: 'on_placed' });
    expect((await placed.svc.syncOrder(1, REF)).invoice).toBe('invoiced');
    const manual = build({ trigger: 'manual', order: { status: 'paid' } });
    const r = await manual.svc.syncOrder(1, REF);
    expect(r.invoice).toBe('none');
    expect(manual.billing.invoiceSalesOrderIn).not.toHaveBeenCalled();
  });

  it('a plan without invoicing still links the contact and the timeline, and skips the sales side with a reason', async () => {
    const t = build({ invoicing: false, order: { status: 'paid' } });
    const r = await t.svc.syncOrder(1, REF);
    expect(r).toMatchObject({ contact: 'created', salesOrder: 'skipped_plan', invoice: 'none' });
    expect(t.billing.createSalesOrderIn).not.toHaveBeenCalled();
    expect(t.activities.insert).toHaveBeenCalled();
  });

  it('a plan at invoices_monthly keeps the sales order and records why there is no invoice', async () => {
    const t = build({
      order: { status: 'paid' },
      invoiceOutcome: { outcome: 'skipped', reason: 'plan_limit_reached' },
    });
    const r = await t.svc.syncOrder(1, REF);
    expect(r).toMatchObject({
      salesOrder: 'created',
      invoice: 'skipped',
      invoiceSkipReason: 'plan_limit_reached',
      payment: 'none',
    });
    expect(t.orders.setInvoice).not.toHaveBeenCalled();
  });

  it('a contact cap leaves the order unlinked but still produces the sales order', async () => {
    const t = build({ link: { outcome: 'skipped', reason: 'plan_limit_reached' } });
    const r = await t.svc.syncOrder(1, REF);
    expect(r).toMatchObject({
      contact: 'skipped',
      contactSkipReason: 'plan_limit_reached',
      salesOrder: 'created',
    });
    expect(t.orders.setContact).not.toHaveBeenCalled();
    expect(t.activities.insert).not.toHaveBeenCalled();
  });

  it('a cancelled order gets no sales order; one that has it is cancelled there once', async () => {
    const none = build({ order: { status: 'cancelled' } });
    expect((await none.svc.syncOrder(1, REF)).salesOrder).toBe('skipped_cancelled');
    expect(none.billing.createSalesOrderIn).not.toHaveBeenCalled();

    const had = build({ order: { status: 'cancelled', salesOrderId: 70, contactId: 5 } });
    expect((await had.svc.syncOrder(1, REF)).salesOrder).toBe('cancelled');
    expect(had.billing.cancelSalesOrderIn).toHaveBeenCalledTimes(1);
    expect((await had.svc.syncOrder(1, REF)).salesOrder).toBe('existing');
    expect(had.billing.cancelSalesOrderIn).toHaveBeenCalledTimes(1);
  });

  it('answers not_found for an order that no longer exists', async () => {
    const t = build({});
    t.orders.lock.mockResolvedValue(undefined as never);
    expect((await t.svc.syncOrder(1, REF)).order).toBe('not_found');
  });
});

describe('StoreOrderSalesService.createInvoiceForOrder (the manual button)', () => {
  it('invoices regardless of the trigger and returns the invoice and the sales order', async () => {
    const t = build({ trigger: 'manual' });
    const out = await t.svc.createInvoiceForOrder(1, REF.uuid);
    expect(out).toEqual({
      outcome: 'invoiced',
      invoiceId: 'inv',
      invoiceNumber: 'RCT-1',
      docType: 'receipt',
      salesOrderId: 'so-uuid',
      salesOrderNumber: 'SO-1',
    });
    expect(t.billing.invoiceSalesOrderIn).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: the order that already has an invoice answers with it', async () => {
    const t = build({});
    await t.svc.createInvoiceForOrder(1, REF.uuid);
    const again = await t.svc.createInvoiceForOrder(1, REF.uuid);
    expect(again.outcome).toBe('existing');
    expect(t.billing.invoiceSalesOrderIn).toHaveBeenCalledTimes(1);
  });

  it('refuses with the plan problem codes when invoicing is locked or invoices_monthly is reached', async () => {
    const locked = build({ invoicing: false });
    await expect(locked.svc.createInvoiceForOrder(1, REF.uuid)).rejects.toMatchObject({
      code: ERROR_CODES.PLAN_FEATURE_LOCKED,
    });
    const limited = build({ invoiceOutcome: { outcome: 'skipped', reason: 'plan_limit_reached' } });
    await expect(limited.svc.createInvoiceForOrder(1, REF.uuid)).rejects.toMatchObject({
      code: ERROR_CODES.PLAN_LIMIT_REACHED,
    });
  });

  it('refuses a cancelled order with 409 and an unknown order with 404', async () => {
    const cancelled = build({ order: { status: 'cancelled' } });
    await expect(cancelled.svc.createInvoiceForOrder(1, REF.uuid)).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
    const missing = build({});
    missing.orders.lock.mockResolvedValue(undefined as never);
    await expect(missing.svc.createInvoiceForOrder(1, REF.uuid)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('StoreOrderSalesConsumer', () => {
  const event = (eventType: string, payload: Record<string, unknown>) => ({
    id: '1',
    orgId: 7,
    aggregateModule: 'wa_orders',
    aggregateId: '12',
    eventType,
    payload,
  });

  it('listens to the placed, received, paid and status-changed order events', () => {
    expect([...STORE_ORDER_EVENTS]).toEqual([
      'store.order_placed',
      'whatsapp.order.received',
      'store.order_paid',
      'store.order_status_changed',
    ]);
  });

  it('syncs the order of each event under the event tenant, by uuid or by number', async () => {
    const syncOrder = vi.fn().mockResolvedValue({ order: 'ok' });
    const registry = new OutboxSubscriberRegistry();
    const consumer = new StoreOrderSalesConsumer({ syncOrder } as never, registry);
    consumer.onModuleInit();
    await registry.dispatch(event('store.order_placed', { orderId: 'u-1', orderNo: 12 }));
    expect(syncOrder).toHaveBeenLastCalledWith(7, { uuid: 'u-1' });
    await registry.dispatch(event('store.order_paid', { orderNo: 12 }));
    expect(syncOrder).toHaveBeenLastCalledWith(7, { id: 12 });
    await registry.dispatch(event('whatsapp.order.received', { orderId: 'u-2' }));
    expect(syncOrder).toHaveBeenLastCalledWith(7, { uuid: 'u-2' });
  });

  it('ignores an event without an order id and lets a failure reach the drain for a retry', async () => {
    const syncOrder = vi.fn().mockRejectedValue(new Error('db down'));
    const registry = new OutboxSubscriberRegistry();
    const consumer = new StoreOrderSalesConsumer({ syncOrder } as never, registry);
    consumer.onModuleInit();
    await registry.dispatch(event('store.order_placed', {}));
    expect(syncOrder).not.toHaveBeenCalled();
    await expect(
      registry.dispatch(event('store.order_placed', { orderId: 'u-1' })),
    ).rejects.toThrow(/db down/);
  });
});
