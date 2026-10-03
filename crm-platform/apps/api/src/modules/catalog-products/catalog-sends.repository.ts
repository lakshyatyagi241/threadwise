import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { CatalogSendActivity } from '@crm/contracts';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** The log of catalog messages (WD-CAT-016): one row per attempt to one recipient, written with the audit row of the attempt. */
@Injectable()
export class CatalogSendsRepository {
  async insert(
    tx: Tx,
    orgId: number,
    v: {
      userId: number | null;
      recipient: string;
      mode: string;
      header: string | null;
      body: string | null;
      footer: string | null;
      productIds: string[];
      productNames: string[];
      status: 'sent' | 'failed';
      error: string | null;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO cat_catalog_sends (org_id, user_id, recipient, mode, header, body, footer, product_ids, product_names, status, error)
      VALUES (${orgId}, ${v.userId}, ${v.recipient}, ${v.mode}, ${v.header}, ${v.body}, ${v.footer},
              ${JSON.stringify(v.productIds)}::jsonb, ${JSON.stringify(v.productNames)}::jsonb, ${v.status}, ${v.error})
      RETURNING id`);
    return Number((res.rows[0] as Raw).id);
  }

  /** Newest first. The number is shown in full (WaDesk disabled masking product-wide). */
  async recent(tx: Tx, orgId: number, limit: number): Promise<CatalogSendActivity[]> {
    const res = await tx.execute(sql`
      SELECT s.uuid, s.recipient, s.mode, s.header, s.body, s.product_ids, s.product_names, s.status, s.error,
             s.created_at, u.full_name
      FROM cat_catalog_sends s
      LEFT JOIN users u ON u.org_id = s.org_id AND u.id = s.user_id
      WHERE s.org_id = ${orgId}
      ORDER BY s.id DESC
      LIMIT ${limit}`);
    return (res.rows as Raw[]).map((r) => ({
      id: r.uuid as string,
      recipient: r.recipient as string,
      mode: r.mode as CatalogSendActivity['mode'],
      body: (r.body as string | null) ?? null,
      header: (r.header as string | null) ?? null,
      productCount: strings(r.product_ids).length,
      productNames: strings(r.product_names),
      status: r.status as 'sent' | 'failed',
      error: (r.error as string | null) ?? null,
      sentBy: (r.full_name as string | null) ?? null,
      createdAt: new Date(r.created_at as string).toISOString(),
    }));
  }
}
