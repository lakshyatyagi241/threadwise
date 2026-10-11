import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_SCOPES, type ApiScope } from '@crm/contracts';
import { OPERATOR_EMAIL, OPERATOR_PASSWORD } from '../auth-registration-security/harness';
import { operatorToken } from '../install-update-licensing/helpers';
import {
  Api,
  bearer,
  mintKey,
  startHarness,
  type Harness,
  type MintedKey,
  type Tenant,
} from '../developer-rest-api-v1/support';

/**
 * Customer REST API (`/api/v1`) and developer API keys: authorization evidence (AUTHZ-011..013, 060, 067, 068, 069, 072, 074, 075).
 *
 * How a key is represented (read from the code, not assumed): `api_keys.scopes` is a text[]. An EMPTY list is an unrestricted key
 * (`scopeAllows`: `held.length === 0 -> true`, TW-API-008). Any non-empty list is restricted: only the listed scopes (plus `x:read` for
 * `x:write`) pass, a name nobody defined grants nothing. So "restricted with zero grants" has no representation of its own; the closest
 * stored shape is a list holding only unknown names, which this file proves is denied on every route.
 *
 * Every route comes from the live controller scan (tools/authz-audit/lib/routes.mjs, gate `api-key`), and the route -> scope mapping is
 * read from the `@RequireApiScope(...)` decorator in the controller source, so a new endpoint is covered the day it is added.
 */

interface Route {
  id: string;
  file: string;
  handler: string;
  method: string;
  path: string;
  url: string;
  gate: string;
  objectIdParams: string[];
  hasBody: boolean;
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options';
interface CallOpts {
  key?: string | null;
  jwt?: string | null;
  headers?: Record<string, string>;
  body?: object | null;
  ip?: string;
}
interface Res {
  status: number;
  text: string;
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  headers: Record<string, string>;
}

let h: Harness;
let api: Api;
let routes: Route[] = [];
let v1: Route[] = [];
const scopeOf = new Map<string, ApiScope>();
const unscoped: string[] = [];

let A: Tenant;
let B: Tenant;
let kFull: MintedKey; // A, unrestricted
let kScoped: MintedKey; // A, restricted; its scopes are rewritten between phases
let kRevoked: MintedKey; // A, revoked through the console
let kExpired: MintedKey; // A, expires_at in the past
let kB: MintedKey; // B, unrestricted

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const READ_SCOPES = API_SCOPES.filter((s) => s.endsWith(':read'));

// ---- helpers ---------------------------------------------------------------------------------------------------------------------

let xff = 0;
const nextIp = () => `10.88.${Math.floor(xff / 250) % 250}.${xff++ % 250}`;

async function call(method: Method, url: string, o: CallOpts = {}): Promise<Res> {
  const http = request(h.app.getHttpServer()) as unknown as Record<
    string,
    (u: string) => request.Test
  >;
  let req = http[method]!(url).set('x-forwarded-for', o.ip ?? nextIp());
  if (o.key) req = req.set('authorization', `Bearer ${o.key}`);
  if (o.jwt) req = req.set(bearer(o.jwt));
  for (const [k, v] of Object.entries(o.headers ?? {})) req = req.set(k, v);
  if (['post', 'put', 'patch'].includes(method)) req = req.send(o.body ?? {});
  const res = await req;
  return {
    status: res.status,
    text: res.text ?? '',
    json: res.body,
    headers: res.headers as Record<string, string>,
  };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]!);
      }
    }),
  );
  return out;
}

const fill = (r: Route, values: Record<string, string> = {}) =>
  r.url.replace(/:(\w+)/g, (_m, name: string) => values[name] ?? randomUUID());
const isDenied = (s: number) => s === 401 || s === 403;
const resourceOf = (s: string) => s.split(':')[0]!;
const readOf = (s: ApiScope) => s.replace(':write', ':read') as ApiScope;
const decoyFor = (s: ApiScope): ApiScope =>
  resourceOf(s) === 'account' ? 'contacts:read' : 'account:read';
const segmentOf = (r: Route) => r.path.split('/')[3] ?? '';

async function setScopes(key: MintedKey, scopes: string[]) {
  await h.owner.query(`UPDATE api_keys SET scopes = $2::text[] WHERE uuid = $1`, [key.id, scopes]);
}
async function setPlan(orgId: number, overrides: object) {
  await h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
    orgId,
    JSON.stringify(overrides),
  ]);
}
const OPEN_PLAN = { limits: { api_keys: 50, api_rate_limit_per_minute: -1 } };

const rowHash = async (table: string, uuid: string) =>
  (
    await h.owner.query(`SELECT md5(to_jsonb(t)::text) AS h FROM "${table}" t WHERE uuid = $1`, [
      uuid,
    ])
  ).rows[0]?.h as string | undefined;
const countOf = async (table: string, orgId: number) =>
  Number(
    (await h.owner.query(`SELECT count(*)::int AS n FROM "${table}" WHERE org_id = $1`, [orgId]))
      .rows[0].n,
  );

/** The route -> scope mapping, read from the controller source: the decorator closest above the handler. */
function declaredScope(r: Route): ApiScope | null {
  const src = readFileSync(join(__dirname, '../../../src', r.file), 'utf8');
  const at = src.search(new RegExp(`\\n  (?:async )?${r.handler}\\(`));
  if (at < 0) return null;
  const before = src.slice(0, at);
  const seg = before.slice(Math.max(before.lastIndexOf('\n  }\n'), before.indexOf('class ')));
  const all = [...seg.matchAll(/@RequireApiScope\('([^']+)'\)/g)];
  return (all.at(-1)?.[1] as ApiScope | undefined) ?? null;
}

// ---- fixtures: tenant A's own objects (what tenant B must never reach) ---------------------------------------------------------------

const SECRET_NAME = 'AZ-SECRET-CONTACT-A';
const SECRET_PHONE = '+919800990001';
const SECRET_EMAIL = 'az-secret-a@example.test';
const fx: Record<string, string> = {};
const FX_TABLE: Record<string, string> = {
  contacts: 'contacts',
  'contact-groups': 'contact_groups',
  templates: 'wa_templates',
  devices: 'devices',
  deals: 'deals',
  broadcasts: 'broadcasts',
};
const notSeeded: string[] = [];

beforeAll(async () => {
  const mod = (await import(
    /* @vite-ignore */ pathToFileURL(
      join(__dirname, '../../../../../tools/authz-audit/lib/routes.mjs'),
    ).href
  )) as { scanRoutes: () => Route[] };
  routes = mod.scanRoutes();
  v1 = routes.filter((r) => r.gate === 'api-key');
  for (const r of v1) {
    const s = declaredScope(r);
    if (s) scopeOf.set(r.id, s);
    else unscoped.push(r.id);
  }

  h = await startHarness();
  api = new Api(h);
  A = await api.signup('az-ks-a');
  B = await api.signup('az-ks-b');
  await setPlan(A.orgId, OPEN_PLAN);
  await setPlan(B.orgId, OPEN_PLAN);

  kFull = await mintKey(api, A, 'full');
  kScoped = await mintKey(api, A, 'scoped', ['contacts:read']);
  kRevoked = await mintKey(api, A, 'to revoke');
  kExpired = await mintKey(api, A, 'to expire');
  kB = await mintKey(api, B, 'b full');
  expect(
    (await api.http().delete(`/v2/developer/keys/${kRevoked.id}`).set(bearer(A.admin))).status,
  ).toBe(200);
  await h.owner.query(
    `UPDATE api_keys SET expires_at = now() - interval '1 minute' WHERE uuid = $1`,
    [kExpired.id],
  );

  // tenant A's objects, created the supported way where a route exists and by SQL otherwise
  fx.contacts = (
    await api.seedContacts(A, [{ name: SECRET_NAME, phone: SECRET_PHONE, email: SECRET_EMAIL }])
  )[0]!;
  await api.seedContacts(B, [{ name: 'AZ-B-ONLY-CONTACT', phone: '+919800990002' }]);
  fx['contact-groups'] = (
    await h.owner.query(
      `INSERT INTO contact_groups (org_id, name) VALUES ($1, 'AZ-SECRET-GROUP-A') RETURNING uuid`,
      [A.orgId],
    )
  ).rows[0].uuid;
  fx.templates = (
    await h.owner.query(
      `INSERT INTO wa_templates (org_id, template_name, template_body, template_type, status)
       VALUES ($1, 'az_secret_tpl_a', 'Hello', 'standard', 'approved') RETURNING uuid`,
      [A.orgId],
    )
  ).rows[0].uuid;
  fx.devices = (
    await h.owner.query(
      `INSERT INTO devices (org_id, device_name, phone_number, status, active)
       VALUES ($1, 'AZ-SECRET-DEVICE-A', '+919800990003', 'connected', true) RETURNING uuid`,
      [A.orgId],
    )
  ).rows[0].uuid;
  const deal = await call('post', '/api/v1/deals', {
    key: kFull.secret,
    body: { title: 'AZ-SECRET-DEAL-A' },
  });
  if (deal.status === 201) fx.deals = deal.json.data.id;
  else notSeeded.push(`deals (create answered ${deal.status})`);
  const bc = await call('post', '/api/v1/broadcasts', {
    key: kFull.secret,
    body: { name: 'AZ-SECRET-BROADCAST-A', template_id: fx.templates, recipients: [fx.contacts] },
  });
  if (bc.status === 201) fx.broadcasts = bc.json.data.id;
  else notSeeded.push(`broadcasts (create answered ${bc.status})`);
}, 600_000);

afterAll(async () => {
  await h?.stop();
}, 120_000);

// ---- 1. scope map ------------------------------------------------------------------------------------------------------------------

describe('AUTHZ-060 the /api/v1 surface and its scope map', () => {
  it('AUTHZ-060 scans the whole customer API and every route declares exactly one defined scope', () => {
    expect(v1.length).toBeGreaterThanOrEqual(50);
    expect(unscoped, 'routes with no @RequireApiScope while others have one').toEqual([]);
    for (const r of v1) expect(API_SCOPES, r.id).toContain(scopeOf.get(r.id));
    // each write route needs a :write scope and each GET route a :read scope (a mismatch would be a silent privilege error)
    const mismatched = v1
      .filter((r) => (r.method === 'GET') !== scopeOf.get(r.id)!.endsWith(':read'))
      .map((r) => `${r.id} -> ${scopeOf.get(r.id)}`);
    // POST /media/:token reads, POST list-style routes may legitimately differ; report the list instead of guessing
    expect(mismatched.filter((m) => !/^POST \/api\/v1\/media/.test(m))).toEqual([]);
  });
});

// ---- 2. unauthenticated, garbage, revoked, expired --------------------------------------------------------------------------------------

describe('AUTHZ-060 credentials that must never open a route', () => {
  it('AUTHZ-060 no key, a garbage key, a revoked key and an expired key are 401 on every /api/v1 route', async () => {
    const wrongSuffix = kFull.secret.slice(0, 12) + 'z'.repeat(32);
    const credentials: Array<[string, CallOpts]> = [
      ['no key', {}],
      ['garbage', { key: 'not-a-key' }],
      ['well-formed unknown', { key: 'wsk_' + 'A'.repeat(40) }],
      ['real prefix, wrong secret', { key: wrongSuffix }],
      ['revoked', { key: kRevoked.secret }],
      ['expired', { key: kExpired.secret }],
      ['garbage in X-Api-Key', { headers: { 'x-api-key': 'wsk_' + 'B'.repeat(40) } }],
      ['revoked in X-Api-Key', { headers: { 'x-api-key': kRevoked.secret } }],
      ['key in the query string only', {}],
    ];
    const bad: string[] = [];
    await pool(v1, 6, async (r) => {
      for (const [label, o] of credentials) {
        const url = fill(r) + (label.includes('query') ? `?api_key=${kFull.secret}` : '');
        const res = await call(r.method.toLowerCase() as Method, url, o);
        const code = res.json?.error?.code;
        if (res.status !== 401 || !['missing_api_key', 'invalid_api_key'].includes(code))
          bad.push(`${r.id} [${label}] -> ${res.status} ${res.text.slice(0, 120)}`);
      }
    });
    expect(bad).toEqual([]);
  }, 1_800_000);

  it('AUTHZ-060 a revoked or expired key leaves the same key usable again only when the row is made active (positive control)', async () => {
    expect((await call('get', '/api/v1/me', { key: kFull.secret })).status).toBe(200);
    expect((await call('get', '/api/v1/me', { key: kRevoked.secret })).status).toBe(401);
    expect((await call('get', '/api/v1/me', { key: kExpired.secret })).status).toBe(401);
    await h.owner.query(`UPDATE api_keys SET expires_at = NULL WHERE uuid = $1`, [kExpired.id]);
    expect((await call('get', '/api/v1/me', { key: kExpired.secret })).status).toBe(200);
    await h.owner.query(
      `UPDATE api_keys SET expires_at = now() - interval '1 minute' WHERE uuid = $1`,
      [kExpired.id],
    );
    expect((await call('get', '/api/v1/me', { key: kExpired.secret })).status).toBe(401);
  });
});

// ---- 3. restricted / unrestricted ----------------------------------------------------------------------------------------------------

describe('AUTHZ-067 scopes on every route', () => {
  it('AUTHZ-067 an intentionally unrestricted key is allowed (not 401/403, no 5xx) on every route', async () => {
    const bad: string[] = [];
    await pool(v1, 6, async (r) => {
      const res = await call(r.method.toLowerCase() as Method, fill(r), { key: kFull.secret });
      if (isDenied(res.status) || res.status >= 500)
        bad.push(`${r.id} (${scopeOf.get(r.id)}) -> ${res.status} ${res.text.slice(0, 160)}`);
    });
    expect(bad).toEqual([]);
  }, 1_800_000);

  it('AUTHZ-067 a restricted key holding exactly the route scope passes the gate on every route', async () => {
    const bad: string[] = [];
    const scopes = [...new Set(v1.map((r) => scopeOf.get(r.id)!))];
    for (const s of scopes) {
      await setScopes(kScoped, [s]);
      for (const r of v1.filter((x) => scopeOf.get(x.id) === s)) {
        const res = await call(r.method.toLowerCase() as Method, fill(r), { key: kScoped.secret });
        if (isDenied(res.status) || res.status >= 500)
          bad.push(`${r.id} with [${s}] -> ${res.status} ${res.text.slice(0, 160)}`);
      }
    }
    expect(bad).toEqual([]);
  }, 1_800_000);

  it('AUTHZ-067 a restricted key lacking the scope is 403 forbidden on every route, and the denial names the needed scope', async () => {
    const bad: string[] = [];
    for (const decoy of ['account:read', 'contacts:read'] as ApiScope[]) {
      await setScopes(kScoped, [decoy]);
      for (const r of v1.filter((x) => decoyFor(scopeOf.get(x.id)!) === decoy)) {
        const need = scopeOf.get(r.id)!;
        const res = await call(r.method.toLowerCase() as Method, fill(r), { key: kScoped.secret });
        if (res.status !== 403 || !String(res.json?.error?.message).includes(need))
          bad.push(`${r.id} with [${decoy}] -> ${res.status} ${res.text.slice(0, 160)}`);
      }
    }
    expect(bad).toEqual([]);
  }, 1_800_000);

  it('AUTHZ-067 a :read scope never satisfies a :write route, and a :write scope never reaches another resource', async () => {
    const bad: string[] = [];
    const writeRoutes = v1.filter((r) => scopeOf.get(r.id)!.endsWith(':write'));
    for (const s of new Set(writeRoutes.map((r) => scopeOf.get(r.id)!))) {
      await setScopes(kScoped, [readOf(s)]);
      for (const r of writeRoutes.filter((x) => scopeOf.get(x.id) === s)) {
        const res = await call(r.method.toLowerCase() as Method, fill(r), { key: kScoped.secret });
        if (res.status !== 403) bad.push(`${r.id} with [${readOf(s)}] -> ${res.status}`);
      }
    }
    for (const s of new Set(writeRoutes.map((r) => scopeOf.get(r.id)!))) {
      await setScopes(kScoped, [s]);
      for (const r of v1.filter((x) => resourceOf(scopeOf.get(x.id)!) !== resourceOf(s))) {
        const res = await call(r.method.toLowerCase() as Method, fill(r), { key: kScoped.secret });
        if (res.status !== 403) bad.push(`${r.id} with [${s}] -> ${res.status}`);
      }
    }
    expect(bad).toEqual([]);
  }, 1_800_000);

  it('AUTHZ-067 a key whose stored scopes grant nothing (unknown or malformed names only) is denied on every route, not treated as unrestricted', async () => {
    const bad: string[] = [];
    const zeroGrant = [
      ['nonsense:read'],
      [''],
      ['*'],
      ['all'],
      ['admin'],
      ['CONTACTS:READ'],
      ['contacts:*'],
      ['contacts:read '],
      ['contacts'],
      ['nonsense:read', 'other:write'],
    ];
    for (const scopes of zeroGrant) {
      await setScopes(kScoped, scopes);
      await pool(v1, 6, async (r) => {
        const res = await call(r.method.toLowerCase() as Method, fill(r), { key: kScoped.secret });
        if (res.status !== 403) bad.push(`${r.id} with ${JSON.stringify(scopes)} -> ${res.status}`);
      });
    }
    expect(bad).toEqual([]);
  }, 1_800_000);

  it('AUTHZ-067 the console cannot mint a key that grants nothing: unknown scopes are 422, and nothing is stored', async () => {
    const before = await countOf('api_keys', A.orgId);
    for (const scopes of [['nonsense:read'], [''], ['*'], ['contacts:*'], 'contacts:read', null]) {
      const res = await api
        .http()
        .post('/v2/developer/keys')
        .set(bearer(A.admin))
        .send({ name: 'x', scopes });
      expect(res.status, JSON.stringify(scopes)).toBe(422);
    }
    expect(await countOf('api_keys', A.orgId)).toBe(before);
  });

  it('AUTHZ-067 POLICY (documented behaviour): an empty scope list, omitted or explicit [], is an unrestricted key, and no HTTP path edits scopes', async () => {
    const explicitEmpty = await mintKey(api, A, 'explicit empty', []);
    const omitted = await mintKey(api, A, 'omitted');
    for (const k of [explicitEmpty, omitted]) {
      expect(k.scopes).toEqual([]);
      for (const path of ['/me', '/contacts', '/deals', '/templates', '/broadcasts', '/devices']) {
        expect((await call('get', `/api/v1${path}`, { key: k.secret })).status, path).toBe(200);
      }
    }
    // there is no endpoint that edits a key: scope edits, rotation and renames do not exist, so a restricted key cannot be cleared into
    // an unrestricted one over HTTP
    for (const m of ['put', 'patch', 'post'] as const) {
      const res = await call(m, `/v2/developer/keys/${explicitEmpty.id}`, {
        jwt: A.admin,
        body: { scopes: [] },
      });
      expect([404, 405], `${m} -> ${res.status}`).toContain(res.status);
    }
    for (const k of [explicitEmpty, omitted])
      await api.http().delete(`/v2/developer/keys/${k.id}`).set(bearer(A.admin));
  });

  it('AUTHZ-067 changing a key sequence restricted -> widened -> narrowed -> emptied is effective on the very next request, with no stale cache', async () => {
    const k = await mintKey(api, A, 'sequence', ['contacts:read']);
    const get = (p: string) => call('get', `/api/v1${p}`, { key: k.secret });
    const post = () =>
      call('post', '/api/v1/contacts', {
        key: k.secret,
        body: { name: 'Seq', phone: '+919800990101' },
      });

    // restricted
    expect((await get('/contacts')).status).toBe(200);
    expect((await get('/me')).status).toBe(403);
    expect((await post()).status).toBe(403);
    // widen: add account:read -> /me opens at once, writes stay closed
    await setScopes(k, ['contacts:read', 'account:read']);
    expect((await get('/me')).status).toBe(200);
    expect((await post()).status).toBe(403);
    // widen to write
    await setScopes(k, ['contacts:write', 'account:read']);
    expect([200, 201]).toContain((await post()).status);
    // narrow back: write closes at once
    await setScopes(k, ['contacts:read']);
    expect((await post()).status).toBe(403);
    expect((await get('/me')).status).toBe(403);
    // swap to an unknown-only list: nothing opens, even what was open a request ago
    await setScopes(k, ['nonsense:read']);
    expect((await get('/contacts')).status).toBe(403);
    expect((await get('/me')).status).toBe(403);
    // unrestricted -> restrict: effective immediately, repeatedly, with parallel requests straddling each change
    for (let i = 0; i < 5; i += 1) {
      await setScopes(k, []);
      expect((await get('/me')).status, `round ${i} unrestricted`).toBe(200);
      await setScopes(k, ['contacts:read']);
      const after = await Promise.all([get('/me'), get('/me'), get('/deals'), get('/contacts')]);
      expect(
        after.map((r) => r.status),
        `round ${i} restricted`,
      ).toEqual([403, 403, 403, 200]);
    }
    // a key revoked while holding scopes stays dead whatever its scopes say
    await api.http().delete(`/v2/developer/keys/${k.id}`).set(bearer(A.admin));
    await setScopes(k, []);
    expect((await get('/me')).status).toBe(401);
  });

  it('AUTHZ-067 POLICY (documented behaviour): clearing the last stored scope of a restricted key makes it unrestricted', async () => {
    // There is no HTTP path to clear scopes (proved above), so this is only reachable by a direct database edit or a future endpoint.
    // It is recorded here so that the day an edit endpoint is added, "remove the last scope" is a conscious decision, not an accident.
    const k = await mintKey(api, A, 'clear-all', ['contacts:read']);
    expect((await call('get', '/api/v1/me', { key: k.secret })).status).toBe(403);
    await setScopes(k, []);
    expect((await call('get', '/api/v1/me', { key: k.secret })).status).toBe(200);
    await api.http().delete(`/v2/developer/keys/${k.id}`).set(bearer(A.admin));
  });

  it('AUTHZ-067 credential confusion: a restricted bearer plus an unrestricted X-Api-Key is still restricted; garbage bearer plus a valid X-Api-Key is 401', async () => {
    await setScopes(kScoped, ['contacts:read']);
    const mixed = await call('get', '/api/v1/me', {
      key: kScoped.secret,
      headers: { 'x-api-key': kFull.secret },
    });
    expect(mixed.status).toBe(403);
    const garbage = await call('get', '/api/v1/me', {
      key: 'wsk_' + 'C'.repeat(40),
      headers: { 'x-api-key': kFull.secret },
    });
    expect(garbage.status).toBe(401);
    const viaHeader = await call('get', '/api/v1/me', { headers: { 'x-api-key': kScoped.secret } });
    expect(viaHeader.status).toBe(403);
    const okHeader = await call('get', '/api/v1/contacts', {
      headers: { 'x-api-key': kScoped.secret },
    });
    expect(okHeader.status).toBe(200);
  });
});

// ---- 4. method confusion ---------------------------------------------------------------------------------------------------------------

describe('AUTHZ-068 method confusion on /api/v1', () => {
  it('AUTHZ-068 a read-only key cannot write through any declared write route, even with real object ids, and nothing changes', async () => {
    await setScopes(kScoped, READ_SCOPES);
    const before: Record<string, string | undefined> = {};
    for (const [seg, uuid] of Object.entries(fx)) before[seg] = await rowHash(FX_TABLE[seg]!, uuid);
    const counts = async () =>
      JSON.stringify(await Promise.all(Object.values(FX_TABLE).map((t) => countOf(t, A.orgId))));
    const countsBefore = await counts();

    const bad: string[] = [];
    const writes = v1.filter((r) => WRITE_METHODS.includes(r.method));
    expect(writes.length).toBeGreaterThan(20);
    for (const r of writes) {
      const real = fx[segmentOf(r)];
      const values = real && r.objectIdParams.length ? { id: real } : {};
      const res = await call(r.method.toLowerCase() as Method, fill(r, values), {
        key: kScoped.secret,
      });
      if (res.status !== 403)
        bad.push(`${r.id} read-only key -> ${res.status} ${res.text.slice(0, 120)}`);
    }
    expect(bad).toEqual([]);
    for (const [seg, uuid] of Object.entries(fx))
      expect(await rowHash(FX_TABLE[seg]!, uuid), `${seg} row changed`).toBe(before[seg]);
    expect(await counts()).toBe(countsBefore);
  }, 1_800_000);

  it('AUTHZ-068 verbs a path does not declare (PUT/PATCH/DELETE/POST/HEAD/OPTIONS) never succeed or leak data for a read-only or unrestricted key', async () => {
    const byUrl = new Map<string, Set<string>>();
    for (const r of v1) byUrl.set(r.url, (byUrl.get(r.url) ?? new Set()).add(r.method));
    // a static segment (`/templates/categories`) is also answered by the `:id` route beside it, so it inherits that route's verbs
    for (const [url, verbs] of byUrl) {
      for (const [other, otherVerbs] of byUrl) {
        if (other === url || !other.includes(':')) continue;
        const re = new RegExp('^' + other.replace(/:\w+/g, '[^/]+') + '$');
        if (re.test(url)) for (const v of otherVerbs) verbs.add(v);
      }
    }
    const bad: string[] = [];
    for (const [label, key] of [
      ['read-only', READ_SCOPES],
      ['unrestricted', [] as string[]],
    ] as const) {
      await setScopes(kScoped, [...key]);
      await pool([...byUrl], 6, async ([url, declared]) => {
        const real = url.includes('/:id')
          ? { id: fx[url.split('/')[3] ?? ''] ?? randomUUID() }
          : {};
        const target = url.replace(
          /:(\w+)/g,
          (_m, n: string) => (real as Record<string, string>)[n] ?? randomUUID(),
        );
        for (const verb of ['PUT', 'PATCH', 'DELETE', 'POST'] as const) {
          if (declared.has(verb)) continue;
          const res = await call(verb.toLowerCase() as Method, target, { key: kScoped.secret });
          if (![401, 403, 404, 405].includes(res.status))
            bad.push(`${verb} ${url} [${label}] -> ${res.status} ${res.text.slice(0, 100)}`);
        }
        const head = await call('head', target, { key: kScoped.secret });
        if (head.text.length > 0) bad.push(`HEAD ${url} [${label}] returned a body`);
        if (!declared.has('GET') && head.status < 400 && head.status !== 204)
          bad.push(`HEAD ${url} [${label}] -> ${head.status} on a path with no GET`);
        const opt = await call('options', target, {
          key: kScoped.secret,
          headers: { origin: 'https://evil.example', 'access-control-request-method': 'DELETE' },
        });
        if (opt.status >= 500 || (opt.text.length > 0 && opt.status < 300))
          bad.push(`OPTIONS ${url} [${label}] -> ${opt.status} ${opt.text.slice(0, 80)}`);
      });
    }
    expect(bad).toEqual([]);
  }, 1_800_000);

  it('AUTHZ-068 HEAD and OPTIONS do not bypass authentication or scopes: HEAD without a key is 401, HEAD with the wrong scope is 403, with the right scope is not denied', async () => {
    const bad: string[] = [];
    const gets = v1.filter((r) => r.method === 'GET');
    for (const r of gets) {
      const anon = await call('head', fill(r));
      if (anon.status !== 401) bad.push(`HEAD ${r.id} no key -> ${anon.status}`);
    }
    for (const decoy of ['account:read', 'contacts:read'] as ApiScope[]) {
      await setScopes(kScoped, [decoy]);
      for (const r of gets.filter((x) => decoyFor(scopeOf.get(x.id)!) === decoy)) {
        const res = await call('head', fill(r), { key: kScoped.secret });
        if (res.status !== 403) bad.push(`HEAD ${r.id} lacking scope -> ${res.status}`);
      }
    }
    await setScopes(kScoped, ['contacts:read']);
    expect((await call('head', '/api/v1/contacts', { key: kScoped.secret })).status).toBe(200);
    expect((await call('head', '/api/v1/contacts', { key: kRevoked.secret })).status).toBe(401);
    expect(bad).toEqual([]);
  }, 1_800_000);

  it('AUTHZ-068 a method-override header cannot turn a read into a write', async () => {
    await setScopes(kScoped, READ_SCOPES);
    const before = await rowHash('contacts', fx.contacts!);
    for (const header of ['x-http-method-override', 'x-method-override', 'x-http-method']) {
      for (const verb of ['DELETE', 'PUT', 'PATCH']) {
        const res = await call('get', `/api/v1/contacts/${fx.contacts}`, {
          key: kScoped.secret,
          headers: { [header]: verb },
        });
        expect(res.status, `${header}: ${verb}`).toBe(200);
        const post = await call('post', `/api/v1/contacts`, {
          key: kScoped.secret,
          headers: { [header]: 'GET' },
          body: { name: 'Override', phone: '+919800990202' },
        });
        expect(post.status, `POST ${header}: GET`).toBe(403);
      }
    }
    expect(await rowHash('contacts', fx.contacts!)).toBe(before);
  });
});

// ---- 5. admin aliases / surfaces that must stay apart --------------------------------------------------------------------------------

describe('AUTHZ-069 keys never reach staff, platform or key-management surfaces', () => {
  it('AUTHZ-069 an unrestricted key never authenticates on any /v2 workspace, authenticated-only or platform/operator route', async () => {
    const targets = routes.filter((r) => r.gate !== 'public' && r.gate !== 'api-key');
    expect(targets.length).toBeGreaterThan(900);
    const bad: string[] = [];
    const unmounted = new Set<string>();
    await pool(targets, 8, async (r) => {
      const m = r.method.toLowerCase() as Method;
      // the scanner writes a version-only controller as /v2/2/...; the mounted path is /v2/...
      const url = fill(r).replace('/v2/2/', '/v2/');
      for (const o of [
        { key: kFull.secret },
        { headers: { 'x-api-key': kFull.secret } },
        { headers: { authorization: `ApiKey ${kFull.secret}` } },
      ] as CallOpts[]) {
        const res = await call(m, url, o);
        if (isDenied(res.status)) continue;
        // a path nothing is mounted at is unreachable, not accessible: only an anonymous 404 on it excuses a 404 here
        if (res.status === 404 && (await call(m, url)).status === 404) {
          unmounted.add(r.id);
          continue;
        }
        bad.push(`${r.id} [${r.gate}] -> ${res.status}`);
      }
    });
    if (unmounted.size)
      console.warn(`AUTHZ-069 routes with no mounted path: ${[...unmounted].join(', ')}`);
    expect(bad).toEqual([]);
  }, 1_800_000);

  it('AUTHZ-069 a workspace JWT, an operator token or an empty bearer never satisfies an /api/v1 route', async () => {
    const operator = await operatorToken(h, OPERATOR_EMAIL, OPERATOR_PASSWORD);
    const bad: string[] = [];
    await pool(v1, 6, async (r) => {
      const m = r.method.toLowerCase() as Method;
      for (const [label, o] of [
        ['workspace admin JWT', { jwt: A.admin }],
        ['operator token', { jwt: operator }],
        ['JWT in X-Api-Key', { headers: { 'x-api-key': A.admin } }],
      ] as Array<[string, CallOpts]>) {
        const res = await call(m, fill(r), o);
        if (res.status !== 401) bad.push(`${r.id} [${label}] -> ${res.status}`);
      }
    });
    expect(bad).toEqual([]);
  }, 1_800_000);

  it('AUTHZ-069 a bearer key does not open /public/v1 (the signed partner surface)', async () => {
    for (const path of [`/public/v1/leads/${randomUUID()}`]) {
      const res = await call('get', path, { key: kFull.secret });
      expect(res.status, path).toBe(401);
    }
    const post = await call('post', '/public/v1/leads', { key: kFull.secret, body: { name: 'x' } });
    expect(post.status).toBe(401);
  });

  it('AUTHZ-069 a key (any scope) cannot list, create, widen or revoke API keys; the console routes are staff only', async () => {
    const victim = await mintKey(api, A, 'victim');
    for (const scopes of [[], ['contacts:read'], [...API_SCOPES]]) {
      await setScopes(kScoped, scopes);
      const list = await call('get', '/v2/developer/keys', { key: kScoped.secret });
      const create = await call('post', '/v2/developer/keys', {
        key: kScoped.secret,
        body: { name: 'minted by key', scopes: [] },
      });
      const revoke = await call('delete', `/v2/developer/keys/${victim.id}`, {
        key: kScoped.secret,
      });
      for (const res of [list, create, revoke])
        expect(isDenied(res.status), `${JSON.stringify(scopes)} -> ${res.status}`).toBe(true);
    }
    expect((await call('get', '/api/v1/me', { key: victim.secret })).status).toBe(200);
    expect(await countOf('api_keys', A.orgId)).toBeGreaterThan(0);
    await api.http().delete(`/v2/developer/keys/${victim.id}`).set(bearer(A.admin));
  });

  it('AUTHZ-069 key management needs the matching staff permission: read, create and revoke are separate grants', async () => {
    const none = await api.member(A, 'ks-none', [['record.contacts.read']]);
    const reader = await api.member(A, 'ks-reader', [['api.keys.read']]);
    const creator = await api.member(A, 'ks-creator', [['api.keys.read'], ['api.keys.create']]);
    const revoker = await api.member(A, 'ks-revoker', [['api.keys.read'], ['api.keys.revoke']]);
    const target = await mintKey(api, A, 'perm target');

    const list = (t: string) => api.http().get('/v2/developer/keys').set(bearer(t));
    const create = (t: string) =>
      api
        .http()
        .post('/v2/developer/keys')
        .set(bearer(t))
        .send({ name: 'perm', scopes: ['account:read'] });
    const revoke = (t: string, id: string) =>
      api.http().delete(`/v2/developer/keys/${id}`).set(bearer(t));

    expect((await list(none.token)).status).toBe(403);
    expect((await create(none.token)).status).toBe(403);
    expect((await revoke(none.token, target.id)).status).toBe(403);
    expect((await list(reader.token)).status).toBe(200);
    expect((await create(reader.token)).status).toBe(403);
    expect((await revoke(reader.token, target.id)).status).toBe(403);
    expect((await revoke(creator.token, target.id)).status).toBe(403);
    expect((await create(revoker.token)).status).toBe(403);
    expect((await list(null as unknown as string)).status).toBe(401);

    const made = await create(creator.token);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect((await call('get', '/api/v1/me', { key: made.body.secret })).status).toBe(200);
    expect((await revoke(revoker.token, made.body.key.id)).status).toBe(200);
    expect((await call('get', '/api/v1/me', { key: made.body.secret })).status).toBe(401);
    // the target is still alive: every refused attempt above left it untouched
    expect((await call('get', '/api/v1/me', { key: target.secret })).status).toBe(200);
    await revoke(A.admin, target.id);
  });

  it("AUTHZ-069 another workspace's admin can neither see nor revoke this workspace's keys; its own list holds only its own", async () => {
    const mine = await mintKey(api, A, 'only A');
    const asB = await api.http().get('/v2/developer/keys').set(bearer(B.admin));
    expect(asB.status).toBe(200);
    const ids = (asB.body.data as Array<{ id: string }>).map((k) => k.id);
    expect(ids).not.toContain(mine.id);
    expect(ids).not.toContain(kFull.id);
    expect(JSON.stringify(asB.body)).not.toContain(kFull.prefix);
    const revoke = await api.http().delete(`/v2/developer/keys/${mine.id}`).set(bearer(B.admin));
    expect(revoke.status).toBe(404);
    expect(
      (await api.http().delete(`/v2/developer/keys/${randomUUID()}`).set(bearer(B.admin))).status,
    ).toBe(404);
    expect((await call('get', '/api/v1/me', { key: mine.secret })).status).toBe(200);
    await api.http().delete(`/v2/developer/keys/${mine.id}`).set(bearer(A.admin));
  });

  it('AUTHZ-069 a member can only mint a key that is no more powerful than the member (a key with api.keys.create alone must not read contacts)', async () => {
    // The key guard derives a key's grants from its scopes alone (api-key-grants.ts), not from the member who minted it, so a member
    // holding only the key-creation permission can mint an unrestricted key and read/write the whole workspace with it.
    const keymaker = await api.member(A, 'ks-keymaker', [['api.keys.read'], ['api.keys.create']]);
    const direct = await api.http().get('/v2/contacts').set(bearer(keymaker.token));
    expect(direct.status, 'precondition: the member cannot read contacts itself').toBe(403);
    const made = await api
      .http()
      .post('/v2/developer/keys')
      .set(bearer(keymaker.token))
      .send({ name: 'escalation' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const viaKey = await call('get', '/api/v1/contacts', { key: made.body.secret });
    const send = await call('post', '/api/v1/contacts', {
      key: made.body.secret,
      body: { name: 'Escalated', phone: '+919800990303' },
    });
    await api.http().delete(`/v2/developer/keys/${made.body.key.id}`).set(bearer(A.admin));
    expect(
      [viaKey.status, send.status],
      'a key minted by a member without contacts access',
    ).toEqual([403, 403]);
  });
});

// ---- 6. tenant binding ----------------------------------------------------------------------------------------------------------------

describe('AUTHZ-011..013 a key is bound to its workspace', () => {
  it('AUTHZ-011 tenant id in a header, query string or body cannot switch the workspace of a key', async () => {
    const base = await call('get', '/api/v1/me', { key: kFull.secret });
    expect(base.status).toBe(200);
    const bBase = await call('get', '/api/v1/me', { key: kB.secret });
    expect(bBase.json.data.workspace.id).not.toBe(base.json.data.workspace.id);

    const attempts: Array<Record<string, string>> = [
      { 'x-org-id': String(B.orgId) },
      { 'x-tenant-id': String(B.orgId) },
      { 'x-workspace-id': String(B.orgId) },
      { 'x-org-slug': B.slug },
      { 'x-tenant': B.slug },
      { 'x-forwarded-host': `${B.slug}.example.test` },
      { host: `${B.slug}.localhost` },
    ];
    for (const headers of attempts) {
      const res = await call('get', '/api/v1/me', { key: kFull.secret, headers });
      expect(res.status, JSON.stringify(headers)).toBe(200);
      expect(res.json.data.workspace.id, JSON.stringify(headers)).toBe(base.json.data.workspace.id);
    }
    for (const q of [
      `org_id=${B.orgId}`,
      `orgId=${B.orgId}`,
      `workspace_id=${B.orgId}`,
      `tenant=${B.slug}`,
      `org=${B.slug}`,
    ]) {
      const res = await call('get', `/api/v1/me?${q}`, { key: kFull.secret });
      expect(res.json?.data?.workspace?.id, q).toBe(base.json.data.workspace.id);
    }
  });

  it('AUTHZ-011 created objects land in the key workspace whatever tenant ids the body or headers carry, and the other workspace gains nothing', async () => {
    const bBefore = await countOf('contacts', B.orgId);
    const aBefore = await countOf('contacts', A.orgId);
    const res = await call('post', '/api/v1/contacts', {
      key: kFull.secret,
      headers: { 'x-org-id': String(B.orgId), 'x-org-slug': B.slug },
      body: {
        name: 'Bound To A',
        phone: '+919800990404',
        org_id: B.orgId,
        orgId: B.orgId,
        organization_id: B.orgId,
        user_id: 1,
      },
    });
    expect([200, 201], JSON.stringify(res.json)).toContain(res.status);
    const rows = await h.owner.query(`SELECT org_id FROM contacts WHERE phone = '+919800990404'`);
    expect(rows.rows.map((r) => Number(r.org_id))).toEqual([A.orgId]);
    expect(await countOf('contacts', B.orgId)).toBe(bBefore);
    expect(await countOf('contacts', A.orgId)).toBe(aBefore + 1);
  });

  it('AUTHZ-012 tenant B keys (unrestricted and scoped) see tenant A objects exactly as nonexistent ones: same status, same error, no A data, A rows untouched', async () => {
    expect(fx.contacts && fx['contact-groups'] && fx.templates && fx.devices).toBeTruthy();
    // positive control: A really sees its own contact, with the secret fields
    const own = await call('get', `/api/v1/contacts/${fx.contacts}`, { key: kFull.secret });
    expect(own.status).toBe(200);
    expect(own.text).toContain(SECRET_NAME);

    const before: Record<string, string | undefined> = {};
    for (const [seg, uuid] of Object.entries(fx)) before[seg] = await rowHash(FX_TABLE[seg]!, uuid);
    const targets = v1.filter((r) => r.objectIdParams.length > 0 && fx[segmentOf(r)]);
    expect(targets.length).toBeGreaterThan(10);
    const bad: string[] = [];
    const kBScoped = await mintKey(api, B, 'b scoped', [
      'contacts:write',
      'templates:write',
      'deals:write',
      'devices:read',
      'contact-groups:write',
      'broadcasts:write',
    ]);
    for (const key of [kB, kBScoped]) {
      await pool(targets, 4, async (r) => {
        const m = r.method.toLowerCase() as Method;
        const foreign = await call(m, fill(r, { id: fx[segmentOf(r)]! }), { key: key.secret });
        const missing = await call(m, fill(r), { key: key.secret });
        if (isDenied(foreign.status) && foreign.status === 403) return; // scoped key lacking this route's scope
        if (foreign.status >= 200 && foreign.status < 300)
          bad.push(`${r.id} foreign id answered ${foreign.status}: ${foreign.text.slice(0, 120)}`);
        if (
          foreign.status !== missing.status ||
          foreign.json?.error?.code !== missing.json?.error?.code
        )
          bad.push(
            `${r.id} foreign ${foreign.status}/${foreign.json?.error?.code} differs from missing ${missing.status}/${missing.json?.error?.code}`,
          );
        for (const needle of [SECRET_NAME, SECRET_PHONE, SECRET_EMAIL, 'AZ-SECRET-'])
          if (foreign.text.includes(needle)) bad.push(`${r.id} leaked ${needle}`);
      });
    }
    expect(bad).toEqual([]);
    for (const [seg, uuid] of Object.entries(fx))
      expect(await rowHash(FX_TABLE[seg]!, uuid), `${seg} row of tenant A changed`).toBe(
        before[seg],
      );
    if (notSeeded.length) console.warn('AUTHZ-012 fixtures not seeded:', notSeeded.join('; '));
    await api.http().delete(`/v2/developer/keys/${kBScoped.id}`).set(bearer(B.admin));
  }, 1_800_000);

  it('AUTHZ-013 id arrays and references with foreign ids are never applied: foreign recipients, template, group and deal contact do not cross tenants', async () => {
    const bOwn = (await api.seedContacts(B, [{ name: 'B recipient', phone: '+919800990505' }]))[0]!;
    const bTemplate = (
      await h.owner.query(
        `INSERT INTO wa_templates (org_id, template_name, template_body, template_type, status)
         VALUES ($1, 'b_tpl', 'Hello', 'standard', 'approved') RETURNING uuid`,
        [B.orgId],
      )
    ).rows[0].uuid as string;
    const bBroadcasts = await countOf('broadcasts', B.orgId);

    // only foreign recipients: refused, nothing created
    const onlyForeign = await call('post', '/api/v1/broadcasts', {
      key: kB.secret,
      body: { name: 'x', template_id: bTemplate, recipients: [fx.contacts] },
    });
    expect(onlyForeign.status, onlyForeign.text).toBe(422);
    expect(await countOf('broadcasts', B.orgId)).toBe(bBroadcasts);

    // mixed: the foreign id is dropped, never targeted (documented Reference behaviour: "dropped without a word")
    const mixed = await call('post', '/api/v1/broadcasts', {
      key: kB.secret,
      body: { name: 'mixed', template_id: bTemplate, recipients: [bOwn, fx.contacts] },
    });
    expect(mixed.status, mixed.text).toBe(201);
    expect(mixed.json.data.total_recipients).toBe(1);
    const recips = await call('get', `/api/v1/broadcasts/${mixed.json.data.id}/recipients`, {
      key: kB.secret,
    });
    expect(recips.status).toBe(200);
    expect(recips.text).not.toContain(fx.contacts);
    expect(recips.text).not.toContain(SECRET_PHONE);

    // a foreign template or group is refused
    const badTpl = await call('post', '/api/v1/broadcasts', {
      key: kB.secret,
      body: { name: 'x', template_id: fx.templates, recipients: [bOwn] },
    });
    expect(badTpl.status).toBe(422);
    const badGroup = await call('post', '/api/v1/broadcasts', {
      key: kB.secret,
      body: { name: 'x', template_id: bTemplate, group_id: fx['contact-groups'] },
    });
    expect(badGroup.status).toBe(422);
    expect(await countOf('broadcasts', B.orgId)).toBe(bBroadcasts + 1);

    // a deal referencing a foreign contact never links to it
    const deal = await call('post', '/api/v1/deals', {
      key: kB.secret,
      body: { title: 'B deal', contact_id: fx.contacts },
    });
    if (deal.status === 201) expect(deal.json.data.contact_id).toBeNull();
    else expect(deal.status, deal.text).toBeLessThan(500);

    // tenant A's broadcast still holds exactly its own recipient
    if (fx.broadcasts) {
      const mine = await call('get', `/api/v1/broadcasts/${fx.broadcasts}`, { key: kFull.secret });
      expect(mine.json.data.total_recipients).toBe(1);
    }
  });

  it('AUTHZ-013 a list of A never contains B objects (search for B-only data from A returns nothing)', async () => {
    const res = await call('get', '/api/v1/contacts?search=AZ-B-ONLY', { key: kFull.secret });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('AZ-B-ONLY');
    const bView = await call('get', '/api/v1/contacts?search=AZ-B-ONLY', { key: kB.secret });
    expect(bView.text).toContain('AZ-B-ONLY');
    expect(bView.text).not.toContain(SECRET_NAME);
  });
});

// ---- 7. plan feature gate --------------------------------------------------------------------------------------------------------------

describe('AUTHZ-072 the public_api plan feature gates every route', () => {
  it('AUTHZ-072 a workspace without public_api gets the plan error on every route, at once, and regains access the moment it is restored', async () => {
    const P = await api.signup('az-ks-plan');
    await setPlan(P.orgId, OPEN_PLAN);
    const full = await mintKey(api, P, 'plan full');
    const scoped = await mintKey(api, P, 'plan scoped', ['contacts:read']);
    expect((await call('get', '/api/v1/contacts', { key: scoped.secret })).status).toBe(200);

    await setPlan(P.orgId, { ...OPEN_PLAN, features: { public_api: false } });
    const t0 = Date.now();
    const bad: string[] = [];
    await pool(v1, 6, async (r) => {
      const m = r.method.toLowerCase() as Method;
      const res = await call(m, fill(r), { key: full.secret });
      const code = String(res.json?.error?.code ?? '');
      if (!([402, 403, 422] as number[]).includes(res.status) || !/plan/.test(code))
        bad.push(`${r.id} unrestricted -> ${res.status} ${res.text.slice(0, 120)}`);
    });
    // a key with the right scope is gated too; a key lacking the scope is refused for the scope first (no plan information to a key
    // that could not use the route anyway)
    const withScope = await call('get', '/api/v1/contacts', { key: scoped.secret });
    if (!/plan/.test(String(withScope.json?.error?.code)) || withScope.status === 200)
      bad.push(
        `GET /contacts scoped(contacts:read) -> ${withScope.status} ${withScope.text.slice(0, 120)}`,
      );
    const lacking = await call('get', '/api/v1/me', { key: scoped.secret });
    if (lacking.status !== 403) bad.push(`GET /me scoped lacking -> ${lacking.status}`);
    expect(bad).toEqual([]);
    // measured: the flip is effective on the first request (no cache between the plan row and the guard)
    console.info(
      `AUTHZ-072 plan flip to disabled: first request denied, whole sweep took ${Date.now() - t0}ms`,
    );

    // key creation on the staff side is gated by the same feature
    const create = await api
      .http()
      .post('/v2/developer/keys')
      .set(bearer(P.admin))
      .send({ name: 'blocked' });
    expect([402, 403, 422], JSON.stringify(create.body)).toContain(create.status);

    await setPlan(P.orgId, OPEN_PLAN);
    expect((await call('get', '/api/v1/me', { key: full.secret })).status).toBe(200);
    expect((await call('get', '/api/v1/contacts', { key: scoped.secret })).status).toBe(200);
  }, 600_000);
});

// ---- 8. secrecy ------------------------------------------------------------------------------------------------------------------------

describe('AUTHZ-074 key secrecy', () => {
  it('AUTHZ-074 the secret is returned once at creation and never again; list and detail carry no secret or hash', async () => {
    const made = await api
      .http()
      .post('/v2/developer/keys')
      .set(bearer(A.admin))
      .send({ name: 'secrecy', scopes: ['account:read'] });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const secret: string = made.body.secret;
    const digest = createHash('sha256').update(secret, 'utf8').digest('hex');
    expect(secret).toMatch(/^wsk_[A-Za-z0-9]{40}$/);
    expect(Object.keys(made.body.key)).not.toEqual(
      expect.arrayContaining(['secret', 'keyHash', 'key_hash']),
    );

    const list = await api.http().get('/v2/developer/keys?limit=100').set(bearer(A.admin));
    expect(list.status).toBe(200);
    for (const text of [JSON.stringify(list.body), JSON.stringify(made.body.key)]) {
      expect(text).not.toContain(secret);
      expect(text).not.toContain(secret.slice(12));
      expect(text).not.toContain(digest);
      expect(text).not.toMatch(/sha256|key_hash|keyHash|signing/i);
    }
    const revoked = await api
      .http()
      .delete(`/v2/developer/keys/${made.body.key.id}`)
      .set(bearer(A.admin));
    expect(revoked.status).toBe(200);
    for (const text of [JSON.stringify(revoked.body)]) {
      expect(text).not.toContain(secret);
      expect(text).not.toContain(digest);
    }
    // GET one key does not exist; the only reads are the list and the keyed API itself
    expect([404, 405]).toContain(
      (await api.http().get(`/v2/developer/keys/${made.body.key.id}`).set(bearer(A.admin))).status,
    );
  });

  it('AUTHZ-074 the raw secret and its digest appear in no table, audit row, outbox event or Redis value except as the stored hash', async () => {
    const made = await api
      .http()
      .post('/v2/developer/keys')
      .set(bearer(A.admin))
      .set('idempotency-key', `ks-${randomUUID()}`)
      .send({ name: 'scan me' });
    expect(made.status).toBe(201);
    const secret: string = made.body.secret;
    const digest = createHash('sha256').update(secret, 'utf8').digest('hex');
    await call('get', '/api/v1/me', { key: secret });
    await api.http().delete(`/v2/developer/keys/${made.body.key.id}`).set(bearer(A.admin));
    await call('get', '/api/v1/me', { key: secret }); // a failed use after revocation must not log it either

    const tables = (
      await h.owner.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      )
    ).rows.map((r) => r.table_name as string);
    const offenders: string[] = [];
    for (const t of tables) {
      for (const [label, needle] of [
        ['secret', secret],
        ['secret body', secret.slice(4)],
        ['digest', digest],
      ] as const) {
        const hit = await h.owner
          .query(`SELECT count(*)::int AS n FROM "${t}" x WHERE to_jsonb(x)::text LIKE $1`, [
            `%${needle}%`,
          ])
          .then((r) => Number(r.rows[0].n))
          .catch(() => 0);
        if (hit > 0 && !(t === 'api_keys' && label === 'digest'))
          offenders.push(`${t}: ${label} x${hit}`);
      }
    }
    expect(offenders).toEqual([]);

    const redisHits: string[] = [];
    for (const k of await h.redis.keys('*')) {
      const type = await h.redis.type(k);
      const dump =
        type === 'string'
          ? ((await h.redis.get(k)) ?? '')
          : type === 'hash'
            ? JSON.stringify(await h.redis.hgetall(k))
            : type === 'list'
              ? JSON.stringify(await h.redis.lrange(k, 0, -1))
              : '';
      if (k.includes(secret) || dump.includes(secret) || dump.includes(digest))
        redisHits.push(`${k} (${type})`);
    }
    expect(redisHits).toEqual([]);
  });

  it('AUTHZ-074 audit and outbox rows of key events record the action, not the secret, and a failed key attempt records nothing sensitive', async () => {
    const rows = await h.owner.query(
      `SELECT action, delta::text AS d FROM audit_log WHERE org_id = $1 AND module = 'api_keys'`,
      [A.orgId],
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const r of rows.rows) expect(String(r.d)).not.toMatch(/wsk_[A-Za-z0-9]{10,}|sha256\$/);
    const events = await h.owner.query(
      `SELECT payload::text AS p FROM event_outbox WHERE org_id = $1 AND aggregate_module = 'api_keys'`,
      [A.orgId],
    );
    expect(events.rows.length).toBeGreaterThan(0);
    for (const r of events.rows) expect(String(r.p)).not.toMatch(/wsk_[A-Za-z0-9]{10,}|sha256\$/);
    const used = await call('get', '/api/v1/me', { key: kFull.secret });
    expect(used.text).not.toContain(kFull.secret);
    expect(JSON.stringify(used.headers)).not.toContain(kFull.secret);
    const bad = await call('get', '/api/v1/me', { key: 'wsk_' + 'D'.repeat(40) });
    expect(bad.text).not.toContain('D'.repeat(40));
  });
});

// ---- 9. revocation, rate limit, lockout ---------------------------------------------------------------------------------------------

describe('AUTHZ-075 revocation, rate limit and lockout are not bypasses', () => {
  it('AUTHZ-075 revocation is effective on the next request: nothing started after the revoke call returned is served, and there is no key cache', async () => {
    const R = await api.signup('az-ks-revoke');
    await setPlan(R.orgId, OPEN_PLAN);
    const key = await mintKey(api, R, 'in flight');
    const seen: Array<{ startedAt: number; status: number }> = [];
    let stop = false;
    const stream = async () => {
      while (!stop) {
        const startedAt = Date.now();
        const res = await call('get', '/api/v1/me', { key: key.secret });
        seen.push({ startedAt, status: res.status });
      }
    };
    const workers = [stream(), stream(), stream()];
    await new Promise((r) => setTimeout(r, 500));
    const revoke = await api.http().delete(`/v2/developer/keys/${key.id}`).set(bearer(R.admin));
    const revokedAt = Date.now();
    expect(revoke.status).toBe(200);
    await new Promise((r) => setTimeout(r, 600));
    stop = true;
    await Promise.all(workers);

    expect(
      seen.some((s) => s.status === 200),
      'the key worked before the revoke',
    ).toBe(true);
    const leaked = seen.filter((s) => s.startedAt > revokedAt && s.status !== 401);
    expect(leaked, 'requests started after the revoke returned').toEqual([]);
    const lag = Math.max(
      0,
      ...seen.filter((s) => s.status === 200).map((s) => revokedAt - s.startedAt),
    );
    console.info(
      `AUTHZ-075 revocation: ${seen.length} requests; no request started after revoke was served (key lookup reads the database on every call)`,
    );
    expect(lag).toBeGreaterThanOrEqual(0);
    const burst = await Promise.all(
      Array.from({ length: 30 }, () => call('get', '/api/v1/me', { key: key.secret })),
    );
    expect(burst.map((r) => r.status)).toEqual(Array(30).fill(401));
  }, 120_000);

  it('AUTHZ-075 an exhausted rate-limit bucket does not make a revoked key anything but 401, and does not unlock a scope-denied route', async () => {
    const R = await api.signup('az-ks-rate');
    // no -1 override: the key limit is the limit
    await setPlan(R.orgId, { limits: { api_keys: 5 } });
    const key = await mintKey(api, R, 'limited', ['account:read']);
    await h.owner.query(`UPDATE api_keys SET rate_limit_per_minute = 2 WHERE uuid = $1`, [key.id]);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1)
      statuses.push((await call('get', '/api/v1/me', { key: key.secret })).status);
    expect(statuses).toEqual([200, 200, 429, 429]);
    // a route the scope denies is still 403 (the scope is checked before the quota, so denied calls do not spend it)
    expect((await call('get', '/api/v1/contacts', { key: key.secret })).status).toBe(403);
    await api.http().delete(`/v2/developer/keys/${key.id}`).set(bearer(R.admin));
    expect((await call('get', '/api/v1/me', { key: key.secret })).status).toBe(401);
  });

  it('AUTHZ-075 failed-authentication lockout is per address: it blocks the valid key from that address only, and a restricted key stays restricted afterwards', async () => {
    const ip = '10.77.1.1';
    for (const k of await h.redis.keys('apikey:authfail:10.77.1.*')) await h.redis.del(k);
    for (let i = 0; i < 30; i += 1)
      expect((await call('get', '/api/v1/me', { key: 'wsk_' + 'E'.repeat(40), ip })).status).toBe(
        401,
      );
    expect((await call('get', '/api/v1/me', { key: 'wsk_' + 'E'.repeat(40), ip })).status).toBe(
      429,
    );
    expect((await call('get', '/api/v1/me', { key: kFull.secret, ip })).status).toBe(429);
    expect((await call('get', '/api/v1/me', { key: kFull.secret, ip: '10.77.1.2' })).status).toBe(
      200,
    );
    for (const k of await h.redis.keys('apikey:authfail:10.77.1.*')) await h.redis.del(k);
    await setScopes(kScoped, ['contacts:read']);
    expect((await call('get', '/api/v1/me', { key: kScoped.secret, ip })).status).toBe(403);
  });
});
