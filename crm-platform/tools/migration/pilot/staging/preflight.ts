#!/usr/bin/env tsx
/**
 * Preflight for the Waboo -> crm-platform migration tool: is THIS database ready for it? Read-only (every session is
 * `default_transaction_read_only = on`), fails closed, never prints a connection string or a password.
 *
 *   tsx pilot/staging/preflight.ts [--org-slug S] [--client C] [--org-plan P] [--after-init] [--skip-partitions]
 *        [--expect-role crm_worker_user] [--migrations-dir DIR] [--allow-target-host H] [--allow-docker-host H] [--confirm-db-name N]
 *
 * Env: TARGET_DATABASE_URL (the worker login: what the tool writes with) and MIGRATION_DATABASE_URL (the owner: only READ, for the
 * `_migrations` ledger, which the worker may not see). Exit 0 = every check PASS (WARN/INFO do not fail), 1 = at least one FAIL, 2 = usage.
 *
 *   a migrations   every packages/db/migrations file is recorded in `_migrations` (checksum too); none missing or edited (extra = database ahead of the checkout: a WARN, schema check b decides)
 *   b schema       every table and column the tool writes exists with an assignable type; no NOT NULL column without a default is left unwritten
 *   c rls          RLS enabled AND forced, tenant policy (current_org_id()) on every tenant table the tool writes
 *   d role         the login is crm_worker_user, not a superuser, cannot bypass RLS, may write the tables and call ensure_monthly_partition
 *   e server       max_connections, statement_timeout, shared_buffers ... (not a replica; connection headroom)
 *   f pgvector     extension `vector` is installed
 *   g migration    the tool's own `migration` schema: absent = needs `init` (fails with --after-init), present = columns and grants
 *   h org          no organization with the planned slug (or the client's deterministic organization uuid: a resume)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { acceptedChecksums } from '../../../../packages/db/src/checksum';
import { assertTargetAllowed, DDL } from '../../load/db';
import { normalizeSlug, ORG_COLLECTION } from '../../load/org';
import { STEPS } from '../../transform';
import { uuidv5 } from '../../util';
import * as inboxLoader from '../../load/inbox';
import raw from './raw-writes.json';
import type { RawWrites } from './raw-writes';
import type { TableSpec } from '../../transform/types';

export type Status = 'PASS' | 'FAIL' | 'WARN' | 'INFO';
export interface Check {
  id: string;
  name: string;
  status: Status;
  details: string[];
}
export interface MigrationRef {
  id: string;
  accepted: string[];
}

/** Injected by bundle.mjs: the migration ids + accepted checksums of the checkout the bundle was built from. */
declare const __EMBEDDED_MIGRATIONS__: MigrationRef[] | undefined;

export interface PreflightOptions {
  targetUrl: string;
  ownerUrl?: string;
  /** The files the database must have applied: a directory (the image's own migrations), else the embedded list. */
  migrationsDir?: string;
  expectRole?: string;
  orgSlug?: string;
  client?: string;
  orgPlan?: string;
  afterInit?: boolean;
  skipPartitions?: boolean;
  /** Extra expectations, for tests. */
  embedded?: MigrationRef[] | null;
  tool?: { steps: typeof STEPS; raw: RawWrites };
}

const safe = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e))
    .split('\n')[0]!
    .replace(/[a-z]+:\/\/\S+/gi, '<url>')
    .slice(0, 300);

async function open(url: string): Promise<Client> {
  // a read-only session: nothing this program sends can write, whatever the role may do
  const c = new Client({
    connectionString: url,
    options: '-c default_transaction_read_only=on',
    application_name: 'migration-preflight',
    connectionTimeoutMillis: 10_000,
  });
  await c.connect();
  return c;
}

/** The server's own statement_timeout (before this program lowers it for its queries). */
async function serverTimeout(c: Client): Promise<string> {
  const v = (await c.query('SHOW statement_timeout')).rows[0].statement_timeout as string;
  await c.query('SET statement_timeout = 30000');
  return v;
}

// --- what the tool writes, derived from the code --------------------------------------------------------------------------------

export interface Wanted {
  table: string;
  /** column -> postgres type the loader reads it as (undefined = existence only: a hand-written statement) */
  columns: Map<string, string | undefined>;
  /** the column list is complete (a TableSpec insert), so an unwritten NOT NULL column is a real problem */
  complete: boolean;
}

/** The modules a `specs` entry of raw-writes.json may point into (a new one fails the preflight and the test, never passes silently). */
const SPEC_MODULES: Record<string, Record<string, unknown>> = { 'load/inbox': inboxLoader };

export function wantedWrites(
  steps: typeof STEPS = STEPS,
  rawWrites: RawWrites = raw as RawWrites,
): Wanted[] {
  const out = new Map<string, Wanted>();
  const get = (t: string): Wanted => {
    let w = out.get(t);
    if (!w) out.set(t, (w = { table: t, columns: new Map(), complete: false }));
    return w;
  };
  const custom = new Set<string>();
  for (const s of steps) {
    for (const [table, spec] of Object.entries(s.tables)) {
      const w = get(table);
      w.complete = true; // a TableSpec insert names every column it writes
      if (spec.custom) custom.add(table);
      w.columns.set('org_id', 'bigint');
      if (!spec.noUuid && !spec.keyless && !spec.custom) w.columns.set('uuid', 'uuid');
      if (spec.custom) w.columns.set('id', 'bigint');
      if (spec.keyless) w.columns.set(spec.keyless.parentCol, 'bigint');
      for (const c of spec.columns) w.columns.set(c.name, c.pg);
    }
  }
  for (const t of custom) get(t).complete = false; // a loader-written table (partitioned usage tables): its own SQL, columns checked, none "required"
  for (const [table, ref] of Object.entries(rawWrites.specs)) {
    const [mod, name] = ref.split(':') as [string, string];
    const spec = SPEC_MODULES[mod]?.[name] as TableSpec | undefined;
    if (!spec)
      throw new Error(
        `raw-writes.json: ${ref} (table ${table}) cannot be resolved: regenerate it and extend SPEC_MODULES`,
      );
    const w = get(table);
    w.complete = true;
    w.columns.set('org_id', 'bigint');
    w.columns.set('uuid', 'uuid');
    for (const c of spec.columns) w.columns.set(c.name, c.pg);
  }
  for (const [table, cols] of Object.entries(rawWrites.sql)) {
    const w = get(table);
    for (const c of cols) if (!w.columns.has(c)) w.columns.set(c, undefined);
  }
  return [...out.values()].sort((a, b) => a.table.localeCompare(b.table));
}

const UDT: Record<string, string[]> = {
  text: ['text', 'varchar', 'bpchar', 'citext'],
  citext: ['citext', 'text', 'varchar'],
  bigint: ['int8'],
  integer: ['int4', 'int8'],
  smallint: ['int2', 'int4', 'int8'],
  boolean: ['bool'],
  timestamptz: ['timestamptz'],
  jsonb: ['jsonb'],
  date: ['date'],
  time: ['time', 'timetz'],
  numeric: ['numeric'],
  uuid: ['uuid'],
};

// --- the checks -----------------------------------------------------------------------------------------------------------------

function migrationFiles(dir: string): MigrationRef[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({
      id: f.replace(/\.sql$/, ''),
      accepted: acceptedChecksums(readFileSync(join(dir, f), 'utf8')),
    }));
}

const MIGRATION_DIRS = [
  '/app/migrations',
  '/app/node_modules/@crm/db/migrations',
  resolve(__dirname, '../../../../packages/db/migrations'),
];

async function checkMigrations(o: PreflightOptions, owner: Client | null): Promise<Check> {
  const c: Check = { id: 'a', name: 'migrations', status: 'PASS', details: [] };
  const fail = (m: string): void => {
    c.status = 'FAIL';
    c.details.push(m);
  };
  const emb =
    o.embedded !== undefined
      ? o.embedded
      : typeof __EMBEDDED_MIGRATIONS__ !== 'undefined'
        ? __EMBEDDED_MIGRATIONS__
        : null;
  const dir = o.migrationsDir ?? MIGRATION_DIRS.find((d) => existsSync(d));
  let expected: MigrationRef[];
  if (dir && existsSync(dir)) {
    expected = migrationFiles(dir);
    c.details.push(`expected: ${expected.length} files from ${dir}`);
    if (emb) {
      const a = new Set(emb.map((m) => m.id));
      const b = new Set(expected.map((m) => m.id));
      const d = [...a].filter((x) => !b.has(x)).concat([...b].filter((x) => !a.has(x)));
      if (d.length) {
        c.status = 'WARN';
        c.details.push(
          `WARN the bundle was built from a different checkout than this directory (differs: ${d.slice(0, 5).join(', ')}${d.length > 5 ? ' ...' : ''}); the directory wins`,
        );
      }
    }
  } else if (emb) {
    expected = emb;
    c.details.push(
      `expected: ${expected.length} files embedded in this bundle (no migrations directory found)`,
    );
  } else {
    fail('no migrations directory and no embedded list to compare with (pass --migrations-dir)');
    return c;
  }
  if (!owner) {
    fail(
      'cannot read the migration ledger: the worker login may not read _migrations and MIGRATION_DATABASE_URL (owner, read-only use) is not set',
    );
    return c;
  }
  const t = await owner.query(`SELECT to_regclass('public._migrations') IS NOT NULL AS ok`);
  if (!t.rows[0].ok) {
    fail(
      'the tracking table _migrations does not exist: this database was not migrated with the packages/db migrate CLI, so its schema cannot be verified',
    );
    return c;
  }
  const applied = new Map<string, string>(
    (await owner.query('SELECT id, checksum FROM _migrations')).rows.map(
      (r: { id: string; checksum: string }) => [r.id, r.checksum],
    ),
  );
  const exp = new Map(expected.map((m) => [m.id, m]));
  const missing = [...exp.keys()].filter((id) => !applied.has(id));
  const extra = [...applied.keys()].filter((id) => !exp.has(id));
  const edited = [...exp.values()]
    .filter((m) => applied.has(m.id) && !m.accepted.includes(applied.get(m.id)!))
    .map((m) => m.id);
  const list = (xs: string[]): string =>
    xs.slice(0, 10).join(', ') + (xs.length > 10 ? ` ... (+${xs.length - 10})` : '');
  if (missing.length) {
    fail(`${missing.length} migration(s) NOT applied: ${list(missing)}`);
    fail(
      'the server is BEHIND this checkout (or the bundle was built from a newer revision than the deployed image): new migrations only reach it when ship.sh deploys. Do NOT run the loader until the server is deployed to the same revision as this bundle. Only if you have verified (git diff of the missing files) that none of them touches a table or column the tool writes (check b/c below pass) may you proceed, and say so in the approval record.',
    );
  }
  if (extra.length) {
    // The database is AHEAD of this checkout (someone applied newer migrations, or the image is older than the database). That alone
    // cannot make the loader write a wrong value: check b below compares every table, column and type the loader writes with the live
    // database and fails when one of them is gone or changed. So this is a warning, not a stop. BEHIND (missing) and EDITED stay failures.
    if (c.status === 'PASS') c.status = 'WARN';
    c.details.push(
      `WARN ${extra.length} applied migration(s) with no file here (database is ahead of this checkout; the schema check b decides whether that matters): ${list(extra)}`,
    );
  }
  if (edited.length)
    fail(
      `${edited.length} applied migration(s) whose checksum differs from the file: ${list(edited)}`,
    );
  c.details.push(`applied: ${applied.size}`);
  return c;
}

async function checkSchema(db: Client, wanted: Wanted[]): Promise<Check> {
  const c: Check = { id: 'b', name: 'schema', status: 'PASS', details: [] };
  const rows = (
    await db.query(
      `SELECT c.relname AS t, a.attname AS col, ty.typname AS udt, a.attnotnull AS notnull,
              (a.atthasdef OR a.attidentity <> '' OR a.attgenerated <> '') AS has_def
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       JOIN pg_type ty ON ty.oid = a.atttypid
       WHERE c.relkind IN ('r','p')`,
    )
  ).rows as Array<{ t: string; col: string; udt: string; notnull: boolean; has_def: boolean }>;
  const by = new Map<string, Map<string, (typeof rows)[number]>>();
  for (const r of rows) (by.get(r.t) ?? by.set(r.t, new Map()).get(r.t)!).set(r.col, r);
  let cols = 0;
  for (const w of wanted) {
    const t = by.get(w.table);
    if (!t) {
      c.status = 'FAIL';
      c.details.push(`table ${w.table}: MISSING`);
      continue;
    }
    for (const [col, pg] of w.columns) {
      cols++;
      const r = t.get(col);
      if (!r) {
        c.status = 'FAIL';
        c.details.push(`${w.table}.${col}: MISSING`);
      } else if (pg && !(UDT[pg] ?? [pg]).includes(r.udt) && r.udt !== pg) {
        c.status = 'FAIL';
        c.details.push(`${w.table}.${col}: type ${r.udt}, the loader writes ${pg}`);
      }
    }
    if (w.complete) {
      for (const [col, r] of t) {
        if (r.notnull && !r.has_def && !w.columns.has(col)) {
          c.status = 'FAIL';
          c.details.push(
            `${w.table}.${col}: NOT NULL with no default, and the tool never writes it (every insert would fail)`,
          );
        }
      }
    }
  }
  c.details.unshift(`${wanted.length} tables, ${cols} columns checked`);
  return c;
}

async function checkRls(db: Client, wanted: Wanted[]): Promise<Check> {
  const c: Check = { id: 'c', name: 'rls', status: 'PASS', details: [] };
  const cls = (
    await db.query(
      `SELECT c.relname AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
              EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped) AS has_org,
              COALESCE((SELECT array_agg(p.polname || '|' || p.polcmd::text || '|' || COALESCE(pg_get_expr(p.polqual, p.polrelid), '') || '|' || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), ''))
                        FROM pg_policy p WHERE p.polrelid = c.oid AND p.polpermissive), '{}') AS pol
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE c.relkind IN ('r','p')`,
    )
  ).rows as Array<{ t: string; rls: boolean; forced: boolean; has_org: boolean; pol: string[] }>;
  const by = new Map(cls.map((r) => [r.t, r]));
  let n = 0;
  for (const w of wanted) {
    const r = by.get(w.table);
    if (!r) continue; // reported by (b)
    if (!r.has_org && w.table !== 'organizations') {
      c.details.push(`${w.table}: no org_id column, not a tenant table (skipped)`);
      continue;
    }
    n++;
    const bad: string[] = [];
    if (!r.rls) bad.push('RLS not enabled');
    if (!r.forced) bad.push('RLS not FORCED (the table owner would bypass it)');
    // the tenant policy: permissive, applies to writes (ALL or INSERT) and reads the tenant GUC through current_org_id()
    const tenant = r.pol.filter((p) => {
      const [, cmd, using, check] = p.split('|');
      return (cmd === '*' || cmd === 'a') && /current_org_id\(\)/.test(`${using}${check}`);
    });
    if (tenant.length === 0) bad.push('no policy for all commands using current_org_id()');
    else if (!tenant.some((p) => p.split('|').slice(2).join('|').includes('current_org_id()')))
      bad.push('tenant policy does not check current_org_id()');
    if (bad.length) {
      c.status = 'FAIL';
      c.details.push(`${w.table}: ${bad.join('; ')}`);
    }
  }
  c.details.unshift(`${n} tenant tables checked (enabled + forced + tenant policy)`);
  return c;
}

async function checkRole(db: Client, o: PreflightOptions, wanted: Wanted[]): Promise<Check> {
  const c: Check = { id: 'd', name: 'role', status: 'PASS', details: [] };
  const expect = o.expectRole ?? 'crm_worker_user';
  const me = (
    await db.query(
      `SELECT current_user AS u, session_user AS s, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
              pg_has_role(current_user, 'crm_worker', 'member') AS worker_member
       FROM pg_roles r WHERE r.rolname = current_user`,
    )
  ).rows[0];
  c.details.push(`connected as role ${me.u}${me.s !== me.u ? ` (session ${me.s})` : ''}`);
  if (me.u !== expect) {
    c.status = 'FAIL';
    c.details.push(`the tool must write as ${expect}, this login is ${me.u}`);
  }
  if (me.rolsuper) {
    c.status = 'FAIL';
    c.details.push('the role is a SUPERUSER: it bypasses RLS completely');
  }
  if (me.rolbypassrls) {
    c.status = 'FAIL';
    c.details.push('the role has BYPASSRLS: it bypasses RLS completely');
  }
  if (!me.worker_member) {
    c.status = 'FAIL';
    c.details.push(
      'the role is not a member of crm_worker (no table grants through the group role)',
    );
  }
  const own = (
    await db.query(
      `SELECT count(*)::int AS n FROM pg_class c WHERE c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) AND c.relnamespace = 'public'::regnamespace`,
    )
  ).rows[0].n;
  if (own > 0) {
    c.status = 'FAIL';
    c.details.push(
      `the role OWNS ${own} tables in public (an owner is subject to RLS only where FORCE is set)`,
    );
  }
  const lacking: string[] = [];
  const noUpdate: string[] = [];
  for (const w of wanted) {
    const t = `public.${w.table}`;
    const ex = (await db.query('SELECT to_regclass($1) IS NOT NULL AS ex', [t])).rows[0]
      .ex as boolean;
    if (!ex) continue;
    const p = (
      await db.query(
        `SELECT has_table_privilege(current_user, $1, 'SELECT') AS s, has_table_privilege(current_user, $1, 'INSERT') AS i, has_table_privilege(current_user, $1, 'UPDATE') AS u`,
        [t],
      )
    ).rows[0];
    if (!p.s || !p.i)
      lacking.push(
        `${w.table}(${!p.s ? 'SELECT ' : ''}${!p.i ? 'INSERT' : ''})`.replace(' )', ')'),
      );
    else if (!p.u) noUpdate.push(w.table);
  }
  if (lacking.length) {
    c.status = 'FAIL';
    c.details.push(`missing privileges on: ${lacking.join(', ')}`);
  }
  if (noUpdate.length)
    c.details.push(`INFO no UPDATE on: ${noUpdate.join(', ')} (fine unless the tool updates them)`);
  const fn = (
    await db.query(
      `SELECT to_regprocedure('ensure_monthly_partition(regclass,date)') IS NOT NULL AS ex,
              to_regprocedure('provision_workspace_presets(bigint)') IS NOT NULL AS prov`,
    )
  ).rows[0];
  if (!fn.prov) {
    c.status = 'FAIL';
    c.details.push(
      'function provision_workspace_presets(bigint) does not exist (the owner login creates the organization with it)',
    );
  }
  if (!fn.ex) {
    c.status = 'FAIL';
    c.details.push('function ensure_monthly_partition(regclass,date) does not exist');
  } else {
    // the very check the inbox and credits steps make themselves: a privilege lookup, nothing is created
    const ok = (
      await db.query(
        `SELECT has_function_privilege('ensure_monthly_partition(regclass,date)', 'EXECUTE') AS ok`,
      )
    ).rows[0].ok;
    if (!ok) {
      if (o.skipPartitions)
        c.details.push(
          'INFO EXECUTE on ensure_monthly_partition is missing (inbox/credits steps are skipped: --skip-partitions)',
        );
      else {
        c.status = 'FAIL';
        c.details.push(
          'the role may not EXECUTE ensure_monthly_partition(regclass,date): the inbox and credits steps would stop before writing',
        );
      }
    } else
      c.details.push(
        'EXECUTE on ensure_monthly_partition: yes (checked by privilege lookup, nothing created)',
      );
  }
  return c;
}

const bytes = (v: string): number => {
  const m = /^(\d+)\s*(B|kB|MB|GB|TB)?$/.exec(v.trim());
  return m
    ? Number(m[1]) *
        ({ B: 1, kB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 }[m[2] ?? 'B'] ?? 1)
    : 0;
};
const ms = (v: string): number => {
  const m = /^(\d+)\s*(us|ms|s|min|h|d)?$/.exec(v.trim());
  return m
    ? Number(m[1]) *
        ({ us: 0.001, ms: 1, s: 1000, min: 60000, h: 3600000, d: 86400000 }[m[2] ?? 'ms'] ?? 1)
    : 0;
};

async function checkServer(db: Client, stDefault: string): Promise<Check> {
  const c: Check = { id: 'e', name: 'server', status: 'PASS', details: [] };
  const names = [
    'server_version',
    'max_connections',
    'shared_buffers',
    'work_mem',
    'maintenance_work_mem',
    'statement_timeout',
    'idle_in_transaction_session_timeout',
    'lock_timeout',
    'max_wal_size',
  ];
  const s = new Map<string, { setting: string; unit: string | null }>(
    (
      await db.query(
        'SELECT name, current_setting(name) AS setting, unit FROM pg_settings WHERE name = ANY($1)',
        [names],
      )
    ).rows.map((r: { name: string; setting: string; unit: string | null }) => [
      r.name,
      { setting: r.setting, unit: null },
    ]),
  );
  const show = (n: string): string =>
    n === 'statement_timeout' ? stDefault : (s.get(n)?.setting ?? '?');
  c.details.push(names.map((n) => `${n}=${show(n)}`).join(' '));
  const mc = Number(s.get('max_connections')?.setting);
  const used = (await db.query('SELECT count(*)::int AS n FROM pg_stat_activity')).rows[0]
    .n as number;
  if (!(mc >= 20)) {
    c.status = 'FAIL';
    c.details.push(
      `max_connections=${mc}: the tool opens up to 9 sessions (two pools of 4 and a lock session)`,
    );
  } else if (mc - used < 12) {
    c.status = 'FAIL';
    c.details.push(
      `only ${mc - used} free connection slots (${used}/${mc} in use): the tool needs about 10`,
    );
  }
  if ((await db.query('SELECT pg_is_in_recovery() AS r')).rows[0].r) {
    c.status = 'FAIL';
    c.details.push('this server is a read-only replica (pg_is_in_recovery)');
  }
  if (stDefault !== '0')
    c.details.push(
      `INFO statement_timeout=${stDefault} is the login's default; the tool sets its own 600000ms per session`,
    );
  const sb = bytes(s.get('shared_buffers')?.setting ?? '0');
  if (sb > 768 * 1024 * 1024) {
    c.details.push(
      `WARN shared_buffers=${Math.round(sb / 1048576)}MB leaves little of a 1 GB container for the tool's batches`,
    );
    if (c.status === 'PASS') c.status = 'WARN';
  }
  const ii = ms(s.get('idle_in_transaction_session_timeout')?.setting ?? '0');
  if (ii > 0 && ii < 600_000) {
    c.details.push(
      `WARN idle_in_transaction_session_timeout=${ii}ms: a --dry-run holds one transaction open for the whole run and can be cut off`,
    );
    if (c.status === 'PASS') c.status = 'WARN';
  }
  c.details.push('free disk and memory of the host are out of scope (check them on the host)');
  return c;
}

async function checkVector(db: Client): Promise<Check> {
  const r = (await db.query(`SELECT extversion FROM pg_extension WHERE extname = 'vector'`))
    .rows[0];
  return r
    ? { id: 'f', name: 'pgvector', status: 'PASS', details: [`extension vector ${r.extversion}`] }
    : {
        id: 'f',
        name: 'pgvector',
        status: 'FAIL',
        details: ['extension vector is not installed in this database'],
      };
}

/** `schema.table -> column names` as the tool's own DDL declares them. */
function migrationSchemaColumns(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of DDL.matchAll(/CREATE TABLE IF NOT EXISTS migration\.(\w+) \(([\s\S]*?)\n\);/g)) {
    const cols = m[2]!
      .split('\n')
      .map((l) => /^\s{2}([a-z_]+)\s+[a-z]/.exec(l)?.[1])
      .filter((x): x is string => Boolean(x) && !['primary', 'constraint'].includes(x as string));
    out.set(m[1]!, cols);
  }
  return out;
}

async function checkToolSchema(db: Client, o: PreflightOptions): Promise<Check> {
  const c: Check = { id: 'g', name: 'migration-schema', status: 'PASS', details: [] };
  const want = migrationSchemaColumns();
  const have = (
    await db.query(
      `SELECT table_name AS t, column_name AS col FROM information_schema.columns WHERE table_schema = 'migration'`,
    )
  ).rows as Array<{ t: string; col: string }>;
  const schema =
    (await db.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'migration'`)).rows.length > 0;
  if (!schema || have.length === 0) {
    if (o.afterInit) {
      c.status = 'FAIL';
      c.details.push('the migration schema is absent: run `init` with the owner URL first');
    } else c.details.push('absent: needs `init` (owner URL, once) before the first run');
    return c;
  }
  const cols = new Map<string, Set<string>>();
  for (const r of have) (cols.get(r.t) ?? cols.set(r.t, new Set()).get(r.t)!).add(r.col);
  for (const [t, wanted] of want) {
    const got = cols.get(t);
    if (!got) {
      c.status = 'FAIL';
      c.details.push(`migration.${t}: MISSING (partial init; run \`init\` again)`);
      continue;
    }
    const miss = wanted.filter((x) => !got.has(x));
    if (miss.length) {
      c.status = 'FAIL';
      c.details.push(
        `migration.${t}: missing column(s) ${miss.join(', ')} (the tool is newer than this schema)`,
      );
    }
    for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      const ok = (
        await db.query(`SELECT has_table_privilege(current_user, $1, $2) AS ok`, [
          `migration.${t}`,
          priv,
        ])
      ).rows[0].ok;
      if (!ok) {
        c.status = 'FAIL';
        c.details.push(`migration.${t}: this login lacks ${priv}`);
      }
    }
  }
  const sc = (
    await db.query(`SELECT has_schema_privilege(current_user, 'migration', 'USAGE') AS ok`)
  ).rows[0].ok;
  if (!sc) {
    c.status = 'FAIL';
    c.details.push('this login lacks USAGE on schema migration');
  }
  c.details.unshift(
    `present: ${[...want.keys()].map((t) => `migration.${t}`).join(', ')} (${want.size} tables checked)`,
  );
  return c;
}

async function checkOrg(db: Client, o: PreflightOptions): Promise<Check> {
  const c: Check = { id: 'h', name: 'org', status: 'PASS', details: [] };
  if (!o.orgSlug) {
    c.status = 'WARN';
    c.details.push('no --org-slug given: the slug check was not made');
    return c;
  }
  let slug: string;
  try {
    slug = normalizeSlug(o.orgSlug);
  } catch (e) {
    return { ...c, status: 'FAIL', details: [safe(e)] };
  }
  // organizations is under FORCE RLS: the read goes through the privileged switch the tool itself uses, inside a read-only transaction
  await db.query('BEGIN');
  try {
    await db.query(`SELECT set_config('app.privileged', 'on', true)`);
    const same = (
      await db.query('SELECT id FROM organizations WHERE lower(slug) = lower($1)', [slug])
    ).rows;
    const mine = o.client
      ? (
          await db.query('SELECT id, slug FROM organizations WHERE uuid = $1::uuid', [
            uuidv5(`${o.client}|${ORG_COLLECTION}`),
          ])
        ).rows
      : [];
    if (mine.length) {
      c.status = 'WARN';
      c.details.push(
        `the organization of client ${o.client} already exists (id ${mine[0].id}, slug ${mine[0].slug}): this is a RESUME or re-run, not a first load`,
      );
    } else if (same.length) {
      c.status = 'FAIL';
      c.details.push(
        `an organization with slug "${slug}" already exists (id ${same[0].id}): the tool would silently pick another slug; choose a different --org-slug`,
      );
    } else c.details.push(`slug "${slug}" is free`);
    if (o.orgPlan) {
      const p = (
        await db.query(`SELECT slug FROM plans WHERE kind = 'plan' AND is_active AND slug = $1`, [
          o.orgPlan.trim().toLowerCase(),
        ])
      ).rows;
      if (p.length === 0) {
        if (c.status === 'PASS') c.status = 'WARN';
        c.details.push(
          `WARN plan "${o.orgPlan}" is not an active plan here: the organization would be created with that literal plan slug`,
        );
      }
    }
  } finally {
    await db.query('ROLLBACK');
  }
  return c;
}

export async function runPreflight(o: PreflightOptions): Promise<Check[]> {
  const out: Check[] = [];
  const guarded = async (id: string, name: string, fn: () => Promise<Check>): Promise<void> => {
    try {
      out.push(await fn());
    } catch (e) {
      out.push({ id, name, status: 'FAIL', details: [`could not run the check: ${safe(e)}`] });
    }
  };
  let db: Client | null = null;
  let stDefault = '0';
  let owner: Client | null = null;
  try {
    db = await open(o.targetUrl);
    stDefault = await serverTimeout(db);
  } catch (e) {
    return [
      {
        id: '-',
        name: 'connect',
        status: 'FAIL',
        details: [`cannot connect with TARGET_DATABASE_URL: ${safe(e)}`],
      },
    ];
  }
  try {
    if (o.ownerUrl) {
      try {
        owner = await open(o.ownerUrl);
        await serverTimeout(owner);
      } catch (e) {
        out.push({
          id: '-',
          name: 'connect-owner',
          status: 'FAIL',
          details: [`cannot connect with MIGRATION_DATABASE_URL: ${safe(e)}`],
        });
      }
    }
    const wanted = wantedWrites(o.tool?.steps ?? STEPS, o.tool?.raw ?? raw);
    const D = db;
    await guarded('a', 'migrations', () => checkMigrations(o, owner));
    await guarded('b', 'schema', () => checkSchema(D, wanted));
    await guarded('c', 'rls', () => checkRls(D, wanted));
    await guarded('d', 'role', () => checkRole(D, o, wanted));
    await guarded('e', 'server', () => checkServer(D, stDefault));
    await guarded('f', 'pgvector', () => checkVector(D));
    await guarded('g', 'migration-schema', () => checkToolSchema(D, o));
    await guarded('h', 'org', () => checkOrg(D, o));
  } finally {
    await db.end().catch(() => undefined);
    await owner?.end().catch(() => undefined);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function format(checks: Check[]): string {
  const lines: string[] = [];
  for (const c of checks) {
    lines.push(`${c.status.padEnd(4)} ${c.id} ${c.name}`);
    for (const d of c.details) lines.push(`       ${d}`);
  }
  const fails = checks.filter((c) => c.status === 'FAIL').length;
  lines.push('', fails ? `PREFLIGHT FAILED: ${fails} check(s) failed` : 'PREFLIGHT PASSED');
  return lines.join('\n');
}

function parseFlags(argv: string[]): Map<string, string | true> {
  const f = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) f.set(a.slice(2, eq), a.slice(eq + 1));
    else if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('--'))
      f.set(a.slice(2), argv[++i]!);
    else f.set(a.slice(2), true);
  }
  return f;
}

export async function main(argv: string[]): Promise<number> {
  const f = parseFlags(argv);
  const str = (k: string): string | undefined =>
    typeof f.get(k) === 'string' ? (f.get(k) as string) : undefined;
  const list = (k: string): string[] =>
    (str(k) ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  const targetUrl = process.env.TARGET_DATABASE_URL;
  if (!targetUrl) {
    console.error('TARGET_DATABASE_URL is not set');
    return 2;
  }
  const guard = {
    allowHosts: list('allow-target-host'),
    allowDockerHosts: list('allow-docker-host'),
    confirmDbName: str('confirm-db-name') ?? null,
    dryRun: true,
  };
  try {
    console.log(assertTargetAllowed(targetUrl, 'target', guard));
    if (process.env.MIGRATION_DATABASE_URL)
      console.log(
        assertTargetAllowed(process.env.MIGRATION_DATABASE_URL, 'owner (read-only use)', guard),
      );
  } catch (e) {
    console.error(safe(e));
    return 1;
  }
  const checks = await runPreflight({
    targetUrl,
    ownerUrl: process.env.MIGRATION_DATABASE_URL,
    migrationsDir: str('migrations-dir'),
    expectRole: str('expect-role'),
    orgSlug: str('org-slug'),
    client: str('client'),
    orgPlan: str('org-plan'),
    afterInit: f.has('after-init'),
    skipPartitions: f.has('skip-partitions'),
  });
  console.log(format(checks));
  return checks.some((c) => c.status === 'FAIL') ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(safe(e));
      process.exit(1);
    },
  );
}
