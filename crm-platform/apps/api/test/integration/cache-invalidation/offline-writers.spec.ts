import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bumpRolesVersionOffline } from '../../../src/kernel/rbac/roles-version-offline';
import { DEMO_DOMAIN, seedDemoMembers } from '../../../src/modules/team-chat/cli/demo-members';
import { buildInstance, startEnv, type Env, type Instance } from './harness';
import { record } from './results';

/**
 * Writers that run outside the API (R-64-04): the seed and demo-data commands and migrations. They write role links straight into
 * Postgres; the running API caches each person's grant set under the workspace's roles version. Real Postgres and Redis.
 */
describe('offline writers and the roles version', () => {
  let env: Env;
  let a: Instance;
  let n = 0;

  async function workspaceWithCachedEmptyUser() {
    const tag = `${Date.now().toString(36)}${n++}`;
    const orgId = Number(
      (
        await env.pg.owner.query(
          `INSERT INTO organizations (slug,name,plan) VALUES ($1,$1,'starter') RETURNING id`,
          [`off-${tag}`],
        )
      ).rows[0].id,
    );
    // a person who exists but holds no role yet: the API has cached an empty grant set for them
    const userId = Number(
      (
        await env.pg.owner.query(
          `INSERT INTO users (org_id,email,full_name,password_hash) VALUES ($1,$2,'Aarav Sharma','x') RETURNING id`,
          [orgId, `aarav.sharma@${DEMO_DOMAIN}`],
        )
      ).rows[0].id,
    );
    expect((await a.rbac.grantsForUser(orgId, userId)).size).toBe(0);
    return { orgId, userId };
  }

  beforeAll(async () => {
    env = await startEnv();
    a = buildInstance(env, 'A');
  }, 240_000);
  afterAll(async () => {
    await a?.close();
    await env?.stop();
  });

  it('control: role links written straight into Postgres are NOT seen while the cached version lives (the R-64-04 gap, bounded by 600 s)', async () => {
    const w = await workspaceWithCachedEmptyUser();
    await env.pg.owner.query('SELECT provision_workspace_presets($1)', [w.orgId]);
    await env.pg.owner.query(
      `INSERT INTO user_roles SELECT $1,$2,id FROM roles WHERE org_id=$1 AND name='Agent'`,
      [w.orgId, w.userId],
    );
    expect((await a.rbac.grantsForUser(w.orgId, w.userId)).size).toBe(0); // stale
    const ttl = await env.admin.ttl(`rbac:version:${w.orgId}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(600);
    record('R-64-04 seed command without the bump', {
      staleUntilCachedVersionExpiresSeconds: ttl,
      documentedSeconds: 600,
    });
  });

  it('seedDemoMembers (the demo-data command) bumps the version: the person has their grants at once', async () => {
    const w = await workspaceWithCachedEmptyUser();
    const was = process.env.REDIS_URL; // the command finds Redis the way an operator's shell does
    process.env.REDIS_URL = env.redis.url;
    try {
      await seedDemoMembers(env.pg.owner as never, w.orgId);
    } finally {
      if (was === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = was;
    }
    const grants = await a.rbac.grantsForUser(w.orgId, w.userId);
    expect(grants.size).toBeGreaterThan(0);
  });

  it('bumpRolesVersionOffline (used by seed-auth): Postgres version up, cached version deleted; no Redis URL is tolerated; unreachable Redis is reported, not thrown', async () => {
    const w = await workspaceWithCachedEmptyUser();
    const before = Number(
      (await env.pg.owner.query(`SELECT roles_version FROM organizations WHERE id=$1`, [w.orgId]))
        .rows[0].roles_version,
    );
    expect(await env.admin.exists(`rbac:version:${w.orgId}`)).toBe(1);
    const r = await bumpRolesVersionOffline(env.pg.owner as never, [w.orgId], env.redis.url);
    expect(r).toEqual({ bumped: 1, redisCleared: true });
    expect(
      Number(
        (await env.pg.owner.query(`SELECT roles_version FROM organizations WHERE id=$1`, [w.orgId]))
          .rows[0].roles_version,
      ),
    ).toBe(before + 1);
    expect(await env.admin.exists(`rbac:version:${w.orgId}`)).toBe(0);
    expect(await bumpRolesVersionOffline(env.pg.owner as never, [w.orgId], undefined)).toEqual({
      bumped: 1,
      redisCleared: false,
    });
    expect(
      await bumpRolesVersionOffline(env.pg.owner as never, [w.orgId], 'redis://127.0.0.1:1'),
    ).toEqual({ bumped: 1, redisCleared: false });
    expect(await bumpRolesVersionOffline(env.pg.owner as never, [], env.redis.url)).toEqual({
      bumped: 0,
      redisCleared: true,
    });
  });
});
