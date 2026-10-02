import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The widget tables against a real Postgres as the restricted application role (a superuser bypasses every policy), plus
 * the token lookup function and the value checks.
 */
describe('chatbot widget: schema, isolation and token lookup', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let widgetA: number;
  let widgetB: number;
  const tokenA = 'A'.repeat(48);
  const tokenB = 'B'.repeat(48);

  const insertWidget = async (org: number, slug: string, token: string) =>
    Number(
      (
        await owner.query(
          `INSERT INTO chatbot_widgets (org_id, name, slug, embed_token) VALUES ($1,$2,$3,$4) RETURNING id`,
          [org, slug, slug, token],
        )
      ).rows[0].id,
    );
  const asTenant = async <T>(org: number, fn: () => Promise<T>) => {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(org)]);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
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
    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../../packages/db/migrations'),
      log: () => undefined,
    });
    orgA = Number(
      (
        await owner.query(
          `INSERT INTO organizations (slug,name,plan) VALUES ('wa','A','starter') RETURNING id`,
        )
      ).rows[0].id,
    );
    orgB = Number(
      (
        await owner.query(
          `INSERT INTO organizations (slug,name,plan) VALUES ('wb','B','starter') RETURNING id`,
        )
      ).rows[0].id,
    );
    widgetA = await insertWidget(orgA, 'a-widget', tokenA);
    widgetB = await insertWidget(orgB, 'b-widget', tokenB);
    await owner.query(
      `INSERT INTO chatbot_widget_visitors (org_id, widget_id, visitor_uuid) VALUES ($1,$2,'va'), ($3,$4,'vb')`,
      [orgA, widgetA, orgB, widgetB],
    );
    const url = new URL(container.getConnectionUri());
    url.username = 'crm_app_user';
    url.password = 'test';
    app = new Client({ connectionString: url.toString() });
    await app.connect();
  }, 180_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  it('RLS is enabled and forced on both tables, with a tenant_isolation policy', async () => {
    const res = await owner.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, count(p.polname)::int AS policies
       FROM pg_class c LEFT JOIN pg_policy p ON p.polrelid = c.oid
       WHERE c.relname IN ('chatbot_widgets','chatbot_widget_visitors') GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity`,
    );
    expect(res.rows).toHaveLength(2);
    for (const r of res.rows)
      expect([r.relname, r.relrowsecurity, r.relforcerowsecurity, r.policies]).toEqual([
        r.relname,
        true,
        true,
        1,
      ]);
  });

  it('a tenant sees only its own widgets and visitors, and with no tenant sees nothing', async () => {
    const mine = await asTenant(orgA, () => app.query(`SELECT id FROM chatbot_widgets`));
    expect(mine.rows.map((r) => Number(r.id))).toEqual([widgetA]);
    const visitors = await asTenant(orgA, () =>
      app.query(`SELECT visitor_uuid FROM chatbot_widget_visitors`),
    );
    expect(visitors.rows.map((r) => r.visitor_uuid)).toEqual(['va']);
    await app.query('BEGIN');
    const none = await app.query(`SELECT id FROM chatbot_widgets`).catch(() => ({ rows: [] }));
    await app.query('ROLLBACK');
    expect(none.rows).toEqual([]);
  });

  it('a tenant cannot insert, update or delete into another tenant (WITH CHECK and USING)', async () => {
    await expect(
      asTenant(orgA, () =>
        app.query(
          `INSERT INTO chatbot_widgets (org_id, name, slug, embed_token) VALUES ($1,'x','x','${'C'.repeat(48)}')`,
          [orgB],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    const upd = await asTenant(orgA, () =>
      app.query(`UPDATE chatbot_widgets SET name = 'hijack' WHERE id = $1`, [widgetB]),
    );
    expect(upd.rowCount).toBe(0);
    const del = await asTenant(orgA, () =>
      app.query(`DELETE FROM chatbot_widgets WHERE id = $1`, [widgetB]),
    );
    expect(del.rowCount).toBe(0);
  });

  it("a visitor cannot point at another tenant's widget (composite foreign key)", async () => {
    await expect(
      owner.query(
        `INSERT INTO chatbot_widget_visitors (org_id, widget_id, visitor_uuid) VALUES ($1,$2,'cross')`,
        [orgA, widgetB],
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('wgt_widget_lookup finds a token without a tenant, returns only two ids, and nothing for an unknown token', async () => {
    const hit = await app.query(`SELECT * FROM wgt_widget_lookup($1)`, [tokenB]);
    expect(hit.rows).toHaveLength(1);
    expect(Object.keys(hit.rows[0]).sort()).toEqual(['widget_id', 'widget_org_id']);
    expect([Number(hit.rows[0].widget_org_id), Number(hit.rows[0].widget_id)]).toEqual([
      orgB,
      widgetB,
    ]);
    expect((await app.query(`SELECT * FROM wgt_widget_lookup('nope')`)).rows).toEqual([]);
    // The lookup does not leave the session privileged.
    expect((await app.query(`SELECT id FROM chatbot_widgets`)).rows).toEqual([]);
  });

  it('the embed token is unique across the whole platform, the slug per organization', async () => {
    await expect(insertWidget(orgA, 'dup-token', tokenB)).rejects.toThrow(
      /uq_chatbot_widgets_embed_token/,
    );
    await expect(insertWidget(orgA, 'a-widget', 'D'.repeat(48))).rejects.toThrow(
      /uq_chatbot_widgets_slug/,
    );
    await expect(insertWidget(orgB, 'a-widget', 'E'.repeat(48))).resolves.toBeGreaterThan(0);
  });

  it('mode, position, background kind and status only take the values the script understands', async () => {
    for (const [col, bad] of [
      ['mode', 'sms'],
      ['position', 'top'],
      ['body_bg_kind', 'video'],
      ['status', 'gone'],
    ] as const) {
      await expect(
        owner.query(`UPDATE chatbot_widgets SET ${col} = $1 WHERE id = $2`, [bad, widgetA]),
      ).rejects.toThrow(/chk_chatbot_widgets/);
    }
  });

  it('deleting an assistant clears the link; deleting a widget takes its visitors but not the conversation', async () => {
    const asst = Number(
      (
        await owner.query(
          `INSERT INTO ai_chat_assistants (org_id, name, slug) VALUES ($1,'x','x') RETURNING id`,
          [orgA],
        )
      ).rows[0].id,
    );
    await owner.query(`UPDATE chatbot_widgets SET assistant_id = $1 WHERE id = $2`, [
      asst,
      widgetA,
    ]);
    await owner.query(`DELETE FROM ai_chat_assistants WHERE id = $1`, [asst]);
    expect(
      (await owner.query(`SELECT assistant_id FROM chatbot_widgets WHERE id = $1`, [widgetA]))
        .rows[0].assistant_id,
    ).toBeNull();
    const channel = Number(
      (
        await owner.query(
          `INSERT INTO channels (org_id, kind, name) VALUES ($1, 'webchat', 'w') RETURNING id`,
          [orgA],
        )
      ).rows[0].id,
    );
    const conv = Number(
      (
        await owner.query(
          `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1, $2, 'visitor-1', 't') RETURNING id`,
          [orgA, channel],
        )
      ).rows[0].id,
    );
    await owner.query(`UPDATE chatbot_widget_visitors SET conversation_id = $1 WHERE org_id = $2`, [
      conv,
      orgA,
    ]);
    await owner.query(`DELETE FROM chatbot_widgets WHERE id = $1`, [widgetA]);
    expect(
      (
        await owner.query(
          `SELECT count(*)::int AS n FROM chatbot_widget_visitors WHERE org_id = $1`,
          [orgA],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (await owner.query(`SELECT count(*)::int AS n FROM conversations WHERE id = $1`, [conv]))
        .rows[0].n,
    ).toBe(1);
  });

  it('the row_version trigger bumps on every update', async () => {
    const before = Number(
      (await owner.query(`SELECT row_version FROM chatbot_widgets WHERE id = $1`, [widgetB]))
        .rows[0].row_version,
    );
    await owner.query(`UPDATE chatbot_widgets SET name = 'renamed' WHERE id = $1`, [widgetB]);
    const after = Number(
      (await owner.query(`SELECT row_version FROM chatbot_widgets WHERE id = $1`, [widgetB]))
        .rows[0].row_version,
    );
    expect(after).toBe(before + 1);
  });
});
