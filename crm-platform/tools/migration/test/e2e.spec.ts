import { copyFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { connect, withTenant } from '../load/db';
import { insertRows, rowUuid } from '../load/engine';
import { runClient } from '../load/run';
import { contacts } from '../transform/contacts';
import {
  asOwner,
  cloneDb,
  count,
  makeDumps,
  runAll,
  runOpts,
  snapshot,
  verify,
  CLIENTS,
  type Dumps,
  type TestDb,
} from './helpers';
import { O } from './fixtures';

const TABLES = [
  'organizations',
  'field_sections',
  'fields',
  'field_options',
  'field_dependencies',
  'field_option_dependencies',
  'status_options',
  'tags',
  'contact_groups',
  'contacts',
  'contact_group_members',
  'contact_notes',
  'wa_templates',
  'workspace_settings',
  'migration.id_map',
  'migration.quarantine',
];
const totals = async (db: TestDb): Promise<Record<string, number>> =>
  Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await count(db, t)] as const)));
const oid = (n: number): string => String((O(n) as { $oid: string }).$oid);

let dumps: Dumps;
let base: TestDb;
const dbs: TestDb[] = [];
const clone = async (label: string, from?: string): Promise<TestDb> => {
  const d = await cloneDb(label, from);
  dbs.push(d);
  return d;
};

beforeAll(async () => {
  dumps = await makeDumps({ bulk: 25 });
  base = await clone('base');
  await runAll(dumps, base);
});
afterAll(async () => {
  for (const d of dbs) await d.drop();
  dumps.cleanup();
});

describe('(i) full run -> reconcile passes with unaccounted 0', () => {
  it.each(CLIENTS)('%s', async (client) => {
    const r = await verify(dumps, base, client);
    console.log(
      `reconcile ${client}: ok=${r.ok} unaccounted=${r.unaccounted} alarms=${r.alarms.length} integrity=${r.integrity.length}`,
    );
    for (const c of r.collections.filter((x) => x.disposition === 'MIGRATE')) {
      console.log(
        `  ${c.collection.padEnd(52)} read ${c.read} = migrated ${c.migrated} + quarantined ${c.quarantined} + excluded ${c.excluded} (unaccounted ${c.unaccounted})`,
      );
    }
    expect(r.alarms).toEqual([]);
    expect(r.integrity).toEqual([]);
    expect(r.unaccounted).toBe(0);
    expect(r.ok).toBe(true);
    for (const c of r.collections.filter(
      (x) => x.disposition === 'MIGRATE' && x.kind === 'collection',
    )) {
      expect(c.migrated + c.quarantined + c.excluded, c.collection).toBe(c.read);
    }
  });

  it('migrates what it should and sets the right values (acme)', async () => {
    const r = await verify(dumps, base, 'acme');
    const row = (n: string) => r.collections.find((c) => c.collection === n)!;
    expect(row('contact_list')).toMatchObject({
      read: 34,
      migrated: 32,
      quarantined: 1,
      excluded: 1,
    });
    expect(row('contact_tag')).toMatchObject({ migrated: 1, quarantined: 1 });
    expect(row('marketing_list')).toMatchObject({ migrated: 2, excluded: 1 });
    expect(row('contact_notes')).toMatchObject({ migrated: 2, quarantined: 1, excluded: 1 });
    expect(row('broadcast_templates')).toMatchObject({ disposition: 'EXCLUDE', excluded: 3 });
    expect(row('project')).toMatchObject({ disposition: 'EXCLUDE', excluded: 1 });
    expect(row('contact_properties_fields')).toMatchObject({ read: 14, migrated: 13, excluded: 1 });
    const q = r.nonMigrated.map((n) => `${n.collection}:${n.code}`);
    expect(q).toEqual(
      expect.arrayContaining([
        'contact_list:NO_IDENTITY',
        'contact_list:SOFT_DELETED',
        'contact_notes:ORPHAN_CONTACT',
        'contact_notes:PARENT_EXCLUDED',
        'contact_properties_field_options:ORPHAN_PARENT',
        'contact_properties_field_options:PARENT_EXCLUDED',
        'contact_properties_field_dependancy_mapping:SELF_DEPENDENCY',
      ]),
    );

    await asOwner(base, async (d) => {
      const one = async (legacy: string) =>
        (
          await d.execute(
            sql`SELECT name, email, phone, normalized_phone, lifecycle_stage, status, whatsapp_subscription_status, is_unsubscribed, display_id, created_at, data FROM contacts WHERE legacy_id = ${legacy}`,
          )
        ).rows[0] as Record<string, unknown>;
      const asha = await one(oid(3001));
      expect(asha).toMatchObject({
        name: 'Asha Rao',
        email: 'asha.rao@example.test',
        phone: '+919812345671',
        normalized_phone: '+919812345671',
        lifecycle_stage: 'lead',
        status: 'open',
        whatsapp_subscription_status: 'subscribed',
      });
      expect(new Date(String(asha.created_at)).toISOString()).toBe('2026-03-01T10:00:00.000Z');
      expect(asha.data).toMatchObject({
        ratha_yatra_2026: 'Yes',
        attendees: '4',
        test_undeclared: 'x1',
        contact_owner: 5,
      });
      expect(asha.data).not.toHaveProperty('utm_source');
      expect(asha.data).not.toHaveProperty('first_name');
      expect(String(asha.display_id)).toMatch(/^CON-\d{5}$/);
      expect(await one(oid(3002))).toMatchObject({
        phone: '+919812345672',
        lifecycle_stage: 'new',
        whatsapp_subscription_status: 'unsubscribed',
        is_unsubscribed: true,
      });
      expect(await one(oid(3003))).toMatchObject({
        phone: '+919812345673',
        lifecycle_stage: 'customer',
        status: 'won',
      });
      expect(new Date(String((await one(oid(3003))).created_at)).getTime()).toBe(1772359200000);
      expect(await one(oid(3004))).toMatchObject({ phone: '+919812345674', name: null });
      expect(await one(oid(3006))).toMatchObject({ phone: null, name: 'Esha Nair' });
      expect(await one(oid(3008))).toMatchObject({
        email: null,
        phone: null,
        lifecycle_stage: 'new',
      });
      expect(await one(oid(3005))).toBeUndefined();
      expect(await one(oid(3007))).toBeUndefined();
      // karma-like labels
      expect(await one(oid(62001))).toMatchObject({
        lifecycle_stage: 'lead',
        phone: '+442071838750',
        whatsapp_subscription_status: 'subscribed',
      });
      expect(await one(oid(62002))).toMatchObject({
        lifecycle_stage: 'opportunity',
        whatsapp_subscription_status: 'unsubscribed',
      });

      // both ids of a document resolve to the same target
      const ids = (
        await d.execute(
          sql`SELECT source_key, key_kind, target_id FROM migration.id_map WHERE source_client = 'acme' AND source_collection = 'contact_list' AND source_key IN (${oid(3001)}, 'con-fixture-0000001')`,
        )
      ).rows as Array<{ key_kind: string; target_id: number }>;
      expect(ids.map((i) => i.key_kind).sort()).toEqual(['objectid', 'string_id']);
      expect(ids[0]!.target_id).toBe(ids[1]!.target_id);

      // the secrets and rejects stayed out of the contact, in quarantine / redacted
      const quarantined = (
        await d.execute(
          sql`SELECT doc FROM migration.quarantine WHERE source_client = 'acme' AND source_key = ${oid(3006) + '#IMPORT_REJECT_MARKERS'}`,
        )
      ).rows;
      expect(quarantined).toHaveLength(1);
      const org = (
        await d.execute(
          sql`SELECT settings, (SELECT count(*)::int FROM roles r WHERE r.org_id = o.id) AS roles FROM organizations o WHERE slug LIKE 'acme%'`,
        )
      ).rows[0] as {
        settings: Record<string, unknown>;
        roles: number;
      };
      expect(org.roles).toBe(5);
      // project / project_configuration / workspace_settings are not imported: the settings hold only the marker
      expect(org.settings).toEqual({ legacy: { waboo: { client: 'acme' } } });
      expect(
        await d
          .execute(sql`SELECT count(*)::int AS n FROM wa_templates`)
          .then((x) => (x.rows[0] as { n: number }).n),
      ).toBe(0);
      // display-id counter is at or above the highest imported id
      const maxId = Number(
        (
          (
            await d.execute(
              sql`SELECT max(substr(display_id, 5)::int) AS m FROM contacts c JOIN organizations o ON o.id = c.org_id WHERE o.slug LIKE 'acme%'`,
            )
          ).rows[0] as { m: number }
        ).m,
      );
      const counter = Number(
        (
          (
            await d.execute(
              sql`SELECT current_value FROM sequence_counters s JOIN organizations o ON o.id = s.org_id WHERE o.slug LIKE 'acme%' AND module_key = 'contacts'`,
            )
          ).rows[0] as { current_value: number }
        ).current_value,
      );
      expect(counter).toBeGreaterThanOrEqual(maxId);
      // no outbox rows, no notifications
      expect(
        await d
          .execute(sql`SELECT count(*)::int AS n FROM event_outbox`)
          .then((x) => (x.rows[0] as { n: number }).n),
      ).toBe(0);
    });
  });

  it('writes the json + markdown report and lists what is not present in WaDesk', async () => {
    const { mkdtempSync, readFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const out = mkdtempSync(join(tmpdir(), 'migtool-out-'));
    const { reconcile } = await import('../reconcile');
    await reconcile({
      source: dumps.source,
      dumpsDir: dumps.dir,
      client: 'acme',
      targetUrl: base.workerUrl,
      outDir: out,
    });
    const md = readFileSync(join(out, 'acme', 'reconcile.md'), 'utf8');
    expect(existsSync(join(out, 'acme', 'reconcile.json'))).toBe(true);
    expect(md).toContain('NOT PRESENT IN WADESK');
    expect(md).toContain('contact_task_config');
    expect(md).toContain('PASS');
    rmSync(out, { recursive: true, force: true });
  });
});

describe('(ii) idempotent: a second run inserts nothing', () => {
  it('re-run with --force, then with id_map and checkpoints wiped, adds 0 rows', async () => {
    const db = await clone('idem');
    await runAll(dumps, db);
    const before = await totals(db);
    const snap = await snapshot(db);
    await runAll(dumps, db, { force: true });
    expect(await totals(db)).toEqual(before);
    // lose all provenance: the deterministic uuids + ON CONFLICT keep the data single
    await asOwner(db, async (d) => {
      await d.execute(sql`TRUNCATE migration.id_map, migration.run_log`);
    });
    await runAll(dumps, db);
    const after = await totals(db);
    expect(after).toEqual(before);
    expect(await snapshot(db)).toBe(snap);
    for (const c of CLIENTS) expect((await verify(dumps, db, c)).ok).toBe(true);
    console.log('idempotency: row counts identical after 2 more runs', JSON.stringify(after));
  });
});

describe('(iii) kill and resume gives the identical result', () => {
  it('crash after a committed batch, and crash inside a batch (rolled back), then resume', async () => {
    const db = await clone('resume');
    let crashes = 0;
    await expect(
      runClient(
        runOpts(dumps, db, 'acme', {
          batchSize: 5,
          afterBatch: ({ step, batch }) => {
            if (step === 'contacts' && batch === 2) {
              crashes++;
              throw new Error('simulated kill after batch 2');
            }
          },
        }),
      ),
    ).rejects.toThrow(/simulated kill/);
    await expect(
      runClient(
        runOpts(dumps, db, 'acme', {
          batchSize: 5,
          midBatch: ({ step, batch }) => {
            if (step === 'contacts' && batch === 4) {
              crashes++;
              throw new Error('simulated kill inside batch 4');
            }
          },
        }),
      ),
    ).rejects.toThrow(/inside batch 4/);
    expect(crashes).toBe(2);
    const partial = await count(db, 'contacts');
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(32);
    await runClient(runOpts(dumps, db, 'acme', { batchSize: 5 }));
    await runClient(runOpts(dumps, db, 'globex', { batchSize: 5 }));
    for (const c of CLIENTS) expect((await verify(dumps, db, c)).ok).toBe(true);
    const [a, b] = [
      JSON.parse(await snapshot(db)) as Record<string, unknown[]>,
      JSON.parse(await snapshot(base)) as Record<string, unknown[]>,
    ];
    for (const t of Object.keys(b)) expect(a[t], `table ${t}`).toEqual(b[t]);
    console.log(
      `resume: killed with ${partial} of 32 acme contacts loaded; final snapshot identical to the uninterrupted run`,
    );
  });
});

describe('(iv) mutation tests: the verifier catches damage', () => {
  const mutate = async (
    label: string,
    change: (d: Awaited<ReturnType<typeof clone>>) => Promise<void>,
    client = 'acme',
  ) => {
    const db = await clone(label, base.name);
    await change(db);
    return verify(dumps, db, client);
  };
  const del = (where: string) => (db: TestDb) =>
    asOwner(db, async (d) => {
      await d.execute(sql.raw(where));
    });

  it('a deleted target row', async () => {
    const r = await mutate('mdel', del(`DELETE FROM contacts WHERE legacy_id = '${oid(3003)}'`));
    expect(r.ok).toBe(false);
    expect(r.unaccounted).toBeGreaterThan(0);
    expect(r.alarms.join('\n')).toMatch(
      /TARGET_MISSING: contacts row for contact_list 65f0a1b2\w+ /,
    );
    console.log('  caught delete ->', r.alarms[0]);
  });
  it('an altered phone', async () => {
    const r = await mutate(
      'mphone',
      del(`UPDATE contacts SET phone = '+15550001111' WHERE legacy_id = '${oid(3001)}'`),
    );
    expect(r.ok).toBe(false);
    expect(r.alarms.join('\n')).toMatch(
      /FINGERPRINT_MISMATCH: contacts contact_list \w+: .*phone source=\*\*\*71 target=\*\*\*11/,
    );
    console.log(
      '  caught phone ->',
      r.alarms.find((a) => a.includes('phone')),
    );
  });
  it('a changed lifecycle stage', async () => {
    const r = await mutate(
      'mlife',
      del(`UPDATE contacts SET lifecycle_stage = 'customer' WHERE legacy_id = '${oid(3001)}'`),
    );
    expect(r.ok).toBe(false);
    expect(r.alarms.join('\n')).toMatch(
      /FINGERPRINT_MISMATCH: contacts .*lifecycle_stage source=lead target=customer/,
    );
    console.log(
      '  caught lifecycle ->',
      r.alarms.find((a) => a.includes('lifecycle')),
    );
  });
  it('an orphaned note', async () => {
    const r = await mutate('morphan', (db) =>
      asOwner(db, (d) =>
        d.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL session_replication_role = replica`); // switch FK enforcement off for this one statement
          await tx.execute(sql.raw(`DELETE FROM contacts WHERE legacy_id = '${oid(3001)}'`));
        }),
      ),
    );
    expect(r.ok).toBe(false);
    expect(r.integrity.join('\n')).toMatch(/ORPHANS: \d+ rows in contact_notes -> contacts/);
    console.log('  caught orphan ->', r.integrity[0]);
  });
  it('a dropped field mapping', async () => {
    const r = await mutate('mfield', del(`DELETE FROM fields WHERE key = 'test_undeclared'`));
    expect(r.ok).toBe(false);
    expect(r.alarms.join('\n')).toMatch(
      /FIELD_UNMAPPED: contact_list\.test_undeclared \(\d+ docs\) has no mapping and no fields row/,
    );
    console.log(
      '  caught field ->',
      r.alarms.find((a) => a.startsWith('FIELD_UNMAPPED')),
    );
  });
  it('an unknown collection', async () => {
    const file = join(dumps.dir, 'acme', 'mystery_collection.ndjson');
    writeFileSync(
      file,
      `{"_id":{"$oid":"${oid(9999)}"},"a":1}\n{"_id":{"$oid":"${oid(9998)}"},"a":2}\n`,
    );
    try {
      const r = await verify(dumps, base, 'acme');
      expect(r.ok).toBe(false);
      expect(r.unaccounted).toBe(2);
      expect(r.alarms.join('\n')).toMatch(
        /UNKNOWN_COLLECTION: mystery_collection \(2 docs\) is not in the registry/,
      );
      await expect(runClient(runOpts(dumps, await clone('munk'), 'acme'))).rejects.toThrow(
        /collections not in the registry: mystery_collection/,
      );
      console.log(
        '  caught unknown ->',
        r.alarms.find((a) => a.startsWith('UNKNOWN')),
      );
    } finally {
      rmSync(file);
    }
  });
  it('a changed dump (hash differs from the manifest)', async () => {
    const f = join(dumps.dir, 'acme', 'contact_tag.ndjson');
    const copy = join(dumps.dir, 'contact_tag.bak');
    copyFileSync(f, copy);
    try {
      writeFileSync(
        f,
        `${(await import('node:fs')).readFileSync(f, 'utf8')}{"_id":{"$oid":"${oid(9997)}"},"id":"x","tag_title":"sneaky"}\n`,
      );
      const r = await verify(dumps, base, 'acme');
      expect(r.ok).toBe(false);
      expect(r.alarms.join('\n')).toMatch(/DUMP_CHANGED: contact_tag/);
    } finally {
      copyFileSync(copy, f);
      rmSync(copy);
    }
  });
});

describe('(v) RLS: the loader cannot write a row into the wrong org', () => {
  it('insert with another org id fails; the right org works', async () => {
    const orgs = await asOwner(
      base,
      async (d) =>
        (
          await d.execute(
            sql`SELECT id FROM organizations WHERE slug LIKE 'acme%' OR slug LIKE 'globex%' ORDER BY slug`,
          )
        ).rows as Array<{ id: number }>,
    );
    expect(orgs).toHaveLength(2);
    const [a, b] = [Number(orgs[0]!.id), Number(orgs[1]!.id)];
    const w = connect(base.workerUrl, 'rls');
    try {
      const spec = contacts.tables.contacts!;
      const item = {
        uuid: rowUuid('x', 'contact_list', 'rls-probe', ''),
        row: {
          name: 'Probe',
          legacy_id: 'rls-probe',
          lifecycle_stage: 'new',
          data: {},
          is_unsubscribed: false,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      };
      const wrong = await withTenant(w.db, { orgId: a }, (tx) =>
        insertRows(tx, b, 'contacts', spec, [item]),
      ).catch((e: unknown) => e as { message: string; cause?: { message: string } });
      expect(wrong).toBeInstanceOf(Error);
      expect((wrong as { cause?: { message: string } }).cause?.message).toMatch(
        /row-level security/i,
      );
      const ok = await withTenant(w.db, { orgId: a }, async (tx) => {
        const got = await insertRows(tx, a, 'contacts', spec, [item]);
        await tx.execute(sql`DELETE FROM contacts WHERE legacy_id = 'rls-probe'`);
        return got.size;
      });
      expect(ok).toBe(1);
      // and an org-a session cannot see org-b contacts at all
      const seen = await withTenant(w.db, { orgId: a }, (tx) =>
        tx.execute(sql`SELECT count(*)::int AS n FROM contacts WHERE org_id = ${b}`),
      );
      expect((seen.rows[0] as { n: number }).n).toBe(0);
    } finally {
      await w.close();
    }
  });
});

describe('(vi) dry run leaves zero rows', () => {
  it('runs the full transform and validation, prints the plan, writes nothing', async () => {
    const db = await clone('dry');
    const before = await totals(db);
    const lines: string[] = [];
    const s = await runClient(
      runOpts(dumps, db, 'acme', { dryRun: true, log: (l) => lines.push(l) }),
    );
    expect(s.steps.contacts).toMatchObject({ migrated: 32, quarantined: 1, excluded: 1 });
    expect(lines.join('\n')).toContain('DRY RUN plan for acme');
    expect(await totals(db)).toEqual(before);
    expect(await count(db, 'migration.run_log')).toBe(0);
    expect(await count(db, 'organizations')).toBe(before.organizations);
    console.log(lines.filter((l) => l.startsWith('contacts') || l.includes('DRY RUN')).join('\n'));
  });
});
