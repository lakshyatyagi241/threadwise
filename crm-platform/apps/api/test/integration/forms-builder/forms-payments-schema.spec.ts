import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * `web_form_payments` against a real Postgres as the restricted application role (a superuser bypasses every policy): forced RLS, a
 * cross-tenant read AND write attempt, the composite foreign key to the submission, the unique reference, the paid/paid_at pairing and the
 * touch trigger.
 */
describe('forms payments: schema and isolation', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let subA: number;
  let subB: number;

  const asTenant = async <T>(org: number, fn: () => Promise<T>): Promise<T> => {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(org)]);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  };
  const definition = JSON.stringify({ title: 'T', steps: [{ id: 's', blocks: [] }] });
  const seedSubmission = async (org: number, key: string): Promise<number> => {
    const form = Number(
      (
        await owner.query(
          `INSERT INTO web_forms (org_id, name, public_key, draft_definition) VALUES ($1,'F',$2,$3::jsonb) RETURNING id`,
          [org, key, definition],
        )
      ).rows[0].id,
    );
    const version = Number(
      (
        await owner.query(
          `INSERT INTO web_form_versions (org_id, form_id, version, definition) VALUES ($1,$2,1,$3::jsonb) RETURNING id`,
          [org, form, definition],
        )
      ).rows[0].id,
    );
    return Number(
      (
        await owner.query(
          `INSERT INTO web_form_submissions (org_id, form_id, version_id, idempotency_key, receipt_token, status)
           VALUES ($1,$2,$3,$4,$5,'awaiting_payment') RETURNING id`,
          [org, form, version, `idem-${key}-01`, `tok-${key}`],
        )
      ).rows[0].id,
    );
  };
  const insertPayment = (
    org: number,
    submission: number,
    reference: string,
    client: Client = owner,
  ) =>
    client.query(
      `INSERT INTO web_form_payments (org_id, submission_id, reference, gateway_slug, amount_minor, currency, expires_at)
       VALUES ($1,$2,$3,'razorpay',50000,'INR', now() + interval '48 hours') RETURNING id`,
      [org, submission, reference],
    );

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
    const org = async (slug: string) =>
      Number(
        (
          await owner.query(
            `INSERT INTO organizations (slug,name,plan) VALUES ($1,$1,'starter') RETURNING id`,
            [slug],
          )
        ).rows[0].id,
      );
    orgA = await org('pa');
    orgB = await org('pb');
    subA = await seedSubmission(orgA, 'AaAaAaAaAaAaAaAaAaAaAa');
    subB = await seedSubmission(orgB, 'BbBbBbBbBbBbBbBbBbBbBb');
    await insertPayment(orgA, subA, 'FRM-a-0001');
    await insertPayment(orgB, subB, 'FRM-b-0001');
    const url = new URL(container.getConnectionUri());
    url.username = 'crm_app_user';
    url.password = 'test';
    app = new Client({ connectionString: url.toString() });
    await app.connect();
  }, 240_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  it('RLS is enabled AND forced with a tenant_isolation policy', async () => {
    const res = await owner.query(
      `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
              (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation')::int AS pol
       FROM pg_class c WHERE c.relname = 'web_form_payments'`,
    );
    expect(res.rows[0]).toEqual({ rls: true, forced: true, pol: 1 });
  });

  it("a tenant sees only its own attempts and cannot write another workspace's", async () => {
    const seen = await asTenant(orgA, () => app.query(`SELECT reference FROM web_form_payments`));
    expect(seen.rows.map((r) => r.reference)).toEqual(['FRM-a-0001']);
    await expect(
      asTenant(orgA, () => insertPayment(orgB, subB, 'FRM-x-0001', app)),
    ).rejects.toThrow(/row-level security/);
    const upd = await asTenant(orgA, () =>
      app.query(`UPDATE web_form_payments SET status = 'failed' WHERE org_id = $1`, [orgB]),
    );
    expect(upd.rowCount).toBe(0);
  });

  it("the foreign key is composite: an attempt cannot point at another workspace's submission", async () => {
    await expect(insertPayment(orgA, subB, 'FRM-a-0002')).rejects.toThrow(
      /fk_web_form_payments_submission/,
    );
  });

  it('a reference is unique per workspace', async () => {
    await expect(insertPayment(orgA, subA, 'FRM-a-0001')).rejects.toThrow(/duplicate key/);
  });

  it('paid and paid_at go together; an amount must be positive; a currency is three capitals', async () => {
    await expect(
      owner.query(`UPDATE web_form_payments SET status = 'paid' WHERE org_id = $1`, [orgA]),
    ).rejects.toThrow(/chk_web_form_payments_paid/);
    await expect(
      owner.query(`UPDATE web_form_payments SET amount_minor = 0 WHERE org_id = $1`, [orgA]),
    ).rejects.toThrow(/chk_web_form_payments_amount/);
    await expect(
      owner.query(`UPDATE web_form_payments SET currency = 'inr' WHERE org_id = $1`, [orgA]),
    ).rejects.toThrow(/chk_web_form_payments_currency/);
  });

  it('settling touches the row (optimistic-lock version bumps) and deleting the submission deletes its attempts', async () => {
    const before = await owner.query(
      `SELECT row_version FROM web_form_payments WHERE org_id = $1`,
      [orgA],
    );
    await owner.query(
      `UPDATE web_form_payments SET status = 'paid', paid_at = now(), settled_via = 'gateway' WHERE org_id = $1`,
      [orgA],
    );
    const after = await owner.query(`SELECT row_version FROM web_form_payments WHERE org_id = $1`, [
      orgA,
    ]);
    expect(after.rows[0].row_version).toBe(before.rows[0].row_version + 1);
    await owner.query(`DELETE FROM web_form_submissions WHERE org_id = $1 AND id = $2`, [
      orgA,
      subA,
    ]);
    const left = await owner.query(`SELECT 1 FROM web_form_payments WHERE org_id = $1`, [orgA]);
    expect(left.rowCount).toBe(0);
  });
});
