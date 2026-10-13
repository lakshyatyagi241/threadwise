/**
 * ROUND 3 (final gate). Invented data only. Findings print as `FINDING ...`; unambiguous defects use expect.soft.
 * (a) 34 targeted damages the generic census does not cover, (b) run lock / exit code, (c) SIGKILL during org creation.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { runClient, RunLockedError } from '../load/run';
import { reconcile } from '../reconcile';
import { asOwner, cloneDb, makeDumps, runOpts, type Dumps, type TestDb } from './helpers';

const find = (...a: unknown[]): void => console.log('FINDING', ...a);
const dbs: TestDb[] = [];
const cleanups: Array<() => void> = [];
const clone = async (label: string): Promise<TestDb> => {
  const d = await cloneDb(label);
  dbs.push(d);
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
const ver = (d: Dumps, db: TestDb, client = 'acme') =>
  reconcile({ source: d.source, dumpsDir: d.dir, client, targetUrl: db.workerUrl });

describe('(a) 34 targeted damages', () => {
  it('cross-column, ordering, duplicates, grants, pipeline, flags, partitions, id_map, quarantine', async () => {
    const dumps = await makeDumps();
    cleanups.push(dumps.cleanup);
    const db = await clone('x3');
    await runClient(
      runOpts(dumps, db, 'acme', {
        org: { name: 'acme', slug: 'acme', ownerEmail: 'boss@example.test', ownerName: 'Boss' },
      }),
    );
    const org = Number((await rows(db, "SELECT id FROM organizations WHERE slug = 'acme'"))[0]!.id);
    expect((await ver(dumps, db)).ok).toBe(true);
    const O = String(org);
    const two = `(SELECT id FROM contacts WHERE org_id=${O} AND legacy_id IS NOT NULL ORDER BY id LIMIT 1)`;
    const two2 = `(SELECT id FROM contacts WHERE org_id=${O} AND legacy_id IS NOT NULL ORDER BY id OFFSET 1 LIMIT 1)`;
    const withPhone = `(SELECT id FROM contacts WHERE org_id=${O} AND phone IS NOT NULL ORDER BY id LIMIT 1)`;
    const withEmail = `(SELECT id FROM contacts WHERE org_id=${O} AND email IS NOT NULL ORDER BY id LIMIT 1)`;
    // [label, tables touched (backed up and restored), statements]
    const cases: Array<[string, string[], string]> = [
      [
        'contacts.normalized_phone differs from phone',
        ['contacts'],
        `UPDATE contacts SET normalized_phone = '+19990001111' WHERE id = ${withPhone}`,
      ],
      [
        'contacts.normalized_email differs from email',
        ['contacts'],
        `UPDATE contacts SET normalized_email = 'zz@zz.test' WHERE id = ${withEmail}`,
      ],
      [
        'display_id swap between two contacts',
        ['contacts'],
        `UPDATE contacts c SET display_id = x.d FROM (SELECT id, CASE WHEN id = ${two} THEN (SELECT display_id FROM contacts WHERE id = ${two2}) ELSE (SELECT display_id FROM contacts WHERE id = ${two}) END AS d FROM contacts WHERE id IN (${two}, ${two2})) x WHERE c.id = x.id AND c.org_id = ${O}`,
      ],
      [
        'display_id gap (CON-99999 > counter)',
        ['contacts'],
        `UPDATE contacts SET display_id = 'CON-99999' WHERE id = ${two}`,
      ],
      [
        'display_id gap below counter (CON-00777)',
        ['contacts'],
        `UPDATE contacts SET display_id = 'CON-00777' WHERE id = ${two}`,
      ],
      [
        'updated_at before created_at',
        ['contacts'],
        `UPDATE contacts SET updated_at = created_at - interval '1 day' WHERE id = ${two}`,
      ],
      [
        'created_at +1 microsecond',
        ['contacts'],
        `UPDATE contacts SET created_at = created_at + interval '1 microsecond' WHERE id = ${two}`,
      ],
      [
        'name changed to NFD form (looks identical)',
        ['contacts'],
        `UPDATE contacts SET name = normalize(name || 'é', NFD) WHERE id = ${two}`,
      ],
      [
        'email changed only in case',
        ['contacts'],
        `UPDATE contacts SET email = upper(email) WHERE id = ${withEmail}`,
      ],
      [
        'data value to JSON null',
        ['contacts'],
        `UPDATE contacts SET data = jsonb_set(data, '{city}', 'null') WHERE data ? 'city' AND id = (SELECT id FROM contacts WHERE data ? 'city' ORDER BY id LIMIT 1)`,
      ],
      [
        'data numeric 1 -> 1.0 (benign)',
        ['contacts'],
        `UPDATE contacts SET data = data || '{"zz":1.0}' WHERE id = ${two}`,
      ],
      [
        'lifecycle_stage to a value no status_option has',
        ['contacts'],
        `UPDATE contacts SET lifecycle_stage = 'ghost' WHERE id = ${two}`,
      ],
      [
        'duplicate group member (new uuid)',
        ['contact_group_members'],
        `INSERT INTO contact_group_members (org_id, contact_id, group_id, created_at, updated_at) SELECT org_id, contact_id, group_id, created_at, updated_at FROM contact_group_members WHERE org_id=${O} LIMIT 1`,
      ],
      [
        'two members swap contact',
        ['contact_group_members'],
        `UPDATE contact_group_members m SET contact_id = x.c FROM (SELECT id, lead(contact_id) OVER (ORDER BY id) AS c FROM (SELECT * FROM contact_group_members WHERE org_id=${O} ORDER BY id LIMIT 2) q) x WHERE m.id = x.id AND m.org_id=${O} AND x.c IS NOT NULL`,
      ],
      [
        'duplicate note (new uuid)',
        ['contact_notes'],
        `INSERT INTO contact_notes (org_id, contact_id, body, created_at, updated_at) SELECT org_id, contact_id, body, created_at, updated_at FROM contact_notes WHERE org_id=${O} LIMIT 1`,
      ],
      [
        'delete one role_grant',
        ['role_grants'],
        `DELETE FROM role_grants WHERE org_id=${O} AND id = (SELECT min(id) FROM role_grants WHERE org_id=${O})`,
      ],
      [
        'flip an allow grant to deny',
        ['role_grants'],
        `UPDATE role_grants SET effect='deny' WHERE org_id=${O} AND id = (SELECT min(id) FROM role_grants WHERE org_id=${O} AND effect='allow')`,
      ],
      [
        'extra pipeline stage',
        ['pipeline_stages'],
        `INSERT INTO pipeline_stages (org_id, pipeline_id, name, sort_order) SELECT org_id, pipeline_id, 'Extra', 99 FROM pipeline_stages WHERE org_id=${O} LIMIT 1`,
      ],
      [
        'delete a pipeline stage',
        ['pipeline_stages'],
        `DELETE FROM pipeline_stages WHERE org_id=${O} AND id = (SELECT min(id) FROM pipeline_stages WHERE org_id=${O})`,
      ],
      [
        'org-level feature flag in settings',
        ['organizations'],
        `UPDATE organizations SET settings = jsonb_set(settings, '{features}', '{"beta":true}') WHERE id=${O}`,
      ],
      [
        'org_plan_state.overrides',
        ['org_plan_state'],
        `UPDATE org_plan_state SET overrides = '{"limits":{"users":999}}' WHERE org_id=${O}`,
      ],
      [
        'workspace_settings.plan_overrides',
        ['workspace_settings'],
        `UPDATE workspace_settings SET plan_overrides = '{"x":1}' WHERE org_id=${O}`,
      ],
      [
        'row in the default partition of event_outbox',
        ['event_outbox'],
        `INSERT INTO event_outbox_default (org_id, aggregate_module, aggregate_id, event_type, payload) VALUES (${O}, 'contacts', 1, 'contact.created', '{}')`,
      ],
      [
        'row in audit_log default partition',
        ['audit_log'],
        `INSERT INTO audit_log_default (org_id, action, entity_type, entity_id) VALUES (${O}, 'x', 'contacts', '1')`,
      ],
      [
        'id_map: two contacts swap target ids',
        ['migration.id_map'],
        `UPDATE migration.id_map m SET target_id = x.t FROM (SELECT source_key, lead(target_id) OVER (ORDER BY source_key) AS t FROM (SELECT * FROM migration.id_map WHERE source_client='acme' AND source_collection='contact_list' ORDER BY source_key LIMIT 2) q) x WHERE m.source_client='acme' AND m.source_collection='contact_list' AND m.source_key = x.source_key AND x.t IS NOT NULL`,
      ],
      [
        'id_map: bogus key pointing at a real contact',
        ['migration.id_map'],
        `INSERT INTO migration.id_map (source_client, source_collection, source_key, key_kind, target_table, target_org_id, target_id) SELECT 'acme','contact_list','ffffffffffffffffffffffff','objectid','contacts',${O},id FROM contacts WHERE org_id=${O} LIMIT 1`,
      ],
      [
        'quarantine: delete a field-level soft issue row',
        ['migration.quarantine'],
        `DELETE FROM migration.quarantine WHERE ctid = (SELECT ctid FROM migration.quarantine WHERE source_key LIKE '%#%' LIMIT 1)`,
      ],
      [
        'quarantine: raw doc payload edited',
        ['migration.quarantine'],
        `UPDATE migration.quarantine SET doc = '{"edited":true}' WHERE ctid = (SELECT ctid FROM migration.quarantine LIMIT 1)`,
      ],
      [
        'quarantine: marked resolved',
        ['migration.quarantine'],
        `UPDATE migration.quarantine SET resolved = true`,
      ],
      [
        'run_log: baseline row deleted',
        ['migration.run_log'],
        `DELETE FROM migration.run_log WHERE step='baseline'`,
      ],
      [
        'sequence_counters(contacts) +5',
        ['sequence_counters'],
        `UPDATE sequence_counters SET current_value = current_value + 5 WHERE org_id=${O} AND module_key='contacts'`,
      ],
      ['owner user suspended', ['users'], `UPDATE users SET status='suspended' WHERE org_id=${O}`],
      [
        'contact copied into ANOTHER organization',
        ['contacts'],
        `WITH o AS (INSERT INTO organizations (slug, name, plan) VALUES ('other','Other','starter') RETURNING id) INSERT INTO contacts (org_id, name, legacy_id) SELECT o.id, 'Leak', 'zzz' FROM o`,
      ],
    ];
    await rows(db, 'CREATE SCHEMA IF NOT EXISTS bk');
    const missed: string[] = [];
    let n = 0;
    for (const [label, tables, stmt] of cases) {
      const saved: Array<{ t: string; list: string; where: string }> = [];
      const ok = await asOwner(db, async (d) => {
        const run = async (text: string): Promise<boolean> => {
          try {
            await d.transaction(async (tx) => {
              await tx.execute(sql`SET LOCAL session_replication_role = replica`);
              await tx.execute(sql.raw(text));
            });
            return true;
          } catch (e) {
            const m = (e as { cause?: { message?: string } }).cause?.message ?? String(e);
            find(`  (not applicable: ${label}: ${m.slice(0, 70)})`);
            return false;
          }
        };
        for (const t of tables) {
          const cols = (
            await d.execute(
              sql.raw(
                `SELECT column_name FROM information_schema.columns WHERE table_schema='${t.includes('.') ? t.split('.')[0] : 'public'}' AND table_name='${t.includes('.') ? t.split('.')[1] : t}' AND is_generated='NEVER'`,
              ),
            )
          ).rows as Array<{ column_name: string }>;
          const list = cols.map((c) => `"${c.column_name}"`).join(', ');
          const where =
            t === 'organizations' ? `id=${O}` : t.startsWith('migration.') ? `true` : `true`;
          saved.push({ t, list, where });
          await run(`DROP TABLE IF EXISTS bk.b_${t.replace('.', '_')}`);
          await run(
            `CREATE TABLE bk.b_${t.replace('.', '_')} AS SELECT ${list} FROM ${t.includes('.') ? t : `"${t}"`}`,
          );
        }
        return run(stmt);
      });
      if (ok) {
        n++;
        const r = await ver(dumps, db);
        if (r.ok) missed.push(label);
        find(
          `DAMAGE3 [${r.ok ? 'MISSED ' : 'caught '}] ${label}${r.ok ? '' : ' -> ' + (r.alarms[0] ?? r.integrity[0] ?? '').slice(0, 90)}`,
        );
      }
      // restore
      await asOwner(db, async (d) => {
        for (const s of saved) {
          const tbl = s.t.includes('.') ? s.t : `"${s.t}"`;
          await d.transaction(async (tx) => {
            await tx.execute(sql`SET LOCAL session_replication_role = replica`);
            await tx.execute(sql.raw(`DELETE FROM ${tbl}`));
            await tx.execute(
              sql.raw(
                `INSERT INTO ${tbl} (${s.list}) OVERRIDING SYSTEM VALUE SELECT ${s.list} FROM bk.b_${s.t.replace('.', '_')}`,
              ),
            );
            await tx.execute(sql.raw(`DROP TABLE bk.b_${s.t.replace('.', '_')}`));
          });
        }
        if (label.startsWith('contact copied'))
          await d.execute(sql.raw(`DELETE FROM organizations WHERE slug='other'`));
      });
    }
    find(`DAMAGE3 summary: ${n} applied, ${missed.length} MISSED: ${missed.join(' | ')}`);
    expect((await ver(dumps, db)).ok, 'control after all restores').toBe(true);
    expect.soft(missed).toEqual([]);
    await drop(db);
  });
});

describe('(b) run lock and exit code', () => {
  it('second real run of the same client fails with RunLockedError (exit 3); other clients run in parallel', async () => {
    const dumps = await makeDumps({ bulk: 3000 });
    cleanups.push(dumps.cleanup);
    const db = await clone('lock');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    let started: () => void = () => undefined;
    const up = new Promise<void>((r) => (started = r));
    const a = runClient(
      runOpts(dumps, db, 'acme', {
        batchSize: 100,
        afterBatch: async () => {
          started();
          await gate;
        },
      }),
    );
    await up;
    let msg = '';
    let isLocked = false;
    const t0 = Date.now();
    try {
      await runClient(runOpts(dumps, db, 'acme', { lockWaitSeconds: 2 }));
    } catch (e) {
      isLocked = e instanceof RunLockedError;
      msg = (e as Error).message;
    }
    find(
      `LOCK: second run -> RunLockedError=${isLocked} after ${Date.now() - t0} ms: ${msg.slice(0, 140)}`,
    );
    expect(isLocked).toBe(true);
    // a different client is NOT blocked by acme's lock
    const g = await runClient(runOpts(dumps, db, 'globex')).then(
      () => 'ok',
      (e: Error) => e.message.slice(0, 100),
    );
    find('LOCK: globex while acme holds its lock ->', g);
    expect(g).toBe('ok');
    // a dry run of acme while a real run holds the lock
    const dry = await runClient(
      runOpts(dumps, db, 'acme', { dryRun: true, lockWaitSeconds: 2 }),
    ).then(
      () => 'ok',
      (e: Error) => e.constructor.name + ': ' + e.message.slice(0, 80),
    );
    find('LOCK: dry run of acme while a real run holds the lock ->', dry);
    release();
    await a;
    const r = await ver(dumps, db);
    find('LOCK: after both: reconcile ok =', r.ok);
    expect(r.ok).toBe(true);
    await drop(db);
  });
});

describe('(c) SIGKILL during organization creation', () => {
  it('kill the CLI at 8 offsets around org creation; the next run must finish clean', async () => {
    const dumps = await makeDumps();
    cleanups.push(dumps.cleanup);
    const db = await clone('orgkill');
    const cli = (
      killAfterMs: number | null,
    ): Promise<{ code: number | null; signal: string | null }> =>
      new Promise((resolveP) => {
        const p = spawn(
          process.execPath,
          [
            'node_modules/tsx/dist/cli.mjs',
            'cli.ts',
            'run',
            '--client',
            'acme',
            '--owner-email',
            'boss@example.test',
            '--owner-name',
            'Boss',
          ],
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
        p.on('exit', (code, signal) => resolveP({ code, signal }));
      });
    const res: string[] = [];
    for (const ms of [900, 1100, 1300, 1500, 1700, 1900, 2200, 2600]) {
      const r = await cli(ms);
      res.push(`${ms}:${String(r.code)}/${String(r.signal)}`);
    }
    const fin = await cli(null);
    const s = await rows(
      db,
      "SELECT (SELECT count(*) FROM organizations WHERE slug LIKE 'acme%')::int AS orgs, (SELECT count(*) FROM roles)::int AS roles, (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM migration.run_log WHERE step='baseline')::int AS baselines",
    );
    const v = await ver(dumps, db);
    find(
      `ORGKILL: ${res.join(' ')} final exit ${String(fin.code)} state ${JSON.stringify(s)} reconcile ok ${v.ok} ${v.alarms.slice(0, 2).join(' / ')}`,
    );
    expect(fin.code).toBe(0);
    expect(v.ok).toBe(true);
    await drop(db);
  });
});
