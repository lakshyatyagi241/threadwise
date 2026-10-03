import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

export interface DueRecovery {
  id: number;
  orgId: number;
  storefrontId: number;
  customerPhone: string;
  customerName: string | null;
  subtotalMinor: number;
  currencyCode: string;
}

/** `storefront_cart_recoveries`: active -> sent when the nudge went out, active -> recovered when the buyer ordered. */
@Injectable()
export class CartRecoveryRepository {
  /**
   * One active row per shop and phone: the partial unique index decides, so two beacons arriving together cannot both insert.
   * Returns false when an active row already exists (nothing is refreshed or rescheduled, as in WaDesk).
   */
  async insertActive(
    tx: Tx,
    orgId: number,
    v: {
      storefrontId: number;
      phoneDigits: string;
      name: string | null;
      items: unknown;
      subtotalMinor: number;
      currencyCode: string;
      delayMinutes: number;
    },
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      INSERT INTO storefront_cart_recoveries
        (org_id, storefront_id, customer_phone, customer_name, items_json, subtotal_minor, currency_code, status, nudge_at)
      VALUES (${orgId}, ${v.storefrontId}, ${v.phoneDigits}, ${v.name}, ${JSON.stringify(v.items)}::jsonb,
              ${v.subtotalMinor}, ${v.currencyCode}, 'active', now() + make_interval(mins => ${v.delayMinutes}))
      ON CONFLICT (org_id, storefront_id, customer_phone) WHERE status = 'active' DO NOTHING
      RETURNING id`);
    return res.rows.length > 0;
  }

  /** The buyer ordered: every active recovery of this shop and phone is `recovered` and will never be nudged. */
  async markRecovered(
    tx: Tx,
    orgId: number,
    storefrontId: number,
    phoneDigits: string,
  ): Promise<number> {
    if (!phoneDigits) return 0;
    const res = await tx.execute(sql`
      UPDATE storefront_cart_recoveries SET status = 'recovered'
      WHERE org_id = ${orgId} AND storefront_id = ${storefrontId} AND customer_phone = ${phoneDigits} AND status = 'active'
      RETURNING id`);
    return res.rows.length;
  }

  /**
   * The worker's claim, across every organization: active rows whose nudge is due and not yet sent, locked with SKIP LOCKED so
   * two workers never take the same row. Runs in the privileged transaction (a sanctioned cross-tenant use).
   */
  async claimDue(tx: Tx, limit: number): Promise<DueRecovery[]> {
    const res = await tx.execute(sql`
      SELECT id, org_id, storefront_id, customer_phone, customer_name, subtotal_minor, currency_code
      FROM storefront_cart_recoveries
      WHERE status = 'active' AND nudged_at IS NULL AND nudge_at <= now()
      ORDER BY nudge_at, id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED`);
    return (
      res.rows as Array<{
        id: number | string;
        org_id: number | string;
        storefront_id: number | string;
        customer_phone: string;
        customer_name: string | null;
        subtotal_minor: number | string;
        currency_code: string;
      }>
    ).map((r) => ({
      id: Number(r.id),
      orgId: Number(r.org_id),
      storefrontId: Number(r.storefront_id),
      customerPhone: r.customer_phone,
      customerName: r.customer_name,
      subtotalMinor: Number(r.subtotal_minor),
      currencyCode: r.currency_code,
    }));
  }

  /** Stamps the nudge as handled and moves the row out of `active`, so the same phone can start a new recovery later (D-12). */
  async markSent(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE storefront_cart_recoveries SET status = 'sent', nudged_at = now()
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'active'`);
  }

  /** Has the buyer ordered since the cart was left? (The order may have been placed while the claim was in flight.) */
  async isStillActive(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT 1 FROM storefront_cart_recoveries WHERE org_id = ${orgId} AND id = ${id} AND status = 'active'`,
    );
    return res.rows.length > 0;
  }
}
