import { Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES, minorToMajor } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../../common/errors/app-error';
import { PlanUsageService } from '../../plans-subscriptions-trials';
import { simpleTax, type LineSpec, type TaxSpec } from './invoice-content';
import { InvoicesRepository, type InvoiceRow } from './invoices.repository';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';
import { SalesOrdersRepository } from './sales-orders.repository';
import { SalesOrdersService } from './sales-orders.service';

/** One line of an order that was placed elsewhere (a store, a WhatsApp cart), priced in the currency's TRUE minor units. */
export interface ExternalOrderLine {
  description: string;
  sku: string | null;
  /** Decimal quantity string ("2", "1.5"). */
  qty: string;
  unitPriceMinor: bigint;
}

/**
 * An order from a commerce channel, as the invoicing module needs it (Reference's `InvoiceDraft`, minus the PDF concerns). The caller maps
 * its own table to this: money is already in the currency's true minor units, the discount is the whole order's, the tax is the one
 * the checkout captured (null when none was: that is what makes the document a receipt).
 */
export interface ExternalOrderInput {
  /** The channel's own order id (`wa_orders.id`): the idempotency key of the invoice (`invoices.wa_order_id`). */
  waOrderId: number;
  /** What the sales order and the invoice carry as their reference ("Store order #12"). */
  reference: string;
  contactId: number | null;
  buyer: {
    name: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
  };
  currency: string;
  lines: ExternalOrderLine[];
  discountMinor: bigint;
  shippingMinor: bigint;
  tax: { inclusive: boolean; label: string | null; ratePercent: string } | null;
  notes: string | null;
  /** What the channel says the buyer owes: compared with what the priced document says, a difference is recorded, never hidden. */
  orderTotalMinor: bigint;
  docType: 'tax_invoice' | 'receipt';
  meta: Record<string, unknown>;
}

export interface ExternalSalesOrderRef {
  id: number;
  uuid: string;
  number: string;
  created: boolean;
}

export type ExternalInvoiceOutcome =
  | {
      outcome: 'invoiced' | 'existing';
      id: number;
      uuid: string;
      number: string | null;
      docType: string;
      totalMinor: bigint;
    }
  | { outcome: 'skipped'; reason: 'plan_limit_reached' | 'nothing_to_invoice' };

export interface ExternalPaymentInput {
  /** A stable id for this payment: replaying it records nothing twice (`wa_order:<id>` when the gateway gave none). */
  gatewayPaymentId: string;
  method: 'storefront' | 'wa_pay' | 'gateway';
  reference: string | null;
  paidAt: Date;
}

/**
 * Splits a document discount over the lines in proportion to their amounts, in minor units, the last discounted line taking the
 * rounding remainder (the same rule a proposal's document discount follows when it becomes an order, `specsFromQuote`). A discount
 * larger than the goods is clamped to them.
 */
export function allocateDiscount(grossMinor: bigint[], discountMinor: bigint): bigint[] {
  const total = grossMinor.reduce((a, b) => a + b, 0n);
  const out = grossMinor.map(() => 0n);
  const wanted = discountMinor > total ? total : discountMinor;
  if (wanted <= 0n || total <= 0n) return out;
  let given = 0n;
  let last = -1;
  grossMinor.forEach((g, i) => {
    if (g > 0n) last = i;
  });
  grossMinor.forEach((g, i) => {
    if (i === last) out[i] = wanted - given;
    else {
      // half-up, on the proportional share
      out[i] = (wanted * g * 2n + total) / (total * 2n);
      given += out[i]!;
    }
  });
  return out;
}

/** The lines of an external order as invoice-line specs: the document discount folded into the lines, one tax rate on every line. */
export function specsOfExternalOrder(input: ExternalOrderInput): LineSpec[] {
  const cur = input.currency.toUpperCase();
  const gross = input.lines.map((l) => lineGrossMinor(l));
  const shares = allocateDiscount(gross, input.discountMinor);
  const tax: TaxSpec | null = input.tax
    ? simpleTax(
        null,
        input.tax.label?.trim() || 'Tax',
        null,
        input.tax.ratePercent,
        input.tax.inclusive,
      )
    : null;
  return input.lines.map((l, i) => ({
    description: l.description,
    sku: l.sku,
    hsnSac: null,
    qty: l.qty,
    unitPrice: minorToMajor(l.unitPriceMinor, cur),
    discount: shares[i]! > 0n ? { kind: 'amount', value: minorToMajor(shares[i]!, cur) } : null,
    tax,
  }));
}

/** unit price x quantity in minor units, half-up (quantities have up to 4 decimals). */
export function lineGrossMinor(l: ExternalOrderLine): bigint {
  const [whole = '0', frac = ''] = l.qty.split('.');
  const scale = 10n ** BigInt(frac.length);
  const q = BigInt(whole) * scale + BigInt(frac || '0');
  return (l.unitPriceMinor * q * 2n + scale) / (scale * 2n);
}

const FIELD_META = 'storeOrder';

/**
 * Bills an order that was placed in a commerce channel into the CRM's sales module: a confirmed sales order, then (when asked) an
 * invoice or receipt and the payment that settled it. Everything runs inside the CALLER's transaction, so the order's link columns, the
 * sales order, the invoice and the ledger entry commit together or not at all, and a redelivered event finds the rows it made.
 *
 * It is the public door of this module for other domains: they never write `sales_orders`, `invoices` or `payments` themselves. The
 * numbering, the totals engine, the frozen-after-issue rule, the audit rows, the timeline and the outbox events are the ones every
 * invoice goes through (`SalesOrdersService`, `InvoicesService`, `PaymentsService`).
 */
@Injectable()
export class ExternalOrderBillingService {
  private readonly logger = new Logger(ExternalOrderBillingService.name);

  constructor(
    private readonly salesOrders: SalesOrdersService,
    private readonly salesRepo: SalesOrdersRepository,
    private readonly invoices: InvoicesService,
    private readonly invoicesRepo: InvoicesRepository,
    private readonly payments: PaymentsService,
    private readonly planUsage: PlanUsageService,
  ) {}

  /** The confirmed sales order of a channel order. */
  async createSalesOrderIn(
    tx: Tx,
    orgId: number,
    input: ExternalOrderInput,
  ): Promise<ExternalSalesOrderRef> {
    const row = await this.salesOrders.createExternalIn(tx, orgId, {
      specs: specsOfExternalOrder(input),
      currency: input.currency.toUpperCase(),
      shipping: input.shippingMinor > 0n ? minorToMajor(input.shippingMinor, input.currency) : null,
      contactId: input.contactId,
      buyer: input.buyer,
      reference: input.reference,
      notes: input.notes,
    });
    return { id: row.id, uuid: row.uuid, number: row.number, created: true };
  }

  /**
   * The invoice (or receipt) of a sales order made by `createSalesOrderIn`, issued at once. The invoice is the order's only one:
   * a second call returns it (`outcome: 'existing'`), which the unique index on `invoices.wa_order_id` also guarantees. A plan that
   * has reached `invoices_monthly` skips with a reason instead of throwing (the order stands).
   */
  async invoiceSalesOrderIn(
    tx: Tx,
    orgId: number,
    salesOrderId: number,
    input: ExternalOrderInput,
  ): Promise<ExternalInvoiceOutcome> {
    const zone = await this.invoices.zone(tx, orgId);
    const existingId = await this.invoicesRepo.liveIdByWaOrder(tx, orgId, input.waOrderId);
    const existing =
      existingId === undefined
        ? undefined
        : await this.invoicesRepo.findById(tx, orgId, existingId, zone);
    if (existing) {
      return {
        outcome: 'existing',
        id: existing.id,
        uuid: existing.uuid,
        number: existing.number,
        docType: existing.docType,
        totalMinor: existing.totalMinor,
      };
    }
    try {
      await this.planUsage.assertCanAdd(orgId, 'invoices_monthly');
    } catch (err) {
      if (err instanceof AppError && err.code === ERROR_CODES.PLAN_LIMIT_REACHED) {
        this.logger.warn(
          { orgId, order: input.waOrderId },
          'invoices_monthly reached: no invoice for the store order',
        );
        return { outcome: 'skipped', reason: 'plan_limit_reached' };
      }
      throw err;
    }
    const order = await this.salesRepo.findById(tx, orgId, salesOrderId);
    if (!order) throw AppError.notFound('Sales order', String(salesOrderId));
    let billed;
    try {
      billed = await this.salesOrders.invoiceRowIn(
        tx,
        orgId,
        null,
        // the order row locked for the billing, as a person's "Invoice" does
        (await this.salesRepo.findByUuid(tx, orgId, order.uuid, true))!,
        { all: true, includeShipping: true, issue: false },
        {
          docType: input.docType,
          source: 'own',
          buyerAddress: input.buyer.address,
          meta: { ...input.meta, [FIELD_META]: input.waOrderId },
        },
      );
    } catch (err) {
      if (err instanceof AppError && err.code === ERROR_CODES.SO_NOTHING_TO_INVOICE) {
        return { outcome: 'skipped', reason: 'nothing_to_invoice' };
      }
      throw err;
    }
    const draft = billed.invoiceRow;
    await this.invoicesRepo.setWaOrderId(tx, orgId, draft.id, input.waOrderId);
    const issued = await this.invoices.issueIn(tx, orgId, null, draft, {});
    if (issued.totalMinor !== input.orderTotalMinor) {
      // The checkout's total and the priced document disagree (a tax rate that had to be derived, a clamped discount). The invoice
      // is the document the buyer will see, so it stands; the difference is written on it for whoever reconciles.
      await this.invoicesRepo.log(tx, orgId, issued.id, {
        event: 'note',
        detail: `store order total ${minorToMajor(input.orderTotalMinor, issued.currency)} differs from the invoice total`,
        actorKind: 'system',
        actorUserId: null,
      });
    }
    return {
      outcome: 'invoiced',
      id: issued.id,
      uuid: issued.uuid,
      number: issued.number,
      docType: issued.docType,
      totalMinor: issued.totalMinor,
    };
  }

  /**
   * Records the order's payment against its invoice: the open balance, paid now. Idempotent on `gatewayPaymentId` (a replayed event
   * writes nothing). Returns true when an entry was written.
   */
  async recordPaymentIn(
    tx: Tx,
    orgId: number,
    invoiceId: number,
    pay: ExternalPaymentInput,
  ): Promise<boolean> {
    const zone = await this.invoices.zone(tx, orgId);
    const inv = await this.invoicesRepo.findById(tx, orgId, invoiceId, zone, true);
    if (!inv || inv.storedStatus !== 'issued') return false;
    const balance = inv.totalMinor - inv.paidMinor - inv.creditedMinor;
    if (balance <= 0n) return false;
    const { payment } = await this.payments.recordIn(tx, orgId, null, inv, {
      amountMinor: balance,
      currency: inv.currency,
      method: pay.method,
      source: pay.method === 'gateway' ? 'gateway' : pay.method,
      paidAt: pay.paidAt,
      reference: pay.reference,
      note: null,
      allowOverpayment: false,
      gatewayPaymentId: pay.gatewayPaymentId,
      metaJson: { [FIELD_META]: true },
    });
    return payment !== undefined;
  }

  /** Cancels the sales order of a channel order that was cancelled there; false when an invoice made from it is still live. */
  cancelSalesOrderIn(
    tx: Tx,
    orgId: number,
    salesOrderId: number,
    reason: string,
  ): Promise<boolean> {
    return this.salesOrders.cancelExternalIn(tx, orgId, salesOrderId, reason);
  }

  /** The invoice linked to a channel order, if any (the order's own `invoice_id` column is the first answer; this is the fallback). */
  async findInvoiceForOrder(
    tx: Tx,
    orgId: number,
    waOrderId: number,
  ): Promise<InvoiceRow | undefined> {
    const id = await this.invoicesRepo.liveIdByWaOrder(tx, orgId, waOrderId);
    if (id === undefined) return undefined;
    return this.invoicesRepo.findById(tx, orgId, id, await this.invoices.zone(tx, orgId));
  }
}
