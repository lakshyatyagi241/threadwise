import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { PgDialect } from 'drizzle-orm/pg-core';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, type Tx } from '@crm/db';
import { CatalogSyncRepository } from '../../../src/modules/catalog-products/catalog-sync.repository';

/**
 * `CatalogSyncRepository.findByRetailerIds`: the one query that replaced a lookup per product in the Meta catalog import (QA task 43).
 * Run against a real Postgres, because what it relies on (DISTINCT ON, = ANY(text[]), the lowest-id rule, the 5000-id chunks) is SQL.
 * The repository only calls `tx.execute(sql)`, so a plain client stands in for the transaction; every query names its org itself.
 *
 * Rerun: pnpm --filter @crm/api exec vitest run test/integration/catalog-products/catalog-sync-lookup.spec.ts --testTimeout=120000
 */
describe('CatalogSyncRepository.findByRetailerIds', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let orgA: number;
  let orgB: number;
  const repo = new CatalogSyncRepository();
  let queries = 0;
  const dialect = new PgDialect();
  const tx = {
    execute: async (q: Parameters<PgDialect['sqlToQuery']>[0]) => {
      queries += 1;
      const { sql, params } = dialect.sqlToQuery(q);
      return owner.query(sql, params as unknown[]);
    },
  } as unknown as Tx;

  const scalar = async (q: string, params: unknown[] = []) =>
    Number((await owner.query(q, params)).rows[0].id);
  const product = (org: number, slug: string, retailer: string | null) =>
    scalar(
      `INSERT INTO wa_products (org_id, name, slug, meta_retailer_id) VALUES ($1,$2,$2,$3) RETURNING id`,
      [org, slug, retailer],
    );

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../../packages/db/migrations'),
      log: () => undefined,
    });
    orgA = await scalar(
      `INSERT INTO organizations (slug,name,plan) VALUES ('sa','A','starter') RETURNING id`,
    );
    orgB = await scalar(
      `INSERT INTO organizations (slug,name,plan) VALUES ('sb','B','starter') RETURNING id`,
    );
  }, 240_000);

  afterAll(async () => {
    await owner?.end();
    await container?.stop();
  });

  it('returns each product by its retailer id, and leaves out ids it does not hold', async () => {
    const shirt = await product(orgA, 'shirt', 'SKU-SHIRT');
    const mug = await product(orgA, 'mug', 'SKU-MUG');
    const found = await repo.findByRetailerIds(tx, orgA, ['SKU-SHIRT', 'SKU-MUG', 'SKU-NOPE']);
    expect([...found.keys()].sort()).toEqual(['SKU-MUG', 'SKU-SHIRT']);
    expect(found.get('SKU-SHIRT')!.id).toBe(shirt);
    expect(found.get('SKU-MUG')!.id).toBe(mug);
  });

  it("never returns another workspace's product, even for the same retailer id", async () => {
    const theirs = await product(orgB, 'their-hat', 'SKU-SHARED');
    const mine = await product(orgA, 'my-hat', 'SKU-SHARED');
    const found = await repo.findByRetailerIds(tx, orgA, ['SKU-SHARED']);
    expect(found.get('SKU-SHARED')!.id).toBe(mine);
    expect(found.get('SKU-SHARED')!.id).not.toBe(theirs);
    expect((await repo.findByRetailerIds(tx, orgB, ['SKU-SHARED'])).get('SKU-SHARED')!.id).toBe(
      theirs,
    );
  });

  it('when several products share a retailer id the lowest product id wins, as the single lookup did', async () => {
    const first = await product(orgA, 'dup-1', 'SKU-DUP');
    await product(orgA, 'dup-2', 'SKU-DUP');
    await product(orgA, 'dup-3', 'SKU-DUP');
    expect((await repo.findByRetailerIds(tx, orgA, ['SKU-DUP'])).get('SKU-DUP')!.id).toBe(first);
  });

  it('repeats in the input are harmless, and an empty input asks the database nothing', async () => {
    const before = queries;
    expect((await repo.findByRetailerIds(tx, orgA, [])).size).toBe(0);
    expect(queries).toBe(before);
    const found = await repo.findByRetailerIds(tx, orgA, ['SKU-MUG', 'SKU-MUG', 'SKU-MUG']);
    expect(found.size).toBe(1);
  });

  it('a product with no retailer id is never matched by an empty or missing one', async () => {
    await product(orgA, 'no-retailer', null);
    expect((await repo.findByRetailerIds(tx, orgA, [''])).size).toBe(0);
  });

  it('looks up 12,000 ids in three queries, not 12,000, and still finds the ones that exist', async () => {
    const ids = Array.from({ length: 12_000 }, (_, i) => `BULK-${i}`);
    const wanted = await product(orgA, 'bulk-x', 'BULK-7777');
    const before = queries;
    const found = await repo.findByRetailerIds(tx, orgA, ids);
    expect(queries - before).toBe(3); // 5000 + 5000 + 2000: under the 65,535 bind-parameter limit each
    expect(found.size).toBe(1);
    expect(found.get('BULK-7777')!.id).toBe(wanted);
  });
});
