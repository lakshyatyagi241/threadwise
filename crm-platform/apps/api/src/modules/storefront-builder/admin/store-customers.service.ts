import { Injectable } from '@nestjs/common';
import type {
  ListStoreCustomersQuery,
  SaveStoreCustomerInput,
  StoreCustomer,
  StoreCustomerDetail,
  StoreCustomerListResponse,
  UpdateStoreCustomerInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { phoneDigits } from '../rules/coupon-admin';
import {
  StoreCustomersRepository,
  encodeCustomerCursor,
  type CustomerRow,
  type PhoneStats,
} from './store-customers.repository';

export const CUSTOMER_MODULE = 'wa_customer_profiles';
const EMPTY: PhoneStats = { orderCount: 0, totals: [], lastOrderAt: null };
const blank = (v: string | null | undefined): string | null => v?.trim() || null;

/**
 * The saved customers of the store (Reference `WaCustomerProfileController`): a merchant pre-sets a buyer's name, company and delivery
 * address by phone so the WhatsApp ordering flow shows it. Kept: the search is literal text over name, phone and company, the list
 * runs by name then phone, one form creates or updates by phone (digits only). Added: edit and open one customer, what each has
 * bought (orders matched on the digits of the phone: count, and lifetime total per currency without cancelled orders), and the CRM
 * contact when the order flow linked one.
 *
 * Delete removes the profile only. Reference also deleted every order of that phone (financial history, one browser confirm): orders
 * are kept for the books, the same decision as the WhatsApp customers screen.
 */
@Injectable()
export class StoreCustomersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: StoreCustomersRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async list(query: ListStoreCustomersQuery): Promise<StoreCustomerListResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId, query);
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const stats = await this.repo.statsFor(
        tx,
        ctx.orgId,
        items.map((r) => r.phone),
      );
      const last = items[items.length - 1];
      return {
        data: items.map((r) => toCustomer(r, stats.get(r.phone) ?? EMPTY)),
        page: {
          nextCursor:
            hasMore && last
              ? encodeCustomerCursor({
                  unnamed: last.name === null,
                  name: last.name ?? '',
                  phone: last.phone,
                  id: last.id,
                })
              : null,
          hasMore,
          limit: query.limit,
        },
      };
    });
  }

  async get(uuid: string): Promise<StoreCustomerDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.orFail(tx, ctx.orgId, uuid);
      return this.detail(tx, ctx.orgId, row);
    });
  }

  /** Reference `store`: create or update by phone. An unusable phone (no digits) is a validation error. */
  async save(input: SaveStoreCustomerInput): Promise<StoreCustomer> {
    const ctx = RequestContextStore.require();
    const phone = phoneDigits(input.phone);
    if (!phone) {
      throw AppError.validation('Enter a valid phone number (with country code).', [
        { path: 'phone', message: 'Enter a valid phone number (with country code).' },
      ]);
    }
    return this.db.tx(async (tx) => {
      const made = await this.repo.upsert(tx, ctx.orgId, {
        phone,
        name: blank(input.name),
        company: blank(input.company),
        address: blank(input.address),
      });
      await this.audit.record(tx, {
        module: CUSTOMER_MODULE,
        recordId: made.id,
        action: made.created ? 'insert' : 'update',
      });
      await this.outbox.emit(tx, {
        aggregateModule: CUSTOMER_MODULE,
        aggregateId: made.id,
        eventType: made.created ? 'store.customer_created' : 'store.customer_updated',
        payload: { customerId: made.uuid },
      });
      const row = (await this.repo.findByUuid(tx, ctx.orgId, made.uuid))!;
      return toCustomer(
        row,
        (await this.repo.statsFor(tx, ctx.orgId, [row.phone])).get(row.phone) ?? EMPTY,
      );
    });
  }

  async update(uuid: string, input: UpdateStoreCustomerInput): Promise<StoreCustomerDetail> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, { lock: true });
      if (!row) throw AppError.notFound('Customer', uuid);
      if (input.rowVersion !== undefined && input.rowVersion !== row.rowVersion) {
        throw AppError.rowVersionConflict('Customer');
      }
      const next = {
        name: blank(input.name),
        company: blank(input.company),
        address: blank(input.address),
      };
      const ok = await this.repo.update(tx, ctx.orgId, row.id, next, row.rowVersion);
      if (!ok) throw AppError.rowVersionConflict('Customer');
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      for (const k of ['name', 'company', 'address'] as const) {
        if (row[k] !== next[k]) delta[k] = { old: row[k], new: next[k] };
      }
      await this.audit.record(tx, {
        module: CUSTOMER_MODULE,
        recordId: row.id,
        action: 'update',
        delta,
      });
      await this.outbox.emit(tx, {
        aggregateModule: CUSTOMER_MODULE,
        aggregateId: row.id,
        eventType: 'store.customer_updated',
        payload: { customerId: row.uuid },
      });
      return this.detail(tx, ctx.orgId, (await this.repo.findByUuid(tx, ctx.orgId, uuid))!);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const gone = await this.repo.delete(tx, ctx.orgId, uuid);
      if (!gone) throw AppError.notFound('Customer', uuid);
      await this.audit.record(tx, { module: CUSTOMER_MODULE, recordId: gone.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: CUSTOMER_MODULE,
        aggregateId: gone.id,
        eventType: 'store.customer_deleted',
        payload: { customerId: uuid },
      });
    });
  }

  private async orFail(tx: Tx, orgId: number, uuid: string): Promise<CustomerRow> {
    const row = await this.repo.findByUuid(tx, orgId, uuid);
    if (!row) throw AppError.notFound('Customer', uuid);
    return row;
  }

  private async detail(tx: Tx, orgId: number, row: CustomerRow): Promise<StoreCustomerDetail> {
    const stats = (await this.repo.statsFor(tx, orgId, [row.phone])).get(row.phone) ?? EMPTY;
    return {
      ...toCustomer(row, stats),
      recentOrders: await this.repo.recentOrders(tx, orgId, row.phone, 10),
    };
  }
}

export function toCustomer(r: CustomerRow, s: PhoneStats): StoreCustomer {
  return {
    id: r.uuid,
    phone: r.phone,
    name: r.name,
    company: r.company,
    address: r.address,
    orderCount: s.orderCount,
    lifetimeTotals: s.totals,
    lastOrderAt: s.lastOrderAt?.toISOString() ?? null,
    contactId: r.contactUuid,
    rowVersion: r.rowVersion,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
