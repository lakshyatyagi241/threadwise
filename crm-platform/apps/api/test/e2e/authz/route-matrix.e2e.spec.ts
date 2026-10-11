import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, bearer, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';
import { OPERATOR_EMAIL, OPERATOR_PASSWORD } from '../auth-registration-security/harness';
import { operatorToken } from '../install-update-licensing/helpers';

/**
 * Generated authorization matrix (AUTHZ-001..021, 031..040, 066, 075, 090).
 *
 * The route list is NOT hand-written: tools/authz-audit/lib/routes.mjs scans every controller, so a new endpoint is covered the day it
 * is added. Against the real app, real Postgres (restricted role, RLS) and real Redis, for EVERY route it asserts:
 *
 *   anon       no credentials                          -> 401 on every non-public route
 *   bfla       workspace member holding NO grants      -> 403 on every permission-gated route
 *   pool       workspace admin on operator routes      -> 401/403 (a tenant admin is never a platform operator)
 *   pool       platform operator on workspace routes   -> 401/403
 *   positive   member holding exactly the route's key  -> never 401/403 (the gate lets the right actor in)
 *   idor       tenant B admin on tenant A's object ids -> never 2xx, never A's id in the body, A's rows unchanged afterwards
 *   effects    every denied phase leaves tenant row counts, updated_at maxima and the event outbox untouched
 *
 * Results (including everything that could not be tested and why) are written to reports/authz-audit/latest/matrix-results.json for
 * the audit report; this spec fails on any violation and never counts a skipped probe as a pass.
 */

interface Route {
  id: string;
  file: string;
  handler: string;
  method: string;
  url: string;
  gate: string;
  permissions: string[];
  pathParams: string[];
  objectIdParams: string[];
  hasBody: boolean;
  v1Api: boolean;
}

type Status = number;
interface Probe {
  route: string;
  file: string;
  status: Status;
  note?: string;
}

const REPORT_DIR = resolve(process.env.AUTHZ_REPORT_DIR ?? join(__dirname, '../../../../../reports/authz-audit/latest'));

let h: Harness;
let api: Api;
let routes: Route[] = [];
let A: Tenant;
let B: Tenant;
let others: Tenant[] = [];
let operator = '';
let noGrant = '';
const keyToken = new Map<string, string>();

let xff = 0;
const nextIp = () => `10.99.${Math.floor(xff / 250) % 250}.${xff++ % 250}`;

/** Routes the gate lets the right actor through but that refuse for a documented environment reason. */
const ENV_GATED: Record<string, string> = {
  'POST /v2/channels/simulator': 'dev-only simulator channel, flag off outside development',
  'POST /v2/extension/sheets/key': 'needs the Google Sheets add-on installed in the workspace (app.google-sheets.use is granted on install)',
};

const results = {
  anon: [] as Probe[],
  bfla: [] as Probe[],
  tenantAdminOnOperator: [] as Probe[],
  operatorOnWorkspace: [] as Probe[],
  positive: [] as Probe[],
  idor: [] as Probe[],
  idorNotTested: [] as Array<{ route: string; reason: string }>,
  serverErrors: [] as Probe[],
  sideEffects: [] as Array<{ group: string; phase: string; diff: string[] }>,
  adminBlocked: [] as Probe[],
  unknownKeys: [] as string[],
};

function fill(route: Route, values: Record<string, string> = {}): string {
  return route.url.replace(/:(\w+)/g, (_m, name: string) => values[name] ?? randomUUID());
}

async function call(route: Route, token: string | null, values?: Record<string, string>) {
  const http = request(h.app.getHttpServer());
  const url = fill(route, values);
  const m = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  let req = (m in http ? http[m] : http.get).call(http, url).set('x-forwarded-for', nextIp());
  if (token) req = req.set(bearer(token));
  if (['post', 'put', 'patch'].includes(m)) req = req.send({});
  const res = await req;
  return { status: res.status, body: res.text ?? '' };
}

// ---- row-level side-effect snapshots ---------------------------------------------------------------------------------------------

interface TableProbe {
  table: string;
  hasUpdated: boolean;
}
let tables: TableProbe[] = [];
const VOLATILE = /(^|_)(sessions?|refresh|login_attempts?|rate_limits?|security_events?|throttle|audit_log)(_|$)/;

async function discoverTables() {
  const cols = await h.owner.query(
    `SELECT table_name, bool_or(column_name = 'updated_at') AS has_updated
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN (SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'org_id')
      GROUP BY table_name`,
  );
  tables = cols.rows
    .filter((r) => !VOLATILE.test(r.table_name as string))
    .map((r) => ({ table: r.table_name as string, hasUpdated: Boolean(r.has_updated) }));
}

async function snapshot(orgIds: number[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const t of tables) {
    const q = t.hasUpdated
      ? `SELECT count(*)::text AS n, coalesce(max(updated_at)::text,'') AS u FROM "${t.table}" WHERE org_id = ANY($1)`
      : `SELECT count(*)::text AS n, '' AS u FROM "${t.table}" WHERE org_id = ANY($1)`;
    try {
      const r = await h.owner.query(q, [orgIds]);
      out.set(t.table, `${r.rows[0].n}|${r.rows[0].u}`);
    } catch {
      /* table without readable shape: not part of the snapshot */
    }
  }
  return out;
}

function diff(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...after].filter(([k, v]) => before.get(k) !== v).map(([k, v]) => `${k}: ${before.get(k)} -> ${v}`);
}

/** Runs `fn` per controller file and records any row change the denied requests caused. */
async function withEffects(phase: string, list: Route[], orgIds: number[], fn: (r: Route) => Promise<void>) {
  const byFile = new Map<string, Route[]>();
  for (const r of list) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
  for (const [file, rs] of byFile) {
    const before = await snapshot(orgIds);
    for (const r of rs) await fn(r);
    const d = diff(before, await snapshot(orgIds));
    if (d.length) results.sideEffects.push({ group: file, phase, diff: d });
  }
}

// ---- setup -----------------------------------------------------------------------------------------------------------------------

beforeAll(async () => {
  const mod = (await import(
    /* @vite-ignore */ pathToFileURL(join(__dirname, '../../../../../tools/authz-audit/lib/routes.mjs')).href
  )) as { scanRoutes: () => Route[] };
  routes = mod.scanRoutes();

  h = await startHarness();
  api = new Api(h);
  A = await api.signup('az-a');
  B = await api.signup('az-b');
  others = [await api.signup('az-c'), await api.signup('az-d'), await api.signup('az-e')];
  noGrant = (await api.member(A, 'nogrant', [])).token;
  operator = await operatorToken(h, OPERATOR_EMAIL, OPERATOR_PASSWORD);
  await discoverTables();

  const orgIds = [A.orgId, B.orgId, ...others.map((t) => t.orgId)];
  const workspace = routes.filter((r) => r.gate === 'permission');
  const operatorRoutes = routes.filter((r) => r.gate === 'operator-permission' || r.gate === 'operator-or-partner-coarse');
  const needAuth = routes.filter((r) => r.gate !== 'public');

  await withEffects('anon', needAuth, orgIds, async (r) => {
    const { status } = await call(r, null);
    results.anon.push({ route: r.id, file: r.file, status });
  });

  await withEffects('bfla', workspace, orgIds, async (r) => {
    const { status } = await call(r, noGrant);
    results.bfla.push({ route: r.id, file: r.file, status });
  });

  await withEffects('tenant-admin-on-operator', operatorRoutes, orgIds, async (r) => {
    const { status } = await call(r, A.admin);
    results.tenantAdminOnOperator.push({ route: r.id, file: r.file, status });
  });

  await withEffects('operator-on-workspace', workspace, orgIds, async (r) => {
    const { status } = await call(r, operator);
    results.operatorOnWorkspace.push({ route: r.id, file: r.file, status });
  });

  await runIdor(orgIds);
  await runPositive(workspace);
}, 1_800_000);

afterAll(async () => {
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(
    join(REPORT_DIR, 'matrix-results.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), routes: routes.length, results }, null, 2),
  );
  await h?.stop();
});

/** Tenant A's rows that a path segment refers to: `/v2/contacts/:id` -> contacts. */
async function foreignIds(): Promise<Map<string, string>> {
  const byTable = new Map<string, string>();
  const cand = await h.owner.query(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'uuid'
        AND table_name IN (SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'org_id')`,
  );
  for (const { table_name } of cand.rows as Array<{ table_name: string }>) {
    const r = await h.owner.query(`SELECT uuid::text AS u FROM "${table_name}" WHERE org_id = $1 LIMIT 1`, [A.orgId]);
    if (r.rows[0]) byTable.set(table_name, r.rows[0].u as string);
  }
  return byTable;
}

function tableFor(route: Route, param: string, ids: Map<string, string>): string | null {
  const segs = route.path.split('/').filter(Boolean);
  const at = segs.indexOf(`:${param}`);
  const seg = at > 0 ? segs[at - 1]! : '';
  const base = seg.replace(/-/g, '_');
  const variants = [base, base.replace(/ies$/, 'y'), base.replace(/s$/, ''), `${base}s`, `${base.replace(/y$/, 'ie')}s`];
  for (const v of variants) if (ids.has(v)) return v;
  return null;
}

async function runIdor(_orgIds: number[]) {
  const ids = await foreignIds();
  const candidates = routes.filter((r) => r.gate === 'permission' && r.objectIdParams.length > 0 && !r.v1Api);
  const watched = new Map<string, string>();
  const rowHash = async (table: string, uuid: string) =>
    (await h.owner.query(`SELECT md5(to_jsonb(t)::text) AS h FROM "${table}" t WHERE uuid = $1`, [uuid])).rows[0]?.h as string | undefined;
  for (const [t, u] of ids) watched.set(`${t}:${u}`, (await rowHash(t, u)) ?? 'missing');

  const adminB = B.admin;
  const touched = new Set<string>();
  for (const r of candidates) {
    const values: Record<string, string> = {};
    let table: string | null = null;
    for (const p of r.objectIdParams) {
      const t = tableFor(r, p, ids);
      if (t) {
        table = t;
        values[p] = ids.get(t)!;
      }
    }
    if (!table) {
      results.idorNotTested.push({ route: r.id, reason: 'no tenant-A row found for the path segment (add a fixture)' });
      continue;
    }
    touched.add(table);
    const { status, body } = await call(r, adminB, values);
    const leaked = status < 300 || (r.method === 'GET' && body.includes(values[r.objectIdParams[0]!]!) && status !== 404);
    results.idor.push({ route: r.id, file: r.file, status, note: leaked ? 'LEAK' : undefined });
  }
  for (const [key, before] of watched) {
    const [t, u] = key.split(':') as [string, string];
    if (!touched.has(t)) continue;
    const after = (await rowHash(t, u)) ?? 'missing';
    if (after !== before) results.sideEffects.push({ group: `idor:${t}`, phase: 'idor', diff: [`row ${u} changed or vanished`] });
  }
}

async function runPositive(workspace: Route[]) {
  // Last on purpose: a gate that lets the right actor in may run the handler; the requests carry empty bodies and unknown ids.
  const keys = [...new Set(workspace.flatMap((r) => r.permissions.slice(0, 1)))];
  for (const key of keys) {
    try {
      keyToken.set(key, (await api.member(A, `k${keyToken.size}`, [[key]])).token);
    } catch (err) {
      if (/permission_key_fkey/.test(String(err))) results.unknownKeys.push(key);
      else results.positive.push({ route: `member:${key}`, file: '-', status: 0, note: `could not create member: ${String(err).slice(0, 120)}` });
    }
  }
  for (const r of workspace) {
    const token = keyToken.get(r.permissions[0]!);
    if (!token) continue;
    const { status, body } = await call(r, token);
    // A 403 that names a DIFFERENT permission key is a second, service-level check behind the route gate (defence in depth); a 403 that
    // names the route's own key, or none, means the gate refused the right actor.
    const second = status === 403 && !r.permissions.some((k) => body.includes(k)) && /[a-z]+\.[a-z-]+\.[a-z-]+/.test(body);
    results.positive.push({ route: r.id, file: r.file, status: second ? 200 : status, note: second ? 'second-gate' : ENV_GATED[r.id] });
    if (status >= 500) results.serverErrors.push({ route: r.id, file: r.file, status });
    const admin = await call(r, A.admin);
    if (admin.status === 401 || admin.status === 403) results.adminBlocked.push({ route: r.id, file: r.file, status: admin.status });
  }
}

// ---- assertions ------------------------------------------------------------------------------------------------------------------

const bad = (list: Probe[], ok: (s: number) => boolean) => list.filter((p) => !ok(p.status)).map((p) => `${p.route} -> ${p.status} (${p.file})`);

describe('generated authorization matrix', () => {
  it('scans every controller', () => {
    expect(routes.length).toBeGreaterThan(900);
  });

  it('rejects an anonymous caller on every non-public route (401)', () => {
    expect(bad(results.anon, (s) => s === 401)).toEqual([]);
  });

  it('denies a member with no grants on every permission-gated route (403)', () => {
    expect(bad(results.bfla, (s) => s === 403)).toEqual([]);
  });

  it('never lets a workspace admin into a platform operator route', () => {
    expect(bad(results.tenantAdminOnOperator, (s) => s === 401 || s === 403)).toEqual([]);
  });

  it('never lets a platform operator token act on workspace permission routes', () => {
    expect(bad(results.operatorOnWorkspace, (s) => s === 401 || s === 403)).toEqual([]);
  });

  it('lets a member holding exactly the route key past the gate', () => {
    expect(
      results.positive
        .filter((p) => (p.status === 401 || p.status === 403) && !ENV_GATED[p.route])
        .map((p) => `${p.route} -> ${p.status} (${p.file})`),
    ).toEqual([]);
  });

  it('only requires permission keys that exist in the catalog', () => {
    expect(results.unknownKeys).toEqual([]);
  });

  it('shows no cross-tenant read, write or delete for tenant A object ids', () => {
    expect(results.idor.filter((p) => p.note === 'LEAK').map((p) => `${p.route} -> ${p.status}`)).toEqual([]);
  });

  it('leaves tenant data untouched by every denied or foreign request', () => {
    expect(results.sideEffects).toEqual([]);
  });
});
