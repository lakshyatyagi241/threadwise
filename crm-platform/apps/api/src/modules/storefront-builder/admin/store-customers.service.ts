import { Inject, Injectable } from '@nestjs/common';
import {
  countryCodeDigits,
  STORE_CUSTOMER_PHONE_ID,
  type ListStoreCustomersQuery,
  type SaveStoreCustomerInput,
  type StoreCustomer,
  type StoreCustomerDetail,
  type StoreCustomerListResponse,
  type UpdateStoreCustomerInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { phoneKey } from '../../../common/sql/phone-key';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { CONTACT_RESOLVER, type ContactResolverPort } from '../../crm/contact-resolver.port';
import { StoreOrdersRepository } from './store-orders.repository';
import {
  StoreCustomersRepository,
  encodeCustomerCursor,
  type BuyerRow,
  type CustomerRow,
} from './store-customers.repository';

export const CUSTOMER_MODULE = 'wa_customer_profiles';
const blank = (v: string | null | undefined): string | null => v?.trim() || null;

/**
 * The customers of the store. Reference's screen (`WaCustomerProfileController`) lists the SAVED customers only: a merchant pre-sets a
 * buyer's name, company and delivery address by phone so the WhatsApp ordering flow shows it. Here the list is every buyer (decided
 * 2026-10-05, see wiring/store-orders-crm.md): the saved profiles plus everyone found in `wa_orders`, grouped by their normalised phone
 * (the platform's default country code is put in front of a bare local number). A row carries what the buyer bought (count, lifetime
 * total per currency without cancelled orders, last order), the CRM contact the order flow linked, and whether a delivery address is
 * saved. The list runs by last activity, newest first (the latest order, else the profile's last change).
 *
 * A buyer with a saved profile is identified by the profile's uuid, one without by `phone:<normalised digits>`; detail takes either.
 * Edit keeps Reference's save-by-phone: editing an order-only buyer creates their profile. Delete removes the profile only. Reference also
 * deleted every order of that phone (financial history, one browser confirm): orders are kept for the books, the same decision as the
 * WhatsApp customers screen; an order-only buyer has nothing to delete (404).
 */
@Injectable()
export class StoreCustomersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: StoreCustomersRepository,
    private readonly shops: StoreOrdersRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(CONTACT_RESOLVER) private readonly resolver: ContactResolverPort,
  ) {}

  async list(query: ListStoreCustomersQuery): Promise<StoreCustomerListResponse> {
    const ctx = RequestContextStore.require();
    const cc = await this.countryDigits();
    return this.db.tx(async (tx) => {
      let storefrontId: number | undefined;
      if (query.storefrontId) {
        storefrontId = await this.shops.shopIdByUuid(tx, ctx.orgId, query.storefrontId);
        // A shop of another workspace is invisible under RLS: a filter on it matches nothing, like any unknown shop.
        if (storefrontId === undefined) {
          return { data: [], page: { nextCursor: null, hasMore: false, limit: query.limit } };
        }
      }
      const rows = await this.repo.buyers(tx, ctx.orgId, cc, {
        q: query.q,
        storefrontId,
        cursor: query.cursor,
        limit: query.limit,
      });
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const last = items[items.length - 1];
      return {
        data: items.map(toCustomer),
        page: {
          nextCursor:
            hasMore && last
              ? encodeCustomerCursor({
                  activityUs: last.activityUs,
                  key: last.key,
                  profileId: last.profileId ?? 0,
                })
              : null,
          hasMore,
          limit: query.limit,
        },
      };
    });
  }

  /** One customer by profile uuid or `phone:<digits>`. */
  async get(id: string): Promise<StoreCustomerDetail> {
    const ctx = RequestContextStore.require();
    const cc = await this.countryDigits();
    return this.db.tx(async (tx) => {
      const row = await this.orFail(tx, ctx.orgId, cc, id);
      return this.detail(tx, ctx.orgId, cc, row);
    });
  }

  /** Reference `store`: create or update by phone. An unusable phone (no digits) is a validation error. */
  async save(input: SaveStoreCustomerInput): Promise<StoreCustomer> {
    const ctx = RequestContextStore.require();
    const cc = await this.countryDigits();
    const phone = this.keyOf(input.phone, cc);
    return this.db.tx(async (tx) => {
      const made = await this.upsertByKey(tx, ctx.orgId, cc, phone, {
        name: blank(input.name),
        company: blank(input.company),
        address: blank(input.address),
      });
      return toCustomer((await this.buyer(tx, ctx.orgId, cc, made.key))!);
    });
  }

  /**
   * Edit name, company and address. A saved customer is updated in place (optimistic lock on `rowVersion`); an order-only buyer
   * (`phone:<digits>`) gets their profile created from the form, as Reference's save-by-phone would.
   */
  async update(id: string, input: UpdateStoreCustomerInput): Promise<StoreCustomerDetail> {
    const ctx = RequestContextStore.require();
    const cc = await this.countryDigits();
    const orderOnly = STORE_CUSTOMER_PHONE_ID.exec(id)?.[1];
    return this.db.tx(async (tx) => {
      const next = {
        name: blank(input.name),
        company: blank(input.company),
        address: blank(input.address),
      };
      if (orderOnly !== undefined) {
        const made = await this.upsertByKey(tx, ctx.orgId, cc, orderOnly, next);
        return this.detail(tx, ctx.orgId, cc, (await this.buyer(tx, ctx.orgId, cc, made.key))!);
      }
      const row = await this.repo.findByUuid(tx, ctx.orgId, id, { lock: true });
      if (!row) throw AppError.notFound('Customer', id);
      if (input.rowVersion !== undefined && input.rowVersion !== row.rowVersion) {
        throw AppError.rowVersionConflict('Customer');
      }
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
      const key = (await this.repo.keyOfProfile(tx, ctx.orgId, id, cc))!;
      return this.detail(tx, ctx.orgId, cc, (await this.buyer(tx, ctx.orgId, cc, key))!);
    });
  }

  async remove(id: string): Promise<void> {
    const ctx = RequestContextStore.require();
    // An order-only buyer has no profile: nothing to remove (their orders are kept for the books).
    if (STORE_CUSTOMER_PHONE_ID.test(id)) throw AppError.notFound('Customer', id);
    await this.db.tx(async (tx) => {
      const gone = await this.repo.delete(tx, ctx.orgId, id);
      if (!gone) throw AppError.notFound('Customer', id);
      await this.audit.record(tx, { module: CUSTOMER_MODULE, recordId: gone.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: CUSTOMER_MODULE,
        aggregateId: gone.id,
        eventType: 'store.customer_deleted',
        payload: { customerId: id },
      });
    });
  }

  // --- helpers ------------------------------------------------------------------------------------------------------------------

  /** The default country code as digits ("91"), "" when it cannot be read (a bare local number then stays as typed). */
  private async countryDigits(): Promise<string> {
    return countryCodeDigits(await this.resolver.defaultCountryCode());
  }

  /** The normalised digits of a typed phone; no digits at all is a validation error. */
  private keyOf(phone: string, cc: string): string {
    const key = phoneKey(phone, cc ? `+${cc}` : null);
    if (!key) {
      throw AppError.validation('Enter a valid phone number (with country code).', [
        { path: 'phone', message: 'Enter a valid phone number (with country code).' },
      ]);
    }
    return key;
  }

  /**
   * Reference's updateOrCreate by phone: the profile of this number is replaced by the submitted fields, or created. A profile saved as
   * the same number in another form (a bare local number) is the same customer and is updated, never duplicated.
   */
  private async upsertByKey(
    tx: Tx,
    orgId: number,
    cc: string,
    key: string,
    v: { name: string | null; company: string | null; address: string | null },
  ): Promise<{ key: string }> {
    const existing = await this.repo.findProfileByKey(tx, orgId, key, cc, { lock: true });
    const made = existing
      ? { id: existing.id, uuid: existing.uuid, created: false }
      : await this.repo.upsert(tx, orgId, { phone: key, ...v });
    if (existing) {
      await this.repo.update(tx, orgId, existing.id, v, existing.rowVersion);
    }
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
    return { key };
  }

  private async buyer(
    tx: Tx,
    orgId: number,
    cc: string,
    key: string,
  ): Promise<BuyerRow | undefined> {
    return (await this.repo.buyers(tx, orgId, cc, { key }))[0];
  }

  private async orFail(tx: Tx, orgId: number, cc: string, id: string): Promise<BuyerRow> {
    const key =
      STORE_CUSTOMER_PHONE_ID.exec(id)?.[1] ?? (await this.repo.keyOfProfile(tx, orgId, id, cc));
    const row = key === undefined ? undefined : await this.buyer(tx, orgId, cc, key);
    if (!row) throw AppError.notFound('Customer', id);
    return row;
  }

  private async detail(
    tx: Tx,
    orgId: number,
    cc: string,
    row: BuyerRow,
  ): Promise<StoreCustomerDetail> {
    return {
      ...toCustomer(row),
      recentOrders: await this.repo.recentOrders(tx, orgId, row.key, cc, 10),
    };
  }
}

export function toCustomer(r: BuyerRow): StoreCustomer {
  return {
    id: r.profileUuid ?? `phone:${r.key}`,
    phone: r.profilePhone ?? r.key,
    name: r.name,
    company: r.company,
    address: r.address,
    hasProfile: r.profileId !== null,
    hasSavedAddress: r.profileId !== null && blank(r.address) !== null,
    orderCount: r.stats.orderCount,
    lifetimeTotals: r.stats.totals,
    lastOrderAt: r.stats.lastOrderAt?.toISOString() ?? null,
    contactId: r.contactUuid,
    rowVersion: r.rowVersion,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export type { CustomerRow };
