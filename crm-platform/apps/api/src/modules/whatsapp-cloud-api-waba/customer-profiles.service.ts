import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  CustomerList,
  CustomerProfile,
  ListCustomersQuery,
  SaveCustomerInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';

const MODULE = 'wa_customer_profiles';
export const CUSTOMER_PAGE_SIZE = 20;

/** The number reduced to its digits, the key an order and a profile share. Null when nothing is left. */
export function customerDigits(phone: string): string | null {
  const d = phone.replace(/\D+/g, '');
  return d === '' ? null : d;
}

/** `LIKE` text for a search term: the term is literal, so `%`, `_` and the escape character itself are escaped. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

interface Row {
  uuid: string;
  phone: string;
  name: string | null;
  company: string | null;
  address: string | null;
  updated_at: Date | string;
}

const toProfile = (r: Row): CustomerProfile => ({
  id: r.uuid,
  phone: r.phone,
  name: r.name,
  company: r.company,
  address: r.address,
  updatedAt: new Date(r.updated_at).toISOString(),
});

/**
 * Saved customer profiles (WD-WABA-055, 056). The ordering flow reads a profile by the customer's phone, so a pre-set address wins over
 * the one from their last order. Offset paging with a total (a merchant's address book is small, not a stream).
 */
@Injectable()
export class CustomerProfilesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListCustomersQuery): Promise<CustomerList> {
    const { orgId } = RequestContextStore.require();
    const where = query.q
      ? sql`AND (name ILIKE ${likePattern(query.q)} OR phone ILIKE ${likePattern(query.q)} OR company ILIKE ${likePattern(query.q)})`
      : sql``;
    return this.db.tx(async (tx) => {
      const total = await tx.execute(
        sql`SELECT count(*)::int AS n FROM wa_customer_profiles WHERE org_id = ${orgId} ${where}`,
      );
      const rows = await tx.execute(
        sql`SELECT uuid, phone, name, company, address, updated_at FROM wa_customer_profiles
             WHERE org_id = ${orgId} ${where}
             ORDER BY name NULLS LAST, phone
             LIMIT ${CUSTOMER_PAGE_SIZE} OFFSET ${(query.page - 1) * CUSTOMER_PAGE_SIZE}`,
      );
      return {
        items: (rows.rows as unknown as Row[]).map(toProfile),
        page: query.page,
        pageSize: CUSTOMER_PAGE_SIZE,
        total: Number((total.rows[0] as { n: number }).n),
      };
    });
  }

  /** One form creates or updates: an upsert on (workspace, digits). */
  async save(input: SaveCustomerInput): Promise<CustomerProfile> {
    const { orgId } = RequestContextStore.require();
    const phone = customerDigits(input.phone);
    if (!phone) throw AppError.validation('Enter a valid phone number (with country code).');
    return this.db.tx(async (tx) => {
      const res = await tx.execute(
        sql`INSERT INTO wa_customer_profiles (org_id, phone, name, company, address)
            VALUES (${orgId}, ${phone}, ${input.name}, ${input.company}, ${input.address})
            ON CONFLICT (org_id, phone) DO UPDATE
              SET name = EXCLUDED.name, company = EXCLUDED.company, address = EXCLUDED.address
            RETURNING id, uuid, phone, name, company, address, updated_at, (xmax = 0) AS created`,
      );
      const r = res.rows[0] as unknown as Row & { id: number | string; created: boolean };
      await this.audit.record(tx, {
        module: MODULE,
        recordId: Number(r.id),
        action: r.created ? 'insert' : 'update',
      });
      return toProfile(r);
    });
  }

  /**
   * Removes the profile only. WaDesk also deleted every order of that phone (financial history, no confirmation beyond the browser's);
   * orders are kept here for the books. An unknown id is a 404, not a quiet success.
   */
  async remove(uuid: string): Promise<void> {
    const { orgId } = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const res = await tx.execute(
        sql`DELETE FROM wa_customer_profiles WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid RETURNING id`,
      );
      const row = res.rows[0] as { id: number | string } | undefined;
      if (!row) throw AppError.notFound('Saved customer', uuid);
      await this.audit.record(tx, { module: MODULE, recordId: Number(row.id), action: 'delete' });
    });
  }
}
