/**
 * RE-VERIFY round (second independent pass). Invented data only. Findings print as `FINDING ...`; where the correct behaviour is
 * unambiguous a defect is asserted with expect.soft, so it shows up as a failing assertion until it is fixed.
 * Groups: (g) guard, (s) scrub, (p) phone, (o) oracle, (u) unique conflicts + phone/oracle blind spot + surrogate leak,
 * (c) generic column/row damage census, (i) intruder rows, (k) concurrency, (m) masking in reports, (x) real SIGKILL.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { assertTargetAllowed } from '../load/db';
import { runClient } from '../load/run';
import { reconcile } from '../reconcile';
import { phoneOf } from '../transform/contacts';
import { scrub } from '../util';
import {
  asOwner,
  cloneDb,
  customDumps,
  makeDumps,
  runOpts,
  snapshot,
  type Dumps,
  type TestDb,
} from './helpers';

type J = Record<string, unknown>;
const oidHex = (n: number): string => `65f0d1d2${n.toString(16).padStart(16, '0')}`;
const O = (n: number): J => ({ $oid: oidHex(n) });
const D = (iso: string): J => ({ $date: iso });
const T1 = '2026-03-01T10:00:00.000Z';
const find = (...a: unknown[]): void => console.log('FINDING', ...a);

const dbs: TestDb[] = [];
const cleanups: Array<() => void> = [];
const clone = async (label: string, from?: string): Promise<TestDb> => {
  const d = await cloneDb(label, from);
  dbs.push(d);
  return d;
};
const dump = async (c: Parameters<typeof customDumps>[0]): Promise<Dumps> => {
  const d = await customDumps(c);
  cleanups.push(d.cleanup);
  return d;
};
const drop = async (d: TestDb): Promise<void> => {
  await d.drop();
  dbs.splice(dbs.indexOf(d), 1);
};
afterAll(async () => {
  for (const d of dbs) await d.drop();
  for (const c of cleanups) c();
});
const rows = async (db: TestDb, text: string): Promise<Array<Record<string, unknown>>> =>
  asOwner(db, async (d) => (await d.execute(sql.raw(text))).rows as Array<Record<string, unknown>>);
const tryRun = async (
  d: Dumps,
  db: TestDb,
  client: string,
  extra: Record<string, unknown> = {},
): Promise<string | null> => {
  try {
    await runClient(runOpts(d, db, client, extra));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};
const ver = (d: Dumps, db: TestDb, client: string, extra: Record<string, unknown> = {}) =>
  reconcile({ source: d.source, dumpsDir: d.dir, client, targetUrl: db.workerUrl, ...extra });
const contact = (n: number, extra: J = {}): J => ({
  _id: O(n),
  id: `c${n}`,
  created_time: D(T1),
  modified_time: D(T1),
  is_deleted: false,
  ...extra,
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('(g) production guard', () => {
  const mustRefuse: Array<[string, string]> = [
    [
      'query-string host override (pg connects to evil.example.com)',
      'postgres://u:p@localhost/db?host=evil.example.com',
    ],
    [
      'query-string hostaddr override (pg connects to 8.8.8.8)',
      'postgres://u:p@localhost/db?hostaddr=8.8.8.8',
    ],
    ['public IPv6', 'postgres://u:p@[2001:db8::1]/db'],
    ['link-local IPv6', 'postgres://u:p@[fe80::1]/db'],
    ['IPv4-mapped IPv6 of a private address', 'postgres://u:p@[::ffff:10.1.2.3]/db'],
    ['unspecified IPv6', 'postgres://u:p@[::]/db'],
    ['decimal-integer IPv4 (10.0.0.1)', 'postgres://u:p@167772161/db'],
    ['localhost.evil.com', 'postgres://u:p@localhost.evil.com/db'],
    ['127.0.0.1.evil.com', 'postgres://u:p@127.0.0.1.evil.com/db'],
    ['userinfo trick', 'postgres://localhost:5432@evil.example.com/db'],
  ];
  it.each(mustRefuse)('refuses %s', (_n, url) => {
    let refused = false;
    try {
      assertTargetAllowed(url, 'target', { dryRun: true });
    } catch {
      refused = true;
    }
    if (!refused) find('GUARD BYPASS (allowed):', url);
    expect.soft(refused, `guard allowed ${url}`).toBe(true);
  });
  it.each([
    'postgres://u:p@localhost/db',
    'postgres://u:p@127.0.0.1/db',
    'postgres://u:p@[::1]/db',
    'postgres://u:p@crm-postgres/db',
  ])('allows %s', (url) => {
    expect(() => assertTargetAllowed(url, 'target', { dryRun: true })).not.toThrow();
  });
  it('a single-label name that is not a known docker name is refused (fixed: it used to be accepted)', () => {
    expect(() => assertTargetAllowed('postgres://u:p@prod-db/db', 't', {})).toThrow(
      /refusing to run against prod-db/,
    );
    // ... unless it is named explicitly as a docker-compose service
    expect(() =>
      assertTargetAllowed('postgres://u:p@prod-db/db', 't', { allowDockerHosts: ['prod-db'] }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('(s) shared scrub', () => {
  const dropped = (o: J): boolean => Object.keys(scrub(o).value as J).length === 0;
  it.each<[string, J]>([
    ['authtoken', { authtoken: 'abc123secret' }],
    ['AUTHTOKEN', { AUTHTOKEN: 'abc' }],
    ['sessiontoken', { sessiontoken: 'x' }],
    ['apitoken', { apitoken: 'x' }],
    ['bearertoken', { bearertoken: 'x' }],
    ['pwd', { pwd: 'hunter2' }],
    ['value sk-proj under an innocent key', { memo: 'sk-proj-abcdefghijklmnopqrstuvwxyz' }],
    ['value ghp_ under an innocent key', { memo: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' }],
    ['value AKIA under an innocent key', { memo: 'AKIAIOSFODNN7EXAMPLE' }],
    ['Bearer value under an allow-listed name', { api_token_price: 'Bearer abcdefgh12345678' }],
    ['JWT value under an allow-listed name', { tokens_used: 'eyJhbGciOi.eyJzdWIiOiIx.abcdef' }],
  ])('drops %s', (name, o) => {
    const d = dropped(o);
    if (!d) find('SCRUB BYPASS:', name, JSON.stringify(scrub(o).value));
    expect.soft(d, `kept: ${name}`).toBe(true);
  });
  it('secrets inside free text / JSON-in-a-string are NOT caught (documented hole)', () => {
    const a = scrub({ note: 'api_key=sk-live-12345 and password: hunter2' }).value as J;
    const b = scrub({ blob: '{"token":"abc","password":"x"}' }).value as J;
    find('free text kept:', JSON.stringify(a), '| JSON-in-string kept:', JSON.stringify(b));
    expect(true).toBe(true);
  });
  it.each<[string, J]>([
    ['key_account', { key_account: 'Yes' }],
    ['primary_key', { primary_key: 'abc' }],
    ['private_notes', { private_notes: 'call back after 5' }],
    ['auth_status', { auth_status: 'pending' }],
  ])('FALSE POSITIVE (silent data loss): %s is a plain CRM value', (name, o) => {
    const d = dropped(o);
    if (d) find('SCRUB OVER-DROP:', name);
    expect.soft(d, `dropped legitimate-looking data: ${name}`).toBe(false);
  });
  it('kept vs dropped for the team-added names', () => {
    const k = (o: J): string => (dropped(o) ? 'dropped' : 'kept');
    find(
      `normalKey:12=${k({ normalKey: 12 })} openRouterKey:'sk'=${k({ openRouterKey: 'sk' })} auth_key:5=${k({ auth_key: 5 })} auth_key:'a'=${k({ auth_key: 'a' })}`,
      `tokens_used:5=${k({ tokens_used: 5 })} input_token_price:0.1=${k({ input_token_price: 0.1 })} token:12345=${k({ token: 12345 })} x_api_key:99=${k({ x_api_key: 99 })}`,
    );
    expect(dropped({ normalKey: 12 })).toBe(true);
    expect(dropped({ tokens_used: 5 })).toBe(false);
    expect(dropped({ input_token_price: 0.1 })).toBe(false);
    expect(dropped({ auth_key: 'a' })).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('(p) phone', () => {
  it.each([
    ['9812345680 12', '91'],
    ['98123456801', '91'],
    ['981234568012', '91'],
    ['1234567', '91'],
  ])('%s with country code %s is a wrong Indian number, must not become E.164', (raw, cc) => {
    const p = phoneOf(raw, cc, null);
    if (p) find(`PHONE accepted silently: "${raw}" cc ${cc} -> ${p}`);
    expect.soft(p, `${raw} -> ${String(p)}`).toBeNull();
  });
});

describe('(o) oracle independence', () => {
  it('oracle.ts has no import / require at all', () => {
    const src = readFileSync(join(__dirname, '..', 'reconcile', 'oracle.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(/^\s*import\s/m.test(code)).toBe(false);
    expect(/\brequire\s*\(/.test(code)).toBe(false);
    expect(/\bimport\s*\(/.test(code)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('(u) unique conflicts, shared-rule blind spot, surrogate leak', () => {
  it('two tags / two lists with the same name: loader quarantines, reconcile must agree', async () => {
    const d = await dump({
      solo: {
        contact_tag: [
          { _id: O(11), id: 't1', tag_title: 'VIP' },
          { _id: O(12), id: 't2', tag_title: 'VIP' },
        ],
        marketing_list: [
          { _id: O(21), id: 'l1', name: 'Friends', created_time: D(T1), deleted_time: null },
          { _id: O(22), id: 'l2', name: 'friends', created_time: D(T1), deleted_time: null },
        ],
        contact_list: [contact(1, { first_name: 'Sol', marketing_list: ['l1', 'l2'] })],
      },
    });
    const db = await clone('uniq');
    expect(await tryRun(d, db, 'solo')).toBeNull();
    const q = await rows(
      db,
      "SELECT collection, source_key, reason_code FROM migration.quarantine WHERE reason_code = 'UNIQUE_CONFLICT'",
    );
    find('UNIQUE_CONFLICT quarantine rows:', JSON.stringify(q));
    const r = await ver(d, db, 'solo');
    find(
      'reconcile after unique conflicts: ok =',
      r.ok,
      'alarms =',
      JSON.stringify(r.alarms.slice(0, 6)),
      'unaccounted =',
      r.unaccounted,
    );
    expect
      .soft(r.ok, 'reconcile fails on a legitimate UNIQUE_CONFLICT quarantine (false alarm)')
      .toBe(true);
    await drop(db);
  });

  it('a wrong phone that the loader AND the oracle both accept is invisible to reconcile', async () => {
    const d = await dump({
      solo: {
        contact_list: [
          contact(1, {
            first_name: 'Ph',
            mobile_phone_number: '9812345680 12',
            country_code: '91',
          }),
        ],
      },
    });
    const db = await clone('phoneblind');
    expect(await tryRun(d, db, 'solo')).toBeNull();
    const p = await rows(db, 'SELECT phone FROM contacts WHERE legacy_id IS NOT NULL');
    const r = await ver(d, db, 'solo');
    find(
      'phone loaded as',
      JSON.stringify(p),
      '-> reconcile ok =',
      r.ok,
      '(shared rule: both say the same)',
    );
    await drop(db);
  });

  it('a lone surrogate in a name: run result and error text', async () => {
    const d = await dump({
      solo: {
        contact_list:
          [
            contact(1, { first_name: 'Anita\ud83d', email: 'anita.surrogate@example.test' }),
            contact(2, { first_name: 'Bimal', email: 'bimal.secret@example.test' }),
          ]
            .map((x) => JSON.stringify(x))
            .join('\n') + '\n',
      },
    });
    const db = await clone('surrogate');
    const err = await tryRun(d, db, 'solo');
    find(
      'lone surrogate run ->',
      err ? `FAILED: ${err.slice(0, 160).replace(/\s+/g, ' ')}` : 'loaded',
    );
    if (err) {
      const leak = /bimal\.secret@example\.test|anita\.surrogate@example\.test/i.test(err);
      find('error text contains other contacts PII:', leak);
      expect
        .soft(leak, 'the failure message echoes the whole batch (PII) into the console')
        .toBe(false);
    }
    expect.soft(err, 'a lone surrogate must not abort the whole client').toBeNull();
    await drop(db);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
const MUTATE = (type: string, udt: string, col: string): string | null => {
  const c = `"${col}"`;
  if (udt === 'tsvector' || udt === 'uuid' || udt === 'bytea') return null;
  if (type === 'boolean') return `${c} = NOT coalesce(${c}, false)`;
  if (['smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision'].includes(type))
    return `${c} = coalesce(${c}, 0) + 1`;
  if (type === 'jsonb') return `${c} = coalesce(${c}, '{}'::jsonb) || '{"zz":1}'::jsonb`;
  if (type.startsWith('timestamp')) return `${c} = coalesce(${c}, now()) + interval '1 day'`;
  if (type === 'text' || type === 'character varying' || udt === 'citext')
    return `${c} = coalesce(${c}::text, '') || 'x'`;
  return null;
};

describe('(c) generic column and row damage census', () => {
  it('every column of every org table that has rows: does reconcile notice a change, or a deleted row?', async () => {
    const dumps = await makeDumps();
    cleanups.push(dumps.cleanup);
    const base = await clone('census_base');
    expect(
      await tryRun(dumps, base, 'acme', {
        org: { name: 'acme', slug: 'acme', ownerEmail: 'boss@example.test', ownerName: 'Boss' },
      }),
    ).toBeNull();
    const org = Number(
      (await rows(base, "SELECT id FROM organizations WHERE slug = 'acme'"))[0]!.id,
    );
    expect((await ver(dumps, base, 'acme')).ok).toBe(true);

    const tabs = await rows(
      base,
      `SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
       WHERE c.table_schema = 'public' AND c.column_name = 'org_id'
         AND c.table_name !~ '(_default|_p[0-9]+|_20[0-9]{2}_[0-9]{2})$' ORDER BY 1`,
    );
    const filled: Array<{ table: string; n: number; where: string }> = [
      { table: 'organizations', n: 1, where: `id = ${org}` },
    ];
    for (const t of tabs) {
      const name = String(t.table_name);
      const n = Number(
        (await rows(base, `SELECT count(*)::int AS n FROM "${name}" WHERE org_id = ${org}`))[0]!.n,
      );
      if (n > 0) filled.push({ table: name, n, where: `org_id = ${org}` });
    }
    find('CENSUS org rows after load:', filled.map((f) => `${f.table}=${f.n}`).join(' '));
    const sideTables = ['event_outbox', 'audit_log', 'notifications', 'contact_identities'];
    find(
      'CENSUS side-effect tables with rows for the org:',
      filled
        .filter((f) => sideTables.includes(f.table))
        .map((f) => `${f.table}=${f.n}`)
        .join(' ') || 'none',
    );

    // ONE working copy; each table is backed up, damaged column by column, and put back (clone-per-mutation took 15 s each)
    const work = await clone('census_work', base.name);
    const exec = (stmt: string): Promise<boolean> =>
      asOwner(work, async (d) => {
        try {
          await d.transaction(async (tx) => {
            await tx.execute(sql`SET LOCAL session_replication_role = replica`);
            await tx.execute(sql.raw(stmt));
          });
          return true;
        } catch {
          return false;
        }
      });
    const missed: string[] = [];
    let tried = 0;
    for (const f of filled) {
      const cols = await rows(
        work,
        `SELECT column_name, data_type, udt_name, is_generated FROM information_schema.columns WHERE table_schema='public' AND table_name='${f.table}' ORDER BY ordinal_position`,
      );
      const plain = cols
        .filter((c) => c.is_generated === 'NEVER')
        .map((c) => `"${String(c.column_name)}"`);
      const list = plain.join(', ');
      const bak = `_bak_${f.table}`;
      await exec(`CREATE TABLE "${bak}" AS SELECT ${list} FROM "${f.table}" WHERE ${f.where}`);
      const restore = (): Promise<boolean> =>
        exec(
          `DELETE FROM "${f.table}" WHERE ${f.where}; INSERT INTO "${f.table}" (${list}) OVERRIDING SYSTEM VALUE SELECT ${list} FROM "${bak}"`,
        );
      const once = async (label: string, stmt: string): Promise<void> => {
        if (!(await exec(stmt))) return;
        tried++;
        const r = await ver(dumps, work, 'acme');
        if (r.ok) missed.push(label);
        if (!(await restore())) throw new Error(`could not restore ${f.table} after ${label}`);
      };
      for (const c of cols) {
        const name = String(c.column_name);
        if (['org_id', 'id', 'uuid'].includes(name) || c.is_generated !== 'NEVER') continue;
        const set = MUTATE(String(c.data_type), String(c.udt_name), name);
        if (set)
          await once(`${f.table}.${name}`, `UPDATE "${f.table}" SET ${set} WHERE ${f.where}`);
      }
      await once(
        `${f.table} (delete one row)`,
        `DELETE FROM "${f.table}" WHERE ctid = (SELECT ctid FROM "${f.table}" WHERE ${f.where} LIMIT 1)`,
      );
      await exec(`DROP TABLE "${bak}"`);
    }
    find(
      `CENSUS mutations applied: ${tried}; NOT NOTICED by reconcile (${missed.length}):`,
      missed.join(' | '),
    );
    expect.soft(missed, 'columns/rows reconcile does not watch').toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('(i) intruder rows reconcile may not see', () => {
  it('inserts into tables the migration never touches / source has no rows for', async () => {
    const d = await dump({
      solo: {
        contact_list: [
          contact(1, { first_name: 'One', email: 'one@example.test' }),
          contact(2, { first_name: 'Two' }),
        ],
      },
    });
    const base = await clone('intr_base');
    expect(
      await tryRun(d, base, 'solo', {
        org: { name: 'Solo', slug: 'solo', ownerEmail: 'boss@example.test', ownerName: 'Boss' },
      }),
    ).toBeNull();
    const org = Number(
      (await rows(base, "SELECT id FROM organizations WHERE slug = 'solo'"))[0]!.id,
    );
    const sideRows = await rows(
      base,
      `SELECT 'event_outbox' t, count(*)::int n FROM event_outbox WHERE org_id=${org} UNION ALL SELECT 'audit_log', count(*)::int FROM audit_log WHERE org_id=${org} UNION ALL SELECT 'notifications', count(*)::int FROM notifications WHERE org_id=${org} UNION ALL SELECT 'contact_identities', count(*)::int FROM contact_identities WHERE org_id=${org}`,
    );
    find('SIDE EFFECTS after a load WITH an owner user:', JSON.stringify(sideRows));
    const u = await rows(
      base,
      `SELECT email, status::text AS status, password_hash IS NULL AS nopw, joined_at IS NULL AS notjoined, invited_at IS NOT NULL AS invited FROM users WHERE org_id=${org}`,
    );
    const us = await rows(
      base,
      `SELECT email_verified_at IS NULL AS unverified FROM user_security WHERE org_id=${org}`,
    );
    find('owner user:', JSON.stringify(u), 'user_security:', JSON.stringify(us));
    expect((await ver(d, base, 'solo')).ok).toBe(true);

    const cases: Array<[string, string]> = [
      [
        'extra note (source has NO notes)',
        `INSERT INTO contact_notes (org_id, contact_id, body) SELECT org_id, id, 'planted' FROM contacts WHERE org_id=${org} LIMIT 1`,
      ],
      [
        'contact_identities row',
        `INSERT INTO contact_identities (org_id, contact_id, kind, value) SELECT org_id, id, 'phone', '+15550001' FROM contacts WHERE org_id=${org} LIMIT 1`,
      ],
      [
        'event_outbox row',
        `INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload) VALUES (${org}, 'contacts', 1, 'contact.created', '{}')`,
      ],
      [
        'intruder user with Owner role',
        `WITH u AS (INSERT INTO users (org_id, email, full_name, password_hash, status) VALUES (${org}, 'evil@example.test', 'Evil', 'x', 'active') RETURNING id) INSERT INTO user_roles (org_id, user_id, role_id) SELECT ${org}, u.id, r.id FROM u, roles r WHERE r.org_id=${org} AND r.name='Owner'`,
      ],
      [
        'extra grant on Viewer role',
        `UPDATE role_grants SET effect='deny' WHERE org_id=${org} AND id = (SELECT id FROM role_grants WHERE org_id=${org} AND effect='allow' LIMIT 1)`,
      ],
      [
        'second organization carrying the same legacy marker',
        `INSERT INTO organizations (slug, name, plan, settings) VALUES ('solo-dup','Dup','starter','{"legacy":{"waboo":{"client":"solo"}}}')`,
      ],
      [
        'organizations.settings extra top-level key',
        `UPDATE organizations SET settings = settings || '{"evil":1}' WHERE id=${org}`,
      ],
      [
        'sequence_counters for another module',
        `INSERT INTO sequence_counters (org_id, module_key, current_value) VALUES (${org}, 'deals', 5)`,
      ],
      [
        'owner user password set',
        `UPDATE users SET password_hash='x' WHERE org_id=${org} AND email='boss@example.test'`,
      ],
    ];
    const missed: string[] = [];
    for (const [label, stmt] of cases) {
      const db = await clone('intr', base.name);
      try {
        const ok = await asOwner(db, async (dd) => {
          try {
            await dd.execute(sql.raw(stmt));
            return true;
          } catch (e) {
            find(
              `  (case "${label}" not applicable: ${String((e as { cause?: { message?: string } }).cause?.message ?? e).slice(0, 80)})`,
            );
            return false;
          }
        });
        if (!ok) continue;
        const r = await ver(d, db, 'solo');
        find(
          `INTRUDER [${r.ok ? 'MISSED ' : 'caught '}] ${label}${r.ok ? '' : ' -> ' + (r.alarms[0] ?? r.integrity[0] ?? '').slice(0, 110)}`,
        );
        if (r.ok) missed.push(label);
      } finally {
        await drop(db);
      }
    }
    expect.soft(missed, 'intruder rows reconcile does not see').toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('(k) concurrency', () => {
  const race = async <T>(p: Promise<T>, ms: number, label: string): Promise<T | 'TIMEOUT'> => {
    let t: NodeJS.Timeout | undefined;
    const to = new Promise<'TIMEOUT'>((r) => (t = setTimeout(() => r('TIMEOUT'), ms)));
    const out = await Promise.race([p, to]);
    clearTimeout(t);
    if (out === 'TIMEOUT') find(`CONCURRENCY ${label}: HUNG (>${ms} ms)`);
    return out;
  };
  it('real+dry on one client, real+real on two clients, two dry runs: no hang, no duplicates', async () => {
    const dumps = await makeDumps();
    cleanups.push(dumps.cleanup);
    for (const [label, mk] of [
      [
        'acme real + acme dry',
        (db: TestDb) => [
          runClient(runOpts(dumps, db, 'acme')),
          runClient(runOpts(dumps, db, 'acme', { dryRun: true })),
        ],
      ],
      [
        'acme real + globex real',
        (db: TestDb) => [
          runClient(runOpts(dumps, db, 'acme')),
          runClient(runOpts(dumps, db, 'globex')),
        ],
      ],
      [
        'acme dry + acme dry + acme real',
        (db: TestDb) => [
          runClient(runOpts(dumps, db, 'acme', { dryRun: true })),
          runClient(runOpts(dumps, db, 'acme', { dryRun: true })),
          runClient(runOpts(dumps, db, 'acme')),
        ],
      ],
    ] as const) {
      const db = await clone('conc');
      const t0 = Date.now();
      const res = await race(Promise.allSettled(mk(db)), 180_000, label);
      const ms = Date.now() - t0;
      if (res === 'TIMEOUT') {
        expect.soft(res).not.toBe('TIMEOUT');
      } else {
        find(
          `CONCURRENCY ${label}: ${ms} ms, results ${JSON.stringify(res.map((r) => (r.status === 'fulfilled' ? 'ok' : String((r.reason as Error).message).slice(0, 90))))}`,
        );
        const dup = await rows(
          db,
          "SELECT (SELECT count(*) FROM organizations WHERE settings->'legacy'->'waboo'->>'client' = 'acme')::int AS orgs, (SELECT count(*) - count(DISTINCT legacy_id) FROM contacts WHERE legacy_id IS NOT NULL)::int AS dupe",
        );
        find('   ', JSON.stringify(dup));
        const r = await ver(dumps, db, 'acme');
        find('   reconcile acme ok =', r.ok, r.alarms.slice(0, 2).join(' / '));
        expect.soft(r.ok, `${label}: reconcile fails after the concurrent runs`).toBe(true);
      }
      await drop(db);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('(m) masking: reports, console, logs, errors', () => {
  it('no raw email / phone / note text in reconcile.json, reconcile.md, console excerpt or run logs, on a failing run too', async () => {
    const dumps = await makeDumps();
    cleanups.push(dumps.cleanup);
    const db = await clone('mask');
    const lines: string[] = [];
    await runClient(runOpts(dumps, db, 'acme', { log: (l: string) => lines.push(l) }));
    // damage so that FINGERPRINT_MISMATCH / ORACLE_MISMATCH lines are produced
    await rows(
      db,
      "UPDATE contacts SET email = 'planted.leak@example.test', phone = '+15550123456', first_name = 'Leaky', name = 'Leaky Name' WHERE id = (SELECT min(id) FROM contacts WHERE legacy_id IS NOT NULL AND email IS NOT NULL)",
    );
    const out = mkdtempSync(join(tmpdir(), 'migtool-mask-'));
    cleanups.push(() => rmSync(out, { recursive: true, force: true }));
    const r = await reconcile({
      source: dumps.source,
      dumpsDir: dumps.dir,
      client: 'acme',
      targetUrl: db.workerUrl,
      outDir: out,
    });
    expect(r.ok).toBe(false);
    const files = readdirSync(join(out, 'acme')).map((f) =>
      readFileSync(join(out, 'acme', f), 'utf8'),
    );
    const cliExcerpt = (await import('../reconcile'))
      .toMarkdown(r)
      .split('\n')
      .slice(0, 40)
      .join('\n');
    const blob = [...files, cliExcerpt, ...lines].join('\n');
    const src = readFileSync(join(dumps.dir, 'acme', 'contact_list.ndjson'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as J);
    const emails = src.map((c) => String(c.email ?? '')).filter((e) => e.includes('@'));
    const phones = src
      .map((c) => String(c.mobile_phone_number ?? '').replace(/\D/g, ''))
      .filter((p) => p.length >= 8);
    const names = src
      .flatMap((c) => [String(c.first_name ?? ''), String(c.last_name ?? '')])
      .filter((n) => n.length >= 5);
    const leakE = [...emails, 'planted.leak@example.test'].filter((e) =>
      blob.toLowerCase().includes(e.toLowerCase()),
    );
    const leakP = [...phones, '15550123456'].filter((p) => blob.replace(/\D/g, '').includes(p));
    const leakN = [...new Set(names)].filter((n) => blob.includes(n));
    find(
      `MASKING: emails leaked ${leakE.length}, phones leaked ${leakP.length}, names appearing ${leakN.length} ${JSON.stringify(leakN.slice(0, 6))}`,
    );
    expect.soft(leakE).toEqual([]);
    expect.soft(leakP).toEqual([]);
    await drop(db);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('(x) a real SIGKILL that actually lands mid-run', () => {
  it('kill the CLI once the contacts step is checkpointed, three times, then finish: identical to a clean run', async () => {
    const dumps = await makeDumps({ bulk: 20000 });
    cleanups.push(dumps.cleanup);
    const ref = await clone('xkill_ref');
    expect(await tryRun(dumps, ref, 'acme', { batchSize: 200 })).toBeNull();
    const refSnap = await snapshot(ref);
    const db = await clone('xkill');
    const cli = async (
      killWhenCheckpointed: boolean,
    ): Promise<{ code: number | null; signal: string | null }> => {
      const p = spawn(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'cli.ts', 'run', '--client', 'acme', '--batch', '200'],
        {
          cwd: join(__dirname, '..'),
          env: {
            ...process.env,
            SOURCE_DUMPS_DIR: dumps.dir,
            TARGET_DATABASE_URL: db.workerUrl,
            MIGRATION_DATABASE_URL: db.ownerUrl,
          },
          stdio: 'ignore',
        },
      );
      const done = new Promise<{ code: number | null; signal: string | null }>((res) =>
        p.on('exit', (code, signal) => res({ code, signal })),
      );
      if (killWhenCheckpointed) {
        for (let i = 0; i < 600 && p.exitCode === null; i++) {
          await new Promise((r) => setTimeout(r, 100));
          try {
            const r = await rows(
              db,
              "SELECT count(*)::int AS n FROM migration.run_log WHERE step = 'contacts' AND state = 'running' AND last_key > 0",
            );
            if (Number(r[0]?.n) > 0 && p.exitCode === null) {
              await new Promise((rr) => setTimeout(rr, Math.floor(Math.random() * 400)));
              p.kill('SIGKILL');
              break;
            }
          } catch {
            /* schema not there yet */
          }
        }
      }
      return done;
    };
    const kills: string[] = [];
    for (let k = 0; k < 3; k++) {
      const r = await cli(true);
      kills.push(`${String(r.code)}/${String(r.signal)}`);
    }
    const fin = await cli(false);
    const same = (await snapshot(db)) === refSnap;
    const v = await ver(dumps, db, 'acme');
    find(
      `REAL SIGKILL: killed-run exits ${JSON.stringify(kills)}, final exit ${String(fin.code)}, identical to clean run: ${same}, reconcile ok: ${v.ok}`,
    );
    expect
      .soft(
        kills.some((k) => k !== '0/null'),
        'at least one run was really killed mid-load',
      )
      .toBe(true);
    expect.soft(same).toBe(true);
    expect.soft(v.ok).toBe(true);
  });
});
