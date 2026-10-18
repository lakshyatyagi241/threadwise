import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { StoreKind } from './mirror-rules';

export interface Audience {
  phone: string;
  name: string | null;
  /** The contact behind the row when the audience is made of contacts (an offer's group); absent for a number read off an order. */
  contactId?: number | null;
}

export interface OfferProduct {
  name: string;
  priceMinor: number;
  productUrl: string | null;
}

/** The audiences of the offer and win-back broadcasts (TW-ECOM-014, 015), inside the caller's tenant transaction. */
@Injectable()
export class SegmentsRepository {
  /** Opted-in, unarchived members of a contact group (by uuid). A contact with no number is kept: it counts as failed, as Reference. */
  async groupMembers(tx: Tx, orgId: number, groupUuid: string): Promise<Audience[]> {
    const res = await tx.execute(sql`
      SELECT c.id, c.phone, c.name
      FROM contact_group_members m
      JOIN contact_groups g ON g.org_id = m.org_id AND g.id = m.group_id
      JOIN contacts c ON c.org_id = m.org_id AND c.id = m.contact_id
      WHERE m.org_id = ${orgId} AND g.uuid = ${groupUuid}::uuid AND NOT c.is_unsubscribed AND NOT c.is_archived
      ORDER BY c.id`);
    return (
      res.rows as Array<{ id: number | string; phone: string | null; name: string | null }>
    ).map((r) => ({ phone: r.phone ?? '', name: r.name, contactId: Number(r.id) }));
  }

  /** The numbers of customers whose orders match: last order older than `days` (0 = any), at least `minOrders` orders and `minSpentMinor` spent. */
  async lapsedPhones(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    f: { days: number; minOrders: number; minSpentMinor: number },
  ): Promise<string[]> {
    const res = await tx.execute(sql`
      SELECT customer_phone FROM wa_orders
      WHERE org_id = ${orgId} AND source = ${kind} AND customer_phone IS NOT NULL AND customer_phone <> ''
      GROUP BY customer_phone
      HAVING (${f.days} = 0 OR max(created_at) < now() - make_interval(days => ${f.days}))
         AND (${f.minOrders} = 0 OR count(*) >= ${f.minOrders})
         AND (${f.minSpentMinor} = 0 OR sum(total_minor) >= ${f.minSpentMinor})
      ORDER BY customer_phone`);
    return (res.rows as Array<{ customer_phone: string }>).map((r) => r.customer_phone);
  }

  /** Numbers (digits) of contacts who opted out. */
  async optedOut(tx: Tx, orgId: number): Promise<Set<string>> {
    const res = await tx.execute(
      sql`SELECT phone FROM contacts WHERE org_id = ${orgId} AND is_unsubscribed AND phone IS NOT NULL`,
    );
    return new Set(
      (res.rows as Array<{ phone: string }>).map((r) => r.phone.replace(/\D/g, '')).filter(Boolean),
    );
  }

  /**
   * The contacts that own each number (digits), in one statement per thousand numbers. The match is the ConsentGate's own for a phone
   * (`normalized_phone` as E.164 with its plus, or the bare digits), so the verdict is read for the same contacts it would find. A number
   * can belong to more than one contact; one with none is simply absent from the map.
   */
  async contactIdsByDigits(
    tx: Tx,
    orgId: number,
    numbers: readonly string[],
  ): Promise<Map<string, number[]>> {
    const out = new Map<string, number[]>();
    const unique = [...new Set(numbers.filter((n) => n.length >= 6 && n.length <= 15))];
    for (let i = 0; i < unique.length; i += 1000) {
      const part = unique.slice(i, i + 1000);
      const keys = part.flatMap((n) => [n, `+${n}`]);
      const res = await tx.execute(sql`
        SELECT c.id, c.normalized_phone FROM contacts c
        WHERE c.org_id = ${orgId} AND c.normalized_phone IN (${sql.join(
          keys.map((k) => sql`${k}`),
          sql`, `,
        )})`);
      for (const r of res.rows as Array<{ id: number | string; normalized_phone: string }>) {
        const key = r.normalized_phone.replace(/\D/g, '');
        out.set(key, [...(out.get(key) ?? []), Number(r.id)]);
      }
    }
    return out;
  }

  async product(tx: Tx, orgId: number, uuid: string): Promise<OfferProduct | undefined> {
    const res = await tx.execute(sql`
      SELECT name, price_minor, product_url FROM wa_products WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`);
    const r = res.rows[0] as
      { name: string; price_minor: number | string | null; product_url: string | null } | undefined;
    return r
      ? { name: r.name, priceMinor: Number(r.price_minor ?? 0), productUrl: r.product_url }
      : undefined;
  }
}
