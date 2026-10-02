import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { TaxType } from '@crm/contracts';
import type { Tx } from '@crm/db';

export interface TaxRateRow {
  id: number;
  uuid: string;
  name: string;
  taxType: TaxType;
  /** Percent, exact: "18", "9.975". */
  ratePercent: string;
  inclusive: boolean;
  isDefault: boolean;
  isActive: boolean;
  description: string | null;
  country: string | null;
  region: string | null;
  components: Array<{ type: string; ratePercent: string }> | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  defaultHsnSac: string | null;
  usedBy: number;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaxRateWrite {
  name?: string;
  taxType?: TaxType;
  ratePercent?: string;
  inclusive?: boolean;
  isActive?: boolean;
  description?: string | null;
  country?: string | null;
  region?: string | null;
  components?: Array<{ type: string; ratePercent: string }> | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  defaultHsnSac?: string | null;
}

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));

/** "9.0000" -> "9", "9.9750" -> "9.975", "10" -> "10". */
const trimPercent = (p: string): string => (p.includes('.') ? p.replace(/0+$/, '').replace(/\.$/, '') : p);

/** Components are stored as { type, ratePercent }; a row written before exact percentages stored { type, rateBp }. */
function normaliseComponents(v: unknown): TaxRateRow['components'] {
  if (!Array.isArray(v)) return null;
  return v.map((c: { type: string; ratePercent?: string; rateBp?: number }) => ({
    type: c.type,
    ratePercent: c.ratePercent ?? String((c.rateBp ?? 0) / 100),
  }));
}

const SELECT = sql`
  SELECT t.id, t.uuid, t.name, t.tax_type, t.rate_percent::text AS rate_percent, t.inclusive, t.is_default, t.is_active, t.description, t.country, t.region,
         t.components, to_char(t.effective_from, 'YYYY-MM-DD') AS effective_from, to_char(t.effective_to, 'YYYY-MM-DD') AS effective_to,
         t.default_hsn_sac, t.row_version, t.created_at, t.updated_at,
         (SELECT count(*)::int FROM invoice_items it WHERE it.org_id = t.org_id AND it.tax_rate_id = t.id) AS used_by
  FROM tax_rates t
`;

const toRow = (r: Raw): TaxRateRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  name: r.name as string,
  taxType: r.tax_type as TaxType,
  ratePercent: trimPercent(r.rate_percent as string),
  inclusive: r.inclusive as boolean,
  isDefault: r.is_default as boolean,
  isActive: r.is_active as boolean,
  description: s(r.description),
  country: s(r.country),
  region: s(r.region),
  components: normaliseComponents(r.components),
  effectiveFrom: s(r.effective_from),
  effectiveTo: s(r.effective_to),
  defaultHsnSac: s(r.default_hsn_sac),
  usedBy: Number(r.used_by),
  rowVersion: Number(r.row_version),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

@Injectable()
export class TaxRatesRepository {
  async list(
    tx: Tx,
    orgId: number,
    opts: { pickableOn?: string; country?: string },
  ): Promise<TaxRateRow[]> {
    const conds: SQL[] = [sql`t.org_id = ${orgId}`];
    if (opts.pickableOn) {
      conds.push(
        sql`t.is_active`,
        sql`(t.effective_from IS NULL OR t.effective_from <= ${opts.pickableOn}::date)`,
        sql`(t.effective_to IS NULL OR t.effective_to >= ${opts.pickableOn}::date)`,
      );
    }
    if (opts.country) conds.push(sql`t.country = ${opts.country}`);
    const res = await tx.execute(
      sql`${SELECT} WHERE ${sql.join(conds, sql` AND `)} ORDER BY t.is_default DESC, lower(t.name)`,
    );
    return (res.rows as Raw[]).map(toRow);
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    forUpdate = false,
  ): Promise<TaxRateRow | undefined> {
    if (forUpdate)
      await tx.execute(
        sql`SELECT 1 FROM tax_rates WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid FOR UPDATE`,
      );
    const res = await tx.execute(
      sql`${SELECT} WHERE t.org_id = ${orgId} AND t.uuid = ${uuid}::uuid`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<TaxRateRow | undefined> {
    const res = await tx.execute(sql`${SELECT} WHERE t.org_id = ${orgId} AND t.id = ${id}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findDefault(tx: Tx, orgId: number): Promise<TaxRateRow | undefined> {
    const res = await tx.execute(
      sql`${SELECT} WHERE t.org_id = ${orgId} AND t.is_default AND t.is_active`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async nameTaken(tx: Tx, orgId: number, name: string, exceptId?: number): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM tax_rates WHERE org_id = ${orgId} AND lower(name) = lower(${name})
      ${exceptId !== undefined ? sql`AND id <> ${exceptId}` : sql``} LIMIT 1
    `);
    return res.rows.length > 0;
  }

  async clearDefault(tx: Tx, orgId: number): Promise<void> {
    await tx.execute(
      sql`UPDATE tax_rates SET is_default = false WHERE org_id = ${orgId} AND is_default`,
    );
  }

  async insert(
    tx: Tx,
    orgId: number,
    createdBy: number | null,
    v: Required<Pick<TaxRateWrite, 'name' | 'taxType' | 'ratePercent' | 'inclusive' | 'isActive'>> &
      TaxRateWrite & { isDefault: boolean },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO tax_rates (org_id, name, tax_type, rate_percent, inclusive, is_default, is_active, description, country, region,
                             components, effective_from, effective_to, default_hsn_sac, created_by)
      VALUES (${orgId}, ${v.name}, ${v.taxType}, ${v.ratePercent}::numeric, ${v.inclusive}, ${v.isDefault}, ${v.isActive},
              ${v.description ?? null}, ${v.country ?? null}, ${v.region ?? null},
              ${v.components ? JSON.stringify(v.components) : null}::jsonb,
              ${v.effectiveFrom ?? null}::date, ${v.effectiveTo ?? null}::date, ${v.defaultHsnSac ?? null}, ${createdBy})
      RETURNING id
    `);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  async update(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    patch: TaxRateWrite & { isDefault?: boolean },
  ): Promise<boolean> {
    const sets: SQL[] = [];
    const add = (col: string, v: unknown) => sets.push(sql`${sql.raw(col)} = ${v}`);
    if (patch.name !== undefined) add('name', patch.name);
    if (patch.taxType !== undefined) add('tax_type', patch.taxType);
    if (patch.ratePercent !== undefined) sets.push(sql`rate_percent = ${patch.ratePercent}::numeric`);
    if (patch.inclusive !== undefined) add('inclusive', patch.inclusive);
    if (patch.isActive !== undefined) add('is_active', patch.isActive);
    if (patch.isDefault !== undefined) add('is_default', patch.isDefault);
    if (patch.description !== undefined) add('description', patch.description);
    if (patch.country !== undefined) add('country', patch.country);
    if (patch.region !== undefined) add('region', patch.region);
    if (patch.components !== undefined)
      sets.push(sql`components = ${patch.components ? JSON.stringify(patch.components) : null}::jsonb`);
    if (patch.effectiveFrom !== undefined) sets.push(sql`effective_from = ${patch.effectiveFrom}::date`);
    if (patch.effectiveTo !== undefined) sets.push(sql`effective_to = ${patch.effectiveTo}::date`);
    if (patch.defaultHsnSac !== undefined) add('default_hsn_sac', patch.defaultHsnSac);
    if (sets.length === 0) sets.push(sql`updated_at = now()`);
    const res = await tx.execute(sql`
      UPDATE tax_rates SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expectedVersion} RETURNING id
    `);
    return res.rows.length > 0;
  }

  async delete(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(
      sql`DELETE FROM tax_rates WHERE org_id = ${orgId} AND id = ${id} RETURNING id`,
    );
    return res.rows.length > 0;
  }
}
