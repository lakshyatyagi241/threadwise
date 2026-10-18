import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { JwtService } from '@nestjs/jwt';
import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDbClient, runMigrations, withPrivileged, withTenant, type DbClient } from '@crm/db';
import {
  RequestContextStore,
  type RequestContext,
} from '../../../src/common/context/request-context';
import type { DatabaseService } from '../../../src/infra/db/database.service';
import { ImpersonationService } from '../../../src/modules/auth/platform/impersonation.service';
import { PlatformStore } from '../../../src/modules/auth/platform/platform-store';
import { AuthAuditService } from '../../../src/modules/auth/security/auth-audit.service';
import { TokenService } from '../../../src/modules/auth/token.service';

/**
 * Operator impersonation against a real Postgres, as the restricted application role (a superuser would bypass the privileged-only
 * policy and the one-open-session index would still hold, but the isolation assertions would be vacuous). The Redis tombstone is an
 * in-memory fake: the property under test is the table, not Redis.
 */
describe('operator impersonation (act-as session)', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let dbClient: DbClient;
  let svc: ImpersonationService;
  let orgUuid: string;
  let orgId: number;
  let ownerId: number;
  let ownerUuid: string;
  let operatorId: number;
  let otherOperatorId: number;

  const env: Record<string, string> = {
    JWT_ACCESS_SECRET: 'access-secret-for-tests-0123456789abcdef',
    JWT_REFRESH_SECRET: 'refresh-secret-for-tests-0123456789abcdef',
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    WEB_APP_URL: 'https://app.example.test/',
  };
  const jwt = new JwtService({});
  const redisStore = new Map<string, string>();
  const redis = {
    get: async (k: string) => redisStore.get(k) ?? null,
    set: async (k: string, v: string) => {
      redisStore.set(k, v);
      return 'OK';
    },
  };

  const q = (text: string, params: unknown[] = []) => owner.query(text, params);

  const asOperator = <T>(
    id: number,
    role: 'super_admin' | 'support',
    fn: () => Promise<T>,
  ): Promise<T> => {
    const ctx: RequestContext = {
      requestId: 'req-1',
      orgId: 0,
      actorType: 'platform_operator',
      actorId: id,
      userId: null,
      ip: '203.0.113.9',
      userAgent: 'vitest',
      operatorRole: role,
    };
    return RequestContextStore.run(ctx, fn);
  };

  const start = (id = operatorId, extra: Partial<{ reason: string; readOnly: boolean }> = {}) =>
    asOperator(id, 'super_admin', () =>
      svc.start(orgUuid, { reason: 'Ticket 1234 debug', readOnly: false, ...extra }),
    );
  const codeOf = (url: string) => new URL(url).searchParams.get('code')!;

  async function seedOrg(slug: string, withOwnerStatus: 'active' | 'inactive' = 'active') {
    const o = await q(`INSERT INTO organizations (slug, name) VALUES ($1, $2) RETURNING id, uuid`, [
      slug,
      `Org ${slug}`,
    ]);
    const id = Number(o.rows[0].id);
    const u = await q(
      `INSERT INTO users (org_id, email, full_name, status) VALUES ($1, $2, 'Owner', $3) RETURNING id, uuid`,
      [id, `${slug}@x.test`, withOwnerStatus],
    );
    return {
      id,
      uuid: String(o.rows[0].uuid),
      userId: Number(u.rows[0].id),
      userUuid: String(u.rows[0].uuid),
    };
  }

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

    const op = await q(
      `INSERT INTO platform_operators (email, full_name, password_hash, role) VALUES
         ('root@x.test', 'Root Operator', 'x', 'super_admin'),
         ('root2@x.test', 'Second Operator', 'x', 'super_admin') RETURNING id`,
    );
    operatorId = Number(op.rows[0].id);
    otherOperatorId = Number(op.rows[1].id);

    dbClient = createDbClient({
      url: `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`,
      poolMax: 4,
    });
    const db = {
      primary: dbClient.db,
      privileged: (fn: Parameters<DatabaseService['privileged']>[0]) =>
        withPrivileged(dbClient.db, fn),
      txAs: (
        t: Parameters<DatabaseService['txAs']>[0],
        fn: Parameters<DatabaseService['txAs']>[1],
      ) => withTenant(dbClient.db, t, fn),
    } as unknown as DatabaseService;
    svc = new ImpersonationService(
      new PlatformStore(db),
      new TokenService(jwt, { get: (k: string) => env[k] } as never),
      new AuthAuditService(db),
      { current: async () => 0 } as never,
      { get: (k: string) => env[k] } as never,
      redis as never,
    );
  }, 180_000);

  afterAll(async () => {
    await dbClient?.close();
    await owner?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    redisStore.clear();
    await q(`DELETE FROM impersonation_sessions`);
    const s = await seedOrg(`o${Math.random().toString(36).slice(2, 8)}`);
    orgId = s.id;
    orgUuid = s.uuid;
    ownerId = s.userId;
    ownerUuid = s.userUuid;
    await q(
      `UPDATE organizations SET settings = jsonb_build_object('ownerUserId', $2::text) WHERE id = $1`,
      [orgId, ownerUuid],
    );
  });

  it('starts a session: only the hash of the code is stored, the window is capped, both actors are audited', async () => {
    const res = await start();
    const code = codeOf(res.handoffUrl);
    expect(res.handoffUrl).toMatch(/^https:\/\/app\.example\.test\/impersonate\?code=[\w-]{43}$/);
    expect(res.workspaceId).toBe(orgUuid);

    const row = (await q(`SELECT * FROM impersonation_sessions WHERE uuid = $1`, [res.sessionId]))
      .rows[0];
    expect(row.handoff_code_hash).toHaveLength(64);
    expect(row.handoff_code_hash).not.toContain(code);
    expect(Number(row.operator_id)).toBe(operatorId);
    expect(Number(row.target_user_id)).toBe(ownerId);
    expect(row.ended_at).toBeNull();
    const minutes =
      (new Date(row.expires_at).getTime() - new Date(row.started_at).getTime()) / 60000;
    expect(minutes).toBeLessThanOrEqual(60);
    const handoffSeconds =
      (new Date(row.handoff_expires_at).getTime() - new Date(row.started_at).getTime()) / 1000;
    expect(handoffSeconds).toBeLessThanOrEqual(61);

    const ev = await q(
      `SELECT actor_type, actor_id, payload FROM security_events WHERE event = 'platform.impersonation.started' AND subject_org_id = $1`,
      [orgId],
    );
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0].actor_type).toBe('platform_operator');
    expect(Number(ev.rows[0].actor_id)).toBe(operatorId);
    expect(ev.rows[0].payload.asUserId).toBe(ownerUuid);
    // the reason survives redaction and the code never reaches the audit trail
    expect(JSON.stringify(ev.rows[0].payload)).not.toContain(code);

    const trail = await q(
      `SELECT actor_type, actor_id, record_id, delta FROM audit_log WHERE org_id = $1 AND action = 'impersonation.started'`,
      [orgId],
    );
    expect(trail.rows).toHaveLength(1);
    expect(trail.rows[0].actor_type).toBe('platform_operator');
    expect(Number(trail.rows[0].actor_id)).toBe(operatorId);
    expect(Number(trail.rows[0].record_id)).toBe(ownerId);
    expect(trail.rows[0].delta.asUserId.new).toBe(ownerUuid);
  });

  it('refuses a non-super-admin operator and a workspace with no active owner', async () => {
    await expect(
      asOperator(operatorId, 'support', () =>
        svc.start(orgUuid, { reason: 'long enough reason', readOnly: false }),
      ),
    ).rejects.toMatchObject({ code: 'AUTH_OPERATOR_ROLE_REQUIRED' });

    const dead = await seedOrg(`dead${Math.random().toString(36).slice(2, 6)}`, 'inactive');
    await q(
      `UPDATE organizations SET settings = jsonb_build_object('ownerUserId', $2::text) WHERE id = $1`,
      [dead.id, dead.userUuid],
    );
    await expect(
      asOperator(operatorId, 'super_admin', () =>
        svc.start(dead.uuid, { reason: 'long enough reason', readOnly: false }),
      ),
    ).rejects.toMatchObject({ code: 'WSP_IMPERSONATION_NO_OWNER' });
    await expect(
      asOperator(operatorId, 'super_admin', () =>
        svc.start('00000000-0000-4000-8000-000000000000', {
          reason: 'long enough reason',
          readOnly: false,
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('falls back to the admin-role user when the workspace names no owner', async () => {
    await q(`UPDATE organizations SET settings = '{}'::jsonb WHERE id = $1`, [orgId]);
    await expect(start()).rejects.toMatchObject({ code: 'WSP_IMPERSONATION_NO_OWNER' });
    const role = await q(
      `INSERT INTO roles (org_id, name, system_key) VALUES ($1, 'Admin', 'admin') RETURNING id`,
      [orgId],
    );
    await q(`INSERT INTO user_roles (org_id, user_id, role_id) VALUES ($1, $2, $3)`, [
      orgId,
      ownerId,
      role.rows[0].id,
    ]);
    const res = await start();
    const row = (
      await q(`SELECT target_user_id FROM impersonation_sessions WHERE uuid = $1`, [res.sessionId])
    ).rows[0];
    expect(Number(row.target_user_id)).toBe(ownerId);
  });

  it('acts as the admin-role user when the named owner is disabled (a migrated workspace whose owner row is inactive)', async () => {
    await q(`UPDATE users SET status = 'inactive' WHERE org_id = $1 AND id = $2`, [orgId, ownerId]);
    await expect(start()).rejects.toMatchObject({ code: 'WSP_IMPERSONATION_NO_OWNER' });
    const admin = await q(
      `INSERT INTO users (org_id, email, full_name, status) VALUES ($1, $2, 'Admin', 'active') RETURNING id`,
      [orgId, `admin-${Math.random().toString(36).slice(2, 6)}@x.test`],
    );
    const role = await q(
      `INSERT INTO roles (org_id, name, system_key) VALUES ($1, 'Owner', 'admin') RETURNING id`,
      [orgId],
    );
    await q(`INSERT INTO user_roles (org_id, user_id, role_id) VALUES ($1, $2, $3)`, [
      orgId,
      admin.rows[0].id,
      role.rows[0].id,
    ]);
    const res = await start();
    const row = (
      await q(`SELECT target_user_id FROM impersonation_sessions WHERE uuid = $1`, [res.sessionId])
    ).rows[0];
    expect(Number(row.target_user_id)).toBe(Number(admin.rows[0].id));
  });

  it('keeps at most one open session per operator: a new start ends the previous one', async () => {
    const first = await start();
    const second = await start();
    const rows = (
      await q(
        `SELECT uuid, ended_at, ended_by FROM impersonation_sessions WHERE operator_id = $1`,
        [operatorId],
      )
    ).rows;
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.uuid === first.sessionId)!;
    const b = rows.find((r) => r.uuid === second.sessionId)!;
    expect(a.ended_by).toBe('new_session');
    expect(a.ended_at).not.toBeNull();
    expect(b.ended_at).toBeNull();
    // another operator is not affected
    await start(otherOperatorId);
    expect(
      (await q(`SELECT count(*)::int AS n FROM impersonation_sessions WHERE ended_at IS NULL`))
        .rows[0].n,
    ).toBe(2);
    // and the database itself refuses a second open row, whoever writes it
    await expect(
      q(
        `INSERT INTO impersonation_sessions (operator_id, target_workspace_id, target_user_id, reason, expires_at, handoff_expires_at)
         VALUES ($1, $2, $3, 'direct insert', now() + interval '10 minutes', now() + interval '1 minute')`,
        [operatorId, orgId, ownerId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('redeems the code once, into an access-only act-as token that cannot outlive the session', async () => {
    const res = await start();
    const code = codeOf(res.handoffUrl);
    const out = await svc.redeem(code);
    expect(out.workspaceSlug).toMatch(/^o/);
    expect(out.expiresIn).toBeGreaterThan(15 * 60); // not capped by the 15 minute access TTL: nothing can refresh it
    expect(out.expiresIn).toBeLessThanOrEqual(60 * 60);
    expect('refreshToken' in out).toBe(false);

    const claims = await jwt.verifyAsync(out.accessToken, { secret: env.JWT_ACCESS_SECRET });
    expect(claims).toMatchObject({
      sub: ownerId,
      org: orgId,
      typ: 'user',
      uid: ownerUuid,
      sid: res.sessionId,
      imp: { sid: res.sessionId, oid: operatorId, ro: false },
    });
    expect(claims.exp).toBeLessThanOrEqual(claims.imp.exp);
    // a refresh-secret verification fails: it is not a refresh token
    await expect(
      jwt.verifyAsync(out.accessToken, { secret: env.JWT_REFRESH_SECRET }),
    ).rejects.toBeTruthy();

    // single use, also when raced
    await expect(svc.redeem(code)).rejects.toMatchObject({
      code: 'WSP_IMPERSONATION_CODE_INVALID',
    });
    const again = await start();
    const racedCode = codeOf(again.handoffUrl);
    const results = await Promise.allSettled([
      svc.redeem(racedCode),
      svc.redeem(racedCode),
      svc.redeem(racedCode),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('rejects an unknown, expired or ended handoff code, and an operator who lost the role', async () => {
    await expect(svc.redeem('x'.repeat(43))).rejects.toMatchObject({
      code: 'WSP_IMPERSONATION_CODE_INVALID',
    });

    const stale = await start();
    await q(
      `UPDATE impersonation_sessions SET handoff_expires_at = now() - interval '1 second' WHERE uuid = $1`,
      [stale.sessionId],
    );
    await expect(svc.redeem(codeOf(stale.handoffUrl))).rejects.toMatchObject({
      code: 'WSP_IMPERSONATION_CODE_INVALID',
    });

    const ended = await start();
    await svc.close(ended.sessionId, 'operator');
    await expect(svc.redeem(codeOf(ended.handoffUrl))).rejects.toMatchObject({
      code: 'WSP_IMPERSONATION_CODE_INVALID',
    });

    const demoted = await start();
    await q(`UPDATE platform_operators SET role = 'support' WHERE id = $1`, [operatorId]);
    try {
      await expect(svc.redeem(codeOf(demoted.handoffUrl))).rejects.toMatchObject({
        code: 'WSP_IMPERSONATION_CODE_INVALID',
      });
    } finally {
      await q(`UPDATE platform_operators SET role = 'super_admin' WHERE id = $1`, [operatorId]);
    }
  });

  it('checks the row on every request: stop, expiry, a suspended operator and forged claims all end the session', async () => {
    const res = await start();
    const out = await svc.redeem(codeOf(res.handoffUrl));
    const claims = await jwt.verifyAsync(out.accessToken, { secret: env.JWT_ACCESS_SECRET });
    const live = await svc.assertOpen(claims);
    expect(live).toMatchObject({ sessionId: res.sessionId, operatorId, readOnly: false });

    // claims that do not match the row (a token for another user of the same session)
    await expect(svc.assertOpen({ ...claims, sub: ownerId + 999 })).rejects.toMatchObject({
      code: 'WSP_IMPERSONATION_ENDED',
    });

    // stop kills the token at once, even inside the cache window
    await svc.close(res.sessionId, 'operator');
    await expect(svc.assertOpen(claims)).rejects.toMatchObject({ code: 'WSP_IMPERSONATION_ENDED' });

    // expiry closes the row itself
    const t = await start();
    const tc = await jwt.verifyAsync((await svc.redeem(codeOf(t.handoffUrl))).accessToken, {
      secret: env.JWT_ACCESS_SECRET,
    });
    await svc.assertOpen(tc);
    await q(
      `UPDATE impersonation_sessions SET started_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' WHERE uuid = $1`,
      [t.sessionId],
    );
    svc.forget(t.sessionId);
    await expect(svc.assertOpen(tc)).rejects.toMatchObject({ code: 'WSP_IMPERSONATION_ENDED' });
    expect(
      (await q(`SELECT ended_by FROM impersonation_sessions WHERE uuid = $1`, [t.sessionId]))
        .rows[0].ended_by,
    ).toBe('expiry');

    // an operator suspended mid-session loses the session on the next check
    const s = await start();
    const sc = await jwt.verifyAsync((await svc.redeem(codeOf(s.handoffUrl))).accessToken, {
      secret: env.JWT_ACCESS_SECRET,
    });
    await q(`UPDATE platform_operators SET status = 'suspended' WHERE id = $1`, [operatorId]);
    try {
      svc.forget(s.sessionId);
      await expect(svc.assertOpen(sc)).rejects.toMatchObject({ code: 'WSP_IMPERSONATION_ENDED' });
      expect(
        (await q(`SELECT ended_by FROM impersonation_sessions WHERE uuid = $1`, [s.sessionId]))
          .rows[0].ended_by,
      ).toBe('access_revoked');
    } finally {
      await q(`UPDATE platform_operators SET status = 'active' WHERE id = $1`, [operatorId]);
    }
  });

  it('stamps every audit_log row written during an act-as transaction with the operator, and nothing else', async () => {
    const res = await start();
    const op = (await q(`SELECT uuid FROM platform_operators WHERE id = $1`, [operatorId])).rows[0]
      .uuid as string;
    await withTenant(
      dbClient.db,
      { orgId, userId: ownerId, impersonation: { operatorUuid: op, sessionUuid: res.sessionId } },
      async (tx) => {
        await tx.execute(
          sql`INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta)
            VALUES (${orgId}, ${ownerId}, 'user', 'contacts', 7, 'update', '{"name":{"old":"a","new":"b"}}'::jsonb)`,
        );
      },
    );
    await withTenant(dbClient.db, { orgId, userId: ownerId }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta)
          VALUES (${orgId}, ${ownerId}, 'user', 'contacts', 8, 'update', '{"name":{"old":"a","new":"b"}}'::jsonb)`,
      );
    });
    const rows = (
      await q(
        `SELECT record_id, delta FROM audit_log WHERE org_id = $1 AND module = 'contacts' ORDER BY record_id`,
        [orgId],
      )
    ).rows;
    expect(rows[0].delta._impersonatedBy.new).toEqual({ operatorId: op, sessionId: res.sessionId });
    expect(rows[0].delta.name).toEqual({ old: 'a', new: 'b' });
    expect(rows[1].delta._impersonatedBy).toBeUndefined();

    // stop: the summary counts the stamped rows
    await svc.close(res.sessionId, 'operator');
    const stopped = (
      await q(
        `SELECT payload FROM security_events WHERE event = 'platform.impersonation.stopped' AND subject_org_id = $1`,
        [orgId],
      )
    ).rows[0].payload;
    expect(stopped.totalEvents).toBe(1);
    expect(stopped.eventsByAction).toEqual({ update: 1 });
    expect(stopped.endedBy).toBe('operator');
    // closing twice is harmless and writes the summary once
    await svc.close(res.sessionId, 'operator');
    expect(
      (
        await q(
          `SELECT count(*)::int AS n FROM security_events WHERE event = 'platform.impersonation.stopped' AND subject_org_id = $1`,
          [orgId],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('is invisible to a workspace member: the table is privileged-only', async () => {
    await start();
    const seen = await withTenant(dbClient.db, { orgId, userId: ownerId }, async (tx) =>
      tx.execute(sql`SELECT count(*)::int AS n FROM impersonation_sessions`),
    );
    expect((seen.rows[0] as { n: number }).n).toBe(0);
  });
});
