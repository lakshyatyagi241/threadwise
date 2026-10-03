import { HttpStatus, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  PAYGW_ADMIN_PAGE_SIZE,
  currencyExponent,
  type AdminMoney,
  type AdminOrdersQuery,
  type AdminOrdersResponse,
  type BillingAnalyticsQuery,
  type BillingAnalyticsResponse,
  type BillingHistoryQuery,
  type BillingHistoryResponse,
  type ExportResponse,
  type InvoiceActionResponse,
  type InvoiceMarkPaidRequest,
  type InvoicesQuery,
  type InvoicesResponse,
  type InvoiceView,
  type ManualInvoiceRequest,
  type OrderActionRequest,
  type OrderActionResponse,
  type OrderAnalyticsQuery,
  type OrderAnalyticsResponse,
  type PaygwOrderStatus,
  type Trend,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { gatewayMeta } from '../../infra/providers/platform-payment-gateways';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { AuthAuditService } from '../auth';
import { AdminBillingRepository, type OrderListRow } from './admin-billing.repository';
import { BillingSettingsService } from './billing-settings.service';
import {
  billingRange,
  buckets,
  deltaPct,
  invoiceRange,
  orderRange,
  type Bucket,
} from './billing-windows';
import { CheckoutSettingsService } from './checkout-settings.service';
import { FulfilmentService } from './fulfilment.service';
import {
  INVOICE_TERMS_DAYS,
  daysLate,
  dueDate,
  invoiceAmounts,
  invoiceBadge,
} from './invoice-rules';
import { recordOrderEvent } from './order-events';
import { majorToMinor, minorToMajor, newOrderNumber } from './order-pricing';
import { OrdersRepository } from './orders.repository';
import { PaygwStore } from './paygw.store';

const DAY = 86_400_000;
const EXPORT_CAP = 5000;

const conflict = (message: string) =>
  new AppError(ERROR_CODES.PAYGW_ORDER_STATE, message, HttpStatus.CONFLICT);

/** CSV cell: quoted, and a leading = + - @ made harmless so a spreadsheet never runs it as a formula. */
export function csvCell(v: unknown): string {
  let t = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}
export const csvLine = (cells: unknown[]): string => cells.map(csvCell).join(',');

/** Folds per-day figures into the window's buckets; days outside every bucket are dropped. */
export function foldDays(bs: Bucket[], days: Map<string, number>): number[] {
  const out = bs.map(() => 0);
  for (const [day, v] of days) {
    const t = Date.parse(`${day}T12:00:00Z`);
    const i = bs.findIndex((b) => t >= b.start.getTime() && t <= b.end.getTime());
    if (i >= 0) out[i]! += v;
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The operator's billing screens (TW-PAYGW-037..046): order history with its approval queue, billing history, invoices and the
 * three analytics. Everything is read across workspaces through PaygwStore, converted into ONE reporting currency (Reference added
 * unconverted amounts of different currencies). Every action writes its security event in the SAME transaction as the change.
 */
@Injectable()
export class AdminBillingService {
  constructor(
    private readonly store: PaygwStore,
    private readonly repo: AdminBillingRepository,
    private readonly orders: OrdersRepository,
    private readonly settings: CheckoutSettingsService,
    private readonly billing: BillingSettingsService,
    private readonly fulfilment: FulfilmentService,
    private readonly outbox: OutboxService,
    private readonly audit: AuthAuditService,
  ) {}

  private async reporting(tx: Tx): Promise<{ currency: string; rate: string }> {
    const { defaultCurrency } = await this.settings.load();
    return { currency: defaultCurrency, rate: await this.repo.rateOf(tx, defaultCurrency) };
  }

  private money(sum: string | number, currency: string): AdminMoney {
    return { currency, amount: Number(sum).toFixed(currencyExponent(currency)) };
  }

  private operatorId(): number {
    const ctx = RequestContextStore.require();
    if (ctx.actorId === null || ctx.actorId === undefined) throw AppError.unauthenticated();
    return ctx.actorId;
  }

  // ---- order history ---------------------------------------------------------------------------------------------------

  async listOrders(q: AdminOrdersQuery): Promise<AdminOrdersResponse> {
    const range = orderRange(q.window);
    return this.store.tx(async (tx) => {
      const rep = await this.reporting(tx);
      const [page, kpi, awaiting] = await Promise.all([
        this.repo.listOrders(tx, {
          from: range.from,
          to: range.to,
          type: q.type,
          q: q.q,
          limit: PAYGW_ADMIN_PAGE_SIZE,
          offset: (q.page - 1) * PAYGW_ADMIN_PAGE_SIZE,
        }),
        this.repo.orderKpis(tx, range, rep.rate),
        this.repo.awaitingApproval(tx),
      ]);
      return {
        total: page.total,
        page: q.page,
        pageSize: PAYGW_ADMIN_PAGE_SIZE,
        data: page.rows.map((r) => this.orderRow(r)),
        awaiting: awaiting.map((a) => ({
          id: a.uuid,
          orderNumber: a.orderNumber,
          workspaceName: a.workspaceName,
          gatewaySlug: a.gatewaySlug,
          currency: a.currency,
          total: this.cellMoney(a.total, a.currency),
          paymentReference: a.paymentReference,
          proofNote: a.proofNote,
          hasProof: a.hasProof,
          proofSubmittedAt: a.proofSubmittedAt ? a.proofSubmittedAt.toISOString() : null,
        })),
        kpis: {
          total: kpi.total,
          totalDeltaPct: deltaPct(kpi.total, kpi.prevTotal),
          upgrades: {
            count: kpi.upgrades.count,
            money: this.money(kpi.upgrades.sum, rep.currency),
          },
          downgrades: {
            count: kpi.downgrades.count,
            money: this.money(kpi.downgrades.sum, rep.currency),
          },
          addons: { count: kpi.addons.count, money: this.money(kpi.addons.sum, rep.currency) },
          cancellations: {
            count: kpi.cancellations.count,
            money: this.money(kpi.cancellations.sum, rep.currency),
          },
        },
        reportingCurrency: rep.currency,
      };
    });
  }

  /** A stored numeric(…,4) total shown in the order's own exponent. */
  private cellMoney(value: string, currency: string): string {
    const minor = majorToMinor(value, currency);
    return minor === null ? value : minorToMajor(minor, currency);
  }

  private orderRow(r: OrderListRow) {
    const name =
      r.kind === 'wallet_topup'
        ? 'Wallet top-up'
        : r.kind === 'manual'
          ? r.description
          : (r.planName ?? r.planSlug);
    return {
      id: r.uuid,
      orderNumber: r.orderNumber,
      createdAt: r.createdAt.toISOString(),
      workspace: r.workspace,
      type: r.type,
      itemName: name,
      itemSub: r.planSlug && r.kind !== 'wallet_topup' ? `plan_${r.planSlug}` : r.gatewaySlug,
      billingPeriod: r.kind === 'plan' ? r.billingPeriod : null,
      status: r.status,
      currency: r.currency,
      total: this.cellMoney(r.total, r.currency),
      gatewaySlug: r.gatewaySlug,
      customerEmail: r.customerEmail,
      awaitingApproval:
        (r.status === 'pending' || r.status === 'awaiting_approval') && r.proofSubmittedAt !== null,
    };
  }

  async orderAnalytics(q: OrderAnalyticsQuery): Promise<OrderAnalyticsResponse> {
    const range = orderRange(q.window);
    const now = new Date();
    return this.store.tx(async (tx) => {
      const rep = await this.reporting(tx);
      const a = await this.repo.orderAnalytics(tx, range, rep.rate);
      const days = await this.repo.motionByDay(tx, range.from, range.to);
      const bs = buckets(range.from, range.to);
      const cohorts = await this.repo.cohorts(tx, now, 6);
      const paid = Number(a.paidSum);
      return {
        reportingCurrency: rep.currency,
        kpis: {
          total: a.total,
          totalDeltaPct: deltaPct(a.total, a.prevTotal),
          newMrr: this.money(paid, rep.currency).amount,
          paidCount: a.paidCount,
          lostMrr: this.money(a.lostSum, rep.currency).amount,
          cancels: a.lostCount,
          avgOrderValue: this.money(
            a.paidCount > 0 ? Math.round(paid / a.paidCount) : 0,
            rep.currency,
          ).amount,
          attachPct: a.total > 0 ? Math.round((a.addonCount / a.total) * 1000) / 10 : 0,
          addons: a.addonCount,
          conversionPct: a.signups > 0 ? Math.round((a.paidCount / a.signups) * 1000) / 10 : 0,
          signups: a.signups,
        },
        motion: {
          labels: bs.map((b) => b.label),
          paid: foldDays(bs, days.paid),
          cancelled: foldDays(bs, days.lost),
        },
        typeMix: [
          { label: 'Renewal', value: a.mix.renewal },
          { label: 'Add-on', value: a.mix.addon },
          { label: 'Cancel', value: a.mix.cancel },
        ],
        addons: a.addons.map((x) => ({
          label: `${x.sku.charAt(0).toUpperCase()}${x.sku.slice(1)} add-on`,
          count: x.count,
          total: this.money(x.total, rep.currency).amount,
        })),
        // Only counts we really have. Reference showed page visits (signups x 10), trials (70%) and active-in-trial (78%) that were never measured.
        funnel: [
          { label: 'Sign-ups', count: a.signups },
          { label: 'Converted to paid', count: a.payers },
        ],
        byCountry: a.countries,
        cohorts,
      };
    });
  }

  // ---- order actions ---------------------------------------------------------------------------------------------------

  private actionResult(
    o: { orderNumber: string },
    status: PaygwOrderStatus,
    unchanged: boolean,
    message: string,
  ): OrderActionResponse {
    return { orderNumber: o.orderNumber, status, unchanged, message };
  }

  /**
   * Approve an offline or pending order: the same fulfilment as a gateway payment (plan window, add-on or wallet), guarded so a
   * second click, a late webhook or a double approval applies it once. Reference allowed any non-paid status; a refunded order is
   * refused here because it is a closed money event.
   */
  async approve(uuid: string): Promise<OrderActionResponse> {
    const operatorId = this.operatorId();
    const head = await this.store.tx((tx) => this.repo.lockByUuid(tx, uuid));
    if (!head) throw AppError.notFound('Order', uuid);
    if (head.status === 'paid') {
      return this.actionResult(head, 'paid', true, `Order ${head.orderNumber} is already paid.`);
    }
    if (head.status === 'refunded') {
      throw conflict(`Order ${head.orderNumber} was refunded and cannot be approved.`);
    }
    const order = await this.store.tx((tx) => this.orders.byUuid(tx, uuid));
    if (!order) throw AppError.notFound('Order', uuid);
    const res = await this.fulfilment.fulfil(order, {
      gatewayPaymentId: head.paymentReference ?? `manual-${head.orderNumber}`,
      payload: { manual: true, approvedBy: 'operator' },
      operator: { id: operatorId, event: 'platform.order.approved' },
    });
    if (!res.applied) {
      return this.actionResult(head, 'paid', true, `Order ${head.orderNumber} is already paid.`);
    }
    return this.actionResult(
      head,
      'paid',
      false,
      `Order ${head.orderNumber} approved, plan activated.`,
    );
  }

  /** Reject a payment proof: the order fails with the operator's note. A paid order cannot be rejected (Reference let a crafted request do it). */
  async reject(uuid: string, input: OrderActionRequest): Promise<OrderActionResponse> {
    const operatorId = this.operatorId();
    return this.store.tx(async (tx) => {
      const o = await this.repo.lockByUuid(tx, uuid);
      if (!o) throw AppError.notFound('Order', uuid);
      if (o.status === 'paid' || o.status === 'refunded') {
        throw conflict(`Order ${o.orderNumber} is ${o.status} and cannot be rejected.`);
      }
      await this.repo.setStatus(tx, o.id, 'failed', {
        failureReason: 'rejected_by_admin',
        reviewNote: input.reviewNote?.trim() || null,
      });
      await recordOrderEvent(tx, this.outbox, { ...o, totalAmount: o.total }, 'failed', {
        reason: 'rejected_by_admin',
      });
      await this.audit.record(tx, {
        event: 'platform.order.rejected',
        status: 'success',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { order: o.orderNumber, amount: o.total, currency: o.currency },
      });
      return this.actionResult(o, 'failed', false, `Order ${o.orderNumber} rejected.`);
    });
  }

  /** Cancel an unfinished order (TW-PAYGW-039): a distinct `cancelled` status instead of overloading failed. Nothing is sent to the gateway. */
  async cancel(uuid: string): Promise<OrderActionResponse> {
    const operatorId = this.operatorId();
    return this.store.tx(async (tx) => {
      const o = await this.repo.lockByUuid(tx, uuid);
      if (!o) throw AppError.notFound('Order', uuid);
      if (o.status === 'paid') {
        return this.actionResult(
          o,
          'paid',
          true,
          `Order ${o.orderNumber} is already paid, cancel is only for pending orders.`,
        );
      }
      if (o.status !== 'pending' && o.status !== 'awaiting_approval') {
        return this.actionResult(o, o.status, true, `Order ${o.orderNumber} is not pending.`);
      }
      await this.repo.setStatus(tx, o.id, 'cancelled', { failureReason: 'cancelled_by_admin' });
      await recordOrderEvent(tx, this.outbox, { ...o, totalAmount: o.total }, 'cancelled', {
        reason: 'cancelled_by_admin',
      });
      await this.audit.record(tx, {
        event: 'platform.order.cancelled',
        status: 'success',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { order: o.orderNumber, amount: o.total, currency: o.currency },
      });
      return this.actionResult(o, 'cancelled', false, `Order ${o.orderNumber} cancelled.`);
    });
  }

  // ---- billing history -------------------------------------------------------------------------------------------------

  private trendOf(
    bs: Bucket[],
    d: { charges: Map<string, number>; refunds: Map<string, number>; failed: Map<string, number> },
    withFailed: boolean,
  ): Trend {
    return {
      labels: bs.map((b) => b.label),
      charges: foldDays(bs, d.charges).map(round2),
      refunds: foldDays(bs, d.refunds).map(round2),
      ...(withFailed ? { failed: foldDays(bs, d.failed).map(round2) } : {}),
    };
  }

  async billingHistory(q: BillingHistoryQuery): Promise<BillingHistoryResponse> {
    const range = billingRange(q.window);
    return this.store.tx(async (tx) => {
      const rep = await this.reporting(tx);
      const [list, gateways, now, prev, days] = await Promise.all([
        this.repo.listEvents(tx, {
          from: range.from,
          to: range.to,
          status: q.status,
          gateway: q.gateway,
          q: q.q,
          limit: PAYGW_ADMIN_PAGE_SIZE,
          offset: (q.page - 1) * PAYGW_ADMIN_PAGE_SIZE,
        }),
        this.repo.gatewaySlugs(tx),
        this.repo.outcomeTotals(tx, range, rep.rate),
        this.repo.outcomeTotals(tx, { from: range.prevFrom, to: range.prevTo }, rep.rate),
        this.repo.trendByDay(tx, range.from, range.to, rep.rate),
      ]);
      const auth = now.paid.count + now.failed.count;
      return {
        total: list.total,
        page: q.page,
        pageSize: PAYGW_ADMIN_PAGE_SIZE,
        data: list.rows.map((r) => ({
          id: r.uuid,
          orderNumber: r.orderNumber,
          createdAt: r.createdAt.toISOString(),
          workspace: r.workspace,
          customerEmail: r.customerEmail,
          customerName: r.customerName,
          gatewaySlug: r.gatewaySlug,
          planName: r.planName,
          status: r.status,
          currency: r.currency,
          total: this.cellMoney(r.total, r.currency),
        })),
        gateways,
        reportingCurrency: rep.currency,
        kpis: {
          gross: this.money(now.paid.sum, rep.currency),
          grossDeltaPct: deltaPct(Number(now.paid.sum), Number(prev.paid.sum)),
          charges: now.paid.count,
          failed: now.failed.count,
          successPct: auth > 0 ? Math.round((now.paid.count / auth) * 1000) / 10 : 0,
          refunds: now.refunded.count,
          refundsMoney: this.money(now.refunded.sum, rep.currency),
          // Disputes are not modelled (Reference's card is a constant 0 too).
          chargebacks: 0,
          chargebacksMoney: this.money(0, rep.currency),
        },
        trend: this.trendOf(buckets(range.from, range.to), days, false),
      };
    });
  }

  async billingAnalytics(q: BillingAnalyticsQuery): Promise<BillingAnalyticsResponse> {
    const range = billingRange(q.window);
    return this.store.tx(async (tx) => {
      const rep = await this.reporting(tx);
      const [now, prev, days, mix, status, top] = await Promise.all([
        this.repo.outcomeTotals(tx, range, rep.rate),
        this.repo.outcomeTotals(tx, { from: range.prevFrom, to: range.prevTo }, rep.rate),
        this.repo.trendByDay(tx, range.from, range.to, rep.rate),
        this.repo.gatewayMix(tx, range, rep.rate),
        this.repo.statusMix(tx, range),
        this.repo.topPayers(tx, range, rep.rate),
      ]);
      const gross = Number(now.paid.sum);
      const refunds = Number(now.refunded.sum);
      const auth = now.paid.count + now.failed.count;
      const cap = (x: string) => `${x.charAt(0).toUpperCase()}${x.slice(1)}`;
      return {
        reportingCurrency: rep.currency,
        kpis: {
          gross: this.money(gross, rep.currency),
          grossDeltaPct: deltaPct(gross, Number(prev.paid.sum)),
          net: this.money(Math.max(0, gross - refunds), rep.currency),
          netPct: gross > 0 ? Math.round((1 - refunds / gross) * 1000) / 10 : 0,
          successPct: auth > 0 ? Math.round((now.paid.count / auth) * 1000) / 10 : 0,
          totalCharges: auth,
          paidCount: now.paid.count,
          failed: this.money(now.failed.sum, rep.currency),
          failedCount: now.failed.count,
          refunds: this.money(now.refunded.sum, rep.currency),
          refundsCount: now.refunded.count,
          chargebacks: this.money(0, rep.currency),
          chargebacksCount: 0,
        },
        trend: this.trendOf(buckets(range.from, range.to), days, true),
        gatewayMix: mix.map((m) => ({ label: cap(m.slug), value: round2(m.value) })),
        statusMix: status.map((m) => ({ label: cap(m.status), value: m.value })),
        topWorkspaces: top.map((t) => ({
          workspace: t.workspace,
          orders: t.orders,
          total: this.money(t.total, rep.currency).amount,
        })),
      };
    });
  }

  // ---- invoices --------------------------------------------------------------------------------------------------------

  private invoiceItem(r: { kind: string; description: string | null; planName: string | null }) {
    if (r.kind === 'manual') return r.description ?? 'Manual invoice';
    if (r.kind === 'wallet_topup') return 'Wallet top-up';
    return r.planName ?? 'Add-on';
  }

  async listInvoices(q: InvoicesQuery): Promise<InvoicesResponse> {
    const now = new Date();
    const win = invoiceRange(q.window, now);
    const overdueBefore = new Date(now.getTime() - INVOICE_TERMS_DAYS * DAY);
    return this.store.tx(async (tx) => {
      const rep = await this.reporting(tx);
      const [list, k, choices] = await Promise.all([
        this.repo.listInvoices(tx, {
          from: win.from,
          to: win.to,
          status: q.status,
          overdueBefore,
          q: q.q,
          limit: PAYGW_ADMIN_PAGE_SIZE,
          offset: (q.page - 1) * PAYGW_ADMIN_PAGE_SIZE,
        }),
        this.repo.invoiceKpis(tx, now, overdueBefore, rep.rate),
        this.repo.workspaceChoices(tx),
      ]);
      return {
        total: list.total,
        page: q.page,
        pageSize: PAYGW_ADMIN_PAGE_SIZE,
        data: list.rows.map((r) => ({
          id: r.uuid,
          number: r.number,
          issuedAt: r.createdAt.toISOString(),
          dueAt: dueDate(r.createdAt).toISOString(),
          workspace: r.workspace,
          ownerName: r.ownerName,
          ownerEmail: r.ownerEmail,
          itemName: this.invoiceItem(r),
          itemUnit: r.kind === 'plan' || r.kind === 'addon' ? r.planUnit : null,
          billingPeriod: r.kind === 'plan' || r.kind === 'addon' ? r.billingPeriod : null,
          currency: r.currency,
          total: this.cellMoney(r.total, r.currency),
          badge: invoiceBadge(r.status, r.createdAt, now),
          daysLate:
            invoiceBadge(r.status, r.createdAt, now) === 'overdue' ? daysLate(r.createdAt, now) : 0,
          manual: r.kind === 'manual',
        })),
        reportingCurrency: rep.currency,
        kpis: {
          total: k.total,
          paid: k.paid,
          paidPct: k.total > 0 ? Math.round((k.paid / k.total) * 1000) / 10 : 0,
          outstanding: k.pending,
          outstandingMoney: this.money(k.pendingSum, rep.currency),
          overdue: k.overdue,
          thisMonth: this.money(k.monthSum, rep.currency),
          thisMonthDeltaPct: deltaPct(Number(k.monthSum), Number(k.prevSum)),
        },
        workspaces: choices,
      };
    });
  }

  async proof(uuid: string): Promise<{ mime: string; bytes: Buffer }> {
    const row = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT b.mime, b.bytes FROM orders o
        JOIN order_proof_blobs b ON b.org_id = o.org_id AND b.order_id = o.id
        WHERE o.uuid = ${uuid}`);
      return (res.rows[0] as { mime: string; bytes: Buffer } | undefined) ?? null;
    });
    if (!row) throw AppError.notFound('Payment proof', uuid);
    return { mime: row.mime, bytes: row.bytes };
  }

  async invoiceView(uuid: string): Promise<InvoiceView> {
    const raw = await this.store.tx((tx) => this.repo.invoiceDetail(tx, uuid));
    if (!raw) throw AppError.notFound('Invoice', uuid);
    return this.viewFromRaw(raw);
  }

  /** The invoice document from one `invoiceDetail` row. The operator's view and the buyer's view are built from the same rows. */
  async viewFromRaw(raw: Record<string, unknown>): Promise<InvoiceView> {
    const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
    const status = String(raw.status) as PaygwOrderStatus;
    const issued = new Date(String(raw.created_at));
    const currency = String(raw.currency);
    const amounts = invoiceAmounts({
      status,
      currency,
      amount: String(raw.amount),
      discountAmount: String(raw.discount_amount),
      taxAmount: String(raw.tax_amount),
      totalAmount: String(raw.total_amount),
    });
    const wsName = str(raw.ws_name);
    const [billing, taxLabel] = await Promise.all([
      this.billing.billingBlock('Reference'),
      this.billing.taxLabel(),
    ]);
    const kind = String(raw.kind);
    const gatewaySlug = str(raw.gateway_slug);
    const address = [
      str(raw.billing_address),
      [str(raw.billing_city), str(raw.billing_postal)].filter(Boolean).join(' '),
      str(raw.billing_country),
    ].filter((l): l is string => Boolean(l && l.trim()));
    return {
      id: String(raw.uuid),
      number: String(raw.order_number),
      issuedAt: issued.toISOString(),
      paidAt: raw.paid_at ? new Date(String(raw.paid_at)).toISOString() : null,
      badge: invoiceBadge(status, issued),
      status,
      workspace: raw.ws_uuid
        ? { id: String(raw.ws_uuid), name: String(raw.ws_name), slug: String(raw.ws_slug) }
        : null,
      billTo: {
        name: str(raw.billing_company) ?? str(raw.customer_name) ?? wsName ?? str(raw.owner_name),
        email: str(raw.customer_email) ?? str(raw.owner_email),
        addressLines: address,
        taxId: str(raw.billing_tax_id),
      },
      payment: {
        method:
          gatewaySlug === 'manual' || !gatewaySlug
            ? 'Manual'
            : (gatewayMeta(gatewaySlug)?.name ?? gatewaySlug),
        reference: str(raw.gateway_payment_id) ?? str(raw.payment_reference),
        paidAt: raw.paid_at ? new Date(String(raw.paid_at)).toISOString() : null,
        currency,
        couponCode: str(raw.coupon_code),
      },
      line: {
        // Unlike Reference, a manual invoice prints its description.
        description:
          kind === 'manual'
            ? (str(raw.description) ?? 'Invoice')
            : kind === 'wallet_topup'
              ? 'Wallet top-up'
              : (str(raw.plan_name) ?? 'Plan purchase'),
        reference: `Order ${String(raw.order_number)}`,
        unit: kind === 'plan' || kind === 'addon' ? str(raw.plan_unit) : null,
      },
      currency,
      subtotal: amounts.subtotal,
      discount: amounts.discount,
      taxRate: String(Number(raw.tax_rate)),
      taxAmount: amounts.taxAmount,
      total: amounts.total,
      amountPaid: amounts.amountPaid,
      balanceDue: amounts.balanceDue,
      taxLabel,
      gatewaySlug,
      billing,
      manual: kind === 'manual',
    };
  }

  async createManual(input: ManualInvoiceRequest): Promise<{ id: string; number: string }> {
    const operatorId = this.operatorId();
    const issued = input.issuedAt ? new Date(`${input.issuedAt}T00:00:00.000Z`) : new Date();
    const minor = majorToMinor(input.amount, input.currency);
    if (minor === null || minor <= 0n) {
      throw AppError.validation('Invalid amount', [
        { path: 'amount', message: 'enter a positive amount' },
      ]);
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const orderNumber = newOrderNumber(new Date(), (n) =>
        Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join(''),
      );
      try {
        return await this.store.tx(async (tx) => {
          const wsRow = await this.repo.workspaceForInvoice(tx, input.workspaceId);
          if (!wsRow) throw AppError.notFound('Workspace', input.workspaceId);
          const created = await this.repo.insertManual(tx, {
            orgId: wsRow.orgId,
            userId: wsRow.ownerId,
            orderNumber,
            currency: input.currency,
            amount: minorToMajor(minor, input.currency),
            status: input.status,
            issuedAt: issued,
            customerName: input.customerName?.trim() || wsRow.name,
            customerEmail: input.customerEmail?.trim() || null,
            description: input.description,
            issuedBy: operatorId,
          });
          await recordOrderEvent(
            tx,
            this.outbox,
            {
              id: created.id,
              orgId: wsRow.orgId,
              orderNumber,
              kind: 'manual',
              currency: input.currency,
              totalAmount: minorToMajor(minor, input.currency),
              gatewaySlug: 'manual',
            },
            input.status === 'paid' ? 'paid' : 'created',
            { manual: true },
          );
          await this.audit.record(tx, {
            event: 'platform.invoice.created',
            status: 'success',
            actorType: 'platform_operator',
            actorId: operatorId,
            payload: {
              order: orderNumber,
              amount: input.amount,
              currency: input.currency,
              status: input.status,
            },
          });
          return { id: created.uuid, number: orderNumber };
        });
      } catch (err) {
        if (err instanceof AppError && err.getStatus() === HttpStatus.CONFLICT) continue;
        throw err;
      }
    }
    throw new AppError(
      ERROR_CODES.INTERNAL,
      'Could not allocate an invoice number.',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  private invoiceResult(
    number: string,
    status: PaygwOrderStatus | null,
    message: string,
  ): InvoiceActionResponse {
    return { number, badge: status ? invoiceBadge(status, new Date()) : null, message };
  }

  /**
   * Mark an invoice paid. With `applyFulfilment` it is the order-history approval (plan, add-on or wallet applied); without, it
   * only records the payment, which is what Reference's invoice menu did for every order (a paid plan order then had no plan).
   */
  async markPaid(uuid: string, input: InvoiceMarkPaidRequest): Promise<InvoiceActionResponse> {
    if (input.applyFulfilment) {
      const r = await this.approve(uuid);
      return this.invoiceResult(r.orderNumber, 'paid', r.message);
    }
    const operatorId = this.operatorId();
    return this.store.tx(async (tx) => {
      const o = await this.repo.lockByUuid(tx, uuid);
      if (!o) throw AppError.notFound('Invoice', uuid);
      if (o.status === 'refunded')
        throw conflict(`Invoice ${o.orderNumber} was refunded and cannot be marked paid.`);
      if (o.status !== 'paid') {
        await this.repo.setStatus(tx, o.id, 'paid', { paidAt: true });
        await recordOrderEvent(tx, this.outbox, { ...o, totalAmount: o.total }, 'paid', {
          applied: 'recorded_only',
        });
        await this.audit.record(tx, {
          event: 'platform.invoice.marked_paid',
          status: 'success',
          actorType: 'platform_operator',
          actorId: operatorId,
          payload: {
            order: o.orderNumber,
            amount: o.total,
            currency: o.currency,
            fulfilment: false,
          },
        });
      }
      return this.invoiceResult(o.orderNumber, 'paid', `Invoice ${o.orderNumber} marked as paid.`);
    });
  }

  async voidInvoice(uuid: string): Promise<InvoiceActionResponse> {
    const operatorId = this.operatorId();
    return this.store.tx(async (tx) => {
      const o = await this.repo.lockByUuid(tx, uuid);
      if (!o) throw AppError.notFound('Invoice', uuid);
      if (o.status === 'paid') {
        throw conflict('A paid invoice cannot be voided, issue a refund instead.');
      }
      if (o.status === 'refunded') throw conflict('A refunded invoice cannot be voided.');
      if (o.status !== 'cancelled') {
        await this.repo.setStatus(tx, o.id, 'cancelled', { failureReason: 'voided_by_admin' });
        await recordOrderEvent(tx, this.outbox, { ...o, totalAmount: o.total }, 'cancelled', {
          reason: 'voided_by_admin',
        });
        await this.audit.record(tx, {
          event: 'platform.invoice.voided',
          status: 'success',
          actorType: 'platform_operator',
          actorId: operatorId,
          payload: { order: o.orderNumber, amount: o.total, currency: o.currency },
        });
      }
      return this.invoiceResult(o.orderNumber, 'cancelled', `Invoice ${o.orderNumber} voided.`);
    });
  }

  async deleteInvoice(uuid: string): Promise<InvoiceActionResponse> {
    const operatorId = this.operatorId();
    return this.store.tx(async (tx) => {
      const o = await this.repo.lockByUuid(tx, uuid);
      if (!o) throw AppError.notFound('Invoice', uuid);
      if (o.status === 'paid') {
        throw conflict('A paid invoice cannot be deleted, void or refund it instead.');
      }
      if (o.status === 'refunded')
        throw conflict('A refunded invoice is part of the revenue record and cannot be deleted.');
      await this.repo.deleteOrder(tx, o.id);
      await this.audit.record(tx, {
        event: 'platform.invoice.deleted',
        status: 'success',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { order: o.orderNumber, amount: o.total, currency: o.currency, status: o.status },
      });
      return this.invoiceResult(o.orderNumber, null, `Invoice ${o.orderNumber} deleted.`);
    });
  }

  // ---- CSV exports (Reference's buttons had no handler) -------------------------------------------------------------------

  async exportOrders(q: AdminOrdersQuery): Promise<ExportResponse> {
    const range = orderRange(q.window);
    const rows = await this.store.tx((tx) =>
      this.repo.exportOrders(
        tx,
        { from: range.from, to: range.to, type: q.type, q: q.q },
        EXPORT_CAP + 1,
      ),
    );
    const lines = [
      csvLine([
        'Order #',
        'Date',
        'Workspace',
        'Type',
        'Item',
        'Status',
        'Currency',
        'Total',
        'Gateway',
        'Customer email',
      ]),
    ];
    for (const r of rows.slice(0, EXPORT_CAP)) {
      const o = this.orderRow(r);
      lines.push(
        csvLine([
          o.orderNumber,
          o.createdAt.slice(0, 10),
          o.workspace?.name,
          o.type,
          o.itemName,
          o.status,
          o.currency,
          o.total,
          o.gatewaySlug,
          o.customerEmail,
        ]),
      );
    }
    return {
      filename: `order-history-${q.window}.csv`,
      csv: `${lines.join('\n')}\n`,
      rows: Math.min(rows.length, EXPORT_CAP),
      truncated: rows.length > EXPORT_CAP,
    };
  }

  async exportBilling(q: BillingHistoryQuery): Promise<ExportResponse> {
    const range = billingRange(q.window);
    const list = await this.store.tx((tx) =>
      this.repo.listEvents(tx, {
        from: range.from,
        to: range.to,
        status: q.status,
        gateway: q.gateway,
        q: q.q,
        limit: EXPORT_CAP + 1,
        offset: 0,
      }),
    );
    const lines = [
      csvLine([
        'Date',
        'Order #',
        'Workspace',
        'Customer',
        'Gateway',
        'Plan',
        'Status',
        'Currency',
        'Amount',
      ]),
    ];
    for (const r of list.rows.slice(0, EXPORT_CAP)) {
      lines.push(
        csvLine([
          r.createdAt.toISOString(),
          r.orderNumber,
          r.workspace?.name,
          r.customerEmail ?? r.customerName,
          r.gatewaySlug,
          r.planName,
          r.status,
          r.currency,
          this.cellMoney(r.total, r.currency),
        ]),
      );
    }
    return {
      filename: `billing-history-${q.window}.csv`,
      csv: `${lines.join('\n')}\n`,
      rows: Math.min(list.rows.length, EXPORT_CAP),
      truncated: list.rows.length > EXPORT_CAP,
    };
  }

  async exportInvoices(q: InvoicesQuery): Promise<ExportResponse> {
    const now = new Date();
    const win = invoiceRange(q.window, now);
    const overdueBefore = new Date(now.getTime() - INVOICE_TERMS_DAYS * DAY);
    const list = await this.store.tx((tx) =>
      this.repo.listInvoices(tx, {
        from: win.from,
        to: win.to,
        status: q.status,
        overdueBefore,
        q: q.q,
        limit: EXPORT_CAP + 1,
        offset: 0,
      }),
    );
    const lines = [
      csvLine([
        'Invoice #',
        'Issued',
        'Due',
        'Workspace',
        'Owner email',
        'Item',
        'Status',
        'Currency',
        'Amount',
      ]),
    ];
    for (const r of list.rows.slice(0, EXPORT_CAP)) {
      lines.push(
        csvLine([
          r.number,
          r.createdAt.toISOString().slice(0, 10),
          dueDate(r.createdAt).toISOString().slice(0, 10),
          r.workspace?.name,
          r.ownerEmail,
          this.invoiceItem(r),
          invoiceBadge(r.status, r.createdAt, now),
          r.currency,
          this.cellMoney(r.total, r.currency),
        ]),
      );
    }
    return {
      filename: `invoices-${q.window}.csv`,
      csv: `${lines.join('\n')}\n`,
      rows: Math.min(list.rows.length, EXPORT_CAP),
      truncated: list.rows.length > EXPORT_CAP,
    };
  }
}
