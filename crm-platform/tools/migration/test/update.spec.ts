import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { writeManifest } from '../extract/manifest';
import { runClient } from '../load/run';
import { updateRows, type StepUpdate } from '../load/update';
import { asOwner, cloneDb, customDumps, makeDumps, runOpts, verify, type Dumps, type TestDb } from './helpers';
import { acmeBcast } from './bcast-fixtures';

/**
 * Update mode against a real database: load the fixture client, change the dump the way Waboo changes after a first load, run
 * `update`, and check every rule of load/update.ts: dry run writes nothing, only the changed columns move, updated_at takes the source
 * time, row_version bumps, a row edited in WaDesk is left (CONFLICT_LOCAL_EDIT), a document deleted at the source is reported and kept,
 * a membership the contact lost is removed, no outbox/audit rows appear, the second run changes nothing, and the verifier agrees.
 */
const dbs: TestDb[] = [];
const dumps: Dumps[] = [];
afterAll(async () => {
  for (const d of dbs) await d.drop();
  for (const d of dumps) d.cleanup();
});

const hex = (n: number): string => `65f0a1b2${n.toString(16).padStart(16, '0')}`;
const rows = async (db: TestDb, text: string): Promise<Array<Record<string, any>>> =>
  asOwner(db, async (d) => (await d.execute(sql.raw(text))).rows as Array<Record<string, any>>);

/** Rewrite one collection of the dump through `fn` (one call per document) and refresh the manifest. */
async function edit(d: Dumps, collection: string, fn: (doc: Record<string, any>) => void): Promise<void> {
  const file = join(d.dir, 'acme', `${collection}.ndjson`);
  const docs = readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, any>);
  for (const doc of docs) fn(doc);
  writeFileSync(file, docs.map((x) => JSON.stringify(x)).join('\n') + '\n');
  await writeManifest(d.source, d.dir, 'acme');
}

describe('update mode', () => {
  it('updates changed columns only, leaves local edits, reports deletions, is idempotent and verifies', async () => {
    const d = await makeDumps();
    dumps.push(d);
    const db = await cloneDb('update');
    dbs.push(db);
    await runClient(runOpts(d, db, 'acme'));

    // an edit made in WaDesk after the load: contact 3004 (its row_version moves through the touch trigger)
    await rows(db, `UPDATE contacts SET name = 'Local edit' WHERE legacy_id = '${hex(3004)}'`);

    // what changes in Waboo afterwards
    await edit(d, 'contact_list', (c) => {
      if (c.id === 'con-fixture-0000001') {
        c.first_name = 'Asha2';
        c.modified_time = { $date: '2026-09-01T00:00:00.000Z' };
        c.city = 'Mumbai';
        c.marketing_list = [];
      }
      if (c.id === 'con-fixture-0000003') c.is_deleted = true;
      if (c.id === 'con-fixture-0000004') c.email = 'changed.email@example.test';
    });
    await edit(d, 'contact_tag', (t) => {
      if (t.id === 'tag-fixture-000000001') t.tag_title = 'VIP gold';
    });
    await edit(d, 'marketing_list', (l) => {
      if (l.id === 'mkl-fixture-0000000000001') {
        l.name = 'Volunteers 2';
        l.modified_time = { $date: '2026-09-02T00:00:00.000Z' };
      }
    });

    const base = { dumpsDir: d.dir, client: 'acme', orgSlug: 'acme', targetUrl: db.workerUrl, ownerUrl: db.ownerUrl, defaultCountryCode: null, log: () => undefined };
    const side = async (): Promise<string> =>
      JSON.stringify(
        await rows(
          db,
          `SELECT (SELECT count(*) FROM event_outbox) AS outbox, (SELECT count(*) FROM audit_log) AS audit, (SELECT count(*) FROM contact_group_members) AS members`,
        ),
      );
    const content = async (): Promise<string> =>
      JSON.stringify(await rows(db, `SELECT uuid, name, first_name, email, data, updated_at, row_version FROM contacts ORDER BY uuid`));
    const before = await content();
    const sideBefore = await side();
    const by = (r: StepUpdate[], step: string): StepUpdate => r.find((x) => x.step === step)!;

    // dry run: the counts, and not one byte written
    const dry = await updateRows({ ...base, apply: false });
    expect(await content()).toBe(before);
    expect(await side()).toBe(sideBefore);
    expect(by(dry, 'contacts')).toMatchObject({ changed: 1, conflictLocalEdit: 1, sourceExcluded: 1 });
    expect(by(dry, 'contacts').cols).toEqual({ name: 1, first_name: 1, data: 1, updated_at: 1 });
    // the locally edited row differs in the column the user changed, the touched updated_at, and the source's new email
    expect(by(dry, 'contacts').conflictCols).toEqual({ name: 1, email: 1, updated_at: 1 });
    expect(by(dry, 'tags').changed).toBe(1);
    expect(by(dry, 'groups').changed).toBe(1);
    expect(by(dry, 'group_members').pruned).toBe(1);

    // apply
    const done = await updateRows({ ...base, apply: true });
    expect(by(done, 'contacts')).toMatchObject({ changed: 1, conflictLocalEdit: 1, sourceExcluded: 1 });
    const asha = (await rows(db, `SELECT first_name, name, updated_at AT TIME ZONE 'UTC' AS u, row_version, data->>'city' AS city, email, phone FROM contacts WHERE legacy_id = '${hex(3001)}'`))[0]!;
    expect(asha.first_name).toBe('Asha2');
    expect(asha.name).toBe('Asha2 Rao');
    expect(new Date(asha.u + 'Z').toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(Number(asha.row_version)).toBe(2);
    expect(asha.city).toBe('Mumbai');
    expect(asha.email).toBe('asha.rao@example.test'); // a column that did not change is untouched
    const local = (await rows(db, `SELECT name, email, row_version FROM contacts WHERE legacy_id = '${hex(3004)}'`))[0]!;
    expect(local.name).toBe('Local edit'); // the local edit is left
    expect(local.email).toBe('only.email@example.test');
    const gone = (await rows(db, `SELECT count(*)::int AS n FROM contacts WHERE legacy_id = '${hex(3003)}'`))[0]!;
    expect(Number(gone.n)).toBe(1); // deleted at the source: reported, not deleted
    expect((await rows(db, `SELECT name FROM tags WHERE name = 'VIP gold'`)).length).toBe(1);
    expect((await rows(db, `SELECT name FROM contact_groups WHERE name = 'Volunteers 2'`)).length).toBe(1);
    expect(
      Number((await rows(db, `SELECT count(*)::int AS n FROM contact_group_members m JOIN contacts c ON c.id = m.contact_id WHERE c.legacy_id = '${hex(3001)}'`))[0]!.n),
    ).toBe(0);
    const after = JSON.parse(await side())[0];
    const was = JSON.parse(sideBefore)[0];
    expect(after.outbox).toBe(was.outbox);
    expect(after.audit).toBe(was.audit);
    expect(Number(after.members)).toBe(Number(was.members) - 1);
    // the touch trigger is back on
    expect((await rows(db, `SELECT tgenabled FROM pg_trigger WHERE tgname = 'trg_contacts_touch'`))[0]!.tgenabled).toBe('O');

    // second run: nothing changes
    const again = await updateRows({ ...base, apply: true });
    for (const s of again) expect({ step: s.step, changed: s.changed, pruned: s.pruned }).toEqual({ step: s.step, changed: 0, pruned: 0 });
    expect(by(again, 'contacts').conflictLocalEdit).toBe(1);

    // the verifier: the updated contact is right (version recorded, oracle agrees); only the deliberately conflicting one disagrees
    const rep = await verify(d, db, 'acme');
    const mine = rep.alarms.filter((a) => a.includes(hex(3001)));
    expect(mine).toEqual([]);
    expect(rep.alarms.some((a) => a.startsWith('ORACLE_MISMATCH: contacts') && a.includes(hex(3004)))).toBe(true);
  });
});

describe('update mode: broadcasts', () => {
  it('moves a recipient and its campaign counters on, writes nothing that could send, and verifies', async () => {
    const a = acmeBcast();
    const d = await customDumps({ acme: { contact_list: a.contact_list, user: a.user, broadcasting: a.broadcasting, whatsapp_broadcasting_data: a.whatsapp_broadcasting_data } });
    dumps.push(d);
    const db = await cloneDb('update-bcast');
    dbs.push(db);
    await runClient(runOpts(d, db, 'acme', { org: { name: 'acme', slug: 'acme', ownerEmail: 'owner@example.test' } }));

    // Waboo moves one delivered recipient on to "seen" and counts a retry; nothing else changes
    let oid = '';
    await edit(d, 'whatsapp_broadcasting_data', (r) => {
      if (oid || r.source !== 'broadcast' || !r.status?.delivered || r.status?.seen || r.status?.failed) return;
      oid = r._id.$oid;
      r.status.seen = { $date: '2026-05-16T10:00:00.000Z' };
      r.retry_count = 2;
    });
    expect(oid).not.toBe('');
    const mine = async (): Promise<Record<string, any>> =>
      (await rows(db, `SELECT r.status, r.read_at, r.retry_count, r.next_attempt_at, r.send_attempts, r.row_version, r.campaign_id FROM wp_campaign_contacts r JOIN migration.id_map m ON m.target_id = r.id AND m.source_collection = 'whatsapp_broadcasting_data' AND m.source_key = '${oid}'`))[0]!;
    const before = await mine();
    const camp = async (): Promise<number> => Number((await rows(db, `SELECT read_count FROM wpcampaigns WHERE id = ${before.campaign_id}`))[0]!.read_count);
    const readBefore = await camp();

    const base = { dumpsDir: d.dir, client: 'acme', orgSlug: 'acme', targetUrl: db.workerUrl, ownerUrl: db.ownerUrl, defaultCountryCode: null, steps: ['campaigns', 'recipients'], log: () => undefined };
    const by = (r: StepUpdate[], step: string): StepUpdate => r.find((x) => x.step === step)!;
    const dry = await updateRows({ ...base, apply: false });
    expect(await mine()).toEqual(before);
    // the plan is built: nothing comes back as NOT_PLANNED
    expect(by(dry, 'recipients').changed).toBe(1);
    expect(by(dry, 'recipients').excludedKeys.some((k) => k.endsWith(':NOT_PLANNED'))).toBe(false);
    expect(Object.keys(by(dry, 'recipients').cols).sort()).toEqual(['read_at', 'status', 'updated_at']);
    expect(by(dry, 'campaigns').cols.read_count).toBe(1);

    await updateRows({ ...base, apply: true });
    const after = await mine();
    expect(after.status).toBe('read');
    expect(after.read_at).not.toBeNull();
    expect(Number(after.row_version)).toBe(2);
    expect(after.retry_count).toBe(before.retry_count); // never written
    expect(after.next_attempt_at).toBeNull();
    expect(after.send_attempts).toBe(before.send_attempts);
    expect(await camp()).toBe(readBefore + 1);
    const again = await updateRows({ ...base, apply: true });
    for (const s of again) expect(s.changed).toBe(0);

    const rep = await verify(d, db, 'acme');
    const bad = rep.alarms.filter((x) => /wp_campaign_contacts|wpcampaigns/.test(x) && x.includes(oid));
    // the one column update mode leaves alone (retry_count) is the only drift
    expect(bad.every((x) => /retry_count/.test(x) && !/status|read_at/.test(x))).toBe(true);
  });
});
