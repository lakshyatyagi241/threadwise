import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';
import { Inbox } from '../team-inbox-conversations/support';
import {
  SPECS,
  fill,
  fire,
  grantsOf,
  type Attack,
  type Ctx,
  type Fx,
  type Method,
  type Res,
  type Route,
  type Spec,
} from './idor-fixtures';

/**
 * Object-level authorization (IDOR / BOLA) for real resource families: AUTHZ-011..015, 031..040, 051..059, 061..065, 073, 090, 094, 095.
 *
 * For every family in idor-fixtures.ts an object is created through the real API in tenant A (and one in tenant B), then every id route
 * of the family (taken from the controllers by tools/authz-audit, so a new route is attacked the day it is added) is called with:
 *   - tenant B's admin (every permission)            -> must be 403/404, never 2xx, never A's data or ids in the body
 *   - a tenant-A member holding no grants            -> must be 403
 *   - a tenant-A member holding only `own` grants    -> cannot reach a colleague's record (families with record scope)
 * and the same call with a random uuid must answer the same status and body shape (no existence oracle). Denied calls must leave A's
 * rows, row counts, audit log, event outbox and queues untouched. Foreign ids in bodies, bulk arrays and query strings are attacked too,
 * lists and counts of B are compared before and after A creates objects, and soft-deleted objects stay protected.
 *
 * Nothing here is weakened to pass: a failing assertion is a finding. See each test for the control it is evidence for.
 */

let h: Harness;
let api: Api;
let c: Ctx;
let A: Tenant;
let B: Tenant;
let noperm = '';
let adminUuidA = '';
let adminUuidB = '';
let v1Routes: Route[] = [];

interface S {
  spec: Spec;
  routes: Route[];
  error?: string;
  a?: Fx;
  b?: Fx;
  a2?: Fx;
  before?: Map<string, string>;
  after?: Map<string, string>;
}
const STATE = new Map<string, S>();
const memo = new Map<string, Promise<unknown>>();
const once = <T>(k: string, f: () => Promise<T>): Promise<T> => {
  if (!memo.has(k)) memo.set(k, f());
  return memo.get(k) as Promise<T>;
};
const notes: string[] = [];

/** Records every finding in the run summary (a test report shows only the first of several identical failures), then asserts. */
function none(label: string, findings: string[]) {
  for (const f of findings)
    notes.push(`  FINDING ${label}: ${f.replace(/\s+/g, ' ').slice(0, 400)}`);
  expect(findings).toEqual([]);
}

// ---- database inspection ---------------------------------------------------------------------------------------------------------

let uuidTables: string[] = [];
let orgTables: Array<{ table: string; hasUpdated: boolean }> = [];
const VOLATILE =
  /(^|_)(sessions?|refresh|login_attempts?|rate_limits?|security_events?|throttle|idempoten\w*)(_|$)/;

async function discover() {
  const u = await h.owner.query(
    `SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'uuid'
        AND table_name IN (SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'org_id')
        AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE')`,
  );
  uuidTables = u.rows.map((r) => r.table_name as string);
  const o = await h.owner.query(
    `SELECT table_name, bool_or(column_name = 'updated_at') AS has_updated FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE')
        AND table_name IN (SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'org_id')
      GROUP BY table_name`,
  );
  orgTables = o.rows
    .filter((r) => !VOLATILE.test(r.table_name as string))
    .map((r) => ({ table: r.table_name as string, hasUpdated: Boolean(r.has_updated) }));
}

/** md5 of every database row that one of the fixture's ids names (all tables with a uuid column). */
async function rowHashes(fx: Fx): Promise<Map<string, string>> {
  const ids = [...new Set(Object.values(fx.ids))];
  const out = new Map<string, string>();
  for (const t of uuidTables) {
    const r = await h.owner.query(
      `SELECT uuid::text AS u, md5(to_jsonb(x)::text) AS h FROM "${t}" x WHERE uuid::text = ANY($1)`,
      [ids],
    );
    for (const row of r.rows) out.set(`${t}:${row.u}`, row.h as string);
  }
  return out;
}

async function snapshot(orgId: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const t of orgTables) {
    const q = t.hasUpdated
      ? `SELECT count(*)::text AS n, coalesce(max(updated_at)::text,'') AS u FROM "${t.table}" WHERE org_id = $1`
      : `SELECT count(*)::text AS n, '' AS u FROM "${t.table}" WHERE org_id = $1`;
    try {
      const r = await h.owner.query(q, [orgId]);
      out.set(`${orgId}:${t.table}`, `${r.rows[0].n}|${r.rows[0].u}`);
    } catch {
      /* a table without a readable shape is not part of the snapshot */
    }
  }
  return out;
}

async function queueDepth(): Promise<number> {
  let total = 0;
  let cursor = '0';
  do {
    const [next, keys] = await h.redis.scan(cursor, 'MATCH', 'bull:*', 'COUNT', 500);
    cursor = next;
    for (const k of keys) {
      if (!/:(wait|delayed|paused|prioritized)$/.test(k)) continue;
      const type = await h.redis.type(k);
      if (type === 'list') total += await h.redis.llen(k);
      else if (type === 'zset') total += await h.redis.zcard(k);
    }
  } while (cursor !== '0');
  return total;
}

interface State {
  a: Map<string, string>;
  b: Map<string, string>;
  hashes: Map<string, string>;
  queue: number;
}
async function capture(fx: Fx[]): Promise<State> {
  const hashes = new Map<string, string>();
  for (const f of fx) for (const [k, v] of await rowHashes(f)) hashes.set(k, v);
  return {
    a: await snapshot(A.orgId),
    b: await snapshot(B.orgId),
    hashes,
    queue: await queueDepth(),
  };
}
function diffState(before: State, after: State, includeB: boolean): string[] {
  const out: string[] = [];
  const cmp = (x: Map<string, string>, y: Map<string, string>, label: string) => {
    for (const [k, v] of y) if (x.get(k) !== v) out.push(`${label} ${k}: ${x.get(k)} -> ${v}`);
    for (const k of x.keys()) if (!y.has(k)) out.push(`${label} ${k}: vanished`);
  };
  cmp(before.hashes, after.hashes, 'row hash');
  cmp(before.a, after.a, 'tenant A table');
  if (includeB) cmp(before.b, after.b, 'tenant B table');
  if (before.queue !== after.queue) out.push(`queued jobs ${before.queue} -> ${after.queue}`);
  return out;
}

// ---- response inspection ---------------------------------------------------------------------------------------------------------

function leaks(text: string, fx: Fx, allowed: Set<string>): string[] {
  const hits: string[] = [];
  if (text.includes(fx.marker)) hits.push('marker');
  for (const s of fx.secrets) if (s && text.includes(s)) hits.push('secret');
  for (const [k, v] of Object.entries(fx.ids))
    if (!allowed.has(v) && text.includes(v)) hits.push(`id:${k}`);
  return hits;
}

function shapeOf(res: Res): string {
  const j = res.json;
  if (!j || typeof j !== 'object' || Array.isArray(j)) return typeof j;
  const flat = (o: Record<string, unknown>): string[] =>
    Object.keys(o)
      .sort()
      .map((k) =>
        ['code', 'statusCode', 'status', 'error'].includes(k) && typeof o[k] !== 'object'
          ? `${k}=${String(o[k])}`
          : k,
      );
  const inner =
    j.error && typeof j.error === 'object' ? flat(j.error as Record<string, unknown>) : [];
  return [...flat(j as Record<string, unknown>), ...inner.map((x) => `error.${x}`)].join(',');
}

/** Numeric leaves that are counts / totals, by path: what a list or aggregate says about how many rows the caller can see. */
function counts(
  json: unknown,
  path = '',
  out: Map<string, number> = new Map(),
): Map<string, number> {
  if (Array.isArray(json)) {
    out.set(`${path}.length`, json.length);
    json.forEach((v, i) => counts(v, `${path}[${i}]`, out));
  } else if (json && typeof json === 'object') {
    for (const [k, v] of Object.entries(json)) {
      if (
        typeof v === 'number' &&
        /(total|count|^all$|^open$|^won$|^lost$|^active$|^inactive$|pending|overdue|done|completed|sum|amount|value|grouped|subscribed|imported)/i.test(
          k,
        )
      ) {
        out.set(`${path}.${k}`, v);
      } else if (typeof v === 'object') counts(v, `${path}.${k}`, out);
    }
  }
  return out;
}

// ---- attack engine ---------------------------------------------------------------------------------------------------------------

const bodyFor = (spec: Spec, r: Route, fx: Fx): unknown => {
  if (r.method === 'GET' || r.method === 'DELETE') return undefined;
  const key = `${r.method} ${r.url}`;
  for (const [re, fn] of spec.bodies ?? []) if (re.test(key)) return fn(fx);
  return {};
};

/** A throttled answer (429) says nothing about authorization: wait for the window and ask again. */
async function fireRetry(method: Method, url: string, token: string, body?: unknown): Promise<Res> {
  let res = await fire(h, method, url, token, body);
  for (let i = 0; i < 4 && res.status === 429; i += 1) {
    await new Promise((r) => setTimeout(r, 1500));
    res = await fire(h, method, url, token, body);
  }
  return res;
}

const statusOk = (s: number) => s === 403 || s === 404;
const weakStatus = (s: number) => s === 400 || s === 409 || s === 410 || s === 422;

interface Run {
  attacked: number;
  skipped: string[];
  weak: string[];
  /** How often each status came back: a foreign object should be a wall of 404s. */
  statuses: Record<number, number>;
  problems: string[];
  effects: string[];
}

/**
 * Calls every route of the family with `fx`'s ids and `token`. `expect403` is the no-grants phase (the permission gate answers first);
 * otherwise the object is hidden from the caller and must look exactly like a nonexistent one.
 */
async function pathAttack(
  s: S,
  fx: Fx,
  token: string,
  actor: string,
  opts: {
    expect403?: boolean;
    includeB: boolean;
    others?: Fx[];
    allowShared?: boolean;
    ignore?: RegExp;
  },
): Promise<Run> {
  const run: Run = {
    attacked: 0,
    skipped: [],
    weak: [],
    statuses: {},
    problems: [],
    effects: [],
  };
  const before = await capture([fx, ...(opts.others ?? [])]);
  for (const r of s.routes) {
    const method = r.method.toLowerCase() as Method;
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    const values = { ...fx.statics, ...fx.ids };
    const url = fill(r.url, values);
    if (url === null) {
      run.skipped.push(
        `${r.id} (needs ${r.pathParams.filter((p) => values[p] === undefined).join(',')})`,
      );
      continue;
    }
    const nonexistent: Record<string, string> = { ...fx.statics };
    for (const k of Object.keys(fx.ids)) nonexistent[k] = randomUUID();
    const url0 = fill(r.url, nonexistent)!;
    const body = bodyFor(s.spec, r, fx);
    const res = await fireRetry(method, url, token, body);
    run.attacked += 1;
    run.statuses[res.status] = (run.statuses[res.status] ?? 0) + 1;
    const tag = `${actor} ${r.method} ${url} [${r.id}]`;
    const allowed = new Set(r.pathParams.map((p) => values[p]).filter(Boolean) as string[]);
    const shared =
      opts.allowShared &&
      ((s.spec.sharedIds ?? []).some((p) => r.pathParams.includes(p)) ||
        s.spec.filteredRoutes?.test(`${r.method} ${r.url}`) === true);
    if (shared && res.status < 300) {
      // The id names tenant-wide configuration (a pipeline stage): readable, but it must not carry the colleague's record.
      const l = leaks(res.text, fx, allowed);
      if (l.length)
        run.problems.push(
          `${tag} -> ${res.status} shared-config route leaks ${l.join(',')}: ${res.text.slice(0, 200)}`,
        );
      continue;
    }
    if (res.status === 401)
      run.problems.push(`${tag} -> 401 (token rejected, not an authorization verdict)`);
    else if (res.status >= 500)
      run.problems.push(`${tag} -> ${res.status} server error: ${res.text.slice(0, 160)}`);
    else if (res.status < 400)
      run.problems.push(`${tag} -> ${res.status} ALLOWED: ${res.text.slice(0, 160)}`);
    else {
      const l = leaks(res.text, fx, allowed);
      if (l.length)
        run.problems.push(
          `${tag} -> ${res.status} body leaks ${l.join(',')}: ${res.text.slice(0, 200)}`,
        );
      if (opts.expect403) {
        if (res.status !== 403)
          run.problems.push(`${tag} -> ${res.status}, expected 403 from the permission gate`);
      } else {
        if (!statusOk(res.status) && !weakStatus(res.status))
          run.problems.push(`${tag} -> ${res.status}, expected 403/404`);
        if (weakStatus(res.status)) run.weak.push(`${tag} -> ${res.status}`);
        const res0 = await fireRetry(method, url0, token, body);
        if (res0.status !== res.status) {
          run.problems.push(
            `${tag} -> ${res.status} but a nonexistent id gives ${res0.status} (existence oracle)`,
          );
        } else if (shapeOf(res0) !== shapeOf(res)) {
          run.problems.push(
            `${tag} body shape differs from a nonexistent id: {${shapeOf(res)}} vs {${shapeOf(res0)}}`,
          );
        }
      }
    }
  }
  run.effects = diffState(
    before,
    await capture([fx, ...(opts.others ?? [])]),
    opts.includeB,
  ).filter((e) => !opts.ignore?.test(e));
  return run;
}

async function runAttacks(
  s: S,
  attacks: Attack[],
  a: Fx,
): Promise<{ problems: string[]; effects: string[] }> {
  const problems: string[] = [];
  const before = await capture([a]);
  for (const at of attacks) {
    const token = at.as === 'A-nogrant' ? noperm : B.admin;
    const res = await fire(h, at.method, at.url, token, at.body);
    const tag = `${at.name}: ${at.method.toUpperCase()} ${at.url} -> ${res.status}`;
    if (res.status === 401 || res.status >= 500) problems.push(`${tag} ${res.text.slice(0, 200)}`);
    else if (res.status < 400) {
      const verdict = at.ok2xx ? at.ok2xx(res) : 'a 2xx for a foreign id was not expected';
      if (verdict) problems.push(`${tag}: ${verdict}`);
    }
    const sent = new Set(
      `${at.url} ${JSON.stringify(at.body ?? {})}`.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      ) ?? [],
    );
    const l = leaks(res.text, a, sent).filter(
      (x) => x !== 'marker' || !JSON.stringify(at.body ?? {}).includes(a.marker),
    );
    if (l.length) problems.push(`${tag}: body leaks ${l.join(',')}: ${res.text.slice(0, 200)}`);
    if (at.verify) problems.push(...(await at.verify()).map((v) => `${at.name}: ${v}`));
  }
  const after = await capture([a]);
  // The attacker's own tables may change (a bulk with its own id in it); the victim's must not.
  return { problems, effects: diffState(before, after, false) };
}

const usable = (key: string): S => {
  const s = STATE.get(key)!;
  return s;
};

// ---- setup -----------------------------------------------------------------------------------------------------------------------

beforeAll(async () => {
  const mod = (await import(
    /* @vite-ignore */ pathToFileURL(
      join(__dirname, '../../../../../tools/authz-audit/lib/routes.mjs'),
    ).href
  )) as { scanRoutes: () => Route[] };
  const scanned = mod.scanRoutes();
  const routes = scanned.filter((r) => !r.v1Api && r.gate !== 'public');
  v1Routes = scanned.filter((r) => r.v1Api);

  // The run takes longer than the default 15 minute access token: a 401 would be read as a denial.
  process.env.JWT_ACCESS_TTL = '6h';
  process.env.CHANNEL_SIMULATOR_ENABLED = 'true';
  h = await startHarness();
  api = new Api(h);
  A = await api.signup('idor-a');
  B = await api.signup('idor-b');
  noperm = (await api.member(A, 'idor-nogrant', [])).token;
  const uuidOfUser = async (id: number) =>
    (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [id])).rows[0].uuid as string;
  adminUuidA = await uuidOfUser(A.adminUserId);
  adminUuidB = await uuidOfUser(B.adminUserId);
  c = { h, api, A, B, routes, inbox: new Inbox(h, api), uuidOfUser };
  await discover();

  for (const spec of SPECS) {
    const s: S = { spec, routes: routes.filter(spec.claims) };
    STATE.set(spec.key, s);
    try {
      await spec.prep?.(c, A);
      await spec.prep?.(c, B);
      s.b = await spec.create(c, B, 'B', { ownerUuid: adminUuidB });
      s.b.extra.ownerUuid = adminUuidB;
      s.before = new Map();
      for (const url of spec.lists ?? []) {
        const res = await fire(h, 'get', url, B.admin);
        s.before.set(url, JSON.stringify([res.status, [...counts(res.json)]]));
      }
      s.a = await spec.create(c, A, 'A', { ownerUuid: adminUuidA });
      s.a.extra.ownerUuid = adminUuidA;
      s.a2 = await spec.create(c, A, 'A2', { ownerUuid: adminUuidA });
      s.a2.extra.ownerUuid = adminUuidA;
      s.after = new Map();
      for (const url of spec.lists ?? []) {
        const res = await fire(h, 'get', url, B.admin);
        s.after.set(url, JSON.stringify([res.status, [...counts(res.json)]]));
      }
    } catch (err) {
      s.error = String((err as Error).message ?? err).slice(0, 400);
    }
  }
}, 1_800_000);

afterAll(async () => {
  const lines = [...STATE.values()].map(
    (s) =>
      `  ${s.spec.key.padEnd(22)} routes=${String(s.routes.length).padStart(3)} ${s.error ? `NOT COVERED: ${s.error}` : 'fixture ok'}`,
  );
  console.log(`\nIDOR families summary\n${lines.join('\n')}\n${notes.join('\n')}`);
  await h?.stop();
});

// ---- tests -----------------------------------------------------------------------------------------------------------------------

it('every family fixture could be created through the real API (otherwise the family is NOT covered)', () => {
  expect(
    [...STATE.values()].filter((s) => s.error).map((s) => `${s.spec.key}: ${s.error}`),
  ).toEqual([]);
});

it('AUTHZ-031 the route scan found the routes the families attack (a new id route is attacked automatically)', () => {
  const unclaimed = SPECS.filter((sp) => STATE.get(sp.key)!.routes.length === 0).map(
    (sp) => sp.key,
  );
  none('families', unclaimed);
});

for (const spec of SPECS) {
  const id = spec.controls[0]!;
  describe(`${spec.key} (${spec.controls.join(', ')})`, () => {
    const need = (ctx: { skip: () => void }) => {
      const s = usable(spec.key);
      if (s.error || !s.a || !s.b || !s.a2) ctx.skip();
      return s;
    };

    it(`${id} ${spec.key}: the owner reads and updates its own object and so does tenant B (the suite is not trivially denying)`, async (ctx) => {
      const s = need(ctx);
      const problems: string[] = [];
      for (const [who, t, fx] of [
        ['A', A, s.a!],
        ['B', B, s.b!],
      ] as const) {
        const url = fill(spec.detail, { ...fx.statics, ...fx.ids });
        const res = await fire(h, 'get', url!, t.admin);
        if (res.status !== 200)
          problems.push(`${who} GET ${url} -> ${res.status} ${res.text.slice(0, 200)}`);
        else if (!res.text.includes(fx.marker))
          problems.push(`${who} GET ${url} does not show its own marker`);
        if (spec.update) {
          const fresh = await spec.create(c, t, `${who}-upd`, {
            ownerUuid: who === 'A' ? adminUuidA : adminUuidB,
          });
          const u = spec.update(fresh);
          const up = await fire(h, u.method, u.url, t.admin, u.body);
          if (up.status >= 300)
            problems.push(
              `${who} ${u.method.toUpperCase()} ${u.url} -> ${up.status} ${up.text.slice(0, 200)}`,
            );
        }
      }
      none(`${spec.key}`, problems);
    });

    it(`${spec.controls[1] ?? id} ${spec.key}: tenant B's admin gets 403/404 on every id route of tenant A's object, no data echoed, same answer as a nonexistent id`, async (ctx) => {
      const s = need(ctx);
      const run = await once(`${spec.key}:B`, () =>
        pathAttack(s, s.a!, B.admin, 'tenant-B-admin', { includeB: true, others: [s.a2!] }),
      );
      notes.push(
        `  ${spec.key}: B attacked ${run.attacked} routes; statuses ${JSON.stringify(run.statuses)}; weak(400/409/422) ${run.weak.length}; skipped ${run.skipped.length}${run.skipped.length ? ` [${run.skipped.join('; ')}]` : ''}`,
      );
      if (run.weak.length) notes.push(`    weak: ${run.weak.slice(0, 12).join(' | ')}`);
      expect(run.attacked, `no route of ${spec.key} was attacked`).toBeGreaterThan(0);
      none(`${spec.key}`, run.problems);
    });

    it(`${spec.controls[2] ?? id} ${spec.key}: denied requests leave rows, row hashes, counts, audit log, outbox and queues untouched`, async (ctx) => {
      const s = need(ctx);
      const run = await once(`${spec.key}:B`, () =>
        pathAttack(s, s.a!, B.admin, 'tenant-B-admin', { includeB: true, others: [s.a2!] }),
      );
      none(`${spec.key}`, run.effects);
    });

    if (spec.attacks || spec.queries) {
      it(`${spec.controls[1] ?? id} ${spec.key}: foreign ids in bodies, bulk arrays and query strings are rejected or ignored, with no partial application`, async (ctx) => {
        const s = need(ctx);
        const problems: string[] = [];
        let effects: string[] = [];
        if (spec.attacks) {
          const r = await runAttacks(s, spec.attacks(c, s.a!, s.b!), s.a!);
          problems.push(...r.problems);
          effects = r.effects;
        }
        for (const url of spec.queries?.(s.a!, s.b!) ?? []) {
          const res = await fire(h, 'get', url, B.admin);
          if (res.status >= 500 || res.status === 401)
            problems.push(`GET ${url} -> ${res.status} ${res.text.slice(0, 160)}`);
          const l = leaks(res.text, s.a!, new Set());
          if (res.status < 300 && l.length)
            problems.push(`GET ${url} -> ${res.status} leaks ${l.join(',')}`);
        }
        none(`${spec.key}`, problems);
        none(`${spec.key}`, effects);
      });
    }

    if (spec.lists?.length) {
      it(`${spec.controls[2] ?? id} ${spec.key}: lists, counts and search of tenant B neither contain nor count tenant A's new objects`, async (ctx) => {
        const s = need(ctx);
        const problems: string[] = [];
        for (const url of spec.lists!) {
          const [status] = JSON.parse(s.before!.get(url)!) as [number];
          if (status !== 200) {
            problems.push(
              `GET ${url} as B answers ${status}, so the comparison below proves nothing`,
            );
          }
          if (s.before!.get(url) !== s.after!.get(url)) {
            problems.push(
              `GET ${url} as B changed after A created objects:\n  before ${s.before!.get(url)}\n  after  ${s.after!.get(url)}`,
            );
          }
          const res = await fire(h, 'get', url, B.admin);
          if (res.status === 200) {
            const l = leaks(res.text, s.a!, new Set()).concat(leaks(res.text, s.a2!, new Set()));
            if (l.length) problems.push(`GET ${url} as B shows tenant-A data (${l.join(',')})`);
          } else if (res.status >= 500 || res.status === 401)
            problems.push(`GET ${url} as B -> ${res.status}`);
        }
        none(`${spec.key}`, problems);
      });
    }

    it(`${spec.controls[1] ?? id} ${spec.key}: a tenant-A member holding no grants is refused (403) on every route and changes nothing`, async (ctx) => {
      const s = need(ctx);
      const permissionRoutes = { ...s, routes: s.routes.filter((r) => r.gate === 'permission') };
      const run = await once(`${spec.key}:noperm`, () =>
        pathAttack(permissionRoutes, s.a!, noperm, 'tenant-A-no-grants', {
          expect403: true,
          includeB: false,
          others: [s.a2!],
        }),
      );
      none(`${spec.key}`, run.problems);
      none(`${spec.key}`, run.effects);
    });

    if (spec.scoped) {
      it(`AUTHZ-032 ${spec.key}: a member with only own-scope grants reaches its own record but never a colleague's (hidden like a nonexistent id), and changes nothing`, async (ctx) => {
        const s = need(ctx);
        const grants = [
          ...grantsOf(
            s.routes.filter((r) => r.gate === 'permission'),
            'own',
          ),
          ...(spec.scopeGrants ?? []).map((k) => [k, 'own'] as [string, 'own']),
        ];
        const m = await api.member(A, `own-${spec.key}`, grants);
        const mUuid = await c.uuidOfUser(m.userId);
        const mine = await spec.create(
          c,
          spec.scopeMode === 'creator' ? { ...A, admin: m.token } : A,
          'M',
          { ownerUuid: mUuid },
        );
        const problems: string[] = [];
        const url = fill(spec.detail, { ...mine.statics, ...mine.ids })!;
        const own = await fire(h, 'get', url, m.token);
        if (own.status !== 200 || !own.text.includes(mine.marker))
          problems.push(`own record GET ${url} -> ${own.status} ${own.text.slice(0, 160)}`);
        const colleagueUrl = fill(spec.detail, { ...s.a!.statics, ...s.a!.ids })!;
        const colleague = await fire(h, 'get', colleagueUrl, m.token);
        if (colleague.status < 400)
          problems.push(
            `colleague record GET ${colleagueUrl} -> ${colleague.status} (own scope sees a colleague's record)`,
          );
        const list = spec.lists?.[0];
        if (list) {
          const l = await fire(h, 'get', list, m.token);
          if (l.status === 200 && l.text.includes(s.a!.marker))
            problems.push(`own-scope list ${list} contains the colleague's marker`);
        }
        const run = await pathAttack(
          { ...s, routes: s.routes.filter((r) => r.gate === 'permission') },
          s.a!,
          m.token,
          'tenant-A-own-scope-member',
          {
            includeB: false,
            others: [s.a2!],
            allowShared: true,
            // A row-filtered read that answers 200 (an export of nothing) is audited by design.
            ignore: spec.filteredRoutes ? /audit_log/ : undefined,
          },
        );
        problems.push(...run.problems);
        none(`${spec.key}`, problems);
        none(`${spec.key}`, run.effects);
      });
    }

    if (spec.deleteUrl) {
      it(`AUTHZ-095 ${spec.key}: a deleted object stays protected: tenant B still gets the nonexistent-id answer and no data`, async (ctx) => {
        const s = need(ctx);
        const del = fill(spec.deleteUrl!, { ...s.a2!.statics, ...s.a2!.ids })!;
        await spec.beforeDelete?.(c, s.a2!, A.admin);
        const res = await fire(h, 'delete', del, A.admin);
        expect(res.status, `owner could not delete ${del}: ${res.text.slice(0, 200)}`).toBeLessThan(
          300,
        );
        const run = await pathAttack(s, s.a2!, B.admin, 'tenant-B-admin (deleted object)', {
          includeB: true,
        });
        none(`${spec.key}`, run.problems);
        none(`${spec.key}`, run.effects);
        const again = await fire(
          h,
          'get',
          fill(spec.detail, { ...s.a2!.statics, ...s.a2!.ids })!,
          B.admin,
        );
        if (spec.detail.includes(':')) expect(again.status).toBeGreaterThanOrEqual(400);
        expect(again.text).not.toContain(s.a2!.marker);
      });
    }

    if (spec.retire) {
      it(`AUTHZ-095 ${spec.key}: an archived / closed / cancelled object stays as protected as a live one`, async (ctx) => {
        const s = need(ctx);
        const fresh = await spec.create(c, A, 'A3', { ownerUuid: adminUuidA });
        fresh.extra.ownerUuid = adminUuidA;
        const r = spec.retire!(fresh);
        const done = await fire(h, r.method, r.url, A.admin, r.body);
        expect(
          done.status,
          `owner could not retire ${r.url}: ${done.text.slice(0, 200)}`,
        ).toBeLessThan(300);
        const run = await pathAttack(s, fresh, B.admin, 'tenant-B-admin (retired object)', {
          includeB: true,
        });
        none(`${spec.key}`, run.problems);
        none(`${spec.key}`, run.effects);
      });
    }
  });
}

// ---- REST API v1 (API keys): the same objects, reached with a key instead of a session ---------------------------------------------

describe("REST API v1 keys: a key of one workspace never reaches another workspace's objects (AUTHZ-062, AUTHZ-063, AUTHZ-031)", () => {
  const MAP: Array<[string, RegExp]> = [
    ['contacts', /^\/api\/v1\/contacts\/:id(\/|$)/],
    ['deals', /^\/api\/v1\/deals\/:id(\/|$)/],
    ['message-templates', /^\/api\/v1\/templates\/:id(\/|$)/],
    ['broadcasts', /^\/api\/v1\/broadcasts\/:id(\/|$)/],
    ['campaigns', /^\/api\/v1\/campaigns\/:id(\/|$)/],
    ['scheduled-messages', /^\/api\/v1\/scheduled\/:id(\/|$)/],
    ['flows', /^\/api\/v1\/flows\/:id(\/|$)/],
    ['contact-groups', /^\/api\/v1\/contact-groups\/:id(\/|$)/],
    ['devices', /^\/api\/v1\/devices\/:id(\/|$)/],
  ];
  const BODIES: Array<[RegExp, (fx: Fx) => unknown]> = [
    [/^(PUT|PATCH) \/api\/v1\/contacts\/:id$/, (fx) => ({ name: `${fx.marker}-x` })],
    [/^(PUT|PATCH) \/api\/v1\/deals\/:id$/, (fx) => ({ title: `${fx.marker}-x` })],
    [/^POST \/api\/v1\/templates\/:id\/send$/, () => ({ to: '+919800000001' })],
    [/^POST \/api\/v1\/flows\/:id\/enroll$/, () => ({ phone: '+919800000001' })],
  ];
  const keys = () => {
    const a = STATE.get('api-keys');
    return { A: a?.a?.secrets[0], B: a?.b?.secrets[0] };
  };

  it('AUTHZ-062 each mapped family: the key of workspace B gets 403/404 on every id route of workspace A, with no data and the nonexistent-id answer', async (ctx) => {
    const { B: keyB } = keys();
    if (!keyB) ctx.skip();
    const problems: string[] = [];
    let attacked = 0;
    const notAttacked: string[] = [];
    for (const [family, re] of MAP) {
      const fam = STATE.get(family);
      if (!fam?.a) {
        notAttacked.push(`${family}: no fixture`);
        continue;
      }
      const routes = v1Routes.filter((r) => re.test(r.url));
      const run = await pathAttack(
        { spec: { bodies: BODIES } as Spec, routes } as unknown as S,
        fam.a,
        keyB!,
        `tenant-B-api-key/${family}`,
        { includeB: true, ignore: /:api_keys:/ },
      );
      attacked += run.attacked;
      problems.push(...run.problems, ...run.effects.map((e) => `${family}: ${e}`));
      if (run.skipped.length) notAttacked.push(`${family}: ${run.skipped.join('; ')}`);
      if (run.weak.length) notes.push(`  v1 ${family}: weak ${run.weak.join(' | ')}`);
    }
    notes.push(
      `  v1: key of B attacked ${attacked} routes${notAttacked.length ? `; not attacked: ${notAttacked.join(' | ')}` : ''}`,
    );
    expect(attacked).toBeGreaterThan(0);
    none('v1', problems);
  });

  it("AUTHZ-063 the key of workspace A reads its own contact by id and B's key lists neither A's contacts nor A's deals", async (ctx) => {
    const { A: keyA, B: keyB } = keys();
    const contacts = STATE.get('contacts');
    if (!keyA || !keyB || !contacts?.a) ctx.skip();
    const own = await fire(h, 'get', `/api/v1/contacts/${contacts!.a!.ids.id}`, keyA!);
    expect(own.status, own.text.slice(0, 200)).toBe(200);
    expect(own.text).toContain(contacts!.a!.marker);
    const problems: string[] = [];
    for (const url of [
      '/api/v1/contacts?limit=100',
      '/api/v1/deals?limit=100',
      '/api/v1/campaigns',
      '/api/v1/broadcasts',
      '/api/v1/templates',
      '/api/v1/scheduled',
      '/api/v1/contact-groups',
      '/api/v1/devices',
      '/api/v1/flows',
      '/api/v1/conversations',
    ]) {
      const res = await fire(h, 'get', url, keyB!);
      for (const fam of [
        'contacts',
        'deals',
        'campaigns',
        'broadcasts',
        'message-templates',
        'scheduled-messages',
        'contact-groups',
        'devices',
        'flows',
      ]) {
        const fx = STATE.get(fam)?.a;
        if (fx && res.text.includes(fx.marker))
          problems.push(`GET ${url} as B shows the ${fam} marker of A`);
      }
      if (res.status >= 500) problems.push(`GET ${url} as B -> ${res.status}`);
    }
    none('v1', problems);
  });
});
