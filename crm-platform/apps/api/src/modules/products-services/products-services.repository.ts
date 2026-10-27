import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { ListSalesItemsQuery, SalesItemKind } from '@crm/contracts';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;

export interface SalesItemRow {
  id: number;
  uuid: string;
  kind: SalesItemKind;
  name: string;
  sku: string | null;
  description: string | null;
  unit: string | null;
  unitPriceMinor: number;
  currency: string;
  taxRatePercent: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  rowVersion: number;
}

export interface SalesItemValues {
  kind: SalesItemKind;
  name: string;
  sku: string | null;
  description: string | null;
  unit: string | null;
  unitPriceMinor: number;
  currency: string;
  taxRatePercent: number | null;
  isActive: boolean;
}

export const escapeLike = (v: string): string => v.replace(/[\\%_]/g, (c) => `\\${c}`);

const toRow = (r: Raw): SalesItemRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  kind: r.kind as SalesItemKind,
  name: r.name as string,
  sku: (r.sku ?? null) as string | null,
  description: (r.description ?? null) as string | null,
  unit: (r.unit ?? null) as string | null,
  unitPriceMinor: Number(r.unit_price_minor),
  currency: r.currency as string,
  taxRatePercent:
    r.tax_rate_percent === null || r.tax_rate_percent === undefined
      ? null
      : Number(r.tax_rate_percent),
  isActive: r.is_active === true,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  rowVersion: Number(r.row_version),
});

const COLUMNS = sql.raw(
  'id, uuid, kind, name, sku, description, unit, unit_price_minor, currency, tax_rate_percent, is_active, created_at, updated_at, row_version',
);

/** Rows of `sales_items` (migration 2037): the price list of the Products and services add-on. */
@Injectable()
export class ProductsServicesRepository {
  private where(orgId: number, q: Pick<ListSalesItemsQuery, 'q' | 'kind' | 'status'>): SQL[] {
    const where: SQL[] = [sql`org_id = ${orgId}`];
    if (q.kind) where.push(sql`kind = ${q.kind}`);
    if (q.status === 'active') where.push(sql`is_active`);
    if (q.status === 'inactive') where.push(sql`NOT is_active`);
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      where.push(sql`(name ILIKE ${like} OR sku ILIKE ${like})`);
    }
    return where;
  }

  async list(tx: Tx, orgId: number, q: ListSalesItemsQuery): Promise<SalesItemRow[]> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM sales_items WHERE ${sql.join(this.where(orgId, q), sql` AND `)}
      ORDER BY lower(name), id LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`);
    return (res.rows as Raw[]).map(toRow);
  }

  async count(
    tx: Tx,
    orgId: number,
    q: Pick<ListSalesItemsQuery, 'q' | 'kind' | 'status'>,
  ): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM sales_items WHERE ${sql.join(this.where(orgId, q), sql` AND `)}`,
    );
    return Number((res.rows[0] as { n: number }).n);
  }

  /** Active and inactive counts over the whole price list, for the tabs. */
  async counts(tx: Tx, orgId: number): Promise<{ all: number; active: number; inactive: number }> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS n, count(*) FILTER (WHERE is_active)::int AS active FROM sales_items WHERE org_id = ${orgId}`);
    const r = res.rows[0] as { n: number; active: number };
    return { all: Number(r.n), active: Number(r.active), inactive: Number(r.n) - Number(r.active) };
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<SalesItemRow | null> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM sales_items WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : null;
  }

  async insert(
    tx: Tx,
    orgId: number,
    createdBy: number | null,
    v: SalesItemValues,
  ): Promise<SalesItemRow> {
    const res = await tx.execute(sql`
      INSERT INTO sales_items (org_id, kind, name, sku, description, unit, unit_price_minor, currency, tax_rate_percent, is_active, created_by)
      VALUES (${orgId}, ${v.kind}, ${v.name}, ${v.sku}, ${v.description}, ${v.unit}, ${v.unitPriceMinor}, ${v.currency},
              ${v.taxRatePercent}, ${v.isActive}, ${createdBy})
      RETURNING ${COLUMNS}`);
    return toRow((res.rows as Raw[])[0]!);
  }

  /** Writes the new values when the row is still at `rowVersion`; null when it moved (or is gone). */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    rowVersion: number,
    v: SalesItemValues,
  ): Promise<SalesItemRow | null> {
    const res = await tx.execute(sql`
      UPDATE sales_items SET kind = ${v.kind}, name = ${v.name}, sku = ${v.sku}, description = ${v.description}, unit = ${v.unit},
             unit_price_minor = ${v.unitPriceMinor}, currency = ${v.currency}, tax_rate_percent = ${v.taxRatePercent}, is_active = ${v.isActive}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${rowVersion}
      RETURNING ${COLUMNS}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : null;
  }

  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM sales_items WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
