import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeManifest } from '../../../extract/manifest';
import { NdjsonDirSource } from '../../../extract/source';
import { wantedWrites } from '../preflight';
import { acmeChat, globexChat, MAP_ACME, MAP_GLOBEX } from '../../../test/chat-fixtures';
import { OWNER_EMAIL, writeFixtures } from '../../../test/fixtures';
import { cloneScratch, dropAll, scratchUrls } from './scratch';

/**
 * The bundle (dist/waboo-migrate.cjs, dist/waboo-preflight.cjs) must do exactly what the unbundled tool does. Both run the same commands
 * (init, preflight, run --dry-run, run, reconcile) on the same invented dumps, each into its own clone of the scratch database; the
 * bundle runs from a directory with no node_modules at all.
 */
const S = scratchUrls();
const TOOL = resolve(__dirname, '../../..');
const STAGING = resolve(__dirname, '..');
const work = mkdtempSync(join(tmpdir(), 'waboo-bundle-'));
const BUNDLE_DIR = join(work, 'bundle'); // no node_modules above this directory

const run = (
  how: 'tsx' | 'bundle',
  prog: 'cli' | 'preflight',
  env: Record<string, string>,
  args: string[],
): { status: number | null; out: string } => {
  const file =
    how === 'bundle'
      ? join(BUNDLE_DIR, prog === 'cli' ? 'waboo-migrate.cjs' : 'waboo-preflight.cjs')
      : null;
  const argv =
    how === 'bundle'
      ? [file!, ...args]
      : [
          'node_modules/tsx/dist/cli.mjs',
          prog === 'cli' ? 'cli.ts' : 'pilot/staging/preflight.ts',
          ...args,
        ];
  const r = spawnSync(process.execPath, argv, {
    cwd: how === 'bundle' ? BUNDLE_DIR : TOOL,
    env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

interface Scenario {
  name: string;
  dumps: string;
  clients: Array<{ client: string; extra: string[] }>;
}
const scenarios: Scenario[] = [];

beforeAll(() => {
  execFileSync(process.execPath, [join(STAGING, 'bundle.mjs')], { cwd: TOOL, stdio: 'pipe' });
  mkdirSync(BUNDLE_DIR, { recursive: true });
  cpSync(join(STAGING, 'dist'), BUNDLE_DIR, { recursive: true });
}, 600_000);

afterAll(async () => {
  await dropAll();
  rmSync(work, { recursive: true, force: true });
});

async function dumpsOf(
  name: string,
  fill: (dir: string) => void,
  clients: string[],
): Promise<string> {
  const dir = join(work, `dumps-${name}`);
  mkdirSync(dir, { recursive: true });
  fill(dir);
  const source = new NdjsonDirSource(dir);
  for (const c of clients) await writeManifest(source, dir, c);
  return dir;
}

const ndjson = (dir: string, client: string, coll: string, docs: unknown[]): void => {
  mkdirSync(join(dir, client), { recursive: true });
  writeFileSync(
    join(dir, client, `${coll}.ndjson`),
    docs.map((d) => JSON.stringify(d)).join('\n') + '\n',
  );
};

async function counts(url: string): Promise<Record<string, string>> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const out: Record<string, string> = {};
    const tables = [
      ...wantedWrites().map((w) => w.table),
      'migration.id_map',
      'migration.quarantine',
      'migration.run_log',
    ];
    for (const t of tables) {
      // preset roles, the owner user and workspace_settings get random uuids from the database itself: counted, not digested
      const hasUuid =
        !['roles', 'users', 'workspace_settings'].includes(t) &&
        (
          await c.query(
            `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = 'uuid'`,
            [t.includes('.') ? t.split('.')[0] : 'public', t.split('.').pop()],
          )
        ).rows.length > 0;
      const r = await c.query(
        hasUuid
          ? `SELECT count(*)::text n, md5(coalesce(string_agg(uuid::text, ',' ORDER BY uuid), '')) d FROM ${t}`
          : `SELECT count(*)::text n, '' d FROM ${t}`,
      );
      out[t] = `${r.rows[0].n}:${r.rows[0].d}`;
    }
    return out;
  } finally {
    await c.end();
  }
}

/** The per-step count lines of `run`, which hold no ids, times or paths. */
const stepLines = (out: string): string[] =>
  out
    .split(/\r?\n/)
    .filter((l) => /^ {2}[a-z_]+ +[{]/.test(l) || /^ {2}org /.test(l) || l.startsWith('WARNING'));

describe.skipIf(!S)('the bundle does what the unbundled tool does', () => {
  it('runs init, preflight, run --dry-run, run and reconcile with identical results (contacts, access, inbox)', async () => {
    const base = await dumpsOf('base', (d) => writeFixtures(d, { bulk: 25, access: true }), [
      'acme',
      'globex',
    ]);
    const a = acmeChat();
    const g = globexChat();
    const chat = await dumpsOf(
      'chat',
      (d) => {
        ndjson(d, 'acme', 'contact_list', a.contact_list);
        ndjson(d, 'acme', 'user', a.user);
        ndjson(d, 'acme', 'chathistory', a.chathistory);
        ndjson(d, 'globex', 'contact_list', g.contact_list);
        ndjson(d, 'globex', 'chathistory', g.chathistory);
        writeFileSync(join(d, 'map-acme.json'), JSON.stringify(MAP_ACME));
        writeFileSync(join(d, 'map-globex.json'), JSON.stringify(MAP_GLOBEX));
      },
      ['acme', 'globex'],
    );
    scenarios.push(
      {
        name: 'base',
        dumps: base,
        clients: [
          { client: 'acme', extra: [] },
          { client: 'globex', extra: [] },
        ],
      },
      {
        name: 'chat',
        dumps: chat,
        clients: [
          { client: 'acme', extra: ['--channel-map', join(chat, 'map-acme.json')] },
          { client: 'globex', extra: ['--channel-map', join(chat, 'map-globex.json')] },
        ],
      },
    );

    for (const sc of scenarios) {
      const results: Record<
        'tsx' | 'bundle',
        { steps: string[][]; counts: Record<string, string>; recon: string[] }
      > = {
        tsx: { steps: [], counts: {}, recon: [] },
        bundle: { steps: [], counts: {}, recon: [] },
      };
      for (const how of ['tsx', 'bundle'] as const) {
        const db = await cloneScratch(`${sc.name}${how}`);
        const env = {
          TARGET_DATABASE_URL: db.worker,
          MIGRATION_DATABASE_URL: db.owner,
          SOURCE_DUMPS_DIR: sc.dumps,
        };
        const outDir = join(work, `out-${sc.name}-${how}`);
        const init = run(how, 'cli', env, ['init']);
        expect(init.status, init.out).toBe(0);
        expect(init.out).toContain('migration schema ready');
        const pre = run(how, 'preflight', env, ['--org-slug', 'acme', '--after-init']);
        expect(pre.status, pre.out).toBe(0);
        expect(pre.out).toContain('PREFLIGHT PASSED');

        for (const { client, extra } of sc.clients) {
          const flags = [
            'run',
            '--client',
            client,
            '--org-name',
            client,
            '--org-slug',
            client,
            '--owner-email',
            OWNER_EMAIL,
            '--batch',
            '7',
            ...extra,
          ];
          const before = await counts(db.owner);
          const dry = run(how, 'cli', env, [...flags, '--dry-run']);
          expect(dry.status, dry.out).toBe(0);
          expect(dry.out).toMatch(/dry run, rolled back/);
          expect(await counts(db.owner), 'a dry run must leave no trace').toEqual(before);
          const real = run(how, 'cli', env, flags);
          expect(real.status, real.out).toBe(0);
          results[how].steps.push(stepLines(real.out));
          expect(stepLines(real.out).length).toBeGreaterThan(5);

          const rec = run(how, 'cli', env, [
            'reconcile',
            '--client',
            client,
            '--out',
            outDir,
            ...extra,
          ]);
          expect(rec.status, rec.out).toBe(0);
          expect(rec.out).toMatch(/result: PASS/);
          results[how].recon.push(
            rec.out
              .split(/\r?\n/)
              .filter((l) => !/^report:|^\s*$/.test(l) && !l.includes(outDir))
              .join('\n')
              .replace(/db=pf_\w+/g, 'db=X')
              .replace(/Generated \S+/g, 'Generated T'),
          );
        }
        results[how].counts = await counts(db.owner);
        // the dump files and a re-run are untouched by the bundle: a second real run changes nothing
        const again = run(how, 'cli', env, [
          'run',
          '--client',
          sc.clients[0]!.client,
          '--org-name',
          sc.clients[0]!.client,
          '--org-slug',
          sc.clients[0]!.client,
          '--owner-email',
          OWNER_EMAIL,
          '--batch',
          '7',
          ...sc.clients[0]!.extra,
        ]);
        expect(again.status, again.out).toBe(0);
        expect(await counts(db.owner)).toEqual(results[how].counts);
      }
      expect(results.bundle.steps).toEqual(results.tsx.steps);
      expect(results.bundle.counts).toEqual(results.tsx.counts);
      expect(results.bundle.recon).toEqual(results.tsx.recon);
      const total = Object.values(results.bundle.counts).reduce(
        (n, v) => n + Number(v.split(':')[0]),
        0,
      );
      expect(total, `${sc.name}: something was loaded`).toBeGreaterThan(50);
      console.log(
        `[bundle] ${sc.name}: identical counts on ${Object.keys(results.bundle.counts).length} tables (${total} rows), reconcile PASS for ${sc.clients.map((c) => c.client).join(' + ')}`,
      );
    }
  });

  it('is one self-contained file per program, with a BUILD-INFO that matches', () => {
    const info = JSON.parse(readFileSync(join(BUNDLE_DIR, 'BUILD-INFO.json'), 'utf8'));
    expect(info.nodeTarget).toBe('node22');
    expect(Object.keys(info.files).sort()).toEqual(['waboo-migrate.cjs', 'waboo-preflight.cjs']);
    for (const [name, f] of Object.entries<{ sha256: string; bytes: number }>(info.files)) {
      const buf = readFileSync(join(BUNDLE_DIR, name));
      expect(buf.length).toBe(f.bytes);
      expect(require('node:crypto').createHash('sha256').update(buf).digest('hex')).toBe(f.sha256);
      // no require() of anything that is not a node built-in
      const reqs = [...buf.toString('utf8').matchAll(/\brequire\("([^"]+)"\)/g)].map((m) => m[1]!);
      const builtin = new Set(require('node:module').builtinModules);
      const foreign = [...new Set(reqs)].filter(
        (r) => !builtin.has(r.replace(/^node:/, '')) && r !== 'pg-native',
      );
      expect(foreign, name).toEqual([]);
    }
    expect(info.embedded.migrations.count).toBeGreaterThan(200);
    expect(Object.keys(info.embedded.accessMaps)).toEqual(['permission-map.json', 'role-map.json']);
    expect(info.fsReads.length).toBeGreaterThan(10);
    // the permission-catalogue command loads the embedded maps: it works from a directory with no access/ next to it
    const r = run('bundle', 'cli', { SOURCE_DUMPS_DIR: scenarios[0]!.dumps }, [
      'permission-catalogue',
      '--client',
      'acme',
      '--out',
      join(work, 'cat'),
    ]);
    expect(r.status, r.out).toBe(0);
  });
});
