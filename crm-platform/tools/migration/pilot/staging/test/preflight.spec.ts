import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { connect, ensureSchema } from '../../../load/db';
import { STEPS } from '../../../transform';
import { runPreflight, wantedWrites, type Check } from '../preflight';
import { cloneScratch, dropAll, scratchUrls, sqlOn, withDb } from './scratch';

const S = scratchUrls();
const TOOL = resolve(__dirname, '../../..');
const get = (cs: Check[], id: string): Check => cs.find((c) => c.id === id)!;
const pf = (db: { owner: string; worker: string }, extra: object = {}): Promise<Check[]> =>
  runPreflight({ targetUrl: db.worker, ownerUrl: db.owner, orgSlug: 'pf-test-org', ...extra });

afterAll(dropAll);

describe.skipIf(!S)('preflight against the scratch database', () => {
  it('passes on a fully migrated database, before and after init', async () => {
    const db = await cloneScratch('ok');
    const before = await pf(db);
    expect(
      before.filter((c) => c.status === 'FAIL'),
      JSON.stringify(before),
    ).toEqual([]);
    expect(get(before, 'g').details.join(' ')).toMatch(/absent: needs `init`/);
    expect(await pf(db, { afterInit: true }).then((c) => get(c, 'g').status)).toBe('FAIL');
    const o = connect(db.owner, 'init');
    await ensureSchema(o.db);
    await o.close();
    const after = await pf(db, { afterInit: true });
    expect(
      after.filter((c) => c.status === 'FAIL'),
      JSON.stringify(after),
    ).toEqual([]);
    expect(get(after, 'g').details.join(' ')).toMatch(/present: migration\.id_map/);
    // every table the tool writes is covered, including the ones that are not in STEPS (organizations, channels, conversations ...)
    const tables = wantedWrites().map((w) => w.table);
    for (const t of [
      'conversations',
      'channels',
      'organizations',
      'wallets',
      'messages',
      'contacts',
    ])
      expect(tables).toContain(t);
    for (const s of STEPS) for (const t of Object.keys(s.tables)) expect(tables).toContain(t);
  });

  it('fails on a missing, an extra and an edited migration', async () => {
    const db = await cloneScratch('mig');
    const last = readdirSync(resolve(TOOL, '../../packages/db/migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .pop()!
      .replace(/\.sql$/, '');
    await sqlOn(
      db.owner,
      `DELETE FROM _migrations WHERE id = '${last}'`,
      `INSERT INTO _migrations (id, checksum, duration_ms) VALUES ('99990101000000_from_the_future', 'x', 1)`,
      `UPDATE _migrations SET checksum = 'deadbeefdeadbeef' WHERE id = '0001_extensions'`,
    );
    const a = get(await pf(db), 'a');
    expect(a.status).toBe('FAIL');
    const text = a.details.join('\n');
    expect(text).toContain(`NOT applied: ${last}`);
    expect(text).toMatch(/server is BEHIND this checkout.*same revision/);
    expect(text).toContain('99990101000000_from_the_future');
    expect(text).toMatch(/checksum differs.*0001_extensions/);
  });

  it('only warns when the database is AHEAD of the checkout (extra applied migrations): schema check b decides', async () => {
    const db = await cloneScratch('ahead');
    await sqlOn(
      db.owner,
      `INSERT INTO _migrations (id, checksum, duration_ms) VALUES ('99990101000000_from_the_future', 'x', 1)`,
    );
    const checks = await pf(db);
    const a = get(checks, 'a');
    expect(a.status).toBe('WARN');
    expect(a.details.join('\n')).toMatch(/WARN 1 applied migration.*ahead of this checkout.*99990101000000_from_the_future/);
    expect(get(checks, 'b').status).toBe('PASS');
  });

  it('fails clearly when there is no tracking table, or no owner connection to read it', async () => {
    const db = await cloneScratch('nomig');
    await sqlOn(db.owner, 'ALTER TABLE _migrations RENAME TO _m_old');
    const a = get(await pf(db), 'a');
    expect(a.status).toBe('FAIL');
    expect(a.details.join(' ')).toMatch(/_migrations does not exist/);
    const b = get(await runPreflight({ targetUrl: db.worker }), 'a');
    expect(b.status).toBe('FAIL');
    expect(b.details.join(' ')).toMatch(/cannot read the migration ledger/);
  });

  it('fails on a dropped column, a changed type, an unwritten NOT NULL column and a missing table', async () => {
    const db = await cloneScratch('col');
    await sqlOn(db.owner, 'ALTER TABLE tags DROP COLUMN created_at CASCADE');
    let b = get(await pf(db), 'b');
    expect(b.status).toBe('FAIL');
    expect(b.details.join('\n')).toContain('tags.created_at: MISSING');

    await sqlOn(db.owner, 'ALTER TABLE tags ALTER COLUMN name TYPE integer USING length(name)');
    b = get(await pf(db), 'b');
    expect(b.details.join('\n')).toMatch(/tags\.name: type int4, the loader writes citext/);

    await sqlOn(
      db.owner,
      `ALTER TABLE contact_notes ADD COLUMN zz_required text NOT NULL DEFAULT 'x'`,
      'ALTER TABLE contact_notes ALTER COLUMN zz_required DROP DEFAULT',
    );
    b = get(await pf(db), 'b');
    expect(b.details.join('\n')).toMatch(/contact_notes\.zz_required: NOT NULL with no default/);

    await sqlOn(db.owner, 'DROP TABLE wallets CASCADE');
    b = get(await pf(db), 'b');
    expect(b.details.join('\n')).toContain('table wallets: MISSING');
  });

  it('fails on a table with RLS disabled, with RLS not forced, and with no tenant policy', async () => {
    const db = await cloneScratch('rls');
    await sqlOn(db.owner, 'ALTER TABLE tags DISABLE ROW LEVEL SECURITY');
    let c = get(await pf(db), 'c');
    expect(c.status).toBe('FAIL');
    expect(c.details.join('\n')).toMatch(/tags: RLS not enabled/);

    await sqlOn(
      db.owner,
      'ALTER TABLE tags ENABLE ROW LEVEL SECURITY',
      'ALTER TABLE tags NO FORCE ROW LEVEL SECURITY',
    );
    c = get(await pf(db), 'c');
    expect(c.details.join('\n')).toMatch(/tags: RLS not FORCED/);

    await sqlOn(
      db.owner,
      'ALTER TABLE tags FORCE ROW LEVEL SECURITY',
      'DROP POLICY tenant_isolation ON tags',
    );
    c = get(await pf(db), 'c');
    expect(c.details.join('\n')).toMatch(
      /tags: no policy for all commands using current_org_id\(\)/,
    );

    await sqlOn(
      db.owner,
      'CREATE POLICY tenant_isolation ON tags FOR ALL USING (true) WITH CHECK (true)',
    );
    c = get(await pf(db), 'c');
    expect(c.status).toBe('FAIL');
  });

  it('fails for the wrong role: the owner (superuser) and the app login', async () => {
    const db = await cloneScratch('role');
    const asOwner = get(await runPreflight({ targetUrl: db.owner, ownerUrl: db.owner }), 'd');
    expect(asOwner.status).toBe('FAIL');
    expect(asOwner.details.join('\n')).toMatch(/must write as crm_worker_user, this login is crm/);
    expect(asOwner.details.join('\n')).toMatch(/SUPERUSER/);
    const app = withDb(S!.worker, db.name, 'crm_app_user', 'crm_app_dev');
    const asApp = get(await runPreflight({ targetUrl: app, ownerUrl: db.owner }), 'd');
    expect(asApp.status).toBe('FAIL');
    expect(asApp.details.join('\n')).toMatch(/this login is crm_app_user/);
    // the role name can be declared on purpose
    const ok = get(
      await runPreflight({ targetUrl: app, ownerUrl: db.owner, expectRole: 'crm_app_user' }),
      'd',
    );
    expect(ok.details.join('\n')).not.toMatch(/must write as/);
  });

  it('fails when the worker may not call ensure_monthly_partition, unless the steps are skipped', async () => {
    const db = await cloneScratch('part');
    await sqlOn(
      db.owner,
      'REVOKE EXECUTE ON FUNCTION ensure_monthly_partition(regclass, date) FROM PUBLIC, crm_worker, crm_worker_user',
    );
    const d = get(await pf(db), 'd');
    expect(d.status).toBe('FAIL');
    expect(d.details.join('\n')).toMatch(/may not EXECUTE ensure_monthly_partition/);
    expect(get(await pf(db, { skipPartitions: true }), 'd').status).toBe('PASS');
  });

  it('fails without pgvector', async () => {
    const db = await cloneScratch('vec');
    await sqlOn(db.owner, 'DROP EXTENSION vector CASCADE');
    expect(get(await pf(db), 'f').status).toBe('FAIL');
  });

  it('fails when an organization with the planned slug exists, and warns on a plan that does not exist', async () => {
    const db = await cloneScratch('org');
    await sqlOn(
      db.owner,
      `INSERT INTO organizations (uuid, slug, name, plan, settings) VALUES (gen_random_uuid(), 'pf-test-org', 'Taken', 'starter', '{}'::jsonb)`,
    );
    const h = get(await pf(db), 'h');
    expect(h.status).toBe('FAIL');
    expect(h.details.join(' ')).toMatch(/already exists/);
    expect(get(await pf(db, { orgSlug: 'Another Org' }), 'h').status).toBe('PASS');
    expect(get(await pf(db, { orgSlug: 'Another Org', orgPlan: 'no-such-plan' }), 'h').status).toBe(
      'WARN',
    );
  });

  it('the CLI exits 0 / 1, refuses a non-local host, and never prints a URL or a password', async () => {
    const db = await cloneScratch('cli');
    const run = (env: Record<string, string>, args: string[] = []) =>
      spawnSync(
        process.execPath,
        [
          'node_modules/tsx/dist/cli.mjs',
          'pilot/staging/preflight.ts',
          '--org-slug',
          'cli-org',
          ...args,
        ],
        { cwd: TOOL, env: { ...process.env, ...env }, encoding: 'utf8' },
      );
    const good = run({ TARGET_DATABASE_URL: db.worker, MIGRATION_DATABASE_URL: db.owner });
    expect(good.status, good.stdout + good.stderr).toBe(0);
    expect(good.stdout).toContain('PREFLIGHT PASSED');
    await sqlOn(db.owner, 'ALTER TABLE tags DROP COLUMN created_at CASCADE');
    const bad = run({ TARGET_DATABASE_URL: db.worker, MIGRATION_DATABASE_URL: db.owner });
    expect(bad.status).toBe(1);
    const all = bad.stdout + bad.stderr + good.stdout + good.stderr;
    expect(all).not.toMatch(/postgres(ql)?:\/\//);
    expect(all).not.toContain('crm_worker_dev');
    expect(all).not.toContain(new URL(S!.owner).password);
    const remote = run({ TARGET_DATABASE_URL: 'postgres://u:secretpw@db.example.com:5432/crm' });
    expect(remote.status).toBe(1);
    expect(remote.stdout + remote.stderr).not.toContain('secretpw');
    expect(remote.stderr).toMatch(/refusing to run against db\.example\.com/);
    // an unreachable host that IS local: a clean FAIL line, no stack, no URL
    const dead = run({ TARGET_DATABASE_URL: 'postgres://u:secretpw@127.0.0.1:1/crm' });
    expect(dead.status).toBe(1);
    expect(dead.stdout + dead.stderr).not.toContain('secretpw');
  });
});
