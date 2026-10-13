/**
 * INDEPENDENT VERIFIER tests (adversarial). Invented data only. Findings are printed as `FINDING ...` lines and, where the correct
 * behaviour is unambiguous, asserted with expect.soft so a defect shows up as a failing assertion.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { NdjsonDirSource } from '../extract/source';
import { writeManifest } from '../extract/manifest';
import { connect } from '../load/db';
import { runClient } from '../load/run';
import { reconcile } from '../reconcile';
import { asOwner, cloneDb, makeDumps, runOpts, snapshot, type Dumps, type TestDb } from './helpers';

type J = Record<string, unknown>;
const oidHex = (n: number): string => `65f0b1b2${n.toString(16).padStart(16, '0')}`;
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
afterAll(async () => {
  for (const d of dbs) await d.drop();
  for (const c of cleanups) c();
});

/** Write raw collection files for several clients, then manifest each. `raw` lets a test supply exact bytes. */
async function customDumps(clients: Record<string, Record<string, J[] | string>>): Promise<Dumps> {
  const dir = mkdtempSync(join(tmpdir(), 'migtool-extra-'));
  for (const [client, colls] of Object.entries(clients)) {
    mkdirSync(join(dir, client), { recursive: true });
    for (const [coll, docs] of Object.entries(colls)) {
      const body =
        typeof docs === 'string' ? docs : docs.map((d) => JSON.stringify(d)).join('\n') + '\n';
      writeFileSync(join(dir, client, `${coll}.ndjson`), body);
    }
  }
  const source = new NdjsonDirSource(dir);
  for (const c of Object.keys(clients)) await writeManifest(source, dir, c);
  const d: Dumps = { dir, source, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  cleanups.push(d.cleanup);
  return d;
}

const project = (n: number, extra: J = {}): J => ({
  _id: O(n),
  id: `prj${n}`,
  name: 'Nasty Co',
  domain: 'nasty.example.test',
  created_time: D(T1),
  modified_time: D(T1),
  deleted_time: null,
  ...extra,
});
const stages = (): J[] => [
  {
    _id: O(900),
    id: 'st000001',
    label: 'Lead',
    position: 1,
    default: true,
    is_deleted: false,
    created_time: D(T1),
    modified_time: D(T1),
    deleted_time: '',
  },
];

const q = async (db: TestDb, text: string): Promise<Array<Record<string, unknown>>> =>
  asOwner(db, async (d) => (await d.execute(sql.raw(text))).rows as Array<Record<string, unknown>>);

async function tryRun(d: Dumps, db: TestDb, client: string, extra = {}): Promise<string | null> {
  try {
    await runClient(runOpts(d, db, client, extra));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
describe('(a) nastier data', () => {
  it('weird contacts: load, then look at what happened to each', async () => {
    const big = 'x'.repeat(1024 * 1024);
    const c = (n: number, extra: J): J => ({
      _id: O(n),
      id: `ct${n}`,
      created_time: D(T1),
      modified_time: D(T1),
      is_deleted: false,
      deleted_time: null,
      ...extra,
    });
    const contacts: J[] = [
      c(1, { first_name: 'Dup', mobile_phone_number: '9812345678', country_code: '91' }),
      c(2, { first_name: 'Dup2', mobile_phone_number: '+91 98123 45678' }),
      c(3, { first_name: 'MailA', email: 'A@X.com' }),
      c(4, { first_name: 'MailB', email: 'a@x.com' }),
      c(5, { first_name: 'P00', mobile_phone_number: '0091-98123-45679' }),
      c(6, { first_name: 'Pext', mobile_phone_number: '9812345680 ext 12', country_code: '91' }),
      c(7, { first_name: 'Pparen', mobile_phone_number: '(981) 234-5681', country_code: '91' }),
      c(8, { first_name: '😀 Ravi 🇮🇳', last_name: 'محمد' }),
      c(9, { first_name: 'Big', bigfield: big }),
      { id: 'onlyid', first_name: 'NoOid' },
      { first_name: 'NoKeyAtAll' },
      // string id of doc 11 equals the ObjectId hex of doc 12
      c(11, { first_name: 'CollideA' }),
      { ...c(12, { first_name: 'CollideB' }), id: oidHex(11) },
      c(13, { first_name: 'EpochMs', created_time: 1700000000000, modified_time: 1700000100000 }),
      c(14, {
        first_name: 'IsoStr',
        created_time: '2024-01-02T03:04:05Z',
        modified_time: '2024-01-02T03:04:05Z',
      }),
      c(15, { first_name: 'Garbage', created_time: 'not-a-date', modified_time: 'nope' }),
      c(16, {
        first_name: 'Future',
        created_time: D('2099-01-01T00:00:00Z'),
        modified_time: D('2099-01-01T00:00:00Z'),
      }),
      c(17, { first_name: 'Epoch0', created_time: 0, modified_time: 0 }),
      c(18, { first_name: 'DelStrFalse', is_deleted: 'false' }),
      c(19, { first_name: 'DelStrTrue', is_deleted: 'true' }),
      c(20, { first_name: 'Del0', is_deleted: 0 }),
      c(21, { first_name: 'Del1', is_deleted: 1 }),
      c(22, { first_name: 'DelStr1', is_deleted: '1' }),
      c(23, { first_name: 'DelTimeSet', deleted_time: '2026-01-01T00:00:00Z' }),
      c(24, { first_name: 'NumStr', lifecycle_stage_date: '1700000000', pax: '12', score: 12 }),
      c(25, { first_name: 'Nested', profile: { a: { b: 1 }, list: [1, { x: 2 }] } }),
      c(26, { first_name: 'Keys', 'a.b': 1, $x: 2, 'my key': 3 }),
      c(27, { first_name: 'Proto', ['__proto__']: { polluted: true } }),
      c(28, { first_name: null, last_name: '', email: '', mobile_phone_number: null }),
      c(29, { first_name: 'NoLC', lifecycle_stage: 'Nonexistent' }),
      c(30, {
        first_name: 'Secret',
        api_token: 'FAKE-SECRET-1',
        password: 'FAKE-PW-1',
        Authorization: 'Bearer FAKE-AUTH-1',
      }),
      c(31, { api_token: 'FAKE-SECRET-2', password: 'FAKE-PW-2' }), // NO_IDENTITY -> whole doc quarantined
      c(32, { first_name: 'LongSource', source: 's'.repeat(300) }),
    ];
    // a JSON line with a literal __proto__ key must survive stringify: build that line by hand
    const protoLine = JSON.stringify(contacts[26]).replace(
      '"__proto__":{}',
      '"__proto__":{"polluted":true}',
    );
    const lines =
      contacts.map((x, i) => (i === 26 ? protoLine : JSON.stringify(x))).join('\n') + '\n';
    const d = await customDumps({
      nasty: { project: [project(1)], contact_lifecycle_stages: stages(), contact_list: lines },
    });
    const db = await clone('nasty');
    const err = await tryRun(d, db, 'nasty');
    console.log('nasty run error:', err);
    expect.soft(err).toBeNull();
    if (err) return;
    const rows = await q(
      db,
      `SELECT legacy_id, name, phone, email, lifecycle_stage, created_at, updated_at, (data ? '__proto__') AS has_proto, length(data::text) AS dlen, data ? 'bigfield' AS big FROM contacts ORDER BY id`,
    );
    const by = new Map(rows.map((r) => [String(r.legacy_id), r]));
    const show = (k: string): string => JSON.stringify(by.get(k) ?? null);
    for (const k of [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
      29, 30, 32,
    ])
      console.log(`  contact ${k}: ${show(oidHex(k))}`);
    console.log('  onlyid:', show('onlyid'));
    const qrows = await q(
      db,
      `SELECT collection, source_key, reason_code FROM migration.quarantine WHERE collection='contact_list' ORDER BY 2`,
    );
    console.log(
      '  quarantine:',
      JSON.stringify(qrows.map((r) => `${String(r.source_key).slice(-6)}:${r.reason_code}`)),
    );

    // ---- expectations that are unambiguous
    expect
      .soft(
        by.has(oidHex(11)) && by.has(oidHex(12)),
        'string id colliding with another doc ObjectId: BOTH docs must load',
      )
      .toBe(true);
    expect.soft(by.has('onlyid'), 'doc with only a string id must load').toBe(true);
    expect
      .soft(by.has(oidHex(22)), 'is_deleted "1" is a deleted doc, must be excluded (found loaded)')
      .toBe(false);
    expect.soft(by.has(oidHex(21)), 'is_deleted 1 must be excluded').toBe(false);
    expect.soft(by.has(oidHex(19)), 'is_deleted "true" must be excluded').toBe(false);
    expect
      .soft(by.has(oidHex(23)), 'deleted_time set on a contact: deleted? (loaded as live)')
      .toBe(false);
    expect.soft(by.get(oidHex(27))?.has_proto, '__proto__ key must be kept in data').toBe(true);
    expect
      .soft(
        String(by.get(oidHex(15))?.created_at ?? '').startsWith('1970'),
        'garbage date must not become 1970',
      )
      .toBe(false);
    // secrets
    const leak = await q(
      db,
      `SELECT (SELECT count(*) FROM contacts WHERE data::text ILIKE '%FAKE-%') AS c, (SELECT count(*) FROM migration.quarantine WHERE doc::text ILIKE '%FAKE-%') AS qn, (SELECT count(*) FROM fields WHERE config::text ILIKE '%FAKE-%' OR key ILIKE '%token%' OR key ILIKE '%password%') AS f`,
    );
    console.log(
      '  secret leak counts (contacts.data, quarantine.doc, fields):',
      JSON.stringify(leak[0]),
    );
    expect.soft(Number(leak[0]!.c), 'credential-looking keys copied into contacts.data').toBe(0);
    expect
      .soft(Number(leak[0]!.qn), 'credential-looking keys copied into migration.quarantine.doc')
      .toBe(0);
    const r = await reconcile({
      source: d.source,
      dumpsDir: d.dir,
      client: 'nasty',
      targetUrl: db.workerUrl,
      sampleSize: 1000,
    });
    console.log(
      '  reconcile ok=',
      r.ok,
      'alarms=',
      JSON.stringify(r.alarms.slice(0, 8)),
      'integrity=',
      JSON.stringify(r.integrity),
    );
    expect.soft(r.ok).toBe(true);
  });

  it('NUL character in a string (postgres jsonb cannot hold \\u0000)', async () => {
    const d = await customDumps({
      nul: {
        project: [project(1)],
        contact_list: [
          { _id: O(1), id: 'a', first_name: 'Fine', created_time: D(T1), is_deleted: false },
          { _id: O(2), id: 'b', first_name: 'A\u0000B', created_time: D(T1), is_deleted: false },
        ],
      },
    });
    const db = await clone('nul');
    const err = await tryRun(d, db, 'nul');
    find('NUL byte in name ->', err ? `RUN ABORTED: ${err.slice(0, 160)}` : 'loaded');
    expect.soft(err, 'a NUL char must be quarantined/cleaned, not abort the batch').toBeNull();
    if (err) {
      const again = await tryRun(d, db, 'nul');
      find('resume after NUL abort ->', again ? `still aborted: ${again.slice(0, 100)}` : 'ok');
    }
  });

  it('BOM, CRLF, truncated last line', async () => {
    const doc = (n: number): string =>
      JSON.stringify({
        _id: O(n),
        id: `x${n}`,
        first_name: `N${n}`,
        created_time: D(T1),
        is_deleted: false,
      });
    const bom = await customDumps({
      bom: { project: [project(1)], contact_list: '﻿' + [doc(1), doc(2)].join('\n') + '\n' },
    });
    let db = await clone('bom');
    let err = await tryRun(bom, db, 'bom');
    find('UTF-8 BOM on first line ->', err ? `ABORT: ${err.slice(0, 120)}` : 'loaded');
    expect.soft(err).toBeNull();

    const crlf = await customDumps({
      crlf: { project: [project(1)], contact_list: [doc(1), doc(2)].join('\r\n') + '\r\n' },
    });
    db = await clone('crlf');
    err = await tryRun(crlf, db, 'crlf');
    const n = await q(db, 'SELECT count(*)::int n FROM contacts');
    find('CRLF ->', err ?? `loaded ${String(n[0]!.n)} contacts`);
    expect.soft(err).toBeNull();

    const trunc = await customDumps({
      trunc: {
        project: [project(1)],
        contact_list:
          [doc(1), doc(2)].join('\n') + '\n{"_id":{"$oid":"65f0b1b2000000000000ffff"},"first_na',
      },
    });
    db = await clone('trunc');
    err = await tryRun(trunc, db, 'trunc');
    find('truncated last line (manifest counts it as a doc) ->', err ?? 'loaded silently');
    expect
      .soft(
        err,
        'a truncated final line must be an explicit error naming file+line, or a NO_KEY/PARSE quarantine',
      )
      .toBeTruthy();
    if (err)
      expect
        .soft(err, 'error should name the collection file and line')
        .toMatch(/contact_list|line/i);
    // partial load state after the abort
    const part = await q(db, 'SELECT count(*)::int n FROM contacts');
    find('contacts loaded before the abort:', part[0]!.n);
    const r = await reconcile({
      source: trunc.source,
      dumpsDir: trunc.dir,
      client: 'trunc',
      targetUrl: db.workerUrl,
    }).then(
      (x) => `ok=${x.ok}`,
      (e: Error) => `reconcile THREW: ${e.message.slice(0, 100)}`,
    );
    find('reconcile on truncated dump ->', r);
  });

  it('org slug longer than the login schema allows (40 chars) / non-latin domain', async () => {
    const d = await customDumps({
      longslug: {
        project: [
          project(1, {
            domain: 'a-very-long-subdomain.of-some-really-long-company-name.example.com',
          }),
        ],
        contact_list: [
          { _id: O(1), id: 'a', first_name: 'F', created_time: D(T1), is_deleted: false },
        ],
      },
    });
    const db = await clone('longslug');
    await tryRun(d, db, 'longslug');
    const s = await q(db, `SELECT slug FROM organizations ORDER BY id DESC LIMIT 1`);
    const slug = String(s[0]!.slug);
    find(
      `slug "${slug}" length ${slug.length} (orgSlugSchema: 2..40, /^[A-Za-z0-9][A-Za-z0-9_-]*$/)`,
    );
    expect.soft(slug.length, 'org slug must fit the login schema max(40)').toBeLessThanOrEqual(40);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('(b) two clients, same source ids, back to back and interleaved', () => {
  const contacts = (tag: string): J[] =>
    Array.from({ length: 40 }, (_, i) => ({
      _id: O(100 + i),
      id: `same${i}`,
      first_name: `${tag}${i}`,
      email: `${tag}${i}@example.test`,
      created_time: D(T1),
      modified_time: D(T1),
      is_deleted: false,
    }));
  const notes = (tag: string): J[] =>
    Array.from({ length: 10 }, (_, i) => ({
      _id: O(500 + i),
      id: `n${i}`,
      contact_id: `same${i}`,
      context: `${tag} note ${i}`,
      created_at: D(T1),
      updated_at: D(T1),
      is_deleted: false,
    }));
  const mk = async (): Promise<Dumps> =>
    customDumps({
      ca: {
        project: [project(1)],
        contact_list: contacts('CA'),
        contact_notes: notes('CA'),
        contact_tag: [{ _id: O(700), id: 't1', tag_title: 'vip' }],
      },
      cb: {
        project: [project(1)],
        contact_list: contacts('CB'),
        contact_notes: notes('CB'),
        contact_tag: [{ _id: O(700), id: 't1', tag_title: 'vip' }],
      },
    });

  async function checkIsolation(d: Dumps, db: TestDb): Promise<void> {
    const orgs = await q(db, `SELECT id, slug FROM organizations ORDER BY id`);
    console.log('  orgs:', JSON.stringify(orgs));
    expect.soft(orgs.length).toBe(2);
    const per = await q(
      db,
      `SELECT org_id, count(*)::int n, count(DISTINCT legacy_id)::int d, bool_and(name LIKE (CASE WHEN org_id = (SELECT min(id) FROM organizations) THEN 'CA%' ELSE 'CB%' END)) AS names_ok FROM contacts GROUP BY org_id ORDER BY 1`,
    );
    console.log('  contacts per org:', JSON.stringify(per));
    for (const p of per) expect.soft(Number(p.n)).toBe(40);
    const map = await q(
      db,
      `SELECT source_client, count(DISTINCT target_org_id)::int orgs, count(*)::int n FROM migration.id_map GROUP BY 1`,
    );
    console.log('  id_map per client:', JSON.stringify(map));
    for (const m of map) expect.soft(Number(m.orgs)).toBe(1);
    // a note must point at a contact of its own org with the matching tag in the name
    const bad = await q(
      db,
      `SELECT count(*)::int n FROM contact_notes n JOIN contacts c ON c.org_id=n.org_id AND c.id=n.contact_id WHERE substr(n.body,1,2) <> substr(c.name,1,2)`,
    );
    expect.soft(Number(bad[0]!.n), 'note attached to a contact of the other client').toBe(0);
    for (const cl of ['ca', 'cb']) {
      const r = await reconcile({
        source: d.source,
        dumpsDir: d.dir,
        client: cl,
        targetUrl: db.workerUrl,
        sampleSize: 1000,
      });
      console.log(`  reconcile ${cl}: ok=${r.ok} ${JSON.stringify(r.alarms.slice(0, 3))}`);
      expect.soft(r.ok).toBe(true);
    }
  }

  it('sequential', async () => {
    const d = await mk();
    const db = await clone('seq2');
    for (const c of ['ca', 'cb']) expect.soft(await tryRun(d, db, c, { batchSize: 7 })).toBeNull();
    await checkIsolation(d, db);
  });

  it('interleaved (both clients at once, small batches)', async () => {
    const d = await mk();
    const db = await clone('inter2');
    const res = await Promise.all(['ca', 'cb'].map((c) => tryRun(d, db, c, { batchSize: 3 })));
    find('interleaved run results:', JSON.stringify(res.map((x) => x?.slice(0, 160) ?? null)));
    expect.soft(res).toEqual([null, null]);
    // if one failed, finish it sequentially so isolation can still be checked
    for (const c of ['ca', 'cb']) await tryRun(d, db, c, { batchSize: 7 });
    await checkIsolation(d, db);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('(c) same client twice at once', () => {
  it('no duplicates, no deadlock', async () => {
    const dumps = await makeDumps({ bulk: 300 });
    cleanups.push(dumps.cleanup);
    const ref = await clone('conc_ref');
    expect(await tryRun(dumps, ref, 'acme', { batchSize: 40 })).toBeNull();
    const refSnap = await snapshot(ref);
    for (let trial = 0; trial < 3; trial++) {
      const db = await clone(`conc${trial}`);
      const t0 = Date.now();
      const res = await Promise.all([
        tryRun(dumps, db, 'acme', { batchSize: 40 }),
        tryRun(dumps, db, 'acme', { batchSize: 40 }),
      ]);
      find(
        `concurrent trial ${trial}: ${Date.now() - t0} ms, results ${JSON.stringify(res.map((x) => x?.slice(0, 200) ?? null))}`,
      );
      // converge: run once more sequentially
      const fin = await tryRun(dumps, db, 'acme', { batchSize: 40 });
      expect.soft(fin).toBeNull();
      const orgs = await q(db, `SELECT count(*)::int n FROM organizations`);
      const dup = await q(
        db,
        `SELECT (SELECT count(*) FROM (SELECT org_id, legacy_id FROM contacts WHERE legacy_id IS NOT NULL GROUP BY 1,2 HAVING count(*)>1) x)::int dups, (SELECT count(*) FROM contacts)::int n`,
      );
      find(
        `  orgs=${String(orgs[0]!.n)} contacts=${String(dup[0]!.n)} dup legacy_id=${String(dup[0]!.dups)}`,
      );
      expect.soft(Number(orgs[0]!.n)).toBe(1);
      expect
        .soft(
          res,
          'a concurrent second run should fail cleanly or be a no-op, not crash with a raw error',
        )
        .toEqual([null, null]);
      const s = await snapshot(db);
      expect
        .soft(
          s === refSnap,
          'final state after concurrent+converge equals an uninterrupted run (display_id gaps?)',
        )
        .toBe(true);
      if (s !== refSnap) {
        const a = JSON.parse(refSnap) as Record<string, unknown[]>;
        const b = JSON.parse(s) as Record<string, unknown[]>;
        for (const t of Object.keys(a))
          if (JSON.stringify(a[t]) !== JSON.stringify(b[t]))
            find(
              `  table differs after concurrent run: ${t} (${a[t]!.length} vs ${b[t]!.length} rows)`,
            );
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('(d) crash at random points, resume, compare', () => {
  it('in-process crashes (afterBatch / midBatch throw)', async () => {
    const dumps = await makeDumps({ bulk: 150 });
    cleanups.push(dumps.cleanup);
    const ref = await clone('crash_ref');
    expect(await tryRun(dumps, ref, 'acme', { batchSize: 9 })).toBeNull();
    const refSnap = await snapshot(ref);
    const refQ = await q(
      ref,
      `SELECT collection, source_key, reason_code FROM migration.quarantine ORDER BY 1,2,3`,
    );
    const refMap = await q(ref, `SELECT count(*)::int n FROM migration.id_map`);
    let mismatches = 0;
    const N = 12;
    for (let trial = 0; trial < N; trial++) {
      const db = await clone(`crash${trial}`);
      let kills = 0;
      for (let k = 0; k < 4; k++) {
        let calls = 0;
        const at = 1 + Math.floor(Math.random() * 40);
        const mid = Math.random() < 0.5;
        const hook = (): void => {
          if (++calls === at) {
            kills++;
            throw new Error(`simulated crash at ${at}`);
          }
        };
        await tryRun(dumps, db, 'acme', {
          batchSize: 9,
          ...(mid ? { midBatch: hook } : { afterBatch: hook }),
        });
      }
      expect.soft(await tryRun(dumps, db, 'acme', { batchSize: 9 })).toBeNull();
      const s = await snapshot(db);
      const sq = await q(
        db,
        `SELECT collection, source_key, reason_code FROM migration.quarantine ORDER BY 1,2,3`,
      );
      const sm = await q(db, `SELECT count(*)::int n FROM migration.id_map`);
      const same =
        s === refSnap && JSON.stringify(sq) === JSON.stringify(refQ) && sm[0]!.n === refMap[0]!.n;
      if (!same) {
        mismatches++;
        find(
          `crash trial ${trial} (kills=${kills}) DIFFERS from clean run; snapshot equal=${s === refSnap} quarantine equal=${JSON.stringify(sq) === JSON.stringify(refQ)} id_map ${String(sm[0]!.n)} vs ${String(refMap[0]!.n)}`,
        );
        const a = JSON.parse(refSnap) as Record<string, unknown[]>;
        const b = JSON.parse(s) as Record<string, unknown[]>;
        for (const t of Object.keys(a))
          if (JSON.stringify(a[t]) !== JSON.stringify(b[t]))
            find(`   table differs: ${t} (${a[t]!.length} vs ${b[t]!.length})`);
      }
      const r = await reconcile({
        source: dumps.source,
        dumpsDir: dumps.dir,
        client: 'acme',
        targetUrl: db.workerUrl,
        sampleSize: 1000,
      });
      expect.soft(r.ok, `reconcile after crash trial ${trial}`).toBe(true);
    }
    find(`in-process crash trials: ${N - mismatches}/${N} identical to clean run`);
    expect.soft(mismatches).toBe(0);
  });

  it('real SIGKILL of the CLI process at random times', async () => {
    const dumps = await makeDumps({ bulk: 2500 });
    cleanups.push(dumps.cleanup);
    const ref = await clone('kill_ref');
    expect(await tryRun(dumps, ref, 'acme', { batchSize: 100 })).toBeNull();
    const refSnap = await snapshot(ref);
    const cli = (db: TestDb, killAfterMs: number | null): Promise<number | null> =>
      new Promise((resolveP) => {
        const p = spawn(
          process.execPath,
          ['node_modules/tsx/dist/cli.mjs', 'cli.ts', 'run', '--client', 'acme', '--batch', '100'],
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
        if (killAfterMs !== null) setTimeout(() => p.kill('SIGKILL'), killAfterMs);
        p.on('exit', (c) => resolveP(c));
      });
    let bad = 0;
    const N = 5;
    for (let t = 0; t < N; t++) {
      const db = await clone(`sigkill${t}`);
      const codes: Array<number | null> = [];
      for (let k = 0; k < 3; k++)
        codes.push(await cli(db, 2500 + Math.floor(Math.random() * 6000)));
      const fin = await cli(db, null);
      const s = await snapshot(db);
      const same = s === refSnap;
      find(
        `SIGKILL trial ${t}: exit codes of killed runs ${JSON.stringify(codes)}, final exit ${String(fin)}, identical to clean run: ${same}`,
      );
      if (!same) {
        bad++;
        const a = JSON.parse(refSnap) as Record<string, unknown[]>;
        const b = JSON.parse(s) as Record<string, unknown[]>;
        for (const tb of Object.keys(a))
          if (JSON.stringify(a[tb]) !== JSON.stringify(b[tb]))
            find(`   table differs: ${tb} (${a[tb]!.length} vs ${b[tb]!.length})`);
      }
    }
    expect.soft(bad).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('(e)+(f) verifier blind spots', () => {
  it('damage matrix', async () => {
    const dumps = await makeDumps({ bulk: 1500 });
    cleanups.push(dumps.cleanup);
    const base = await clone('bs_base');
    expect(await tryRun(dumps, base, 'acme', { batchSize: 500 })).toBeNull();
    const ver = (db: TestDb, seed = 1) =>
      reconcile({
        source: dumps.source,
        dumpsDir: dumps.dir,
        client: 'acme',
        targetUrl: db.workerUrl,
        seed,
      });
    const ctl = await ver(base);
    find(
      `control (undamaged, default sample 200 of ~1500): ok=${ctl.ok} alarms=${ctl.alarms.length} sample=${ctl.sample.compared}`,
    );
    expect(ctl.ok).toBe(true);

    type Dmg = {
      name: string;
      run: (d: ReturnType<typeof connect>['db']) => Promise<void>;
      seeds?: number;
    };
    // run damage with FK/user triggers disabled (so touch_row does not bump updated_at and mask the change)
    const quiet =
      (text: string): Dmg['run'] =>
      async (d) => {
        await d.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL session_replication_role = replica`);
          await tx.execute(sql.raw(text));
        });
      };
    const one = (t: string, where = ''): string =>
      `(SELECT id FROM ${t} ${where} ORDER BY id LIMIT 1)`;
    const dmgs: Dmg[] = [
      {
        name: 'swap two contacts phones',
        run: quiet(
          `WITH a AS (SELECT id, phone FROM contacts WHERE phone IS NOT NULL ORDER BY id LIMIT 2), s AS (SELECT array_agg(id ORDER BY id) ids, array_agg(phone ORDER BY id) ph FROM a) UPDATE contacts c SET phone = CASE WHEN c.id = s.ids[1] THEN s.ph[2] ELSE s.ph[1] END FROM s WHERE c.id = ANY(s.ids)`,
        ),
      },
      {
        name: 'change contact created_at',
        run: quiet(
          `UPDATE contacts SET created_at = created_at + interval '1 day' WHERE id = ${one('contacts')}`,
        ),
      },
      {
        name: 'change custom value inside data jsonb',
        seeds: 10,
        run: quiet(
          `UPDATE contacts SET data = data || '{"city":"HACKED"}' WHERE id = ${one('contacts', "WHERE data ? 'city'")}`,
        ),
      },
      {
        name: 'add key inside data jsonb',
        seeds: 10,
        run: quiet(
          `UPDATE contacts SET data = data || '{"injected":"1"}' WHERE id = ${one('contacts')}`,
        ),
      },
      {
        name: 'delete a contact_group_member',
        run: quiet(`DELETE FROM contact_group_members WHERE id = ${one('contact_group_members')}`),
      },
      {
        name: 'repoint a group member to another group',
        run: quiet(
          `UPDATE contact_group_members SET group_id = (SELECT max(id) FROM contact_groups) WHERE id = ${one('contact_group_members', 'WHERE group_id <> (SELECT max(id) FROM contact_groups)')}`,
        ),
      },
      {
        name: 'duplicate a contact row (new uuid, same content)',
        run: quiet(
          `INSERT INTO contacts (org_id, name, email, phone, lifecycle_stage, data, legacy_id, created_at, updated_at) SELECT org_id, name, email, phone, lifecycle_stage, data, NULL, created_at, updated_at FROM contacts ORDER BY id LIMIT 1`,
        ),
      },
      {
        name: 'duplicate a note row',
        run: quiet(
          `INSERT INTO contact_notes (org_id, contact_id, body, created_at, updated_at) SELECT org_id, contact_id, body, created_at, updated_at FROM contact_notes ORDER BY id LIMIT 1`,
        ),
      },
      {
        name: 'edit a field_options label',
        run: quiet(
          `UPDATE field_options SET label = label || ' (edited)' WHERE id = ${one('field_options')}`,
        ),
      },
      {
        name: 'change a tag name',
        run: quiet(`UPDATE tags SET name = name || 'X' WHERE id = ${one('tags')}`),
      },
      {
        name: 'truncate a note body',
        run: quiet(
          `UPDATE contact_notes SET body = left(body, 2) WHERE id = ${one('contact_notes')}`,
        ),
      },
      {
        name: 'null an email',
        run: quiet(
          `UPDATE contacts SET email = NULL WHERE id = ${one('contacts', 'WHERE email IS NOT NULL')}`,
        ),
      },
      {
        name: 'EXTRA contact in target, not in source',
        run: quiet(
          `INSERT INTO contacts (org_id, name, phone) SELECT org_id, 'Intruder', '+10000000000' FROM contacts LIMIT 1`,
        ),
      },
      {
        name: 'EXTRA tag in target',
        run: quiet(
          `INSERT INTO tags (org_id, name) SELECT org_id, 'intruder-tag' FROM tags LIMIT 1`,
        ),
      },
      {
        name: 'EXTRA field in target',
        run: quiet(
          `INSERT INTO fields (org_id, module_key, key, label, field_type) SELECT org_id, 'contacts', 'intruder_field', 'x', 'text' FROM fields LIMIT 1`,
        ),
      },
      {
        name: 'EXTRA group member in target',
        run: quiet(
          `INSERT INTO contact_group_members (org_id, contact_id, group_id) SELECT g.org_id, (SELECT max(id) FROM contacts), g.id FROM contact_groups g ORDER BY g.id LIMIT 1`,
        ),
      },
      {
        name: 'EXTRA wa_template in target',
        run: quiet(
          `INSERT INTO wa_templates (org_id, template_name, template_body) SELECT org_id, 'intruder', 'x' FROM contacts LIMIT 1`,
        ),
      },
      {
        name: 'EXTRA event_outbox-like side effect: contact_notes extra',
        run: quiet(
          `INSERT INTO contact_notes (org_id, contact_id, body) SELECT org_id, id, 'intruder note' FROM contacts LIMIT 1`,
        ),
      },
      {
        name: 'contacts.lost_reason changed (not in fingerprint)',
        seeds: 10,
        run: quiet(`UPDATE contacts SET lost_reason = 'HACK' WHERE id = ${one('contacts')}`),
      },
      {
        name: 'contacts.lifecycle_stage_date changed (not in fingerprint)',
        seeds: 10,
        run: quiet(
          `UPDATE contacts SET lifecycle_stage_date = now() WHERE id = ${one('contacts')}`,
        ),
      },
      {
        name: 'contacts.sms_subscription_status changed (not in fingerprint)',
        seeds: 10,
        run: quiet(
          `UPDATE contacts SET sms_subscription_status = 'subscribed' WHERE id = ${one('contacts')}`,
        ),
      },
      {
        name: 'contacts.is_unsubscribed flipped (not in fingerprint)',
        seeds: 10,
        run: quiet(
          `UPDATE contacts SET is_unsubscribed = NOT is_unsubscribed WHERE id = ${one('contacts')}`,
        ),
      },
      {
        name: 'contacts.is_archived = true (unmapped column, hides contact in UI)',
        seeds: 10,
        run: quiet(`UPDATE contacts SET is_archived = true WHERE id = ${one('contacts')}`),
      },
      {
        name: 'contacts.display_id nulled',
        seeds: 10,
        run: quiet(`UPDATE contacts SET display_id = NULL WHERE id = ${one('contacts')}`),
      },
      {
        name: 'contacts.display_id duplicated',
        seeds: 10,
        run: quiet(
          `UPDATE contacts SET display_id = (SELECT display_id FROM contacts ORDER BY id LIMIT 1) WHERE id = (SELECT id FROM contacts ORDER BY id OFFSET 1 LIMIT 1)`,
        ),
      },
      {
        name: 'sequence_counters reset to 0 (next native contact gets CON-00001 again)',
        run: quiet(`UPDATE sequence_counters SET current_value = 0 WHERE module_key = 'contacts'`),
      },
      {
        name: 'fields.position / is_read_only / config changed (not in fingerprint)',
        seeds: 10,
        run: quiet(
          `UPDATE fields SET position = position + 5, is_read_only = NOT is_read_only, config = '{}' WHERE id = ${one('fields', "WHERE key = 'city'")}`,
        ),
      },
      {
        name: 'contact_groups.created_at changed (fp = name only)',
        seeds: 10,
        run: quiet(
          `UPDATE contact_groups SET created_at = created_at + interval '9 days' WHERE id = ${one('contact_groups')}`,
        ),
      },
      {
        name: 'tags.created_at changed (fp = name only)',
        seeds: 10,
        run: quiet(
          `UPDATE tags SET created_at = created_at + interval '9 days' WHERE id = ${one('tags')}`,
        ),
      },
      {
        name: 'status_options.color changed (unmapped column)',
        run: quiet(
          `UPDATE status_options SET color = '#ff0000' WHERE id = ${one('status_options')}`,
        ),
      },
      {
        name: 'organizations.slug/status changed',
        run: quiet(`UPDATE organizations SET status = 'suspended', slug = slug || '-x'`),
      },
      {
        name: 'org_plan_state + workspace_settings + roles deleted',
        run: quiet(
          `DELETE FROM user_roles; DELETE FROM role_grants; DELETE FROM roles; DELETE FROM org_plan_state; DELETE FROM workspace_settings`,
        ),
      },
      {
        name: 'organizations.settings legacy secret value re-added',
        run: quiet(
          `UPDATE organizations SET settings = jsonb_set(settings, '{legacy,waboo,evil}', '{"value":{"auth_token":"FAKE"}}')`,
        ),
      },
      {
        name: 'id_map row deleted only (control: must be caught)',
        run: quiet(
          `DELETE FROM migration.id_map WHERE source_collection='contact_list' AND source_key = (SELECT legacy_id FROM contacts ORDER BY id LIMIT 1)`,
        ),
      },
      {
        name: 'contact deleted AND id_map removed AND bogus quarantine row inserted ("false quarantine")',
        run: quiet(
          `WITH c AS (DELETE FROM contacts WHERE id = (SELECT id FROM contacts WHERE NOT EXISTS (SELECT 1 FROM contact_notes n WHERE n.contact_id = contacts.id) AND NOT EXISTS (SELECT 1 FROM contact_group_members m WHERE m.contact_id = contacts.id) ORDER BY id LIMIT 1) RETURNING legacy_id), m AS (DELETE FROM migration.id_map WHERE source_collection='contact_list' AND source_key IN (SELECT legacy_id FROM c)) INSERT INTO migration.quarantine (source_client, collection, source_key, reason_code, reason) SELECT 'acme','contact_list', legacy_id, 'NO_IDENTITY','fabricated' FROM c`,
        ),
      },
      {
        name: 'whole contact_group_members table truncated',
        run: quiet(`DELETE FROM contact_group_members`),
      },
    ];
    const results: Array<{ name: string; caught: string }> = [];
    for (const dmg of dmgs) {
      const db = await clone('bs', base.name);
      await asOwner(db, async (d) => dmg.run(d));
      const seeds = dmg.seeds ?? 1;
      let caught = 0;
      let first = '';
      for (let s = 1; s <= seeds; s++) {
        const r = await ver(db, s);
        if (!r.ok) {
          caught++;
          if (!first)
            first = (r.alarms[0] ?? r.integrity[0] ?? `unaccounted ${r.unaccounted}`).slice(0, 150);
        }
      }
      results.push({
        name: dmg.name,
        caught: `${caught}/${seeds}${first ? '  e.g. ' + first : ''}`,
      });
      find(
        `DAMAGE [${caught === seeds ? 'caught ' : caught === 0 ? 'MISSED ' : 'PARTIAL'}] ${dmg.name} -> ${caught}/${seeds} ${first}`,
      );
      await db.drop();
      dbs.splice(dbs.indexOf(db), 1);
    }
    const missed = results.filter(
      (r) =>
        r.caught.startsWith('0/') ||
        (/^[1-9]\d*\/\d+/.test(r.caught) &&
          r.caught.split('  ')[0]!.split('/')[0] !== r.caught.split('  ')[0]!.split('/')[1]),
    );
    find('MISSED OR PARTIAL:', missed.map((m) => m.name).join(' | '));
    for (const m of missed)
      expect
        .soft(false, `verifier misses or only partly catches: ${m.name} (${m.caught})`)
        .toBe(true);
  });

  it('(f) dump tamper, manifest check, field-coverage alarm, equation from source', async () => {
    const dumps = await makeDumps({ bulk: 30 });
    cleanups.push(dumps.cleanup);
    const db = await clone('tamper');
    expect(await tryRun(dumps, db, 'acme')).toBeNull();
    const file = join(dumps.dir, 'acme', 'contact_list.ndjson');
    const orig = readFileSync(file, 'utf8');
    // 1. modify dump after manifest, AFTER load: reconcile must say DUMP_CHANGED
    writeFileSync(
      file,
      orig +
        JSON.stringify({
          _id: O(9999),
          id: 'late',
          first_name: 'Late',
          created_time: D(T1),
          is_deleted: false,
        }) +
        '\n',
    );
    let r = await reconcile({
      source: dumps.source,
      dumpsDir: dumps.dir,
      client: 'acme',
      targetUrl: db.workerUrl,
    });
    find(
      'modified dump after load -> reconcile alarms:',
      JSON.stringify(r.alarms.filter((a) => /DUMP_CHANGED/.test(a))),
    );
    expect.soft(r.alarms.some((a) => a.startsWith('DUMP_CHANGED'))).toBe(true);
    // 2. does RUN block a dump that no longer matches its manifest?
    const db2 = await clone('tamper2');
    const err = await tryRun(dumps, db2, 'acme');
    find(
      'RUN against a dump that differs from its manifest ->',
      err ? `blocked: ${err.slice(0, 120)}` : 'NOT BLOCKED (loaded the modified dump)',
    );
    expect
      .soft(err, 'run must refuse a dump whose sha256 no longer matches manifest.json')
      .toBeTruthy();
    // 3. skip-hash flag hides it
    r = await reconcile({
      source: dumps.source,
      dumpsDir: dumps.dir,
      client: 'acme',
      targetUrl: db.workerUrl,
      skipHash: true,
    });
    find(
      'reconcile --skip-hash on modified dump: DUMP_CHANGED present =',
      r.alarms.some((a) => a.startsWith('DUMP_CHANGED')),
      'ok =',
      r.ok,
    );
    writeFileSync(file, orig);

    // 4. never-seen field on a NON-dynamic collection; and on contacts
    const tagFile = join(dumps.dir, 'acme', 'contact_tag.ndjson');
    const tagsRaw = (() => {
      try {
        return readFileSync(tagFile, 'utf8');
      } catch {
        return '';
      }
    })();
    const tagFile2 = tagsRaw ? tagFile : join(dumps.dir, 'acme', 'marketing_list.ndjson');
    const raw2 = readFileSync(tagFile2, 'utf8')
      .trim()
      .split('\n')
      .map((l) => ({ ...(JSON.parse(l) as J), brand_new_field: 'x' }));
    writeFileSync(tagFile2, raw2.map((x) => JSON.stringify(x)).join('\n') + '\n');
    await writeManifest(dumps.source, dumps.dir, 'acme');
    const db3 = await clone('tamper3');
    const e3 = await tryRun(dumps, db3, 'acme');
    r = await reconcile({
      source: dumps.source,
      dumpsDir: dumps.dir,
      client: 'acme',
      targetUrl: db3.workerUrl,
    });
    find(
      `never-seen field on ${tagFile2.split(/[\\/]/).pop()}: run error=${e3}; reconcile alarm=`,
      JSON.stringify(r.alarms.filter((a) => /brand_new_field/.test(a))),
    );
    expect.soft(r.alarms.some((a) => /brand_new_field/.test(a))).toBe(true);
    const cfile = join(dumps.dir, 'acme', 'contact_list.ndjson');
    const cl = readFileSync(cfile, 'utf8')
      .trim()
      .split('\n')
      .map((l) => ({ ...(JSON.parse(l) as J), never_seen_before: 'v' }));
    writeFileSync(cfile, cl.map((x) => JSON.stringify(x)).join('\n') + '\n');
    await writeManifest(dumps.source, dumps.dir, 'acme');
    const db4 = await clone('tamper4');
    await tryRun(dumps, db4, 'acme');
    r = await reconcile({
      source: dumps.source,
      dumpsDir: dumps.dir,
      client: 'acme',
      targetUrl: db4.workerUrl,
    });
    find(
      'never-seen field on contact_list: alarm =',
      JSON.stringify(r.alarms.filter((a) => /never_seen_before/.test(a))),
      'verdict row =',
      JSON.stringify(r.fields.find((f) => f.field === 'never_seen_before')),
    );

    // 5. equation is computed from source: lie in run_log counts and the report must not change
    await asOwner(db4, async (d) => {
      await d.execute(
        sql`UPDATE migration.run_log SET counts = jsonb_build_object('read', 999999)`,
      );
    });
    const r2 = await reconcile({
      source: dumps.source,
      dumpsDir: dumps.dir,
      client: 'acme',
      targetUrl: db4.workerUrl,
    });
    const c = r2.collections.find((x) => x.collection === 'contact_list')!;
    find(
      `equation after run_log lie: contact_list read=${c.read} migrated=${c.migrated} quarantined=${c.quarantined} excluded=${c.excluded}`,
    );
    expect.soft(c.read).toBe(c.migrated + c.quarantined + c.excluded);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('(2/4) side effects, dry run, secrets in reports, prod guard', () => {
  const tableCounts = async (db: TestDb): Promise<Record<string, number>> => {
    const t = await q(
      db,
      `SELECT table_schema||'.'||table_name AS t FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema IN ('public','migration') ORDER BY 1`,
    );
    const out: Record<string, number> = {};
    for (const x of t)
      out[String(x.t)] = Number((await q(db, `SELECT count(*)::int n FROM ${String(x.t)}`))[0]!.n);
    return out;
  };

  it('dry run leaves zero rows in EVERY table; real run writes only the expected tables', async () => {
    const dumps = await makeDumps({ bulk: 20 });
    cleanups.push(dumps.cleanup);
    const db = await clone('sidefx');
    const before = await tableCounts(db);
    expect(await tryRun(dumps, db, 'acme', { dryRun: true })).toBeNull();
    const afterDry = await tableCounts(db);
    const dryDiff = Object.keys(afterDry).filter((k) => afterDry[k] !== before[k]);
    find('tables changed by DRY RUN:', JSON.stringify(dryDiff));
    expect.soft(dryDiff).toEqual([]);
    const seq = await q(db, `SELECT count(*)::int n FROM sequence_counters`);
    find('sequence_counters rows after dry run:', seq[0]!.n);

    expect(await tryRun(dumps, db, 'acme')).toBeNull();
    const afterReal = await tableCounts(db);
    const changed = Object.keys(afterReal).filter((k) => afterReal[k] !== before[k]);
    find(
      'tables changed by REAL run:',
      JSON.stringify(changed.map((k) => `${k}:${before[k]}->${afterReal[k]}`)),
    );
    const forbidden = changed.filter((k) =>
      /outbox|notification|webhook|audit|security_events|conversation|message|flow_run|job|queue|email|campaign|broadcast/i.test(
        k,
      ),
    );
    expect
      .soft(forbidden, 'event_outbox / notification / webhook / audit rows must not be produced')
      .toEqual([]);
    // pending work anywhere?
    const ob = await q(db, `SELECT count(*)::int n FROM event_outbox`);
    expect.soft(Number(ob[0]!.n)).toBe(0);
  });

  it('secrets and PII in logs and reports', async () => {
    const d = await customDumps({
      sec: {
        project: [project(1)],
        project_configuration: [
          {
            _id: O(2),
            config_key: 'k',
            is_json: true,
            config_value: {
              api_key: 'FAKE-KEY-9',
              nested: [{ client_secret: 'FAKE-CS-9' }],
              ok: 1,
            },
            created_time: D(T1),
          },
        ],
        workspace_settings: [
          {
            _id: O(3),
            type: 'x',
            private_key: 'FAKE-PK-9',
            nested: { Authorization: 'FAKE-AUTH-9' },
          },
        ],
        contact_properties_fields: [
          {
            _id: O(4),
            id: 'f1',
            name: 'access_token',
            label: 'access_token',
            type: 'string',
            is_deleted: false,
            parent_id: null,
            secret_note: 'FAKE-FIELD-9',
          },
        ],
        contact_list: [
          {
            _id: O(5),
            id: 'c1',
            first_name: 'Rita',
            email: 'rita.pii@example.test',
            mobile_phone_number: '+919812300001',
            access_token: 'FAKE-TOK-9',
            created_time: D(T1),
            is_deleted: false,
          },
          {
            _id: O(6),
            id: 'c2',
            auth_token: 'FAKE-TOK-10',
            created_time: D(T1),
            is_deleted: false,
          },
        ],
        broadcast_templates: [
          {
            _id: O(7),
            id: 't1',
            type: 'whatsapp',
            name: 'tpl',
            status: 'APPROVED',
            category: 'MARKETING',
            language: 'en',
            components: [{ type: 'BODY', text: 'hi' }],
            access_token: 'FAKE-TPL-9',
          },
        ],
      },
    });
    const db = await clone('sec');
    const logs: string[] = [];
    const err = await tryRun(d, db, 'sec', { log: (l: string) => logs.push(l) });
    find('secrets scenario run error:', err);
    const leak = await q(
      db,
      `SELECT 'settings' w, count(*)::int n FROM organizations WHERE settings::text LIKE '%FAKE-%' UNION ALL SELECT 'contacts', count(*)::int FROM contacts WHERE data::text LIKE '%FAKE-%' UNION ALL SELECT 'quarantine', count(*)::int FROM migration.quarantine WHERE doc::text LIKE '%FAKE-%' UNION ALL SELECT 'fields', count(*)::int FROM fields WHERE config::text LIKE '%FAKE-%' OR key LIKE '%token%' UNION ALL SELECT 'wa_templates', count(*)::int FROM wa_templates WHERE row_to_json(wa_templates)::text LIKE '%FAKE-%'`,
    );
    find('secret-looking values reaching the DB:', JSON.stringify(leak));
    for (const l of leak) expect.soft(Number(l.n), `secret leaked into ${String(l.w)}`).toBe(0);
    const out = mkdtempSync(join(tmpdir(), 'migtool-out-'));
    cleanups.push(() => rmSync(out, { recursive: true, force: true }));
    await reconcile({
      source: d.source,
      dumpsDir: d.dir,
      client: 'sec',
      targetUrl: db.workerUrl,
      outDir: out,
    });
    // damage a phone to make the alarm text appear, then re-report
    await asOwner(db, async (x) => {
      await x.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL session_replication_role = replica`);
        await tx.execute(
          sql`UPDATE contacts SET phone = '+14155550123' WHERE legacy_id = ${oidHex(5)}`,
        );
      });
    });
    await reconcile({
      source: d.source,
      dumpsDir: d.dir,
      client: 'sec',
      targetUrl: db.workerUrl,
      outDir: out,
    });
    const text = readdirSync(join(out, 'sec'))
      .map((f) => readFileSync(join(out, 'sec', f), 'utf8'))
      .join('\n');
    find(
      'PII in reconcile report:',
      JSON.stringify({
        phone: /\+9198123|\+14155550123/.test(text),
        email: /rita\.pii@example\.test/.test(text),
        secret: /FAKE-/.test(text),
      }),
    );
    expect.soft(/FAKE-/.test(text)).toBe(false);
    expect
      .soft(
        /rita\.pii@example\.test|\+9198123|\+14155550123/.test(text),
        'raw phone/email in out/reconcile.* (should be masked)',
      )
      .toBe(false);
    const logText = logs.join('\n');
    expect.soft(/rita\.pii|\+919812|FAKE-/.test(logText), 'PII/secret in run logs').toBe(false);
  });

  it('prod guard: the CLI will happily try a production-looking host', async () => {
    const d = await customDumps({
      g: {
        project: [project(1)],
        contact_list: [{ _id: O(1), id: 'a', first_name: 'F', is_deleted: false }],
      },
    });
    const run = (): Promise<string> =>
      new Promise((res) => {
        let buf = '';
        const p = spawn(
          process.execPath,
          ['node_modules/tsx/dist/cli.mjs', 'cli.ts', 'run', '--client', 'g', '--dry-run'],
          {
            cwd: join(__dirname, '..'),
            env: {
              ...process.env,
              SOURCE_DUMPS_DIR: d.dir,
              TARGET_DATABASE_URL:
                'postgres://crm_worker_user:x@prod-db.geta.internal.invalid:5432/crm_production',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        p.stdout.on('data', (b: Buffer) => (buf += b.toString()));
        p.stderr.on('data', (b: Buffer) => (buf += b.toString()));
        p.on('exit', () => res(buf));
      });
    const out = await run();
    find('CLI output for a prod-looking target:', out.replace(/\s+/g, ' ').slice(0, 300));
    expect
      .soft(
        /refus|production|--i-know|confirm/i.test(out),
        'CLI must refuse production-looking targets without an explicit flag',
      )
      .toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('(g) follow-ups', () => {
  it('string id colliding with another doc ObjectId, across batches (batch size 1)', async () => {
    const c = (n: number, extra: J): J => ({
      _id: O(n),
      id: `ct${n}`,
      created_time: D(T1),
      is_deleted: false,
      ...extra,
    });
    const d = await customDumps({
      coll: {
        project: [project(1)],
        contact_list: [
          c(11, { first_name: 'CollideA' }),
          { ...c(12, { first_name: 'CollideB' }), id: oidHex(11) },
        ],
        contact_notes: [
          {
            _id: O(50),
            id: 'n1',
            contact_id: oidHex(11),
            context: 'note for A by oid',
            created_at: D(T1),
            is_deleted: false,
          },
        ],
      },
    });
    const db = await clone('coll');
    const err = await tryRun(d, db, 'coll', { batchSize: 1 });
    const rows = await q(db, `SELECT legacy_id, name FROM contacts ORDER BY id`);
    find('collision, batch=1: error=', err, 'contacts=', JSON.stringify(rows.map((r) => r.name)));
    const note = await q(
      db,
      `SELECT c.name FROM contact_notes n JOIN contacts c ON c.id = n.contact_id`,
    );
    find('note referencing ObjectId of CollideA attached to:', JSON.stringify(note));
    const r = await reconcile({
      source: d.source,
      dumpsDir: d.dir,
      client: 'coll',
      targetUrl: db.workerUrl,
      sampleSize: 1000,
    });
    find(
      'reconcile on collision data: ok=',
      r.ok,
      JSON.stringify(r.alarms.slice(0, 3)),
      'unaccounted=',
      r.unaccounted,
    );
    expect.soft(rows.length, 'both contacts must load').toBe(2);
  });

  it('staggered concurrent runs of the same client (second starts mid-way)', async () => {
    const dumps = await makeDumps({ bulk: 1500 });
    cleanups.push(dumps.cleanup);
    for (let trial = 0; trial < 3; trial++) {
      const db = await clone(`stag${trial}`);
      const a = tryRun(dumps, db, 'acme', { batchSize: 25 });
      await new Promise((r) => setTimeout(r, 1200 + trial * 700));
      const b = tryRun(dumps, db, 'acme', { batchSize: 25 });
      const res = await Promise.all([a, b]);
      find(`staggered trial ${trial}: ${JSON.stringify(res.map((x) => x?.slice(0, 220) ?? null))}`);
      const fin = await tryRun(dumps, db, 'acme', { batchSize: 25 });
      const dup = await q(
        db,
        `SELECT (SELECT count(*) FROM contacts)::int n, (SELECT count(DISTINCT display_id) FROM contacts)::int dd, (SELECT current_value FROM sequence_counters WHERE module_key='contacts')::int seq, (SELECT count(*) FROM contact_group_members)::int gm`,
      );
      find(
        `  final err=${fin} contacts=${String(dup[0]!.n)} distinct display_ids=${String(dup[0]!.dd)} counter=${String(dup[0]!.seq)} members=${String(dup[0]!.gm)}`,
      );
      const r = await reconcile({
        source: dumps.source,
        dumpsDir: dumps.dir,
        client: 'acme',
        targetUrl: db.workerUrl,
        sampleSize: 1000,
      });
      expect.soft(r.ok, `reconcile after staggered concurrent run ${trial}`).toBe(true);
      expect.soft(res, 'no raw error from the concurrent run').toEqual([null, null]);
      expect
        .soft(Number(dup[0]!.seq), 'display-id counter inflated by the loser run')
        .toBe(Number(dup[0]!.n));
    }
  });
});
