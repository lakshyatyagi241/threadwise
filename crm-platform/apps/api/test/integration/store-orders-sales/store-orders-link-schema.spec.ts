import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * Migration 20261029090000 (store orders join the CRM) against a real Postgres: the links are nullable composite foreign keys that set
 * NULL when the contact, sales order or invoice goes; the backfill matches an order's or a saved customer's phone to a contact of the
 * SAME workspace (the identity row first, the stored number second, the oldest live contact winning); and the two tables keep their
 * forced tenant isolation as the restricted application role.
 */
const MIGRATION = resolve(
  __dirname,
  '../../../../../packages/db/migrations/20261029090000_store_orders_contact_link.sql',
);

describe('store orders contact link: schema, backfill, isolation', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;

  const scalar = async (q: string, params: unknown[] = []) =>
    Number((await owner.query(q, params)).rows[0].id);
  const asTenant = async <T>(org: number, fn: () => Promise<T>) => {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(org)]);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  };
  const contact = (org: number, name: string, phone: string | null, extra = '') =>
    scalar(
      `INSERT INTO contacts (org_id, name, phone${extra ? ', ' + extra.split('=')[0] : ''})
       VALUES ($1, $2, $3${extra ? ', ' + extra.split('=')[1] : ''}) RETURNING id`,
      [org, name, phone],
    );
  const identity = (org: number, contactId: number, value: string) =>
    owner.query(
      `INSERT INTO contact_identities (org_id, contact_id, kind, value, is_primary) VALUES ($1,$2,'phone',$3,true)`,
      [org, contactId, value],
    );
  const order = (org: number, phone: string | null) =>
    scalar(
      `INSERT INTO wa_orders (org_id, source, customer_phone, items_json) VALUES ($1,'storefront',$2,'[]') RETURNING id`,
      [org, phone],
    );
  const profile = (org: number, phone: string) =>
    scalar(`INSERT INTO wa_customer_profiles (org_id, phone) VALUES ($1,$2) RETURNING id`, [
      org,
      phone,
    ]);

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await owner.query(
      `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../../packages/db/migrations'),
      log: () => undefined,
    });
    const uri = new URL(container.getConnectionUri());
    uri.username = 'crm_app_user';
    uri.password = 'test';
    app = new Client({ connectionString: uri.toString() });
    await app.connect();
    orgA = await scalar(
      `INSERT INTO organizations (slug,name,plan) VALUES ('oa','A','starter') RETURNING id`,
    );
    orgB = await scalar(
      `INSERT INTO organizations (slug,name,plan) VALUES ('ob','B','starter') RETURNING id`,
    );
  }, 240_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  it('adds the nullable link columns to both tables, with composite set-null foreign keys', async () => {
    const cols = await owner.query(
      `SELECT table_name, column_name, is_nullable FROM information_schema.columns
       WHERE table_name IN ('wa_orders','wa_customer_profiles') AND column_name IN ('contact_id','sales_order_id','invoice_id')
       ORDER BY table_name, column_name`,
    );
    expect(cols.rows).toEqual([
      { table_name: 'wa_customer_profiles', column_name: 'contact_id', is_nullable: 'YES' },
      { table_name: 'wa_orders', column_name: 'contact_id', is_nullable: 'YES' },
      { table_name: 'wa_orders', column_name: 'invoice_id', is_nullable: 'YES' },
      { table_name: 'wa_orders', column_name: 'sales_order_id', is_nullable: 'YES' },
    ]);
    const fks = await owner.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname IN ('fk_wa_orders_contact_id','fk_wa_orders_sales_order_id','fk_wa_orders_invoice_id','fk_wa_customer_profiles_contact_id')
       ORDER BY conname`,
    );
    expect(fks.rows).toHaveLength(4);
    for (const r of fks.rows) {
      expect(r.def).toContain('(org_id,');
      expect(r.def).toMatch(/ON DELETE SET NULL \(\w+\)/);
    }
  });

  it('keeps RLS forced on both tables: a tenant sees and writes only its own rows', async () => {
    const flags = await owner.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('wa_orders','wa_customer_profiles')`,
    );
    for (const r of flags.rows)
      expect([r.relname, r.relrowsecurity, r.relforcerowsecurity]).toEqual([r.relname, true, true]);

    const oa = await order(orgA, '919800000001');
    const ob = await order(orgB, '919800000002');
    await asTenant(orgA, async () => {
      const seen = await app.query(`SELECT id FROM wa_orders`);
      expect(seen.rows.map((r) => Number(r.id))).toEqual([oa]);
      expect(seen.rows.map((r) => Number(r.id))).not.toContain(ob);
      // writing the link of another tenant's order touches nothing
      const upd = await app.query(`UPDATE wa_orders SET contact_id = NULL WHERE id = $1`, [ob]);
      expect(upd.rowCount).toBe(0);
    });
  });

  it('refuses a link to a contact of ANOTHER workspace (composite foreign key)', async () => {
    const foreign = await contact(orgB, 'Other tenant', '+919811111111');
    const mine = await order(orgA, '919811111111');
    await expect(
      owner.query(`UPDATE wa_orders SET contact_id = $1 WHERE id = $2`, [foreign, mine]),
    ).rejects.toThrow(/fk_wa_orders_contact_id/);
    await expect(
      owner.query(`UPDATE wa_customer_profiles SET contact_id = $1 WHERE false`, [foreign]),
    ).resolves.toBeDefined();
  });

  it('sets the link to NULL when the contact is deleted; the order stays', async () => {
    const c = await contact(orgA, 'Temp', '+919822222222');
    const o = await order(orgA, '919822222222');
    await owner.query(`UPDATE wa_orders SET contact_id = $1 WHERE id = $2`, [c, o]);
    await owner.query(`DELETE FROM contacts WHERE id = $1`, [c]);
    const row = (await owner.query(`SELECT contact_id FROM wa_orders WHERE id = $1`, [o])).rows[0];
    expect(row.contact_id).toBeNull();
  });

  it('backfills orders and profiles by phone, inside the same workspace only', async () => {
    // Contacts: A has an identity-keyed one, a legacy one (stored number only) and an archived duplicate; B has the same number as A.
    const ident = await contact(orgA, 'Identity', '+919833333333');
    await identity(orgA, ident, '+919833333333');
    const legacy = await contact(orgA, 'Legacy', '+919844444444');
    const archivedDup = await contact(orgA, 'Old duplicate', '+919855555555', 'is_archived=true');
    const liveDup = await contact(orgA, 'Live duplicate', '+919855555555');
    const bSame = await contact(orgB, 'B same number', '+919833333333');
    await identity(orgB, bSame, '+919833333333');

    const oIdent = await order(orgA, '919833333333'); // digits only, with a country code
    const oPlus = await order(orgA, '+919833333333'); // the stored "+"
    const oLegacy = await order(orgA, '919844444444');
    const oDup = await order(orgA, '919855555555');
    const oNone = await order(orgA, '919866666666'); // nobody has this number
    const oBlank = await order(orgA, null);
    const oB = await order(orgB, '919833333333');
    const pIdent = await profile(orgA, '919833333333');
    const pNone = await profile(orgA, '919877777777');

    // run the backfill of the migration again, on rows that have no link yet (the file is applied once; this is its data step)
    await owner.query(`UPDATE wa_orders SET contact_id = NULL, invoice_id = NULL`);
    await owner.query(`UPDATE wa_customer_profiles SET contact_id = NULL`);
    const sqlText = readFileSync(MIGRATION, 'utf8');
    const backfill = sqlText.slice(sqlText.indexOf('-- Backfill:'));
    await owner.query(`BEGIN; ${backfill} COMMIT;`);

    const link = async (table: string, id: number) =>
      (await owner.query(`SELECT contact_id FROM ${table} WHERE id = $1`, [id])).rows[0]
        .contact_id as number | null;
    expect(Number(await link('wa_orders', oIdent))).toBe(ident);
    expect(Number(await link('wa_orders', oPlus))).toBe(ident);
    expect(Number(await link('wa_orders', oLegacy))).toBe(legacy);
    // two contacts could match: the live one wins over the archived one
    expect(Number(await link('wa_orders', oDup))).toBe(liveDup);
    expect(archivedDup).not.toBe(liveDup);
    expect(await link('wa_orders', oNone)).toBeNull();
    expect(await link('wa_orders', oBlank)).toBeNull();
    // never across workspaces: B's order matches B's contact, not A's
    expect(Number(await link('wa_orders', oB))).toBe(bSame);
    expect(Number(await link('wa_customer_profiles', pIdent))).toBe(ident);
    expect(await link('wa_customer_profiles', pNone)).toBeNull();
  });

  it('the backfill is not an edit: row_version and updated_at of the orders it links stay', async () => {
    const c = await contact(orgA, 'Quiet', '+919888888888');
    await identity(orgA, c, '+919888888888');
    const o = await order(orgA, '919888888888');
    const before = (
      await owner.query(`SELECT row_version, updated_at FROM wa_orders WHERE id = $1`, [o])
    ).rows[0];
    await owner.query(`UPDATE wa_orders SET contact_id = NULL WHERE id = $1`, [o]); // an edit, by design bumps the version
    const afterEdit = (await owner.query(`SELECT row_version FROM wa_orders WHERE id = $1`, [o]))
      .rows[0];
    expect(afterEdit.row_version).toBe(before.row_version + 1);
    const sqlText = readFileSync(MIGRATION, 'utf8');
    await owner.query(`BEGIN; ${sqlText.slice(sqlText.indexOf('-- Backfill:'))} COMMIT;`);
    const after = (
      await owner.query(`SELECT row_version, contact_id FROM wa_orders WHERE id = $1`, [o])
    ).rows[0];
    expect(Number(after.contact_id)).toBe(c);
    expect(after.row_version).toBe(afterEdit.row_version);
  });
});
