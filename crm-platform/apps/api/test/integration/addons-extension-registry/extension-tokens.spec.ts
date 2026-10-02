import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, runMigrations, withTenant, type DbClient } from '@crm/db';
import {
  EXTENSION_TOKEN_MAX_TTL_S,
  ExtensionTokenService,
  hashExtensionToken,
} from '../../../src/modules/addons-extension-registry/extension-token.service';

/**
 * TW-ADD-034 against a real Postgres as the restricted application role: only the hash is stored, a token resolves
 * to its user and touches last_used_at, an expired or revoked token resolves to nothing, issuing sweeps the user's
 * expired tokens, and a token can never resolve inside another organisation (RLS).
 */
describe('browser-extension tokens', () => {
  const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let dbClient: DbClient;
  let orgA = 0;
  let orgB = 0;
  let userA = 0;
  let userA2 = 0;
  const svc = new ExtensionTokenService();
  const inOrg = <T>(orgId: number, fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(dbClient.db, { orgId }, fn);

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
    const user = async (orgId: number, email: string) =>
      Number(
        (
          await owner.query(
            `INSERT INTO users (org_id, email, full_name) VALUES ($1, $2::citext, $2::text) RETURNING id`,
            [orgId, email],
          )
        ).rows[0].id,
      );
    orgA = await org('tok-a');
    orgB = await org('tok-b');
    userA = await user(orgA, 'a1@example.test');
    userA2 = await user(orgA, 'a2@example.test');
    dbClient = createDbClient({
      url: `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`,
      poolMax: 4,
    });
  }, 180_000);

  afterAll(async () => {
    await dbClient?.close();
    await owner?.end();
    await container?.stop();
  });

  it('issues a 60-character token and stores only its sha256', async () => {
    const issued = await inOrg(orgA, (tx) => svc.issue(tx, { orgId: orgA, userId: userA }));
    expect(issued.token).toHaveLength(60);
    const rows = await owner.query(
      `SELECT token_hash, label FROM extension_api_tokens WHERE uuid = $1`,
      [issued.uuid],
    );
    expect(rows.rows[0]).toEqual({
      token_hash: hashExtensionToken(issued.token),
      label: 'browser-extension',
    });
    expect(JSON.stringify(rows.rows)).not.toContain(issued.token);
  });

  it('resolves a live token to its user and stamps last_used_at', async () => {
    const { token, uuid } = await inOrg(orgA, (tx) =>
      svc.issue(tx, { orgId: orgA, userId: userA2 }),
    );
    expect(await inOrg(orgA, (tx) => svc.resolve(tx, token, new Date(Date.now() + 1000)))).toEqual({
      userId: userA2,
    });
    expect(await inOrg(orgA, (tx) => svc.resolve(tx, 'not-a-token'))).toBeNull();
    const row = await owner.query(`SELECT last_used_at FROM extension_api_tokens WHERE uuid = $1`, [
      uuid,
    ]);
    expect(row.rows[0].last_used_at).not.toBeNull();
  });

  it('rejects an expired token, and a token always has a TTL capped at a year', async () => {
    const short = await inOrg(orgA, (tx) =>
      svc.issue(tx, { orgId: orgA, userId: userA, ttlSeconds: 60 }),
    );
    expect(
      await inOrg(orgA, (tx) => svc.resolve(tx, short.token, new Date(Date.now() + 30_000))),
    ).toEqual({
      userId: userA,
    });
    expect(
      await inOrg(orgA, (tx) => svc.resolve(tx, short.token, new Date(Date.now() + 120_000))),
    ).toBeNull();

    const forever = await inOrg(orgA, (tx) =>
      svc.issue(tx, { orgId: orgA, userId: userA, ttlSeconds: 10 * EXTENSION_TOKEN_MAX_TTL_S }),
    );
    expect(forever.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
      EXTENSION_TOKEN_MAX_TTL_S * 1000 + 5000,
    );
    const stored = await owner.query(
      `SELECT expires_at FROM extension_api_tokens WHERE uuid = $1`,
      [forever.uuid],
    );
    expect(stored.rows[0].expires_at).not.toBeNull();
  });

  it('logout removes exactly the token presented; the same user keeps other sessions', async () => {
    const a = await inOrg(orgA, (tx) => svc.issue(tx, { orgId: orgA, userId: userA }));
    const b = await inOrg(orgA, (tx) => svc.issue(tx, { orgId: orgA, userId: userA }));
    expect(await inOrg(orgA, (tx) => svc.revoke(tx, a.token))).toBe(true);
    expect(await inOrg(orgA, (tx) => svc.revoke(tx, a.token))).toBe(false);
    expect(await inOrg(orgA, (tx) => svc.resolve(tx, a.token))).toBeNull();
    expect(await inOrg(orgA, (tx) => svc.resolve(tx, b.token))).toEqual({ userId: userA });
  });

  it("issuing sweeps that user's expired tokens, so the table needs no cross-tenant cleanup", async () => {
    await owner.query(
      `INSERT INTO extension_api_tokens (org_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, 'stale-hash', now() - interval '1 day')`,
      [orgA, userA],
    );
    await inOrg(orgA, (tx) => svc.issue(tx, { orgId: orgA, userId: userA }));
    const n = await owner.query(
      `SELECT count(*)::int AS n FROM extension_api_tokens WHERE token_hash = 'stale-hash'`,
    );
    expect(n.rows[0].n).toBe(0);
  });

  it('a token never resolves inside another organisation', async () => {
    const { token } = await inOrg(orgA, (tx) => svc.issue(tx, { orgId: orgA, userId: userA }));
    expect(await inOrg(orgB, (tx) => svc.resolve(tx, token))).toBeNull();
    expect(await inOrg(orgB, (tx) => svc.revoke(tx, token))).toBe(false);
    expect(await inOrg(orgA, (tx) => svc.resolve(tx, token))).toEqual({ userId: userA });
  });

  it('deleting a user removes their tokens (Reference cascaded; the port had set the column null)', async () => {
    const u = Number(
      (
        await owner.query(
          `INSERT INTO users (org_id, email, full_name) VALUES ($1, 'gone@example.test', 'g') RETURNING id`,
          [orgA],
        )
      ).rows[0].id,
    );
    const { token } = await inOrg(orgA, (tx) => svc.issue(tx, { orgId: orgA, userId: u }));
    await owner.query(`DELETE FROM users WHERE org_id = $1 AND id = $2`, [orgA, u]);
    expect(await inOrg(orgA, (tx) => svc.resolve(tx, token))).toBeNull();
    const left = await owner.query(
      `SELECT count(*)::int AS n FROM extension_api_tokens WHERE token_hash = $1`,
      [hashExtensionToken(token)],
    );
    expect(left.rows[0].n).toBe(0);
  });
});
