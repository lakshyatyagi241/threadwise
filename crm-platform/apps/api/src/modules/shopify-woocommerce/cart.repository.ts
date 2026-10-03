import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { StoreKind } from './mirror-rules';

export interface Recovery {
  id: number;
  storeId: number;
  scheduledIds: string[];
}

// Table names are fixed by the store kind, never taken from input.
const table = (kind: StoreKind): SQL =>
  sql.raw(kind === 'shopify' ? 'shopify_cart_recoveries' : 'woocommerce_cart_recoveries');

const toRecovery = (r: Record<string, unknown>): Recovery => ({
  id: Number(r.id),
  storeId: Number(r.integration_id),
  scheduledIds: Array.isArray(r.scheduled_ids)
    ? r.scheduled_ids.filter((x): x is string => typeof x === 'string')
    : [],
});

/** The abandoned-cart recoveries of a store (WD-ECOM-019), inside the caller's tenant transaction. */
@Injectable()
export class CartRepository {
  /** Opens a recovery and returns its id. `encryptedToken` is the checkout token, encrypted by the caller. */
  async open(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    storeId: number,
    v: { encryptedToken: string; phone: string; email: string | null },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO ${table(kind)} (org_id, integration_id, checkout_token, customer_phone, customer_email, scheduled_ids, status)
      VALUES (${orgId}, ${storeId}, ${v.encryptedToken}, ${v.phone}, ${v.email}, '[]'::jsonb, 'active')
      RETURNING id`);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  async setScheduled(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    id: number,
    ids: readonly string[],
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE ${table(kind)} SET scheduled_ids = ${JSON.stringify(ids)}::jsonb, updated_at = now(), row_version = row_version + 1
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** Is this recovery still waiting? A step whose recovery was closed (the customer ordered) must not send. */
  async isActive(tx: Tx, orgId: number, kind: StoreKind, id: number): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT 1 FROM ${table(kind)} WHERE org_id = ${orgId} AND id = ${id} AND status = 'active'`,
    );
    return res.rows.length > 0;
  }

  /** The recoveries still waiting for this number, across the organization's stores of this kind. */
  async activeByPhone(tx: Tx, orgId: number, kind: StoreKind, phone: string): Promise<Recovery[]> {
    const res = await tx.execute(sql`
      SELECT id, integration_id, scheduled_ids FROM ${table(kind)}
      WHERE org_id = ${orgId} AND customer_phone = ${phone} AND status = 'active' ORDER BY id`);
    return (res.rows as Array<Record<string, unknown>>).map(toRecovery);
  }

  /** `recovered` (the customer ordered) or `cancelled` (nothing could be scheduled). */
  async setStatus(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    id: number,
    status: 'recovered' | 'cancelled',
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE ${table(kind)} SET status = ${status}, updated_at = now(), row_version = row_version + 1
      WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
