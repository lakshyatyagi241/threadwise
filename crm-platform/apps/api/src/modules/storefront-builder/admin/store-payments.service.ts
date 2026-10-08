import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type {
  ListStorePaymentsQuery,
  SaveWhatsappPayConfigInput,
  StorePaymentListResponse,
  StorePaymentRecord,
  StorePaymentSummary,
  WhatsappPayConfig,
  WhatsappPayListResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { PAYMENT_STATUS_SQL } from './payment-sql';
import { ORDER_COLUMNS, ORDER_FROM, orderConditions, toOrderRow } from './store-orders.repository';

const WAPAY_MODULE = 'workspace_payment_configs';

interface ConfigRaw {
  id: number | string;
  uuid: string;
  config_name: string;
  payment_type: string;
  country: string;
  currency: string;
  is_active: boolean;
  meta_json: Record<string, unknown> | null;
  row_version: number;
  updated_at: Date | string;
}

const toConfig = (r: ConfigRaw): WhatsappPayConfig => ({
  id: r.uuid,
  configName: r.config_name,
  paymentType: r.payment_type,
  country: r.country,
  currency: r.currency,
  isActive: r.is_active,
  autoCharge: r.meta_json?.auto_charge === true,
  rowVersion: r.row_version,
  updatedAt: new Date(r.updated_at).toISOString(),
});

const CONFIG_COLUMNS = sql`id, uuid, config_name, payment_type, country, currency, is_active, meta_json, row_version, updated_at`;

/**
 * The store's Payments screen. Reference's /store/payments is Meta's WhatsApp Pay page (the merchant names the "Direct Pay Method"
 * made in WhatsApp Manager); here it also carries the read-only money side of the store's orders, derived from the orders
 * themselves (the same expression the order list filters on). Charging through WhatsApp Pay is not part of this service.
 */
@Injectable()
export class StorePaymentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Orders where money was asked for or arrived (nothing for an `unpaid` one unless that status is asked for), newest first. */
  async list(query: ListStorePaymentsQuery): Promise<StorePaymentListResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const where: SQL[] = orderConditions(ctx.orgId, {
        paymentStatus: query.status,
        method: query.method,
        from: query.from,
        to: query.to,
        q: query.q,
        cursor: query.cursor,
      });
      if (!query.status) where.push(sql`${PAYMENT_STATUS_SQL} <> 'unpaid'`);
      const res = await tx.execute(sql`
        SELECT ${ORDER_COLUMNS} FROM ${ORDER_FROM}
        WHERE ${sql.join(where, sql` AND `)}
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT ${query.limit + 1}`);
      const rows = (res.rows as unknown as Parameters<typeof toOrderRow>[0][]).map(toOrderRow);
      const { items, page } = buildPage(rows, query.limit);
      return {
        data: items.map((o): StorePaymentRecord => {
          const meta = o.metaJson ?? {};
          const via = typeof meta.paid_via === 'string' ? meta.paid_via : null;
          const ref =
            typeof meta.gateway_payment_id === 'string'
              ? meta.gateway_payment_id
              : typeof meta.razorpay_payment === 'string'
                ? meta.razorpay_payment
                : o.waPaymentTxnId;
          return {
            orderId: o.uuid,
            orderNo: o.id,
            customerName: o.customerName,
            customerPhone: o.customerPhone,
            status: o.paymentStatus,
            method: o.paymentMethod,
            paidVia: via ?? (o.waPaymentStatus ? 'whatsapp_pay' : null),
            reference: ref ?? null,
            waPaymentStatus: o.waPaymentStatus,
            paymentLink: o.paymentLink,
            amountMinor: o.totalMinor,
            currencyCode: o.currencyCode,
            storefrontName: o.storefrontName,
            createdAt: o.createdAt.toISOString(),
            updatedAt: o.updatedAt.toISOString(),
          };
        }),
        page,
      };
    });
  }

  async summary(): Promise<StorePaymentSummary> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT ${PAYMENT_STATUS_SQL} AS status, o.currency_code, count(*)::int AS n, coalesce(sum(o.total_minor), 0)::bigint AS total
        FROM wa_orders o WHERE o.org_id = ${ctx.orgId}
        GROUP BY 1, 2`);
      const out: StorePaymentSummary = { paid: 0, awaiting: 0, cod: 0, unpaid: 0, collected: [] };
      for (const r of res.rows as Array<{
        status: keyof Omit<StorePaymentSummary, 'collected'>;
        currency_code: string;
        n: number;
        total: number | string;
      }>) {
        out[r.status] += r.n;
        if (r.status === 'paid')
          out.collected.push({ currencyCode: r.currency_code, totalMinor: Number(r.total) });
      }
      return out;
    });
  }

  // ---- WhatsApp Pay configurations -----------------------------------------------------------------------------------

  async listWhatsappPay(): Promise<WhatsappPayListResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT ${CONFIG_COLUMNS} FROM workspace_payment_configs WHERE org_id = ${ctx.orgId} ORDER BY id DESC`,
      );
      const data = (res.rows as unknown as ConfigRaw[]).map(toConfig);
      return { data, page: { nextCursor: null, hasMore: false, limit: data.length } };
    });
  }

  /** Reference `store`: create or update by name; country and currency are India's (the only market WhatsApp Pay supports). */
  async saveWhatsappPay(input: SaveWhatsappPayConfigInput): Promise<WhatsappPayConfig> {
    const ctx = RequestContextStore.require();
    const name = input.configName.trim();
    return this.db.tx(async (tx) => {
      const waba = await tx.execute(sql`
        SELECT id FROM wa_provider_configs WHERE org_id = ${ctx.orgId} AND provider = 'waba' ORDER BY id LIMIT 1`);
      const providerId = (waba.rows[0] as { id: number | string } | undefined)?.id ?? null;
      const res = await tx.execute(sql`
        INSERT INTO workspace_payment_configs (org_id, provider_config_id, config_name, payment_type, country, currency, is_active, meta_json)
        VALUES (${ctx.orgId}, ${providerId === null ? null : Number(providerId)}, ${name}, ${input.paymentType}, 'IN', 'INR', ${input.isActive},
                ${JSON.stringify({ auto_charge: input.autoCharge })}::jsonb)
        ON CONFLICT (org_id, config_name) DO UPDATE
          SET provider_config_id = EXCLUDED.provider_config_id, payment_type = EXCLUDED.payment_type, country = 'IN',
              currency = 'INR', is_active = EXCLUDED.is_active, meta_json = EXCLUDED.meta_json
        RETURNING ${CONFIG_COLUMNS}, (xmax = 0) AS created`);
      const row = res.rows[0] as unknown as ConfigRaw & { created: boolean };
      await this.audit.record(tx, {
        module: WAPAY_MODULE,
        recordId: Number(row.id),
        action: row.created ? 'insert' : 'update',
        delta: {
          configName: { old: null, new: name },
          paymentType: { old: null, new: input.paymentType },
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: WAPAY_MODULE,
        aggregateId: Number(row.id),
        eventType: 'store.whatsapp_pay_config_saved',
        payload: { configName: name, isActive: input.isActive },
      });
      return toConfig(row);
    });
  }

  async removeWhatsappPay(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const res = await tx.execute(
        sql`DELETE FROM workspace_payment_configs WHERE org_id = ${ctx.orgId} AND uuid = ${uuid}::uuid RETURNING id, config_name`,
      );
      const row = res.rows[0] as { id: number | string; config_name: string } | undefined;
      if (!row) throw AppError.notFound('Payment configuration', uuid);
      await this.audit.record(tx, {
        module: WAPAY_MODULE,
        recordId: Number(row.id),
        action: 'delete',
        delta: { configName: { old: row.config_name, new: null } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: WAPAY_MODULE,
        aggregateId: Number(row.id),
        eventType: 'store.whatsapp_pay_config_removed',
        payload: { configName: row.config_name },
      });
    });
  }
}
