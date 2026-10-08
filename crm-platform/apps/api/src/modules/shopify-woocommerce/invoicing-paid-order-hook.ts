import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { ExternalOrderBillingService, InvoiceSettingsService } from '../crm';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import type { HandOffOutcome, PaidOrderHook, PaidStoreOrder } from './_shims/tokens';
import { InvoiceHandoffRepository } from './invoice-handoff.repository';
import {
  orderFacts,
  paidAtOf,
  parseEcomTrigger,
  shopifyExternalOrder,
  triggerMet,
  wooExternalOrder,
} from './invoice-order-rules';
import { StoresRepository } from './stores.repository';

/** Runs `fn` as the system actor of `orgId` unless a request context of that workspace is already open (the audit trail needs one). */
function runInOrg<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
  const current = RequestContextStore.peek();
  if (current && current.orgId === orgId) return fn();
  return RequestContextStore.run(
    {
      requestId: `ecom-invoice-${randomUUID()}`,
      orgId,
      actorType: 'system',
      actorId: null,
      userId: null,
    },
    fn,
  );
}

/**
 * The paid-order hand-off (WD-ECOM-035): after the mirror holds a store's order, the invoicing module bills it. In one transaction:
 * the delivery id is claimed (a replay stops here), the order gets its confirmed sales order (once), the invoice or receipt
 * (once: the order's own `invoice_id` and `invoices.wa_order_id` say so, even after the invoice was voided), the payment of a paid
 * order in the ledger and, with the workspace's switch on, the invoice queued for the buyer. A failure rolls the whole step back and
 * is the caller's to log: the webhook delivery is never failed by it.
 *
 * The workspace decides per source (`invoice_settings`): off by default; the trigger names the event (paid by default).
 */
@Injectable()
export class InvoicingPaidOrderHook implements PaidOrderHook {
  private readonly logger = new Logger(InvoicingPaidOrderHook.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly settings: InvoiceSettingsService,
    private readonly billing: ExternalOrderBillingService,
    private readonly entitlements: PlanEntitlementService,
    private readonly stores: StoresRepository,
    private readonly repo: InvoiceHandoffRepository,
  ) {}

  handOff(o: PaidStoreOrder): Promise<HandOffOutcome> {
    const facts = orderFacts(o.kind, o.topic, o.data);
    if (!facts.orderEvent) return Promise.resolve({ outcome: 'ignored', reason: 'not_an_order' });
    const { orgId, kind } = o;
    const storeOrderId = String(o.data.id);

    return runInOrg(orgId, () =>
      this.db.txAs({ orgId }, async (tx): Promise<HandOffOutcome> => {
        const policy = await this.settings.ecomPolicy(tx, orgId, kind);
        if (!policy.autoSend) return { outcome: 'ignored', reason: 'auto_invoice_off' };
        if (!triggerMet(parseEcomTrigger(policy.trigger), facts))
          return { outcome: 'ignored', reason: 'trigger_not_met' };
        if (!(await this.entitlements.featureEnabled(orgId, 'invoicing')))
          return { outcome: 'ignored', reason: 'plan_has_no_invoicing' };

        const order = await this.repo.lockOrder(tx, orgId, kind, storeOrderId);
        if (!order) return { outcome: 'ignored', reason: 'no_mirrored_order' };
        const claimed = await this.repo.claim(tx, orgId, {
          source: kind,
          deliveryId: o.deliveryId,
          topic: o.topic,
          orderId: order.id,
        });
        if (!claimed) return { outcome: 'ignored', reason: 'replay' };

        // The order has its invoice, or had one (a voided invoice is a decision, not a gap): nothing more to bill.
        const known =
          order.invoiceId ?? (await this.billing.findInvoiceForOrder(tx, orgId, order.id))?.id ?? null;
        if (known !== null) {
          if (order.invoiceId === null) await this.repo.setInvoice(tx, orgId, order.id, known);
          await this.repo.settle(tx, orgId, kind, o.deliveryId, {
            outcome: 'existing',
            invoiceId: known,
            reason: null,
          });
          return { outcome: 'existing', invoiceId: known };
        }

        const store = await this.stores.storeById(tx, orgId, kind, o.storeId);
        const fallbackCurrency = !store
          ? null
          : 'shopCurrency' in store
            ? store.shopCurrency
            : store.storeCurrency;
        const ctx = {
          waOrderId: order.id,
          contactId: order.contactId,
          settingsTaxLabel: policy.taxLabel,
          deliveryId: o.deliveryId,
          topic: o.topic,
          fallbackCurrency,
        };
        const input =
          kind === 'shopify' ? shopifyExternalOrder(o.data, ctx) : wooExternalOrder(o.data, ctx);

        let salesOrderId = order.salesOrderId;
        if (salesOrderId === null) {
          salesOrderId = (await this.billing.createSalesOrderIn(tx, orgId, input)).id;
          await this.repo.setSalesOrder(tx, orgId, order.id, salesOrderId);
        }
        const out = await this.billing.invoiceSalesOrderIn(tx, orgId, salesOrderId, input);
        if (out.outcome === 'skipped') {
          await this.repo.settle(tx, orgId, kind, o.deliveryId, {
            outcome: 'skipped',
            invoiceId: null,
            reason: out.reason,
          });
          this.logger.warn({ orgId, kind, order: order.id, reason: out.reason }, 'store order not invoiced');
          return { outcome: 'ignored', reason: out.reason };
        }
        await this.repo.setInvoice(tx, orgId, order.id, out.id);
        if (facts.paid) {
          await this.billing.recordPaymentIn(tx, orgId, out.id, {
            gatewayPaymentId: `ecom:${kind}:${storeOrderId}`,
            method: 'gateway',
            reference: `${kind === 'shopify' ? 'Shopify' : 'WooCommerce'} ${input.reference.split(' ').pop()}`,
            paidAt: paidAtOf(kind, o.data, new Date()),
          });
        }
        await this.billing.autoSendIn(tx, orgId, out.id);
        await this.repo.settle(tx, orgId, kind, o.deliveryId, {
          outcome: out.outcome,
          invoiceId: out.id,
          reason: null,
        });
        return { outcome: out.outcome, invoiceId: out.id };
      }),
    );
  }
}
