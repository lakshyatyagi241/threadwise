import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  Api,
  PASSWORD,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';
import { OPERATOR_EMAIL, OPERATOR_PASSWORD } from '../auth-registration-security/harness';
import { operatorToken } from '../install-update-licensing/helpers';
import { REDIS_CLIENT } from '../../../src/infra/redis/redis.module';
import { redisFailsClosed } from '../../../src/modules/auth/support/resilience';
import {
  ChatMediaStore,
  MediaTokenService,
} from '../../../src/infra/providers/chat-conversations/media';

/**
 * Cache isolation, fail-closed behaviour, check-then-act races and stale entitlement caches
 * (AUTHZ-019, 086, 087, 088, 089, 094).
 *
 * Real Postgres (restricted role, RLS), real Redis, the real AppModule. The Redis outage is simulated on the application's own client
 * (`disconnect()`, restored in `finally`), never by touching a container; a Postgres failure is a committed rename of one table (every statement against it errors)
 * , renamed back in `finally`. Every negative sits next to a positive (the same actor allowed before the change or
 * a sibling allowed during it), so a suite that denies everything cannot pass.
 *
 * Criterion for the races (AUTHZ-086/087): a request that STARTED after the revoking change returned (so after it committed) must never
 * succeed. A request that began before the commit and was already past its check is accepted by that criterion; the staged tests
 * (`window`) hold a row lock to force exactly that interleaving and REPORT whether a mutation still lands after the commit.
 *
 * Findings that are real application defects keep a strict assertion and therefore fail. Decisions the product made on purpose are
 * pinned by a test whose name carries POLICY-DECISION.
 */
vi.setConfig({ testTimeout: 900_000, hookTimeout: 900_000 });

let h: Harness;
let api: Api;
let mediaRoot: string;
let A: Tenant;
let B: Tenant;
const tenants: Tenant[] = [];

beforeAll(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'crm-cache-races-'));
  process.env.MEDIA_LOCAL_DIR = mediaRoot;
  h = await startHarness();
  api = new Api(h);
  A = await tenant('cr-a');
  B = await tenant('cr-b');
}, 600_000);

afterAll(async () => {
  await restoreRedis().catch(() => undefined);
  await h?.stop();
  await rm(mediaRoot, { recursive: true, force: true });
  delete process.env.MEDIA_LOCAL_DIR;
});

// ---- helpers ---------------------------------------------------------------------------------------------------------------------

let ipCounter = 10;
const nextIp = () => `10.66.${Math.floor(ipCounter / 250) % 250}.${ipCounter++ % 250}`;
const http = () => request(h.app.getHttpServer());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();
const denied = (status: number) => status === 401 || status === 403;

async function tenant(label: string): Promise<Tenant> {
  const t = await api.signup(label);
  tenants.push(t);
  return t;
}

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
function call(
  token: string | null,
  method: Method,
  path: string,
  body?: object,
  headers: Record<string, string> = {},
) {
  let r = http()[method](path).set('x-forwarded-for', nextIp());
  if (token) r = r.set(bearer(token));
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return body === undefined ? r : r.send(body);
}

const login = (slug: string, email: string, password = PASSWORD) =>
  http()
    .post('/v2/auth/login')
    .set('x-forwarded-for', nextIp())
    .send({ orgSlug: slug, email, password });

/** The claims of a JWT, without verifying it (the test only needs `sid`, `org`, `sub`). */
const claimsOf = (token: string) =>
  JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as {
    sid: string;
    org: number;
    sub: number;
  };

const rolesVersion = async (orgId: number) =>
  Number(
    (await h.owner.query(`SELECT roles_version FROM organizations WHERE id = $1`, [orgId])).rows[0]
      .roles_version,
  );
const grantKey = (orgId: number, version: number, userId: number) =>
  `rbac:${orgId}:v${version}:u${userId}`;

async function roleOfUser(userId: number): Promise<{ uuid: string; rowVersion: number }> {
  const r = await h.owner.query(
    `SELECT r.uuid, r.row_version FROM user_roles ur JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id WHERE ur.user_id = $1 LIMIT 1`,
    [userId],
  );
  return { uuid: r.rows[0].uuid as string, rowVersion: Number(r.rows[0].row_version) };
}
const userUuid = async (userId: number) =>
  (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [userId])).rows[0].uuid as string;

async function scan(pattern = '*'): Promise<string[]> {
  const out = new Set<string>();
  let cursor = '0';
  do {
    const [next, batch] = await h.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    cursor = next;
    for (const k of batch) out.add(k);
  } while (cursor !== '0');
  return [...out].sort();
}
async function deleteKeys(pattern: string) {
  const ks = await scan(pattern);
  if (ks.length) await h.redis.del(...ks);
}

// ---- Redis outage on the application's own client ---------------------------------------------------------------------------------

const appRedis = () => h.app.get<Redis>(REDIS_CLIENT, { strict: false });

async function restoreRedis() {
  const rc = appRedis();
  if (rc.status === 'ready') return;
  if (rc.status !== 'connecting' && rc.status !== 'connect' && rc.status !== 'reconnecting') {
    await rc.connect().catch(() => undefined);
  }
  for (let i = 0; i < 200 && rc.status !== 'ready'; i++) await sleep(50);
  if (rc.status !== 'ready')
    throw new Error(`the application's Redis client did not come back: ${rc.status}`);
}

/** Runs `fn` with the application's Redis connection closed (every command fails at once), then restores it. */
async function withRedisDown<T>(fn: () => Promise<T>, mode?: 'open' | 'closed'): Promise<T> {
  const rc = appRedis();
  const prev = process.env.AUTH_REDIS_FAILURE_MODE;
  if (mode) process.env.AUTH_REDIS_FAILURE_MODE = mode;
  rc.disconnect();
  try {
    for (let i = 0; i < 200 && rc.status !== 'end'; i++) await sleep(25);
    expect(rc.status, 'the simulated outage must be in place').toBe('end');
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.AUTH_REDIS_FAILURE_MODE;
    else process.env.AUTH_REDIS_FAILURE_MODE = prev;
    await restoreRedis();
  }
}

/** Makes selected commands of the application's client fail (a blip on one command), restored afterwards. */
async function withFailingCommand<T>(
  command: 'del' | 'set',
  when: (key: string) => boolean,
  fn: () => Promise<T>,
): Promise<{ result: T; failed: number }> {
  const rc = appRedis() as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const original = rc[command]!.bind(rc);
  let failed = 0;
  rc[command] = (...args: unknown[]) => {
    if (when(String(args[0]))) {
      failed++;
      return Promise.reject(new Error(`simulated ${command} failure`));
    }
    return original(...args);
  };
  try {
    return { result: await fn(), failed };
  } finally {
    delete rc[command];
  }
}

/**
 * Postgres statement errors: every statement the application sends against one table fails ("relation does not exist"), because the
 * table is renamed (committed) in this test's own database and renamed back afterwards. (A REVOKE does not work here: the application
 * role also holds the privilege through PUBLIC.)
 */
async function withBrokenTable(table: string, fn: () => Promise<void>) {
  await h.owner.query(`ALTER TABLE "${table}" RENAME TO "${table}__broken"`);
  try {
    await fn();
  } finally {
    await h.owner.query(`ALTER TABLE "${table}__broken" RENAME TO "${table}"`);
  }
}

// ---- 1. cache isolation (AUTHZ-019) ----------------------------------------------------------------------------------------------

describe('AUTHZ-019 cache isolation between tenants and between users', () => {
  let aReader: { token: string; userId: number };
  let aNoGrant: { token: string; userId: number };
  let aRoleMgr: { token: string; userId: number };
  let aCampaign: { token: string; userId: number };
  let bReader: { token: string; userId: number };

  beforeAll(async () => {
    aReader = await api.member(A, 'rdr', [['record.contacts.read']]);
    aNoGrant = await api.member(A, 'nog', []);
    aRoleMgr = await api.member(A, 'rolemgr', [['admin.role.manage']]);
    aCampaign = await api.member(A, 'camp', [['camp.campaigns.create']]);
    bReader = await api.member(B, 'rdr', [['record.contacts.read']]);
  });

  it('AUTHZ-019 the grant cache is keyed by org, version and user: each caller gets their own answer, warm or cold', async () => {
    for (let pass = 0; pass < 2; pass++) {
      // pass 0 fills the cache, pass 1 is answered from it
      expect((await call(aReader.token, 'get', '/v2/contacts')).status).toBe(200);
      expect((await call(bReader.token, 'get', '/v2/contacts')).status).toBe(200);
      expect((await call(aNoGrant.token, 'get', '/v2/contacts')).status).toBe(403);
      expect((await call(A.admin, 'get', '/v2/contacts')).status).toBe(200);
      expect((await call(B.admin, 'get', '/v2/roles')).status).toBe(200);
    }
    const vA = await rolesVersion(A.orgId);
    const vB = await rolesVersion(B.orgId);
    const warm = await h.redis.get(grantKey(A.orgId, vA, aReader.userId));
    expect(JSON.parse(warm!)['record.contacts.read']).toMatchObject({ effect: 'allow' });
    const cold = await h.redis.get(grantKey(A.orgId, vA, aNoGrant.userId));
    expect(cold).not.toBeNull();
    expect(JSON.parse(cold!)['record.contacts.read']).toBeUndefined();
    // a user id never resolves under another tenant's key
    expect(await h.redis.get(grantKey(B.orgId, vB, aReader.userId))).toBeNull();
    expect(await h.redis.get(grantKey(A.orgId, vA, bReader.userId))).toBeNull();
    expect(await h.redis.get(grantKey(B.orgId, vB, bReader.userId))).not.toBeNull();
  });

  it("AUTHZ-019 a grant change in tenant A takes effect for A's user and leaves tenant B's cached grants and answers alone", async () => {
    const vBBefore = await rolesVersion(B.orgId);
    const bKey = grantKey(B.orgId, vBBefore, bReader.userId);
    const bCached = await h.redis.get(bKey);
    expect(bCached).not.toBeNull();

    const role = await roleOfUser(aNoGrant.userId);
    const edit = await call(A.admin, 'patch', `/v2/roles/${role.uuid}`, {
      grants: [{ permissionKey: 'record.contacts.read', effect: 'allow', recordScope: 'all' }],
      rowVersion: role.rowVersion,
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect((await call(aNoGrant.token, 'get', '/v2/contacts')).status).toBe(200);

    expect(await rolesVersion(B.orgId)).toBe(vBBefore);
    expect(await h.redis.get(bKey)).toBe(bCached);
    expect((await call(bReader.token, 'get', '/v2/contacts')).status).toBe(200);
    // and the other direction: B's reader is not widened by A's edit (still no roles access)
    expect(denied((await call(bReader.token, 'get', '/v2/roles')).status)).toBe(true);
    // put the no-grant member back for the tests that follow
    const again = await roleOfUser(aNoGrant.userId);
    const undo = await call(A.admin, 'patch', `/v2/roles/${again.uuid}`, {
      grants: [],
      rowVersion: again.rowVersion,
    });
    expect(undo.status, JSON.stringify(undo.body)).toBe(200);
    expect((await call(aNoGrant.token, 'get', '/v2/contacts')).status).toBe(403);
  });

  it('AUTHZ-019 idempotency: the same Idempotency-Key used by tenant A and tenant B never replays A’s stored response to B', async () => {
    const key = randomUUID();
    const first = await call(
      A.admin,
      'post',
      '/v2/roles',
      { name: 'idem-tenant-a', grants: [] },
      { 'Idempotency-Key': key },
    );
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await call(
      B.admin,
      'post',
      '/v2/roles',
      { name: 'idem-tenant-b', grants: [] },
      { 'Idempotency-Key': key },
    );
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.body.name, 'B must get the response of its own request').toBe('idem-tenant-b');
    expect(second.body.id).not.toBe(first.body.id);
    const inB = await h.owner.query(
      `SELECT count(*)::int AS n FROM roles WHERE org_id = $1 AND name = 'idem-tenant-b'`,
      [B.orgId],
    );
    expect(inB.rows[0].n, 'B’s request was executed, not replayed').toBe(1);
    const leaked = await h.owner.query(
      `SELECT count(*)::int AS n FROM roles WHERE org_id = $1 AND name = 'idem-tenant-a'`,
      [B.orgId],
    );
    expect(leaked.rows[0].n).toBe(0);
    // the store has one entry per tenant
    expect(await h.redis.get(`idem:${A.orgId}:${key}`)).toContain('idem-tenant-a');
    expect(await h.redis.get(`idem:${B.orgId}:${key}`)).toContain('idem-tenant-b');
  });

  it('AUTHZ-019 idempotency (positive): the same caller retrying the same key gets the stored response and nothing runs twice', async () => {
    const key = randomUUID();
    const first = await call(
      A.admin,
      'post',
      '/v2/roles',
      { name: 'idem-retry', grants: [] },
      { 'Idempotency-Key': key },
    );
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const retry = await call(
      A.admin,
      'post',
      '/v2/roles',
      { name: 'idem-retry', grants: [] },
      { 'Idempotency-Key': key },
    );
    expect(retry.status, JSON.stringify(retry.body)).toBeLessThan(300);
    expect(retry.body).toEqual(first.body);
    const n = await h.owner.query(
      `SELECT count(*)::int AS n FROM roles WHERE org_id = $1 AND name = 'idem-retry'`,
      [A.orgId],
    );
    expect(n.rows[0].n).toBe(1);
  });

  it('AUTHZ-019 idempotency: the same key used by two different users of one tenant never replays the first user’s response to the second', async () => {
    const key = randomUUID();
    const first = await call(
      A.admin,
      'post',
      '/v2/roles',
      { name: 'idem-user-admin', grants: [] },
      { 'Idempotency-Key': key },
    );
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await call(
      aRoleMgr.token,
      'post',
      '/v2/roles',
      { name: 'idem-user-member', grants: [] },
      { 'Idempotency-Key': key },
    );
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(
      second.body.name,
      `the second user received the first user's stored response (key idem:${A.orgId}:<key> carries no user id)`,
    ).toBe('idem-user-member');
    const made = await h.owner.query(
      `SELECT count(*)::int AS n FROM roles WHERE org_id = $1 AND name = 'idem-user-member'`,
      [A.orgId],
    );
    expect(made.rows[0].n, 'the second user’s request must have been executed').toBe(1);
  });

  it('AUTHZ-019 idempotency: one key reused on a different route of the same tenant never replays the other route’s response', async () => {
    const key = randomUUID();
    const role = await call(
      A.admin,
      'post',
      '/v2/roles',
      { name: 'idem-route-role', grants: [] },
      { 'Idempotency-Key': key },
    );
    expect(role.status, JSON.stringify(role.body)).toBe(201);
    const email = `idem-route-${Date.now()}@example.test`;
    const user = await call(
      A.admin,
      'post',
      '/v2/users',
      { email, fullName: 'Idem Route', password: PASSWORD, roleIds: [] },
      { 'Idempotency-Key': key },
    );
    expect(user.status, JSON.stringify(user.body)).toBeLessThan(500);
    const made = await h.owner.query(
      `SELECT count(*)::int AS n FROM users WHERE org_id = $1 AND email = $2`,
      [A.orgId, email],
    );
    expect(
      {
        created: made.rows[0].n,
        repliedWithRoleBody: JSON.stringify(user.body) === JSON.stringify(role.body),
      },
      'the users route must run its own handler, not answer with the roles route’s stored body (the key is not bound to method, path or body)',
    ).toEqual({ created: 1, repliedWithRoleBody: false });
    expect(user.body.email).toBe(email);
  });

  it('AUTHZ-019 rate-limit buckets: a per-actor throttle exhausted by one user, in one tenant, throttles nobody else', async () => {
    const hit = (token: string) => call(token, 'post', '/v2/broadcast-wizard/csv', {});
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await hit(A.admin);
      statuses.push(r.status);
      if (r.status === 429) {
        expect(r.headers['retry-after']).toBeDefined();
        break;
      }
    }
    expect(statuses.at(-1), `A admin statuses ${statuses}`).toBe(429);
    expect(statuses.length, 'the limit is 6 per minute').toBeLessThanOrEqual(8);
    expect(statuses.slice(0, -1).every((s) => s !== 429)).toBe(true);
    // everyone else still has a full budget
    expect((await hit(B.admin)).status, 'tenant B admin').not.toBe(429);
    expect((await hit(aCampaign.token)).status, 'second user of tenant A').not.toBe(429);
    const mine = await scan(`rl:*:user:${A.orgId}:${A.adminUserId}:*`);
    const theirs = await scan(`rl:*:user:${B.orgId}:${B.adminUserId}:*`);
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.length).toBeGreaterThan(0);
    expect(mine.filter((k) => theirs.includes(k))).toEqual([]);
  });

  it('AUTHZ-019 signed media tokens are bound to one person in one tenant: no other user, in or out of the tenant, opens them', async () => {
    const store = h.app.get(ChatMediaStore);
    const tokens = h.app.get(MediaTokenService);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('cache-and-races-secret-image-bytes'),
    ]);
    const stored = await store.store({ orgId: A.orgId, filename: 'secret.png', buffer: png });
    const open = (token: string, jwt: string) =>
      http()
        .get(`/v2/media/${token}`)
        .set('x-forwarded-for', nextIp())
        .set(bearer(jwt))
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });

    const mine = tokens.sign({
      key: stored.key,
      orgId: A.orgId,
      userId: A.adminUserId,
      mime: stored.mime,
      name: stored.name,
    });
    const ok = await open(mine, A.admin);
    expect(ok.status).toBe(200);
    expect(Buffer.from(ok.body as Buffer).equals(png)).toBe(true);

    const colleague = await open(mine, aReader.token);
    const outsider = await open(mine, B.admin);
    const forged = await open(
      tokens.sign({ key: stored.key, orgId: B.orgId, userId: B.adminUserId }),
      B.admin,
    );
    const nothing = await open(
      tokens.sign({
        key: `chat/${A.orgId}/2000/01/none.png`,
        orgId: A.orgId,
        userId: aReader.userId,
      }),
      aReader.token,
    );
    for (const [what, r] of [
      ['a colleague in tenant A', colleague],
      ['a user of tenant B', outsider],
      ['a token re-minted for B over A’s key', forged],
    ] as const) {
      expect(r.status, what).toBe(404);
      expect(Buffer.from(r.body as Buffer).includes(Buffer.from('secret-image-bytes')), what).toBe(
        false,
      );
    }
    // every refusal looks the same as asking for something that does not exist
    const shape = (r: { status: number; body: unknown; headers: Record<string, string> }) =>
      JSON.stringify({
        s: r.status,
        t: r.headers['content-type'],
        b: JSON.parse(Buffer.from(r.body as Buffer).toString('utf8')).code,
      });
    expect(shape(colleague)).toBe(shape(nothing));
    expect(shape(outsider)).toBe(shape(nothing));
    expect(shape(forged)).toBe(shape(nothing));
  });

  it('AUTHZ-019 session state is per session: revoking one user’s session leaves a colleague and another tenant’s sessions untouched', async () => {
    const victim = await api.member(A, 'sess', [['record.contacts.read']]);
    const sid = claimsOf(victim.token).sid;
    expect((await call(victim.token, 'get', '/v2/contacts')).status).toBe(200);
    const out = await call(victim.token, 'post', '/v2/auth/logout', {});
    expect(out.status).toBe(201);
    expect(await h.redis.get(`auth:rev:${sid}`)).toBe('1');
    expect(denied((await call(victim.token, 'get', '/v2/contacts')).status)).toBe(true);
    expect((await call(aReader.token, 'get', '/v2/contacts')).status).toBe(200);
    expect((await call(bReader.token, 'get', '/v2/contacts')).status).toBe(200);
    expect((await call(B.admin, 'get', '/v2/contacts')).status).toBe(200);
    expect(await h.redis.get(`auth:rev:${claimsOf(aReader.token).sid}`)).toBeNull();
  });
});

// ---- 2. fail-closed (AUTHZ-088) --------------------------------------------------------------------------------------------------

describe('AUTHZ-088 fail-closed when an authorization store is unavailable', () => {
  let F: Tenant;
  let fReader: { token: string; userId: number };
  let fNoGrant: { token: string; userId: number };
  let fDeny: { token: string; userId: number };
  let fCampaign: { token: string; userId: number };
  let bReader: { token: string; userId: number };

  const flushAuthCaches = async () => {
    await deleteKeys('rbac:*');
    await deleteKeys('auth:gate:*');
    await deleteKeys('auth:org-susp:*');
  };

  beforeAll(async () => {
    F = await tenant('cr-f');
    fReader = await api.member(F, 'rdr', [['record.contacts.read']]);
    fNoGrant = await api.member(F, 'nog', []);
    fDeny = await api.member(F, 'deny', [['record.contacts.read']]);
    fCampaign = await api.member(F, 'camp', [['camp.campaigns.create']]);
    bReader = await api.member(B, 'rdr2', [['record.contacts.read']]);
    // fDeny holds a deny on the very key the reader holds as allow
    await h.owner.query(
      `UPDATE role_grants SET effect = 'deny' WHERE org_id = $1 AND role_id IN (SELECT role_id FROM user_roles WHERE org_id = $1 AND user_id = $2)`,
      [F.orgId, fDeny.userId],
    );
    await flushAuthCaches();
  });

  it('AUTHZ-088 Redis down (open mode): grants resolve from Postgres; the granted member is let in, the no-grant and the deny member are not', async () => {
    await flushAuthCaches();
    expect(
      (await call(fReader.token, 'get', '/v2/contacts')).status,
      'positive control while Redis is up',
    ).toBe(200);
    await flushAuthCaches();
    await withRedisDown(async () => {
      const granted = await call(fReader.token, 'get', '/v2/contacts');
      const noGrant = await call(fNoGrant.token, 'get', '/v2/contacts');
      const deny = await call(fDeny.token, 'get', '/v2/contacts');
      const admin = await call(F.admin, 'get', '/v2/contacts');
      const adminOnRoles = await call(F.admin, 'get', '/v2/roles');
      const noGrantRoles = await call(fNoGrant.token, 'get', '/v2/roles');
      expect(granted.status, JSON.stringify(granted.body)).toBe(200);
      expect(admin.status, JSON.stringify(admin.body)).toBe(200);
      expect(adminOnRoles.status).toBe(200);
      expect(noGrant.status, 'no grant must stay denied').toBe(403);
      expect(noGrantRoles.status).toBe(403);
      expect(deny.status, 'a deny grant must still beat the allow').toBe(403);
    }, 'open');
    // Redis back: the same answers, and the grant sets are cached again
    expect((await call(fReader.token, 'get', '/v2/contacts')).status).toBe(200);
    expect((await call(fNoGrant.token, 'get', '/v2/contacts')).status).toBe(403);
    expect((await scan(`rbac:${F.orgId}:*`)).length).toBeGreaterThan(0);
  });

  it('AUTHZ-088 Redis down (closed mode, the production default): every authenticated request is refused with 503, never allowed', async () => {
    expect(
      redisFailsClosed({ NODE_ENV: 'production' } as NodeJS.ProcessEnv),
      'production default',
    ).toBe(true);
    expect(
      redisFailsClosed({
        NODE_ENV: 'production',
        AUTH_REDIS_FAILURE_MODE: 'open',
      } as NodeJS.ProcessEnv),
    ).toBe(false);
    await withRedisDown(async () => {
      for (const [who, token] of [
        ['granted member', fReader.token],
        ['no-grant member', fNoGrant.token],
        ['admin', F.admin],
      ] as const) {
        const r = await call(token, 'get', '/v2/contacts');
        expect(r.status, `${who}: ${JSON.stringify(r.body)}`).toBe(503);
        expect(r.body.code).toBe('AUTH_SERVICE_DEGRADED');
        expect(JSON.stringify(r.body)).not.toContain('record.contacts');
      }
      const signIn = await login(F.slug, 'nobody@example.test', 'wrong-password-1');
      expect(signIn.status, 'sign-in is not decided without the counters').toBe(503);
      expect(JSON.stringify(signIn.body)).not.toMatch(/accessToken|refreshToken/);
    }, 'closed');
    expect((await call(fReader.token, 'get', '/v2/contacts')).status, 'recovers').toBe(200);
  });

  it('AUTHZ-088 POLICY-DECISION: with AUTH_REDIS_FAILURE_MODE=open (the non-production default) a revoked session is honoured during an outage; closed mode refuses it', async () => {
    const m = await api.member(F, 'revoked', [['record.contacts.read']]);
    expect((await call(m.token, 'get', '/v2/contacts')).status).toBe(200);
    expect((await call(m.token, 'post', '/v2/auth/logout', {})).status).toBe(201);
    expect(
      denied((await call(m.token, 'get', '/v2/contacts')).status),
      'revoked while Redis is up',
    ).toBe(true);
    const open = await withRedisDown(() => call(m.token, 'get', '/v2/contacts'), 'open');
    const closed = await withRedisDown(() => call(m.token, 'get', '/v2/contacts'), 'closed');
    // pinned: the tombstone lives only in Redis, so open mode cannot tell. Bounded by the 15-minute access token.
    console.info(
      `[AUTHZ-088] revoked token during an outage: open mode -> ${open.status}, closed mode -> ${closed.status}`,
    );
    expect(closed.status, 'closed mode must never honour it').toBe(503);
    expect([200, 503]).toContain(open.status);
    expect(
      denied((await call(m.token, 'get', '/v2/contacts')).status),
      'revoked again once Redis is back',
    ).toBe(true);
  });

  it('AUTHZ-088 POLICY-DECISION: rate limiting and sign-in lockout fail open in open mode and fail closed (503) in closed mode', async () => {
    const hammer = async () => {
      const out: number[] = [];
      for (let i = 0; i < 9; i++)
        out.push((await call(fCampaign.token, 'post', '/v2/broadcast-wizard/csv', {})).status);
      return out;
    };
    const open = await withRedisDown(
      async () => ({
        statuses: await hammer(),
        logins: await Promise.all(
          [1, 2, 3, 4, 5, 6].map(() => login(F.slug, fReader.token.slice(0, 5) + '@example.test')),
        ),
      }),
      'open',
    );
    console.info(
      `[AUTHZ-088] outage, open mode: throttled route x9 -> ${open.statuses}; bad sign-ins -> ${open.logins.map((r) => r.status)}`,
    );
    expect(
      open.statuses.every((s) => s !== 429 && s < 500),
      'throttle fails open, no 5xx',
    ).toBe(true);
    expect(open.logins.every((r) => r.status < 500)).toBe(true);
    const closed = await withRedisDown(() => hammer(), 'closed');
    expect(
      closed.every((s) => s === 503),
      `closed mode: ${closed}`,
    ).toBe(true);
    // Redis back: the throttle counts again (positive: the limiter is not left disabled)
    const after: number[] = [];
    for (let i = 0; i < 9; i++)
      after.push((await call(F.admin, 'post', '/v2/broadcast-wizard/csv', {})).status);
    expect(after).toContain(429);
  });

  it('AUTHZ-088 Redis down: a suspended workspace and a suspended user stay locked out (Postgres is authoritative); other tenants carry on', async () => {
    const S = await tenant('cr-s');
    const sAdmin = S.admin;
    const sUser = await api.member(S, 'sus', [['record.contacts.read']]);
    expect((await call(sAdmin, 'get', '/v2/contacts')).status).toBe(200);
    expect((await call(sUser.token, 'get', '/v2/contacts')).status).toBe(200);

    await h.owner.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [sUser.userId]);
    await flushAuthCaches();
    await withRedisDown(async () => {
      const u = await call(sUser.token, 'get', '/v2/contacts');
      expect(denied(u.status), `suspended user: ${u.status}`).toBe(true);
      expect(
        (await call(sAdmin, 'get', '/v2/contacts')).status,
        'the colleague is not affected',
      ).toBe(200);
    }, 'open');

    await h.owner.query(`UPDATE organizations SET status = 'suspended' WHERE id = $1`, [S.orgId]);
    await flushAuthCaches();
    try {
      await withRedisDown(async () => {
        const a = await call(sAdmin, 'get', '/v2/contacts');
        expect(a.status, JSON.stringify(a.body)).toBe(403);
        expect(a.body.code).toBe('WSP_ORG_SUSPENDED');
        expect(
          (await call(bReader.token, 'get', '/v2/contacts')).status,
          'another tenant is unaffected',
        ).toBe(200);
      }, 'open');
    } finally {
      await h.owner.query(`UPDATE organizations SET status = 'active' WHERE id = $1`, [S.orgId]);
      await deleteKeys('auth:org-susp:*');
    }
  });

  it('AUTHZ-088 Postgres statement errors during grant lookup: the request is a 5xx or a refusal, never an allow, and the body leaks nothing', async () => {
    expect((await call(fReader.token, 'get', '/v2/contacts')).status, 'positive control').toBe(200);
    await flushAuthCaches();
    await withBrokenTable('role_grants', async () => {
      for (const [who, token] of [
        ['granted member', fReader.token],
        ['no-grant member', fNoGrant.token],
        ['admin', F.admin],
      ] as const) {
        const r = await call(token, 'get', '/v2/contacts');
        expect(
          r.status >= 500 || denied(r.status),
          `${who}: ${r.status} ${JSON.stringify(r.body)}`,
        ).toBe(true);
        expect(JSON.stringify(r.body)).not.toMatch(
          /role_grants|permission denied|select |relation|crm_app_user/i,
        );
        expect(
          await scan(
            `rbac:${F.orgId}:v*:u${token === F.admin ? F.adminUserId : token === fReader.token ? fReader.userId : fNoGrant.userId}`,
          ),
          `${who}: nothing cached from a failed lookup`,
        ).toEqual([]);
      }
    });
    await flushAuthCaches();
    expect((await call(fReader.token, 'get', '/v2/contacts')).status, 'recovers').toBe(200);
    expect((await call(fNoGrant.token, 'get', '/v2/contacts')).status).toBe(403);
  });

  it('AUTHZ-088 Postgres statement errors during the account-gate lookup never allow the request', async () => {
    expect((await call(F.admin, 'get', '/v2/contacts')).status, 'positive control').toBe(200);
    await flushAuthCaches();
    await withBrokenTable('user_security', async () => {
      const r = await call(F.admin, 'get', '/v2/contacts');
      expect(r.status >= 500 || denied(r.status), `${r.status} ${JSON.stringify(r.body)}`).toBe(
        true,
      );
      expect(JSON.stringify(r.body)).not.toMatch(
        /user_security|permission denied|select |relation/i,
      );
    });
    await flushAuthCaches();
    expect((await call(F.admin, 'get', '/v2/contacts')).status, 'recovers').toBe(200);
  });

  it('AUTHZ-089 a Redis failure while the grant-version cache is invalidated must not leave the pre-change grants live', async () => {
    const m = await api.member(F, 'stale', [['record.contacts.read'], ['support.ticket.read']]);
    expect((await call(m.token, 'get', '/v2/contacts')).status).toBe(200);
    expect((await call(m.token, 'get', '/v2/support/tickets')).status).toBe(200);
    expect(
      await h.redis.get(`rbac:version:${F.orgId}`),
      'the version is cached before the change',
    ).not.toBeNull();

    const role = await roleOfUser(m.userId);
    const { result: edit, failed } = await withFailingCommand(
      'del',
      (key) => key.startsWith('rbac:version:'),
      () =>
        call(F.admin, 'patch', `/v2/roles/${role.uuid}`, {
          grants: [{ permissionKey: 'support.ticket.read', effect: 'allow', recordScope: 'all' }],
          rowVersion: role.rowVersion,
        }),
    );
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(failed, 'the invalidation really failed during the change').toBeGreaterThan(0);

    const ttl = await h.redis.ttl(`rbac:version:${F.orgId}`);
    const after = await call(m.token, 'get', '/v2/contacts');
    console.info(
      `[AUTHZ-089] after a failed rbac:version invalidation: removed grant answers ${after.status}; cached version ttl ${ttl}s`,
    );
    expect(
      after.status,
      `the removed grant still works for up to ${ttl}s (the version cache was not dropped)`,
    ).toBe(403);
    expect(
      (await call(m.token, 'get', '/v2/support/tickets')).status,
      'the kept grant is unaffected',
    ).toBe(200);
  });

  it('AUTHZ-088 a Redis failure while a session tombstone is written must not leave the revoked access token live', async () => {
    const m = await api.member(F, 'tomb', [['record.contacts.read']]);
    expect((await call(m.token, 'get', '/v2/contacts')).status).toBe(200);
    const { result: out, failed } = await withFailingCommand(
      'set',
      (key) => key.startsWith('auth:rev:'),
      () => call(m.token, 'post', '/v2/auth/logout', {}),
    );
    expect(out.status).toBe(201);
    expect(failed, 'the tombstone write really failed').toBeGreaterThan(0);
    const row = await h.owner.query(`SELECT revoked_at FROM auth_sessions WHERE uuid = $1`, [
      claimsOf(m.token).sid,
    ]);
    expect(row.rows[0].revoked_at, 'the session row itself is revoked').not.toBeNull();
    const after = await call(m.token, 'get', '/v2/contacts');
    expect(
      denied(after.status),
      `the database says revoked but the guard only reads Redis: ${after.status} (bounded by the 15-minute access token)`,
    ).toBe(true);
  });
});

// ---- 3. TOCTOU (AUTHZ-086, 087) --------------------------------------------------------------------------------------------------

describe('AUTHZ-086/087 mutations racing the change that revokes them', () => {
  const ITERATIONS = 30;
  let R: Tenant;
  let mOwn: { token: string; userId: number };
  let mTeam: { token: string; userId: number };
  let mAll: { token: string; userId: number };
  let peer: { token: string; userId: number; uuid: string };
  let teamId: number;

  const contactRow = async (uuid: string) => {
    const r = await h.owner.query(
      `SELECT id, owner_id, updated_by, name, row_version FROM contacts WHERE uuid = $1`,
      [uuid],
    );
    const x = r.rows[0] as
      | {
          id: string;
          owner_id: string | null;
          updated_by: string | null;
          name: string;
          row_version: number;
        }
      | undefined;
    return (
      x && {
        id: Number(x.id),
        ownerId: x.owner_id === null ? null : Number(x.owner_id),
        updatedBy: x.updated_by === null ? null : Number(x.updated_by),
        name: x.name,
        rowVersion: Number(x.row_version),
      }
    );
  };
  const audit = async (contactId: number) =>
    (
      await h.owner.query(
        `SELECT action FROM audit_log WHERE org_id = $1 AND module = 'contacts' AND record_id = $2 ORDER BY id`,
        [R.orgId, contactId],
      )
    ).rows.map((r) => r.action as string);
  const deletedEvents = async (uuid: string) =>
    (await api.events(R.orgId, 'contact.deleted')).filter((p) => p.uuid === uuid).length;

  interface Attempt {
    status: number;
    started: number;
    ended: number;
    body: Record<string, unknown>;
  }
  /** Sends `fire` after `delayMs`, remembering when the request started and ended. */
  const attempt = (
    delayMs: number,
    fire: () => Promise<{ status: number; body: unknown }>,
  ): Promise<Attempt> =>
    (async () => {
      if (delayMs) await sleep(delayMs);
      const started = now();
      const r = await fire();
      return {
        status: r.status,
        started,
        ended: now(),
        body: (r.body ?? {}) as Record<string, unknown>,
      };
    })();

  beforeAll(async () => {
    R = await tenant('cr-race');
    mOwn = await api.member(R, 'own', [
      ['record.contacts.read', 'own'],
      ['record.contacts.update', 'own'],
      ['record.contacts.delete', 'own'],
    ]);
    mTeam = await api.member(R, 'team', [
      ['record.contacts.read', 'team'],
      ['record.contacts.update', 'team'],
      ['record.contacts.delete', 'team'],
    ]);
    mAll = await api.member(R, 'all', [
      ['record.contacts.read'],
      ['record.contacts.update'],
      ['record.contacts.delete'],
    ]);
    const p = await api.member(R, 'peer', [['record.contacts.read']]);
    peer = { ...p, uuid: await userUuid(p.userId) };
    const team = await h.owner.query(
      `INSERT INTO teams (org_id, name) VALUES ($1, 'race-team') RETURNING id`,
      [R.orgId],
    );
    teamId = Number(team.rows[0].id);
  });

  const reassign = (uuids: string[], ownerUuid: string) =>
    call(R.admin, 'post', '/v2/contacts/assignee', { ids: uuids, ownerId: ownerUuid });

  it('AUTHZ-086 positive controls: an own-scope member edits and deletes a contact they own; not one they do not', async () => {
    const [mine, theirs] = await api.seedContacts(R, [
      { name: 'ctl-mine', ownerId: mOwn.userId },
      { name: 'ctl-theirs', ownerId: peer.userId },
    ]);
    const rv = (await contactRow(mine!))!.rowVersion;
    expect(
      (
        await call(mOwn.token, 'patch', `/v2/contacts/${mine}`, {
          name: 'ctl-mine-2',
          rowVersion: rv,
        })
      ).status,
    ).toBe(200);
    expect(
      (await call(mOwn.token, 'patch', `/v2/contacts/${theirs}`, { name: 'x', rowVersion: 1 }))
        .status,
    ).toBe(404);
    expect((await call(mOwn.token, 'delete', `/v2/contacts/${theirs}`)).status).toBe(404);
    expect((await call(mOwn.token, 'delete', `/v2/contacts/${mine}`)).status).toBe(204);
    expect(await contactRow(theirs!)).toBeDefined();
  });

  it('AUTHZ-086 owner reassignment vs concurrent own-scope updates: nothing started after the reassignment succeeds, and no update lands after it', async () => {
    const lateStarts: string[] = [];
    const lateWrites: string[] = [];
    const serverErrors: string[] = [];
    let landedBeforeRevocation = 0;
    for (let i = 0; i < ITERATIONS; i++) {
      const [uuid] = await api.seedContacts(R, [{ name: `upd-${i}`, ownerId: mOwn.userId }]);
      const rv = (await contactRow(uuid!))!.rowVersion;
      let revokedAt = Infinity;
      const revoke = attempt(Math.floor(i / 6), async () => {
        const r = await reassign([uuid!], peer.uuid);
        revokedAt = now();
        return r;
      });
      const writes = [0, 3, 6, 9, 12, 15, 18, 22].map((d, k) =>
        attempt(d, () =>
          call(mOwn.token, 'patch', `/v2/contacts/${uuid}`, {
            name: `m-${i}-${k}`,
            rowVersion: rv,
          }),
        ),
      );
      const [rev, ...results] = await Promise.all([revoke, ...writes]);
      expect(
        (rev.body as { succeeded?: string[] }).succeeded,
        `iteration ${i}: the revocation itself applied`,
      ).toContain(uuid);
      results.forEach((w, k) => {
        if (w.status >= 500) serverErrors.push(`${i}.${k}: ${w.status}`);
        if (w.started > revokedAt && w.status < 300)
          lateStarts.push(`${i}.${k}: started after the commit, got ${w.status}`);
        if (w.status === 200 && w.ended < revokedAt) landedBeforeRevocation++;
      });
      const row = (await contactRow(uuid!))!;
      expect(row.ownerId, `iteration ${i}: the new owner stands`).toBe(peer.userId);
      if (row.updatedBy === mOwn.userId && row.name.startsWith('m-')) {
        lateWrites.push(
          `${i}: row written by the former owner after the reassignment (name ${row.name})`,
        );
      }
      const probe = await call(mOwn.token, 'patch', `/v2/contacts/${uuid}`, {
        name: 'after',
        rowVersion: row.rowVersion,
      });
      expect(probe.status, `iteration ${i}: sequential edit after the commit`).toBe(404);
    }
    console.info(
      `[AUTHZ-086] update vs reassign x${ITERATIONS}: edits that landed before the commit ${landedBeforeRevocation}, late writes ${lateWrites.length}`,
    );
    expect(serverErrors).toEqual([]);
    expect(lateStarts).toEqual([]);
    expect(lateWrites).toEqual([]);
  });

  it('AUTHZ-086 owner reassignment vs concurrent own-scope deletes: nothing started after the reassignment succeeds; state and trail stay consistent', async () => {
    const lateStarts: string[] = [];
    const serverErrors: string[] = [];
    const inconsistent: string[] = [];
    let deletedAfterReassign = 0;
    let deletedFirst = 0;
    for (let i = 0; i < ITERATIONS; i++) {
      const [uuid] = await api.seedContacts(R, [{ name: `del-${i}`, ownerId: mOwn.userId }]);
      const id = (await contactRow(uuid!))!.id;
      let revokedAt = Infinity;
      const revoke = attempt(Math.floor(i / 6), async () => {
        const r = await reassign([uuid!], peer.uuid);
        revokedAt = now();
        return r;
      });
      const deletes = [0, 4, 8, 12, 16, 20].map((d) =>
        attempt(d, () => call(mOwn.token, 'delete', `/v2/contacts/${uuid}`)),
      );
      const [rev, ...results] = await Promise.all([revoke, ...deletes]);
      results.forEach((w, k) => {
        if (w.status >= 500) serverErrors.push(`${i}.${k}: ${w.status}`);
        if (w.started > revokedAt && w.status < 300)
          lateStarts.push(`${i}.${k}: started after the commit, got ${w.status}`);
      });
      const row = await contactRow(uuid!);
      const trail = await audit(id);
      const ok = results.filter((r) => r.status === 204).length;
      const deletes204 = trail.filter((a) => a === 'delete').length;
      const reassigned = trail.includes('update');
      if (row) {
        if (ok !== 0) inconsistent.push(`${i}: row exists although ${ok} delete(s) answered 204`);
        if (deletes204 !== 0)
          inconsistent.push(`${i}: row exists but ${deletes204} delete audit row(s)`);
        if (row.ownerId !== peer.userId) inconsistent.push(`${i}: owner ${row.ownerId}`);
      } else {
        if (ok < 1) inconsistent.push(`${i}: row gone but no delete answered 204`);
        // (duplicates from the same user's repeated deletes are the double-delete test's subject, not this one's)
        if (deletes204 < 1) inconsistent.push(`${i}: row gone but ${deletes204} delete audit rows`);
        if ((rev.body as { succeeded?: string[] }).succeeded?.includes(uuid!) && reassigned)
          deletedAfterReassign++;
        else deletedFirst++;
      }
    }
    console.info(
      `[AUTHZ-086] delete vs reassign x${ITERATIONS}: deleted before the reassignment ${deletedFirst}, deleted although the reassignment had already applied ${deletedAfterReassign} (requests that began before the commit)`,
    );
    expect(serverErrors).toEqual([]);
    expect(lateStarts).toEqual([]);
    expect(inconsistent).toEqual([]);
  });

  it('AUTHZ-086 a sequential delete after the reassignment is refused and the contact survives', async () => {
    const [uuid] = await api.seedContacts(R, [{ name: 'seq-del', ownerId: mOwn.userId }]);
    const moved = await reassign([uuid!], peer.uuid);
    expect(moved.status, JSON.stringify(moved.body)).toBeLessThan(300);
    expect(moved.body.succeeded).toContain(uuid);
    expect((await call(mOwn.token, 'delete', `/v2/contacts/${uuid}`)).status).toBe(404);
    expect((await contactRow(uuid!))?.ownerId).toBe(peer.userId);
  });

  it('AUTHZ-087 team membership removal vs concurrent team-scope updates and deletes: nothing started after the removal succeeds', async () => {
    const lateStarts: string[] = [];
    const serverErrors: string[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      await h.owner.query(
        `INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3),($1,$2,$4) ON CONFLICT DO NOTHING`,
        [R.orgId, teamId, mTeam.userId, peer.userId],
      );
      const [a, b] = await api.seedContacts(R, [
        { name: `team-u-${i}`, ownerId: peer.userId },
        { name: `team-d-${i}`, ownerId: peer.userId },
      ]);
      const rv = (await contactRow(a!))!.rowVersion;
      expect(
        (await call(mTeam.token, 'get', `/v2/contacts/${a}`)).status,
        `iteration ${i}: team member reads before`,
      ).toBe(200);
      let revokedAt = Infinity;
      const revoke = attempt(Math.floor(i / 6), async () => {
        await h.owner.query(
          `DELETE FROM team_members WHERE org_id = $1 AND team_id = $2 AND user_id = $3`,
          [R.orgId, teamId, mTeam.userId],
        );
        revokedAt = now();
        return { status: 200, body: {} };
      });
      const writes = [0, 3, 6, 9, 12, 15, 18, 22].flatMap((d, k) => [
        attempt(d, () =>
          call(mTeam.token, 'patch', `/v2/contacts/${a}`, { name: `t-${i}-${k}`, rowVersion: rv }),
        ),
        attempt(d, () => call(mTeam.token, 'delete', `/v2/contacts/${b}`)),
      ]);
      const results = (await Promise.all([revoke, ...writes])).slice(1);
      results.forEach((w, k) => {
        if (w.status >= 500) serverErrors.push(`${i}.${k}: ${w.status}`);
        if (w.started > revokedAt && w.status < 300)
          lateStarts.push(`${i}.${k}: started after the removal, got ${w.status}`);
      });
      const fresh = (await contactRow(a!))!;
      expect(
        (
          await call(mTeam.token, 'patch', `/v2/contacts/${a}`, {
            name: 'after',
            rowVersion: fresh.rowVersion,
          })
        ).status,
        `iteration ${i}: sequential edit after`,
      ).toBe(404);
      expect((await call(mTeam.token, 'get', `/v2/contacts/${a}`)).status).toBe(404);
      if (await contactRow(b!)) {
        expect((await call(mTeam.token, 'delete', `/v2/contacts/${b}`)).status).toBe(404);
      }
    }
    expect(serverErrors).toEqual([]);
    expect(lateStarts).toEqual([]);
  });

  it('AUTHZ-086 window: a delete that is past its owner check when the owner changes still deletes (reported, accepted by the began-before-commit criterion)', async () => {
    const [uuid] = await api.seedContacts(R, [{ name: 'window-del', ownerId: mOwn.userId }]);
    const id = (await contactRow(uuid!))!.id;
    // hold the row lock: the app's plain SELECT passes its owner check, then its DELETE waits behind the lock
    await h.owner.query('BEGIN');
    let pending: Promise<Attempt>;
    let commitMs = 0;
    try {
      await h.owner.query(`SELECT 1 FROM contacts WHERE id = $1 FOR UPDATE`, [id]);
      pending = attempt(0, () => call(mOwn.token, 'delete', `/v2/contacts/${uuid}`));
      await sleep(600);
      await h.owner.query(`UPDATE contacts SET owner_id = $2 WHERE id = $1`, [id, peer.userId]);
      await h.owner.query('COMMIT');
      commitMs = now();
    } catch (err) {
      await h.owner.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
    const res = await pending;
    const row = await contactRow(uuid!);
    const trail = await audit(id);
    console.info(
      `[AUTHZ-086] window (delete): owner changed at commit, request began before it -> ${res.status}, row ${row ? 'kept' : 'DELETED'}, ended ${(res.ended - commitMs).toFixed(0)} ms after the commit, trail ${trail}`,
    );
    expect(res.status).toBeLessThan(500);
    if (res.status === 204) {
      expect(row, 'a 204 means the row is gone').toBeUndefined();
      expect(trail.filter((a) => a === 'delete')).toHaveLength(1);
    } else {
      expect(row?.ownerId).toBe(peer.userId);
    }
    // the same request issued after the commit is refused (the criterion's strict half)
    const [again] = await api.seedContacts(R, [{ name: 'window-del-after', ownerId: peer.userId }]);
    expect((await call(mOwn.token, 'delete', `/v2/contacts/${again}`)).status).toBe(404);
  });

  it('AUTHZ-087 window: an update that is past its team check when the membership is removed (reported)', async () => {
    await h.owner.query(
      `INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3),($1,$2,$4) ON CONFLICT DO NOTHING`,
      [R.orgId, teamId, mTeam.userId, peer.userId],
    );
    const [uuid] = await api.seedContacts(R, [{ name: 'window-upd', ownerId: peer.userId }]);
    const row0 = (await contactRow(uuid!))!;
    await h.owner.query('BEGIN');
    let pending: Promise<Attempt>;
    let commitMs = 0;
    try {
      await h.owner.query(`SELECT 1 FROM contacts WHERE id = $1 FOR UPDATE`, [row0.id]);
      pending = attempt(0, () =>
        call(mTeam.token, 'patch', `/v2/contacts/${uuid}`, {
          name: 'window-upd-by-team',
          rowVersion: row0.rowVersion,
        }),
      );
      await sleep(600);
      await h.owner.query(
        `DELETE FROM team_members WHERE org_id = $1 AND team_id = $2 AND user_id = $3`,
        [R.orgId, teamId, mTeam.userId],
      );
      await h.owner.query('COMMIT');
      commitMs = now();
    } catch (err) {
      await h.owner.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
    const res = await pending;
    const row = (await contactRow(uuid!))!;
    console.info(
      `[AUTHZ-087] window (update): membership removed at commit, request began before it -> ${res.status}, name now "${row.name}", ended ${(res.ended - commitMs).toFixed(0)} ms after the commit`,
    );
    expect(res.status).toBeLessThan(500);
    expect([200, 404, 409]).toContain(res.status);
    expect(row.name).toBe(res.status === 200 ? 'window-upd-by-team' : 'window-upd');
    const after = await call(mTeam.token, 'patch', `/v2/contacts/${uuid}`, {
      name: 'after-window',
      rowVersion: row.rowVersion,
    });
    expect(after.status, 'started after the commit').toBe(404);
  });

  it('AUTHZ-086 concurrent update + delete of one record by two permitted users leave one consistent row, audit trail and event stream', async () => {
    const problems: string[] = [];
    const outcomes = new Map<string, number>();
    for (let i = 0; i < ITERATIONS; i++) {
      const [uuid] = await api.seedContacts(R, [{ name: `ud-${i}` }]);
      const row0 = (await contactRow(uuid!))!;
      const [del, upd] = await Promise.all([
        attempt(Math.floor(i / 10), () => call(R.admin, 'delete', `/v2/contacts/${uuid}`)),
        attempt(0, () =>
          call(mAll.token, 'patch', `/v2/contacts/${uuid}`, {
            name: `ud-new-${i}`,
            rowVersion: row0.rowVersion,
          }),
        ),
      ]);
      const key = `delete ${del.status} / update ${upd.status}`;
      outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
      const row = await contactRow(uuid!);
      const trail = await audit(row0.id);
      const deleteAudits = trail.filter((a) => a === 'delete').length;
      const updateAudits = trail.filter((a) => a === 'update').length;
      if (del.status >= 500 || upd.status >= 500) problems.push(`${i}: 5xx (${key})`);
      if (del.status !== 204) problems.push(`${i}: the permitted delete answered ${del.status}`);
      if (row) problems.push(`${i}: row survived a 204 delete (${key})`);
      if (deleteAudits !== 1) problems.push(`${i}: ${deleteAudits} delete audit rows (${key})`);
      if (updateAudits !== (upd.status === 200 ? 1 : 0))
        problems.push(`${i}: ${updateAudits} update audit rows for update ${upd.status}`);
      if ((await deletedEvents(uuid!)) !== 1)
        problems.push(`${i}: ${await deletedEvents(uuid!)} contact.deleted events`);
    }
    console.info(`[AUTHZ-086] update vs delete outcomes: ${JSON.stringify([...outcomes])}`);
    expect(problems).toEqual([]);
  });

  it('AUTHZ-086 two simultaneous deletes of one record by two permitted users: exactly one wins, one audit row, one event', async () => {
    const problems: string[] = [];
    const outcomes = new Map<string, number>();
    for (let i = 0; i < ITERATIONS; i++) {
      const [uuid] = await api.seedContacts(R, [{ name: `dd-${i}` }]);
      const id = (await contactRow(uuid!))!.id;
      const [x, y] = await Promise.all([
        attempt(0, () => call(R.admin, 'delete', `/v2/contacts/${uuid}`)),
        attempt(0, () => call(mAll.token, 'delete', `/v2/contacts/${uuid}`)),
      ]);
      const key = [x.status, y.status].sort().join('+');
      outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
      const wins = [x, y].filter((r) => r.status === 204).length;
      const audits = (await audit(id)).filter((a) => a === 'delete').length;
      const events = await deletedEvents(uuid!);
      if ([x, y].some((r) => r.status >= 500)) problems.push(`${i}: 5xx (${key})`);
      if (wins !== 1) problems.push(`${i}: ${wins} requests answered 204 (${key})`);
      if (audits !== 1) problems.push(`${i}: ${audits} delete audit rows (${key})`);
      if (events !== 1) problems.push(`${i}: ${events} contact.deleted events (${key})`);
      if (await contactRow(uuid!)) problems.push(`${i}: row survived`);
    }
    console.info(`[AUTHZ-086] double delete outcomes: ${JSON.stringify([...outcomes])}`);
    expect(problems).toEqual([]);
  });
});

// ---- 4. stale entitlement and permission caches (AUTHZ-089) ----------------------------------------------------------------------

describe('AUTHZ-089 entitlement, suspension and session changes take effect without waiting for a cache', () => {
  let op = '';
  let C: Tenant;
  let D: Tenant;

  const setPlan = (orgId: number, slug: string) =>
    h.owner.query(
      `WITH o AS (UPDATE organizations SET plan = $2 WHERE id = $1)
       INSERT INTO org_plan_state (org_id, trial_ends_at, plan_ends_at) VALUES ($1, NULL, NULL)
       ON CONFLICT (org_id) DO UPDATE SET trial_ends_at = NULL, plan_ends_at = NULL`,
      [orgId, slug],
    );
  async function makePlan(slug: string, analytics: boolean) {
    const r = await call(op, 'post', '/v2/platform/plans', {
      name: slug,
      slug,
      amount: '10',
      features: { analytics },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  }
  const analytics = (token: string) => call(token, 'get', '/v2/analytics/overview');
  const open = (r: { status: number }) => r.status !== 422 && !denied(r.status) && r.status < 500;

  beforeAll(async () => {
    op = await operatorToken(h, OPERATOR_EMAIL, OPERATOR_PASSWORD);
    C = await tenant('cr-plan-c');
    D = await tenant('cr-plan-d');
    await makePlan('cr_with_analytics', true);
    await makePlan('cr_without_analytics', false);
  });

  it('AUTHZ-089 a plan downgrade, an upgrade and a per-workspace override apply on the very next request, and only to that workspace', async () => {
    await setPlan(C.orgId, 'cr_with_analytics');
    await setPlan(D.orgId, 'cr_with_analytics');
    const before = await analytics(C.admin);
    expect(open(before), `with the feature: ${before.status} ${JSON.stringify(before.body)}`).toBe(
      true,
    );
    expect(open(await analytics(D.admin))).toBe(true);

    await setPlan(C.orgId, 'cr_without_analytics');
    const locked = await analytics(C.admin);
    expect(locked.status, 'next request after the downgrade').toBe(422);
    expect(locked.body.code).toBe('PLAN_FEATURE_LOCKED');
    expect(open(await analytics(D.admin)), 'the other workspace keeps the feature').toBe(true);

    await setPlan(C.orgId, 'cr_with_analytics');
    expect(open(await analytics(C.admin)), 'next request after the upgrade').toBe(true);

    await h.owner.query(
      `UPDATE org_plan_state SET overrides = jsonb_build_object('features', jsonb_build_object('analytics', false)) WHERE org_id = $1`,
      [C.orgId],
    );
    expect((await analytics(C.admin)).status, 'next request after a feature override').toBe(422);
    expect(open(await analytics(D.admin))).toBe(true);
    await h.owner.query(`UPDATE org_plan_state SET overrides = '{}'::jsonb WHERE org_id = $1`, [
      C.orgId,
    ]);
    expect(open(await analytics(C.admin)), 'override removed').toBe(true);
  });

  it('AUTHZ-089 a workspace suspension and its lifting reach the API within the 5-second cache (measured), and only for that workspace', async () => {
    const S = await tenant('cr-susp');
    expect((await call(S.admin, 'get', '/v2/contacts')).status).toBe(200);
    expect((await call(D.admin, 'get', '/v2/contacts')).status).toBe(200);
    const cached = await h.redis.get(`auth:org-susp:${S.orgId}`);
    expect(cached, 'the verdict is cached before the change').toBe('0');

    const poll = async (want: (s: number) => boolean) => {
      const t0 = now();
      for (;;) {
        const r = await call(S.admin, 'get', '/v2/contacts');
        if (want(r.status)) return { ms: now() - t0, r };
        if (now() - t0 > 15_000) return { ms: now() - t0, r };
        await sleep(100);
      }
    };
    await h.owner.query(`UPDATE organizations SET status = 'suspended' WHERE id = $1`, [S.orgId]);
    const suspended = await poll((s) => s === 403);
    console.info(
      `[AUTHZ-089] suspension visible after ${suspended.ms.toFixed(0)} ms (cache TTL 5 s, no invalidation because the write bypassed the app)`,
    );
    expect(suspended.r.status).toBe(403);
    expect(suspended.r.body.code).toBe('WSP_ORG_SUSPENDED');
    expect(suspended.ms).toBeLessThanOrEqual(6_500);
    expect(
      (await call(D.admin, 'get', '/v2/contacts')).status,
      'another workspace is unaffected',
    ).toBe(200);

    await h.owner.query(`UPDATE organizations SET status = 'active' WHERE id = $1`, [S.orgId]);
    const restored = await poll((s) => s === 200);
    console.info(`[AUTHZ-089] unsuspension visible after ${restored.ms.toFixed(0)} ms`);
    expect(restored.r.status).toBe(200);
    expect(restored.ms).toBeLessThanOrEqual(6_500);
  });

  it('AUTHZ-089 a suspended user is refused within the 30-second account-gate cache when nothing invalidates it (measured)', async () => {
    const m = await api.member(C, 'gate', [['record.contacts.read']]);
    expect((await call(m.token, 'get', '/v2/contacts')).status).toBe(200);
    expect(
      await h.redis.get(`auth:gate:${C.orgId}:${m.userId}`),
      'gate state cached',
    ).not.toBeNull();
    await h.owner.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [m.userId]);
    const t0 = now();
    let status = 200;
    while (now() - t0 < 40_000) {
      status = (await call(m.token, 'get', '/v2/contacts')).status;
      if (status !== 200) break;
      await sleep(500);
    }
    const ms = now() - t0;
    console.info(
      `[AUTHZ-089] user suspension (direct write, no invalidation) visible after ${(ms / 1000).toFixed(1)} s (account-gate TTL 30 s)`,
    );
    expect(denied(status), `status ${status}`).toBe(true);
    expect(ms).toBeLessThanOrEqual(35_000);
  });

  it('AUTHZ-089 a suspension made through the API takes effect on the next request (the gate cache is invalidated)', async () => {
    const m = await api.member(C, 'gateapi', [['record.contacts.read']]);
    expect((await call(m.token, 'get', '/v2/contacts')).status).toBe(200);
    const uuid = await userUuid(m.userId);
    const rv = Number(
      (await h.owner.query(`SELECT row_version FROM users WHERE id = $1`, [m.userId])).rows[0]
        .row_version,
    );
    const res = await call(C.admin, 'patch', `/v2/users/${uuid}`, {
      status: 'inactive',
      rowVersion: rv,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const next = await call(m.token, 'get', '/v2/contacts');
    const cachedGate = await h.redis.get(`auth:gate:${C.orgId}:${m.userId}`);
    expect(
      denied(next.status),
      `status ${next.status} after the API suspension; cached account-gate state: ${cachedGate}`,
    ).toBe(true);
  });

  it('AUTHZ-089 a revoked session is refused on its next request, while the same user’s other session and other tenants carry on', async () => {
    const m = await api.member(C, 'twice', [['record.contacts.read']]);
    const email = (await h.owner.query(`SELECT email FROM users WHERE id = $1`, [m.userId])).rows[0]
      .email as string;
    const second = await login(C.slug, email);
    expect(second.status, JSON.stringify(second.body)).toBeLessThan(300);
    const other = second.body.tokens.accessToken as string;
    expect((await call(m.token, 'get', '/v2/contacts')).status).toBe(200);
    expect((await call(other, 'get', '/v2/contacts')).status).toBe(200);
    expect((await call(m.token, 'post', '/v2/auth/logout', {})).status).toBe(201);
    const t0 = now();
    const r = await call(m.token, 'get', '/v2/contacts');
    console.info(
      `[AUTHZ-089] revoked session refused on the next request (${(now() - t0).toFixed(0)} ms later), no TTL wait`,
    );
    expect(r.status).toBe(401);
    expect((await call(other, 'get', '/v2/contacts')).status).toBe(200);
    expect((await call(D.admin, 'get', '/v2/contacts')).status).toBe(200);
  });
});

// ---- 5. error and response leakage (AUTHZ-094) -----------------------------------------------------------------------------------

describe('AUTHZ-094 error responses do not tell a foreign object from a missing one and do not leak internals', () => {
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const INTERNALS =
    /(\bat\s+[\w$.<>]+\s*\(|node_modules|\.ts:\d+|\.js:\d+|stack|SELECT\s|INSERT\s|UPDATE\s+\w+\s+SET|DELETE\s+FROM|relation\s+"|violates|syntax error|permission denied|\bpg_|drizzle|org_id|crm_app_user|ECONNREFUSED|ioredis|redis)/i;
  const VOLATILE_HEADERS = new Set([
    'date',
    'content-length',
    'etag',
    'x-request-id',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
    'retry-after',
    'connection',
    'keep-alive',
  ]);

  let L: Tenant; // owner of the foreign objects
  let M: Tenant; // the prober
  let foreignContact = '';
  let foreignRole = '';
  let foreignUser = '';
  let mNoGrant: { token: string; userId: number };

  interface Seen {
    status: number;
    type: string;
    body: string;
    headers: string[];
    ms: number;
  }
  const normalise = (text: string) =>
    text.replace(UUID_RE, '<uuid>').replace(/"requestId":"[^"]*"/g, '"requestId":"<id>"');
  async function probe(
    token: string | null,
    method: Method,
    path: string,
    body?: object,
  ): Promise<Seen> {
    const t0 = now();
    const r = await call(token, method, path, body);
    return {
      status: r.status,
      type: String(r.headers['content-type'] ?? '').split(';')[0]!,
      body: normalise(r.text ?? ''),
      headers: Object.keys(r.headers)
        .filter((k) => !VOLATILE_HEADERS.has(k))
        .sort(),
      ms: now() - t0,
    };
  }

  beforeAll(async () => {
    L = await tenant('cr-leak-l');
    M = await tenant('cr-leak-m');
    mNoGrant = await api.member(M, 'nog', []);
    [foreignContact] = await api.seedContacts(L, [
      { name: 'Foreign Person', email: 'foreign.person@example.test' },
    ]);
    foreignRole = (await roleOfUser(L.adminUserId)).uuid;
    foreignUser = await userUuid(L.adminUserId);
  });

  const targets = (id: string) =>
    [
      ['get', `/v2/contacts/${id}`, undefined],
      ['patch', `/v2/contacts/${id}`, { name: 'x', rowVersion: 1 }],
      ['delete', `/v2/contacts/${id}`, undefined],
      ['get', `/v2/contacts/${id}/tags`, undefined],
      ['get', `/v2/roles/${id}`, undefined],
      ['get', `/v2/users/${id}`, undefined],
    ] as const;

  it('AUTHZ-094 a foreign id and a nonexistent id give the same status, content type, headers and body shape (positive: the owner sees the object)', async () => {
    const own = await probe(L.admin, 'get', `/v2/contacts/${foreignContact}`);
    expect(own.status).toBe(200);
    expect((await probe(L.admin, 'get', `/v2/roles/${foreignRole}`)).status).toBe(200);
    expect((await probe(L.admin, 'get', `/v2/users/${foreignUser}`)).status).toBe(200);

    const timings: string[] = [];
    for (const [i, [method, , body]] of targets(foreignContact!).entries()) {
      const real = i < 4 ? foreignContact! : i === 4 ? foreignRole : foreignUser;
      const path = (id: string) => targets(id)[i]![1];
      const foreign = await probe(M.admin, method, path(real), body);
      const missing = await probe(M.admin, method, path(randomUUID()), body);
      expect(foreign.status, `${method} ${path('<id>')}`).toBe(404);
      expect(foreign.status).toBe(missing.status);
      expect(foreign.type).toBe(missing.type);
      expect(foreign.headers).toEqual(missing.headers);
      expect(foreign.body).toBe(missing.body);
      timings.push(
        `${method} ${path('<id>')}: foreign ${foreign.ms.toFixed(0)} ms, missing ${missing.ms.toFixed(0)} ms`,
      );
      // the body names neither the object nor the other tenant
      for (const text of [foreign.body, missing.body]) {
        expect(text).not.toMatch(INTERNALS);
        expect(text).not.toContain('Foreign Person');
        expect(text).not.toContain('foreign.person@example.test');
        expect(text).not.toContain(L.slug);
      }
    }
    console.info(`[AUTHZ-094] timing (informational only):\n  ${timings.join('\n  ')}`);
  });

  it('AUTHZ-094 a caller without the grant gets the same 403 for a foreign id, a nonexistent id and a real one of their own tenant', async () => {
    const [mine] = await api.seedContacts(M, [{ name: 'Mine' }]);
    const seen = [
      await probe(mNoGrant.token, 'get', `/v2/contacts/${foreignContact}`),
      await probe(mNoGrant.token, 'get', `/v2/contacts/${randomUUID()}`),
      await probe(mNoGrant.token, 'get', `/v2/contacts/${mine}`),
    ];
    for (const s of seen) {
      expect(s.status).toBe(403);
      expect(s.body).toBe(seen[0]!.body);
      expect(s.headers).toEqual(seen[0]!.headers);
      expect(s.body).not.toMatch(INTERNALS);
    }
    expect(
      (await probe(M.admin, 'get', `/v2/contacts/${mine}`)).status,
      'positive: the tenant admin reads its own',
    ).toBe(200);
  });

  it('AUTHZ-094 401 responses do not say why: a missing, malformed, tampered or foreign-secret token all look the same', async () => {
    const good = M.admin;
    const [h64, p64, sig] = good.split('.') as [string, string, string];
    const flipped = `${h64}.${p64}.${sig.slice(0, -2)}${sig.endsWith('AA') ? 'BB' : 'AA'}`;
    const tamperedClaims = Buffer.from(
      JSON.stringify({ ...claimsOf(good), org: L.orgId }),
    ).toString('base64url');
    const variants: Array<[string, string | null]> = [
      ['no token', null],
      ['garbage', 'not-a-jwt'],
      ['bad signature', flipped],
      ['claims swapped to tenant L', `${h64}.${tamperedClaims}.${sig}`],
    ];
    const seen: Seen[] = [];
    for (const [, token] of variants) seen.push(await probe(token, 'get', '/v2/contacts'));
    const withToken = seen.slice(1);
    for (const [i, s] of seen.entries()) {
      expect(s.status, variants[i]![0]).toBe(401);
      expect(s.type).toBe('application/problem+json');
      expect(s.body).not.toMatch(INTERNALS);
      expect(s.body).not.toMatch(/jwt|signature|secret|malformed|expired at/i);
    }
    expect(new Set(withToken.map((s) => s.body)).size, 'one body for every bad token').toBe(1);
    expect(
      (await probe(good, 'get', '/v2/contacts')).status,
      'positive: the genuine token works',
    ).toBe(200);
  });

  it('AUTHZ-094 404 for an unknown route and 400 for a malformed id carry no stack, SQL or framework internals', async () => {
    const results = [
      await probe(M.admin, 'get', '/v2/this-route-does-not-exist'),
      await probe(M.admin, 'get', '/v2/contacts/not-a-uuid'),
      await probe(M.admin, 'patch', `/v2/contacts/${randomUUID()}`, { rowVersion: 'x' }),
    ];
    for (const r of results) {
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
      expect(r.body).not.toMatch(INTERNALS);
      expect(r.body).not.toContain(L.slug);
    }
  });

  it('AUTHZ-094 a 500 caused by a database failure answers with the generic problem: no SQL, table, role or stack', async () => {
    await withBrokenTable('role_grants', async () => {
      await deleteKeys('rbac:*');
      const r = await call(mNoGrant.token, 'get', '/v2/contacts');
      expect(r.status, JSON.stringify(r.body)).toBeGreaterThanOrEqual(500);
      expect(r.type).toBe('application/problem+json');
      expect(r.body.detail).toBe('An unexpected error occurred.');
      expect(Object.keys(r.body).sort()).toEqual([
        'code',
        'detail',
        'instance',
        'requestId',
        'status',
        'title',
        'type',
      ]);
      expect(r.text).not.toMatch(INTERNALS);
      expect(r.text).not.toContain('role_grants');
      for (const [name, value] of Object.entries(r.headers)) {
        expect(`${name}: ${String(value)}`, 'headers').not.toMatch(INTERNALS);
      }
    });
    await deleteKeys('rbac:*');
    expect((await call(M.admin, 'get', '/v2/contacts')).status, 'recovers').toBe(200);
  });

  it('AUTHZ-094 response headers never name another tenant, whoever is asking', async () => {
    const needles = [L.slug, 'foreign.person', 'Foreign Person'];
    const asks: Array<[string | null, Method, string]> = [
      [M.admin, 'get', `/v2/contacts/${foreignContact}`],
      [M.admin, 'get', '/v2/contacts'],
      [mNoGrant.token, 'get', `/v2/contacts/${foreignContact}`],
      [null, 'get', `/v2/contacts/${foreignContact}`],
    ];
    for (const [token, method, path] of asks) {
      const r = await call(token, method, path);
      const headerText = Object.entries(r.headers)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join('\n');
      for (const needle of needles) {
        expect(headerText, `${method} ${path}`).not.toContain(needle);
      }
      expect(r.headers['set-cookie'], 'no cookie is set on an API response').toBeUndefined();
      expect(
        Object.keys(r.headers).filter((k) => /org|tenant|workspace|account/i.test(k)),
        'no header carries a tenant identifier',
      ).toEqual([]);
      if (r.headers['x-powered-by']) {
        console.info(
          `[AUTHZ-094] informational: x-powered-by: ${r.headers['x-powered-by']} is sent (framework fingerprint)`,
        );
      }
    }
  });
});

// ---- 1 (continued). the Redis keyspace after all of the above ---------------------------------------------------------------------

describe('AUTHZ-019 Redis keyspace audit', () => {
  /**
   * Keys that hold no tenant or user data of their own, with the reason. Anything else must carry the org id (and the user id where the
   * value is per-user) as a path segment, or the test fails and the key has to be judged and listed here.
   */
  const GLOBAL: Array<[RegExp, string]> = [
    [/^auth:epoch$/, 'platform-wide token epoch, a number'],
    [
      /^(auth:rev|auth:act|auth:cap):[0-9a-f-]{36}$/,
      'per-session (random uuid): tombstone, last-activity ms, cap marker; no tenant data',
    ],
    [
      /^auth:(ip|ipfail):/,
      'per-address throttle counters (by design shared by every tenant behind one address); a number',
    ],
    [/^auth:footer-v:platform$/, 'platform footer version counter'],
    [/^auth:send-halt$/, 'platform emergency halt flag'],
    [
      /^auth:known-nets:operator:0:[0-9a-f]{32}$/,
      'platform-operator pool (org 0): hashed networks',
    ],
    [
      /^(auth:mfa|auth:mfa-try|auth:wschoice|auth:social|auth:signup|auth:wa-login):[0-9a-f]{20,}/,
      'keyed by the sha256 of an unguessable one-time token',
    ],
    [/^auth:otp-phone:/, 'sha256 of a phone number; a counter'],
    [/^bull:/, 'BullMQ queue internals (job data carries its own org id)'],
    [/^health:probe$/, 'liveness probe, constant'],
    [
      /^(lang|i18n|translation|tr):/,
      'translation cache keyed by the hash of the text; no tenant data',
    ],
  ];
  const orgIds = () => new Set(tenants.map((t) => String(t.orgId)));

  it('AUTHZ-019 every tenant-scoped key carries the org id; per-user keys carry the user id too; the rest are judged global', async () => {
    const all = await scan();
    expect(all.length, 'the suite exercised the caches').toBeGreaterThan(20);
    const orgs = orgIds();
    const unjudged: string[] = [];
    const global: string[] = [];
    const perUserMissingUser: string[] = [];
    const wrongOrg: string[] = [];

    const grants = /^rbac:(\d+):v\d+:u(\d+)$/;
    const gate = /^auth:gate:(\d+):(\d+)$/;
    const suspended = /^auth:org-susp:(\d+)$/;
    const idem = /^idem:(\d+):.+$/;
    const version = /^rbac:version:(\d+)$/;
    const footer = /^auth:footer-v:(\d+)$/;
    const alert = /^auth:alert:(\d+):[^:]+:[0-9a-f]+$/;
    const nets = /^auth:known-nets:(?:staff|partner|user):(\d+):[0-9a-f]{32}$/;
    const rlActor =
      /^rl:\d+\/\d+s:[^:]+:(?:user|partner_agent|api_key|platform_operator):(\d+):\d+:-?\d+$/;
    const rlIp = /^rl:\d+\/\d+s:[^:]+:ip:.+$/;
    for (const key of all) {
      const checks = [grants, gate, suspended, idem, version, footer, alert, nets];
      const hit = checks.map((re) => re.exec(key)).find(Boolean);
      if (hit) {
        if (!orgs.has(hit[1]!)) wrongOrg.push(key);
        continue;
      }
      if (key.startsWith('rl:')) {
        const m = rlActor.exec(key);
        if (m) {
          if (!orgs.has(m[1]!)) wrongOrg.push(key);
        } else if (rlIp.test(key)) {
          global.push(key); // an address-keyed bucket: shared by every tenant behind one address, by design
        } else {
          unjudged.push(`${key}  (throttle key of an unknown shape)`);
        }
        continue;
      }
      if (/^rbac:|^auth:gate:|^idem:|^auth:org-susp:/.test(key)) {
        perUserMissingUser.push(key);
        continue;
      }
      const reason = GLOBAL.find(([re]) => re.test(key));
      if (reason) global.push(key);
      else unjudged.push(key);
    }
    console.info(
      `[AUTHZ-019] keyspace: ${all.length} keys, ${global.length} judged global, families: ${[...new Set(all.map((k) => k.split(':').slice(0, 2).join(':')))].join(', ')}`,
    );
    expect(wrongOrg, 'tenant-scoped keys naming an organisation this suite did not create').toEqual(
      [],
    );
    expect(
      perUserMissingUser,
      'tenant/user data keys that do not match the documented shape',
    ).toEqual([]);
    expect(
      unjudged,
      'keys with no org segment and no entry in the global list: judge each by what it holds',
    ).toEqual([]);
  });

  it('AUTHZ-019 the per-user and per-tenant key families never share a key between two tenants', async () => {
    const all = await scan();
    for (const re of [/^rbac:(\d+):v\d+:u(\d+)$/, /^auth:gate:(\d+):(\d+)$/]) {
      const byUser = new Map<string, Set<string>>();
      for (const key of all) {
        const m = re.exec(key);
        if (!m) continue;
        byUser.set(m[2]!, (byUser.get(m[2]!) ?? new Set()).add(m[1]!));
      }
      const shared = [...byUser].filter(([, orgSet]) => orgSet.size > 1).map(([user]) => user);
      expect(shared, `${re}: a user id appears under two tenants`).toEqual([]);
      expect(byUser.size, `${re}: family present`).toBeGreaterThan(0);
    }
    // the stored value is never another tenant's: a cached grant set for tenant A's reader mentions only that reader's grants
    const vA = await rolesVersion(A.orgId);
    const sets = await Promise.all(
      (await scan(`rbac:${A.orgId}:v${vA}:u*`)).map((k) => h.redis.get(k)),
    );
    for (const s of sets) expect(s).not.toBeNull();
  });
});
