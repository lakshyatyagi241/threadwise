import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createSalesItemSchema,
  listSalesItemsQuerySchema,
  PLAN_FEATURE_DEFS,
  updateSalesItemSchema,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import {
  ProductsServicesRepository,
  type SalesItemRow,
} from '../../src/modules/products-services/products-services.repository';
import {
  isUniqueViolation,
  valuesOfCreate,
  valuesOfUpdate,
} from '../../src/modules/products-services/products-services.service';

const dialect = new PgDialect();
function capture() {
  const seen: Array<{ sql: string; params: unknown[] }> = [];
  const tx = {
    execute: async (q: SQL) => {
      const r = dialect.sqlToQuery(q);
      seen.push({ sql: r.sql.replace(/\s+/g, ' ').trim(), params: r.params });
      return { rows: [{ n: 0, active: 0 }] };
    },
  } as unknown as Tx;
  return { tx, seen };
}

const row: SalesItemRow = {
  id: 1,
  uuid: 'u',
  kind: 'product',
  name: 'Widget',
  sku: 'W-1',
  description: 'A widget',
  unit: 'pcs',
  unitPriceMinor: 125000,
  currency: 'INR',
  taxRatePercent: 18,
  isActive: true,
  createdAt: new Date('2026-10-27T00:00:00Z'),
  updatedAt: new Date('2026-10-27T00:00:00Z'),
  rowVersion: 3,
};

describe('the Products and services contract', () => {
  it('a create takes the defaults and cleans what was typed', () => {
    const out = createSalesItemSchema.parse({
      name: '  Widget ',
      sku: '   ',
      unit: ' pcs ',
      unitPriceMinor: 5000,
      currency: 'inr',
      taxRatePercent: '12.5',
    });
    expect(out).toMatchObject({
      kind: 'product',
      name: 'Widget',
      sku: null,
      unit: 'pcs',
      currency: 'INR',
      taxRatePercent: 12.5,
      isActive: true,
    });
  });
  it('refuses a negative or fractional price, a bad currency and a tax over 100', () => {
    const base = { name: 'x', unitPriceMinor: 100, currency: 'INR' };
    expect(createSalesItemSchema.safeParse({ ...base, unitPriceMinor: -1 }).success).toBe(false);
    expect(createSalesItemSchema.safeParse({ ...base, unitPriceMinor: 1.5 }).success).toBe(false);
    expect(createSalesItemSchema.safeParse({ ...base, currency: 'RUPEE' }).success).toBe(false);
    expect(createSalesItemSchema.safeParse({ ...base, taxRatePercent: 101 }).success).toBe(false);
    expect(createSalesItemSchema.safeParse({ ...base, name: '   ' }).success).toBe(false);
  });
  it('an update needs the row version, and any field may be left out', () => {
    expect(updateSalesItemSchema.safeParse({ name: 'New' }).success).toBe(false);
    expect(updateSalesItemSchema.safeParse({ rowVersion: 2, isActive: false }).success).toBe(true);
  });
  it('the list query has defaults and caps the page size', () => {
    expect(listSalesItemsQuerySchema.parse({})).toMatchObject({
      page: 1,
      limit: 50,
      status: 'all',
    });
    expect(listSalesItemsQuerySchema.safeParse({ limit: 500 }).success).toBe(false);
  });
  it('the plan feature is its own, off by default and needs no other', () => {
    const def = PLAN_FEATURE_DEFS.find((d) => d.key === 'products_services');
    expect(def?.default).toBe(false);
  });
});

describe('what a create and an update write', () => {
  it('a create writes the cleaned values', () => {
    const v = valuesOfCreate(
      createSalesItemSchema.parse({
        name: 'Consulting',
        kind: 'service',
        unitPriceMinor: 0,
        currency: 'USD',
      }),
    );
    expect(v).toMatchObject({
      kind: 'service',
      sku: null,
      unit: null,
      taxRatePercent: null,
      isActive: true,
    });
  });
  it('an update keeps what was not sent and clears what was sent empty', () => {
    const kept = valuesOfUpdate(
      row,
      updateSalesItemSchema.parse({ rowVersion: 3, name: 'Widget 2' }),
    );
    expect(kept).toMatchObject({
      name: 'Widget 2',
      sku: 'W-1',
      unit: 'pcs',
      unitPriceMinor: 125000,
      taxRatePercent: 18,
    });
    const cleared = valuesOfUpdate(
      row,
      updateSalesItemSchema.parse({
        rowVersion: 3,
        sku: '',
        taxRatePercent: null,
        isActive: false,
      }),
    );
    expect(cleared).toMatchObject({
      sku: null,
      taxRatePercent: null,
      isActive: false,
      name: 'Widget',
    });
  });
  it('knows a unique violation, even wrapped', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ cause: { code: '23505' } })).toBe(true);
    expect(isUniqueViolation(new Error('x'))).toBe(false);
  });
});

describe('the price list queries', () => {
  it('scope every read to the workspace and match a search on the name or the SKU', async () => {
    const { tx, seen } = capture();
    await new ProductsServicesRepository().list(tx, 7, {
      page: 2,
      limit: 25,
      status: 'active',
      kind: 'service',
      q: '50%_off',
    });
    const s = seen[0]!;
    expect(s.sql).toContain('org_id = $1');
    expect(s.sql).toContain('kind =');
    expect(s.sql).toContain('is_active');
    expect(s.sql).toContain('name ILIKE');
    expect(s.sql).toContain('sku ILIKE');
    expect(s.params).toContain(String.raw`%50\%\_off%`);
    expect(s.sql).toContain('ORDER BY lower(name), id');
  });
  it('an update is conditioned on the row version it was read at', async () => {
    const { tx, seen } = capture();
    await new ProductsServicesRepository().update(tx, 7, 1, 3, {
      kind: 'product',
      name: 'x',
      sku: null,
      description: null,
      unit: null,
      unitPriceMinor: 0,
      currency: 'INR',
      taxRatePercent: null,
      isActive: true,
    });
    expect(seen[0]!.sql).toContain('row_version =');
    expect(seen[0]!.sql).toContain('org_id =');
  });
});
