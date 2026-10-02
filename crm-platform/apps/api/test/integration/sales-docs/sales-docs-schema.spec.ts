import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The proposals / estimates tables against a real Postgres, as the restricted application role (a superuser bypasses every
 * policy and would make the isolation assertions vacuous, see rls.spec.ts). Constraint checks use the owner connection: owners
 * skip RLS but never CHECK, UNIQUE or FK. The allocator is exercised from many separate connections at once.
 */
describe('sales docs: schema, constraints, isolation and the number allocator', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let userB: number;
  let contactB: number;
  let companyB: number;
  let docA: number;
  let docB: number;

  const one = async (sql: string, p: unknown[] = []) =>
    Number((await owner.query(sql, p)).rows[0].id);

  const insertDoc = (org: number, over: Record<string, unknown> = {}) => {
    const v = {
      doc_type: 'proposal',
      number: `N-${Math.random().toString(36).slice(2, 9)}`,
      seq: Math.floor(Math.random() * 1e9),
      status: 'draft',
      subtotal_minor: 1000,
      discount_minor: 0,
      tax_minor: 100,
      total_minor: 1100,
      ...over,
    };
    const cols = Object.keys(v);
    return owner.query(
      `INSERT INTO sales_docs (org_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`,
      [org, ...cols.map((c) => v[c as keyof typeof v])],
    );
  };
  const rejects = (sql: string, params: unknown[], pattern: RegExp) =>
    expect(owner.query(sql, params)).rejects.toThrow(pattern);

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

    orgA = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('sa','A','starter') RETURNING id`,
    );
    orgB = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('sb','B','starter') RETURNING id`,
    );
    await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'a@s.test','A','x') RETURNING id`,
      [orgA],
    );
    userB = await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'b@s.test','B','x') RETURNING id`,
      [orgB],
    );
    contactB = await one(`INSERT INTO contacts (org_id, name) VALUES ($1,'CB') RETURNING id`, [
      orgB,
    ]);
    companyB = await one(`INSERT INTO companies (org_id, name) VALUES ($1,'CoB') RETURNING id`, [
      orgB,
    ]);
    docA = Number((await insertDoc(orgA, { number: 'PRO-0001', seq: 1 })).rows[0].id);
    docB = Number((await insertDoc(orgB, { number: 'PRO-0001', seq: 1 })).rows[0].id);

    app = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: 'crm',
      user: 'crm_app_user',
      password: 'test',
    });
    await app.connect();
  }, 240_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  async function asOrg<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgId)]);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  }

  describe('row-level security (every table of the module)', () => {
    const tables = [
      'sales_docs',
      'sales_doc_items',
      'sales_doc_revisions',
      'sales_doc_events',
      'sales_doc_counters',
      'sales_doc_settings',
      'sales_doc_templates',
    ];
    it('RLS is enabled and forced with a tenant policy on every table', async () => {
      const res = await owner.query(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
                (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation')::int AS policies
           FROM pg_class c WHERE c.relname = ANY($1) AND c.relkind = 'r' ORDER BY 1`,
        [tables],
      );
      expect(res.rows).toHaveLength(tables.length);
      for (const r of res.rows) {
        expect(r, r.relname).toMatchObject({
          relrowsecurity: true,
          relforcerowsecurity: true,
          policies: 1,
        });
      }
    });

    it('a workspace sees only its own documents, even when the other id is known exactly', async () => {
      const own = await asOrg(
        orgA,
        async () => (await app.query(`SELECT id FROM sales_docs`)).rows,
      );
      expect(own.map((r) => Number(r.id))).toEqual([docA]);
      const other = await asOrg(
        orgA,
        async () =>
          (await app.query(`SELECT 1 FROM sales_docs WHERE org_id = $1 AND id = $2`, [orgB, docB]))
            .rows,
      );
      expect(other).toHaveLength(0);
    });

    it('with no tenant set a query sees nothing, and a write into another workspace is refused by WITH CHECK (documents and lines)', async () => {
      await app.query('BEGIN');
      try {
        expect((await app.query(`SELECT 1 FROM sales_docs`)).rows).toHaveLength(0);
      } finally {
        await app.query('ROLLBACK');
      }
      for (const stmt of [
        `INSERT INTO sales_docs (org_id, doc_type, number, seq) VALUES ($1, 'proposal', 'SMUGGLED', 99)`,
        `INSERT INTO sales_doc_counters (org_id, doc_type, last_seq) VALUES ($1, 'proposal', 5)`,
        `INSERT INTO sales_doc_settings (org_id) VALUES ($1)`,
      ]) {
        await app.query('BEGIN');
        try {
          await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgA)]);
          await expect(app.query(stmt, [orgB]), stmt).rejects.toThrow(/row-level security/);
        } finally {
          await app.query('ROLLBACK');
        }
      }
    });
  });

  describe('constraints', () => {
    it('TW-PROP-008 / D-06: a number is unique per workspace, a counter value unique per type, but both repeat across workspaces and types', async () => {
      await rejects(
        `INSERT INTO sales_docs (org_id, doc_type, number, seq) VALUES ($1,'proposal','PRO-0001', 7)`,
        [orgA],
        /uq_sales_docs_number/,
      );
      await rejects(
        `INSERT INTO sales_docs (org_id, doc_type, number, seq) VALUES ($1,'proposal','OTHER-1', 1)`,
        [orgA],
        /uq_sales_docs_type_seq/,
      );
      // the same seq under the other type, and the same number in another workspace, are fine
      await owner.query(
        `INSERT INTO sales_docs (org_id, doc_type, number, seq) VALUES ($1,'estimate','EST-0001', 1)`,
        [orgA],
      );
    });

    it('a status or a kind outside the vocabulary is refused (Reference had no check)', async () => {
      await rejects(
        `UPDATE sales_docs SET status = 'rejected' WHERE org_id = $1 AND id = $2`,
        [orgA, docA],
        /chk_sales_docs_status/,
      );
      await rejects(
        `UPDATE sales_docs SET status = 'invoiced' WHERE org_id = $1 AND id = $2`,
        [orgA, docA],
        /chk_sales_docs_status/,
      );
      await rejects(
        `UPDATE sales_docs SET doc_type = 'invoice' WHERE org_id = $1 AND id = $2`,
        [orgA, docA],
        /chk_sales_docs_type/,
      );
    });

    it('the totals must add up: total = subtotal - discount + tax, and the discount cannot exceed the subtotal', async () => {
      await rejects(
        `UPDATE sales_docs SET total_minor = 1 WHERE org_id = $1 AND id = $2`,
        [orgA, docA],
        /chk_sales_docs_totals/,
      );
      await rejects(
        `UPDATE sales_docs SET discount_minor = 2000, total_minor = 0 WHERE org_id = $1 AND id = $2`,
        [orgA, docA],
        /chk_sales_docs_totals/,
      );
    });

    it('a decided document has a decision time, an open one has been sent, a viewed one has been viewed', async () => {
      await rejects(
        `UPDATE sales_docs SET status = 'accepted' WHERE org_id = $1 AND id = $2`,
        [orgA, docA],
        /chk_sales_docs_stamps/,
      );
      await rejects(
        `UPDATE sales_docs SET status = 'sent' WHERE org_id = $1 AND id = $2`,
        [orgA, docA],
        /chk_sales_docs_stamps/,
      );
      await rejects(
        `UPDATE sales_docs SET status = 'viewed', sent_at = now() WHERE org_id = $1 AND id = $2`,
        [orgA, docA],
        /chk_sales_docs_stamps/,
      );
    });

    it('rates and discounts are bounded: tax 0 to 100%, a percent discount at most 100%, none means zero', async () => {
      await rejects(
        `UPDATE sales_docs SET tax_rate_bp = 10001 WHERE org_id = $1 AND id = $2`,
        [orgA, docA],
        /chk_sales_docs_tax_rate/,
      );
      await rejects(
        `UPDATE sales_docs SET discount_kind = 'percent', discount_value = 10001 WHERE org_id = $1 AND id = $2`,
        [orgA, docA],
        /chk_sales_docs_discount/,
      );
      await rejects(
        `UPDATE sales_docs SET discount_kind = 'none', discount_value = 5 WHERE org_id = $1 AND id = $2`,
        [orgA, docA],
        /chk_sales_docs_discount/,
      );
    });

    it('the public token hash is unique across workspaces (one lookup finds one document)', async () => {
      await owner.query(
        `UPDATE sales_docs SET public_token_hash = 'h1' WHERE org_id = $1 AND id = $2`,
        [orgA, docA],
      );
      await rejects(
        `UPDATE sales_docs SET public_token_hash = 'h1' WHERE org_id = $1 AND id = $2`,
        [orgB, docB],
        /uq_sales_docs_token_hash/,
      );
    });

    it('a line must be consistent: net = gross - discount, a non-negative quantity, a rate of 0 to 100%', async () => {
      const ins = (cols: string, vals: string) =>
        `INSERT INTO sales_doc_items (org_id, doc_id, position, description, qty, unit_price_minor, ${cols}) VALUES ($1,$2,$3,'x',${vals})`;
      await rejects(
        ins('gross_minor, net_minor', '1, 100, 100, 5'),
        [orgA, docA, 90],
        /chk_sales_doc_items_money/,
      );
      await rejects(
        ins('gross_minor, net_minor', '-1, 100, 100, 100'),
        [orgA, docA, 91],
        /chk_sales_doc_items_qty/,
      );
      await rejects(
        ins('tax_rate_bp', '1, 100, 20000'),
        [orgA, docA, 92],
        /chk_sales_doc_items_tax/,
      );
      await owner.query(ins('gross_minor, net_minor', '2.5, 100, 250, 250'), [orgA, docA, 0]);
      await rejects(
        ins('gross_minor, net_minor', '1, 100, 100, 100'),
        [orgA, docA, 0],
        /uq_sales_doc_items_position/,
      );
      // qty keeps its four decimals exactly
      const q = await owner.query(
        `SELECT qty::text AS qty FROM sales_doc_items WHERE org_id = $1 AND doc_id = $2`,
        [orgA, docA],
      );
      expect(q.rows[0].qty).toBe('2.5000');
    });
  });

  describe('foreign keys are composite', () => {
    it('a document cannot link a contact, company or deal, or be owned by a user, of another workspace', async () => {
      await rejects(
        `UPDATE sales_docs SET contact_id = $3 WHERE org_id = $1 AND id = $2`,
        [orgA, docA, contactB],
        /fk_sales_docs_contact_id/,
      );
      await rejects(
        `UPDATE sales_docs SET company_id = $3 WHERE org_id = $1 AND id = $2`,
        [orgA, docA, companyB],
        /fk_sales_docs_company_id/,
      );
      await rejects(
        `UPDATE sales_docs SET owner_id = $3 WHERE org_id = $1 AND id = $2`,
        [orgA, docA, userB],
        /fk_sales_docs_owner_id/,
      );
      await rejects(
        `UPDATE sales_docs SET created_by = $3 WHERE org_id = $1 AND id = $2`,
        [orgA, docA, userB],
        /fk_sales_docs_created_by/,
      );
    });

    it('deleting a linked contact, company or user keeps the document and clears only the link', async () => {
      const c = await one(`INSERT INTO contacts (org_id, name) VALUES ($1,'gone') RETURNING id`, [
        orgA,
      ]);
      const u = await one(
        `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'gone@s.test','G','x') RETURNING id`,
        [orgA],
      );
      const d = Number((await insertDoc(orgA, { contact_id: c, owner_id: u })).rows[0].id);
      await owner.query(`DELETE FROM contacts WHERE org_id = $1 AND id = $2`, [orgA, c]);
      await owner.query(`DELETE FROM users WHERE org_id = $1 AND id = $2`, [orgA, u]);
      const row = (
        await owner.query(
          `SELECT contact_id, owner_id FROM sales_docs WHERE org_id = $1 AND id = $2`,
          [orgA, d],
        )
      ).rows[0];
      expect(row).toEqual({ contact_id: null, owner_id: null });
    });

    it('deleting a document removes its lines, revisions and timeline, and nothing else', async () => {
      const d = Number((await insertDoc(orgA)).rows[0].id);
      await owner.query(
        `INSERT INTO sales_doc_items (org_id, doc_id, position, description, qty, unit_price_minor) VALUES ($1,$2,0,'x',1,1)`,
        [orgA, d],
      );
      await owner.query(
        `INSERT INTO sales_doc_events (org_id, doc_id, type, actor_kind) VALUES ($1,$2,'created','user')`,
        [orgA, d],
      );
      await owner.query(
        `INSERT INTO sales_doc_revisions (org_id, doc_id, revision, status, snapshot, total_minor) VALUES ($1,$2,1,'sent','{}',0)`,
        [orgA, d],
      );
      await owner.query(`DELETE FROM sales_docs WHERE org_id = $1 AND id = $2`, [orgA, d]);
      for (const t of ['sales_doc_items', 'sales_doc_events', 'sales_doc_revisions']) {
        const n = await owner.query(
          `SELECT count(*)::int AS n FROM ${t} WHERE org_id = $1 AND doc_id = $2`,
          [orgA, d],
        );
        expect(n.rows[0].n, t).toBe(0);
      }
      expect(
        (
          await owner.query(
            `SELECT count(*)::int AS n FROM sales_docs WHERE org_id = $1 AND id = $2`,
            [orgA, docA],
          )
        ).rows[0].n,
      ).toBe(1);
    });
  });

  describe('the timeline is append-only (D-11, D-15)', () => {
    it('an event cannot be edited, but the foreign key may clear its actor when a user is deleted', async () => {
      const u = await one(
        `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'actor@s.test','Act','x') RETURNING id`,
        [orgA],
      );
      const e = await one(
        `INSERT INTO sales_doc_events (org_id, doc_id, type, actor_kind, actor_user_id, signer_name)
         VALUES ($1,$2,'accepted','user',$3,'cipher') RETURNING id`,
        [orgA, docA, u],
      );
      await rejects(
        `UPDATE sales_doc_events SET signer_name = 'forged' WHERE org_id = $1 AND id = $2`,
        [orgA, e],
        /append-only/,
      );
      await rejects(
        `UPDATE sales_doc_events SET type = 'declined' WHERE org_id = $1 AND id = $2`,
        [orgA, e],
        /append-only/,
      );
      await owner.query(`DELETE FROM users WHERE org_id = $1 AND id = $2`, [orgA, u]);
      const row = (
        await owner.query(
          `SELECT actor_user_id, signer_name FROM sales_doc_events WHERE org_id = $1 AND id = $2`,
          [orgA, e],
        )
      ).rows[0];
      expect(row).toEqual({ actor_user_id: null, signer_name: 'cipher' });
    });
  });

  describe('templates', () => {
    it('a name is unique per kind ignoring case, and a kind has at most one default', async () => {
      const ins = (kind: string, name: string, def: boolean) =>
        owner.query(
          `INSERT INTO sales_doc_templates (org_id, doc_type, name, is_default) VALUES ($1,$2,$3,$4)`,
          [orgA, kind, name, def],
        );
      await ins('proposal', 'Standard', true);
      await expect(ins('proposal', 'STANDARD', false)).rejects.toThrow(
        /uq_sales_doc_templates_name/,
      );
      await expect(ins('proposal', 'Other', true)).rejects.toThrow(
        /uq_sales_doc_templates_default/,
      );
      await ins('estimate', 'Standard', true);
    });
  });

  describe('the number allocator (TW-PROP-008, D-06)', () => {
    const connect = async () => {
      const c = new Client({
        host: container.getHost(),
        port: container.getPort(),
        database: 'crm',
        user: 'crm_app_user',
        password: 'test',
      });
      await c.connect();
      return c;
    };
    // The statement the repository runs, verbatim.
    const ALLOCATE = `INSERT INTO sales_doc_counters (org_id, doc_type, last_seq) VALUES ($1, $2, $3)
      ON CONFLICT (org_id, doc_type) DO UPDATE SET last_seq = sales_doc_counters.last_seq + 1 RETURNING last_seq`;

    async function createOne(
      c: Client,
      org: number,
      kind: string,
      start: number,
      hold = 0,
    ): Promise<number> {
      await c.query('BEGIN');
      try {
        await c.query(`SELECT set_config('app.org_id', $1, true)`, [String(org)]);
        const seq = Number((await c.query(ALLOCATE, [org, kind, start])).rows[0].last_seq);
        // The lock is held until COMMIT: slow work in between must not let anyone else take the same number.
        if (hold) await c.query(`SELECT pg_sleep($1)`, [hold]);
        await c.query(
          `INSERT INTO sales_docs (org_id, doc_type, number, seq, subtotal_minor, tax_minor, total_minor) VALUES ($1,$2,$3,$4,0,0,0)`,
          [org, kind, `${kind.slice(0, 3).toUpperCase()}-${seq}`, seq],
        );
        await c.query('COMMIT');
        return seq;
      } catch (err) {
        await c.query('ROLLBACK');
        throw err;
      }
    }

    it('60 creations from 12 concurrent connections get 60 distinct numbers with no gap, the first transaction racing for the counter row included', async () => {
      const org = await one(
        `INSERT INTO organizations (slug, name, plan) VALUES ('alloc','Alloc','starter') RETURNING id`,
      );
      const clients = await Promise.all(Array.from({ length: 12 }, connect));
      try {
        const got = (
          await Promise.all(
            clients.map(async (c) => {
              const mine: number[] = [];
              for (let i = 0; i < 5; i++)
                mine.push(await createOne(c, org, 'proposal', 1, i === 0 ? 0.05 : 0));
              return mine;
            }),
          )
        ).flat();
        expect(new Set(got).size).toBe(60);
        expect([...got].sort((a, b) => a - b)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
        const rows = await owner.query(
          `SELECT count(*)::int AS n, count(DISTINCT number)::int AS d, max(seq)::int AS m FROM sales_docs WHERE org_id = $1`,
          [org],
        );
        expect(rows.rows[0]).toEqual({ n: 60, d: 60, m: 60 });
      } finally {
        await Promise.all(clients.map((c) => c.end()));
      }
    }, 60_000);

    it('a rolled-back creation gives its number back, and a deleted document never does', async () => {
      const org = await one(
        `INSERT INTO organizations (slug, name, plan) VALUES ('alloc2','Alloc2','starter') RETURNING id`,
      );
      const c = await connect();
      try {
        expect(await createOne(c, org, 'estimate', 1)).toBe(1);
        await c.query('BEGIN');
        await c.query(`SELECT set_config('app.org_id', $1, true)`, [String(org)]);
        expect(Number((await c.query(ALLOCATE, [org, 'estimate', 1])).rows[0].last_seq)).toBe(2);
        await c.query('ROLLBACK');
        expect(await createOne(c, org, 'estimate', 1)).toBe(2);
        // Reference's max(seq)+1 reused the number of a deleted newest document; the counter does not.
        await owner.query(`DELETE FROM sales_docs WHERE org_id = $1 AND seq = 2`, [org]);
        expect(await createOne(c, org, 'estimate', 1)).toBe(3);
      } finally {
        await c.end();
      }
    });

    it('types and workspaces count independently, and the starting number applies only to the first', async () => {
      const org = await one(
        `INSERT INTO organizations (slug, name, plan) VALUES ('alloc3','Alloc3','starter') RETURNING id`,
      );
      const c = await connect();
      try {
        expect(await createOne(c, org, 'proposal', 1000)).toBe(1000);
        expect(await createOne(c, org, 'proposal', 1000)).toBe(1001);
        expect(await createOne(c, org, 'estimate', 1)).toBe(1);
      } finally {
        await c.end();
      }
    });
  });
});
