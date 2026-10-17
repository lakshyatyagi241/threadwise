import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The support tables against a real Postgres as the restricted application role (a superuser would bypass every
 * policy and make the RLS assertions vacuous). CHECK and FK checks use the owner connection: owners skip RLS but
 * never constraints.
 */
describe('support tables: RLS and constraints', () => {
  const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let userA: number;
  let operator: number;
  let ticketA: number;
  let ticketB: number;

  async function inTx<T>(setup: string[], fn: () => Promise<T>): Promise<T> {
    await app.query('BEGIN');
    try {
      for (const stmt of setup) await app.query(stmt);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  }
  const asOrg = <T>(orgId: number, fn: () => Promise<T>) =>
    inTx([`SELECT set_config('app.org_id', '${orgId}', true)`], fn);
  const asPrivileged = <T>(fn: () => Promise<T>) =>
    inTx([`SELECT set_config('app.privileged', 'on', true)`], fn);

  const insertTicket = (c: Client, org: number, over: Record<string, string> = {}) => {
    const row = {
      ticket_number: `TKT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: 'N',
      email: 'n@example.test',
      subject: 'S',
      message: 'M',
      ...over,
    };
    return c.query(
      `INSERT INTO support_tickets (org_id, ${Object.keys(row).join(', ')})
       VALUES ($1, ${Object.keys(row)
         .map((_, i) => `$${i + 2}`)
         .join(', ')}) RETURNING id`,
      [org, ...Object.values(row)],
    );
  };

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
    await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });
    const org = async (slug: string) =>
      Number(
        (
          await owner.query(`INSERT INTO organizations (slug, name) VALUES ($1, $1) RETURNING id`, [
            slug,
          ])
        ).rows[0].id,
      );
    orgA = await org('supp-a');
    orgB = await org('supp-b');
    userA = Number(
      (
        await owner.query(
          `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1, 'a@example.test', 'A', 'x') RETURNING id`,
          [orgA],
        )
      ).rows[0].id,
    );
    operator = Number(
      (
        await owner.query(
          `INSERT INTO platform_operators (email, full_name, password_hash, role) VALUES ('o@example.test', 'Op', 'x', 'support') RETURNING id`,
        )
      ).rows[0].id,
    );
    ticketA = Number((await insertTicket(owner, orgA)).rows[0].id);
    ticketB = Number((await insertTicket(owner, orgB)).rows[0].id);
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

  it('forces RLS with both policy clauses on every support table', async () => {
    const res = await owner.query(
      `SELECT c.relname, c.relforcerowsecurity, p.qual IS NOT NULL AS has_using, p.with_check IS NOT NULL AS has_check
         FROM pg_class c JOIN pg_policies p ON p.tablename = c.relname
        WHERE c.relname IN ('support_tickets', 'support_messages', 'platform_notes')`,
    );
    expect(res.rowCount).toBe(3);
    for (const r of res.rows) {
      expect(r, r.relname).toMatchObject({
        relforcerowsecurity: true,
        has_using: true,
        has_check: true,
      });
    }
  });

  it('a tenant sees only its own tickets; no tenant context sees none; privileged sees all', async () => {
    const mine = await asOrg(orgA, () => app.query(`SELECT id FROM support_tickets`));
    expect(mine.rows.map((r) => Number(r.id))).toEqual([ticketA]);
    expect((await inTx([], () => app.query(`SELECT id FROM support_tickets`))).rowCount).toBe(0);
    const all = await asPrivileged(() => app.query(`SELECT id FROM support_tickets ORDER BY id`));
    expect(all.rows.map((r) => Number(r.id))).toEqual([ticketA, ticketB]);
  });

  it('a tenant cannot write a ticket into another organization, nor touch its rows', async () => {
    await expect(asOrg(orgA, () => insertTicket(app, orgB))).rejects.toThrow(/row-level security/);
    const upd = await asOrg(orgA, () =>
      app.query(`UPDATE support_tickets SET status = 'closed' WHERE id = $1`, [ticketB]),
    );
    expect(upd.rowCount).toBe(0);
  });

  it('rejects values outside the status, priority, reason and role vocabularies', async () => {
    await expect(insertTicket(owner, orgA, { status: 'done' })).rejects.toThrow(
      /chk_support_tickets_status/,
    );
    await expect(insertTicket(owner, orgA, { priority: 'critical' })).rejects.toThrow(
      /chk_support_tickets_priority/,
    );
    await expect(insertTicket(owner, orgA, { reason: 'refund' })).rejects.toThrow(
      /chk_support_tickets_reason/,
    );
    await expect(
      owner.query(
        `INSERT INTO support_messages (org_id, ticket_id, author_role, body) VALUES ($1, $2, 'robot', 'x')`,
        [orgA, ticketA],
      ),
    ).rejects.toThrow(/chk_support_messages_author_role/);
  });

  it('keeps ticket numbers unique across organizations', async () => {
    const n = (
      await owner.query(`SELECT ticket_number FROM support_tickets WHERE id = $1`, [ticketA])
    ).rows[0].ticket_number as string;
    await expect(insertTicket(owner, orgB, { ticket_number: n })).rejects.toThrow(
      /uq_support_tickets_ticket_number/,
    );
  });

  it('assigns to a platform operator, and unassigns when the operator is deleted', async () => {
    await owner.query(`UPDATE support_tickets SET assigned_agent_id = $2 WHERE id = $1`, [
      ticketA,
      operator,
    ]);
    await expect(
      owner.query(`UPDATE support_tickets SET assigned_agent_id = 999999 WHERE id = $1`, [ticketA]),
    ).rejects.toThrow(/fk_support_tickets_assigned_operator/);
    await owner.query(`DELETE FROM platform_operators WHERE id = $1`, [operator]);
    const r = await owner.query(`SELECT assigned_agent_id FROM support_tickets WHERE id = $1`, [
      ticketA,
    ]);
    expect(r.rows[0].assigned_agent_id).toBeNull();
  });

  it('a message has at most one author, and a customer author must belong to the same organization', async () => {
    const op = Number(
      (
        await owner.query(
          `INSERT INTO platform_operators (email, full_name, password_hash) VALUES ('o2@example.test', 'Op2', 'x') RETURNING id`,
        )
      ).rows[0].id,
    );
    await expect(
      owner.query(
        `INSERT INTO support_messages (org_id, ticket_id, author_user_id, author_operator_id, body) VALUES ($1, $2, $3, $4, 'x')`,
        [orgA, ticketA, userA, op],
      ),
    ).rejects.toThrow(/chk_support_messages_one_author/);
    await expect(
      owner.query(
        `INSERT INTO support_messages (org_id, ticket_id, author_user_id, author_role, body) VALUES ($1, $2, $3, 'customer', 'x')`,
        [orgB, ticketB, userA],
      ),
    ).rejects.toThrow(/fk_support_messages_author_user_id/);
  });
});
