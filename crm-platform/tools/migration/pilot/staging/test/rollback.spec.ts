import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { writeManifest } from '../../../extract/manifest';
import { NdjsonDirSource } from '../../../extract/source';
import { acmeChat, globexChat, MAP_ACME, MAP_GLOBEX } from '../../../test/chat-fixtures';
import { OWNER_EMAIL, writeFixtures } from '../../../test/fixtures';
import { cloneScratch, dropAll, scratchUrls } from './scratch';

/** Step 10 of the runbook: rollback-org.sql removes ONE migrated organization completely and leaves the other one alone. */
const S = scratchUrls();
const TOOL = resolve(__dirname, '../../..');
const SQL = readFileSync(resolve(__dirname, '../rollback-org.sql'), 'utf8');
const work = mkdtempSync(join(tmpdir(), 'waboo-rb-'));
afterAll(async () => {
  await dropAll();
  rmSync(work, { recursive: true, force: true });
});

const tsx = (env: Record<string, string>, args: string[]) => {
  const r = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'cli.ts', ...args], {
    cwd: TOOL,
    env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

/** psql inside the scratch container (the staging server runs the same file through `docker compose exec postgres psql`). */
const psql = (dbName: string, vars: string[]) => {
  const pw = new URL(S!.owner).password;
  const r = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      '-e',
      `PGPASSWORD=${pw}`,
      'waboo-pilot-scratch',
      'psql',
      '-h',
      '127.0.0.1',
      '-U',
      'crm',
      '-d',
      dbName,
      '-X',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      ...vars.flatMap((v) => ['-v', v]),
      '-f',
      '-',
    ],
    { input: SQL, encoding: 'utf8' },
  );
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

async function allCounts(url: string): Promise<Record<string, number>> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const tables = (
      await c.query(
        `SELECT n.nspname || '.' || c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r','p') AND NOT c.relispartition AND n.nspname IN ('public','migration') ORDER BY 1`,
      )
    ).rows.map((r) => r.t as string);
    const out: Record<string, number> = {};
    for (const t of tables)
      out[t] = Number((await c.query(`SELECT count(*) n FROM ${t}`)).rows[0].n);
    return out;
  } finally {
    await c.end();
  }
}

describe.skipIf(!S)('rollback-org.sql', () => {
  it('removes one migrated organization completely and leaves the other untouched', async () => {
    const db = await cloneScratch('rb');
    const dir = join(work, 'dumps');
    mkdirSync(dir, { recursive: true });
    writeFixtures(dir, { bulk: 10, access: true });
    // inbox data for both (channels, conversations, messages, ledger rows) on top of the contact/access fixtures
    const a = acmeChat();
    const g = globexChat();
    const nd = (c: string, coll: string, docs: unknown[]): void =>
      writeFileSync(
        join(dir, c, `${coll}.ndjson`),
        docs.map((d) => JSON.stringify(d)).join('\n') + '\n',
      );
    nd('acme', 'contact_list', [
      ...readNd(join(dir, 'acme', 'contact_list.ndjson')),
      ...a.contact_list,
    ]);
    nd('acme', 'chathistory', a.chathistory);
    nd('globex', 'contact_list', [
      ...readNd(join(dir, 'globex', 'contact_list.ndjson')),
      ...g.contact_list,
    ]);
    nd('globex', 'chathistory', g.chathistory);
    writeFileSync(join(dir, 'map-acme.json'), JSON.stringify(MAP_ACME));
    writeFileSync(join(dir, 'map-globex.json'), JSON.stringify(MAP_GLOBEX));
    const src = new NdjsonDirSource(dir);
    for (const c of ['acme', 'globex']) await writeManifest(src, dir, c);
    const env = {
      TARGET_DATABASE_URL: db.worker,
      MIGRATION_DATABASE_URL: db.owner,
      SOURCE_DUMPS_DIR: dir,
    };
    expect(tsx(env, ['init']).status).toBe(0);
    const empty = await allCounts(db.owner);

    const load = (c: string): void => {
      const r = tsx(env, [
        'run',
        '--client',
        c,
        '--org-name',
        c,
        '--org-slug',
        c,
        '--owner-email',
        `${c}@example.test`,
        '--batch',
        '7',
        '--channel-map',
        join(dir, `map-${c}.json`),
      ]);
      expect(r.status, r.out.slice(0, 3000)).toBe(0);
    };
    load('acme');
    const onlyAcme = await allCounts(db.owner);
    load('globex');
    const both = await allCounts(db.owner);
    expect(both['public.messages']).toBeGreaterThan(onlyAcme['public.messages']!);
    expect(both['public.conversations']).toBeGreaterThan(0);
    const rows = (c: Record<string, number>): number => Object.values(c).reduce((x, y) => x + y, 0);

    // refusals
    const nope = psql(db.name, ['slug=no-such-org']);
    expect(nope.status).not.toBe(0);
    expect(nope.out).toMatch(/no organization with that slug/);
    await (async () => {
      const c = new Client({ connectionString: db.owner });
      await c.connect();
      await c.query(
        `INSERT INTO organizations (uuid, slug, name, plan, settings) VALUES (gen_random_uuid(), 'native-org', 'Native', 'starter', '{}'::jsonb)`,
      );
      await c.end();
    })();
    const native = psql(db.name, ['slug=native-org', 'commit=1']);
    expect(native.status).not.toBe(0);
    expect(native.out).toMatch(/not created by the migration tool/);
    expect((await allCounts(db.owner))['public.organizations']).toBe(
      both['public.organizations']! + 1,
    );
    await (async () => {
      const c = new Client({ connectionString: db.owner });
      await c.connect();
      await c.query(`DELETE FROM organizations WHERE slug = 'native-org'`);
      await c.end();
    })();

    // the dry run reports and changes nothing
    const dry = psql(db.name, ['slug=globex']);
    expect(dry.status, dry.out).toBe(0);
    expect(dry.out).toMatch(/DRY RUN: rolled back/);
    expect(dry.out).toMatch(/messages/);
    expect(await allCounts(db.owner)).toEqual(both);

    // the real one: globex disappears, the database is exactly what it was with acme alone
    const real = psql(db.name, ['slug=globex', 'commit=1']);
    expect(real.status, real.out).toBe(0);
    expect(real.out).toMatch(/COMMITTED/);
    const after = await allCounts(db.owner);
    expect(after).toEqual(onlyAcme);

    // and acme still reconciles
    const rec = tsx(env, [
      'reconcile',
      '--client',
      'acme',
      '--out',
      join(work, 'out'),
      '--channel-map',
      join(dir, 'map-acme.json'),
    ]);
    expect(rec.status, rec.out.slice(0, 2000)).toBe(0);
    expect(rec.out).toMatch(/result: PASS/);

    // removing the other one too gets back to the empty database
    const last = psql(db.name, ['slug=acme', 'commit=1']);
    expect(last.status, last.out).toBe(0);
    expect(await allCounts(db.owner)).toEqual(empty);
    console.log(
      `[rollback] ${rows(both) - rows(onlyAcme)} rows removed with globex, ${rows(onlyAcme) - rows(empty)} with acme; database back to its pre-load counts`,
    );
  });
});

function readNd(file: string): unknown[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
