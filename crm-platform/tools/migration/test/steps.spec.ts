import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { parseChannelMap } from '../inbox/config';
import { runClient, type RunOptions } from '../load/run';
import { formatSteps, selectSteps, STEP_DEPS } from '../load/steps';
import { reconcile } from '../reconcile';
import { STEPS } from '../transform';
import { acmeBcast } from './bcast-fixtures';
import { acmeChat, MAP_ACME } from './chat-fixtures';
import { acmeCredits, OPENING_ACME } from './credits-fixtures';
import { acmeFlows } from './flows-fixtures';
import { asOwner, cloneDb, customDumps, runOpts, type Dumps, type TestDb } from './helpers';

const OWNER = 'owner@example.test';
const opts = (d: Dumps, db: TestDb, extra: Partial<RunOptions> = {}): RunOptions =>
  runOpts(d, db, 'acme', { org: { name: 'acme', slug: 'acme', ownerEmail: OWNER }, ...extra });
const rec = (
  d: Dumps,
  db: TestDb,
  allow = false,
  more: Partial<Parameters<typeof reconcile>[0]> = {},
) =>
  reconcile({
    source: d.source,
    dumpsDir: d.dir,
    client: 'acme',
    targetUrl: db.workerUrl,
    sampleSize: 1000,
    allowExtraRows: allow,
    ...more,
  });
const rows = async (db: TestDb, text: string): Promise<Array<Record<string, any>>> =>
  asOwner(db, async (d) => (await d.execute(sql.raw(text))).rows as Array<Record<string, any>>);

const dbs: TestDb[] = [];
const dumpsList: Dumps[] = [];
afterAll(async () => {
  for (const d of dbs) await d.drop();
  for (const d of dumpsList) d.cleanup();
});
const clone = async (label: string): Promise<TestDb> => {
  const d = await cloneDb(label);
  dbs.push(d);
  return d;
};
const dumpsOf = async (c: Record<string, any[]>): Promise<Dumps> => {
  const d = await customDumps({ acme: c });
  dumpsList.push(d);
  return d;
};

const TABLES = [
  'organizations',
  'users',
  'roles',
  'fields',
  'status_options',
  'tags',
  'contact_groups',
  'contacts',
  'contact_group_members',
  'contact_notes',
  'wpcampaigns',
  'wp_campaign_contacts',
  'flows',
  'keyword_replies',
  'chatbot_widgets',
  'ai_chat_assistants',
  'channels',
  'conversations',
  'messages',
  'wallet_transactions',
  'wallets',
  'ai_token_usage',
  'usage_charges',
  'migration.id_map',
  'migration.quarantine',
];
/** Row counts of every table the steps write, and a digest of the id_map (what maps to what). */
async function state(db: TestDb): Promise<string> {
  const out: Record<string, unknown> = {};
  for (const t of TABLES)
    out[t] = Number((await rows(db, `SELECT count(*)::int AS n FROM ${t}`))[0]!.n);
  out.idmap = (
    await rows(
      db,
      `SELECT md5(string_agg(source_collection || '|' || source_key || '|' || target_table, ',' ORDER BY source_collection, source_key)) AS h FROM migration.id_map`,
    )
  )[0]!.h;
  out.quarantine = (
    await rows(
      db,
      `SELECT md5(string_agg(collection || '|' || source_key || '|' || reason_code, ',' ORDER BY collection, source_key, reason_code)) AS h FROM migration.quarantine`,
    )
  )[0]!.h;
  return JSON.stringify(out);
}

/** Runs the sequence of selections one by one, the whole run at once on another database, and requires the same final state. */
async function staged(
  d: Dumps,
  sequence: string[],
  extra: Partial<RunOptions> = {},
  more: Partial<Parameters<typeof reconcile>[0]> = {},
): Promise<{ db: TestDb; all: TestDb }> {
  const all = await clone('st-all');
  await runClient(opts(d, all, extra));
  const db = await clone('st-staged');
  for (const s of sequence) {
    await runClient(opts(d, db, { ...extra, steps: s.split(',') }));
    // after every stage the steps that ran are fully verified and the others are NOT RUN, never an alarm
    const mid = await rec(d, db, false, more);
    expect(mid.alarms, `after ${s}`).toEqual([]);
  }
  expect(await state(db)).toBe(await state(all));
  const r = await rec(d, db, false, more);
  expect(r.alarms).toEqual([]);
  expect(r.notRun).toEqual([]);
  expect((await rec(d, all, false, more)).alarms).toEqual([]);
  return { db, all };
}

describe('the step list', () => {
  it('names every step in load order with its prerequisites, groups included', () => {
    const names: string[] = STEPS.map((s) => s.handler);
    for (const n of names) expect(Object.keys(STEP_DEPS), n).toContain(n);
    for (const [step, deps] of Object.entries(STEP_DEPS))
      for (const dep of deps)
        expect(names.indexOf(dep), `${step} needs ${dep} first`).toBeLessThan(names.indexOf(step));
    const text = formatSteps();
    expect(text).toMatch(
      /^contacts\s+field_defs, field_undeclared, lifecycle, lifecycle_status, users/m,
    );
    expect(text).toMatch(/^inbox\s+contacts/m);
    expect(text).toMatch(/^flow_bots\s+\S/m);
    expect(STEP_DEPS.flow_bots).toEqual([]); // flows need nothing from contacts
    expect(selectSteps(['access', 'flows'], ['widgets']).selected).not.toContain('widgets');
    expect(selectSteps(['org']).selected).toEqual([]);
    expect(selectSteps().all).toBe(true);
  });
});

describe('selecting steps', () => {
  it('refuses an unknown step and a missing prerequisite before anything is written', async () => {
    const a = acmeBcast();
    const d = await dumpsOf({
      contact_list: a.contact_list,
      user: a.user,
      broadcasting: a.broadcasting,
      whatsapp_broadcasting_data: a.whatsapp_broadcasting_data,
    });
    const db = await clone('st-refuse');
    await expect(runClient(opts(d, db, { steps: ['contacts', 'nonsense'] }))).rejects.toThrow(
      /unknown step "nonsense"/,
    );
    await expect(runClient(opts(d, db, { skipSteps: ['nope'] }))).rejects.toThrow(
      /unknown step "nope"/,
    );
    await expect(runClient(opts(d, db, { steps: ['contacts'] }))).rejects.toThrow(
      /contacts needs users/,
    );
    await expect(runClient(opts(d, db, { steps: ['recipients'] }))).rejects.toThrow(
      /recipients needs campaigns/,
    );
    expect(Number((await rows(db, 'SELECT count(*)::int AS n FROM organizations'))[0]!.n)).toBe(0);
    expect(Number((await rows(db, 'SELECT count(*)::int AS n FROM migration.run_log'))[0]!.n)).toBe(
      0,
    );
    // selected together, or already loaded, it is fine; a skipped prerequisite is refused too
    await expect(runClient(opts(d, db, { skipSteps: ['users'] }))).rejects.toThrow(
      /contacts needs users/,
    );
    await runClient(opts(d, db, { steps: ['users', 'field_undeclared', 'contacts'] }));
    await runClient(opts(d, db, { steps: ['group_members'] })); // contacts are loaded; groups come from the dump's lists, absent here
  });

  it('flows, broadcasts and the people load one step at a time to exactly the state of an all-at-once run', async () => {
    const a = acmeBcast();
    const f = acmeFlows();
    const d = await dumpsOf({
      contact_list: a.contact_list,
      user: a.user,
      broadcasting: a.broadcasting,
      whatsapp_broadcasting_data: a.whatsapp_broadcasting_data,
      ...f,
    });
    const { db } = await staged(d, [
      'fields',
      'access',
      'contacts,group_members',
      'broadcasts',
      'credits',
      'flows',
    ]);
    expect(Number((await rows(db, 'SELECT count(*)::int AS n FROM flows'))[0]!.n)).toBe(4);
  });

  it('chat history loads after the people, with its channel map', async () => {
    const c = acmeChat();
    const d = await dumpsOf({
      contact_list: c.contact_list,
      user: c.user,
      chathistory: c.chathistory,
    });
    const inbox = { channelMap: parseChannelMap(MAP_ACME) };
    await staged(d, ['fields', 'access', 'contacts,group_members', 'chat'], { inbox }, { inbox });
  });

  it('credits load on their own once the opening balance file exists', async () => {
    const c = acmeCredits();
    const d = await dumpsOf({
      contact_list: [],
      credit_logs: c.credit_logs,
      whatsapp_broadcasting_data: c.whatsapp_broadcasting_data,
      user: c.user,
    });
    writeFileSync(join(d.dir, 'acme', 'credit-opening.json'), JSON.stringify(OPENING_ACME));
    await staged(d, ['access', 'fields,contacts,group_members', 'broadcasts', 'credits']);
  });

  it('reconcile after a partial run shows the steps that never ran as NOT RUN, not as an alarm or as unaccounted', async () => {
    const a = acmeBcast();
    const d = await dumpsOf({
      contact_list: a.contact_list,
      user: a.user,
      broadcasting: a.broadcasting,
      whatsapp_broadcasting_data: a.whatsapp_broadcasting_data,
      ...acmeFlows(),
    });
    const db = await clone('st-partial');
    await runClient(opts(d, db, { steps: ['access', 'flows'] }));
    const r = await rec(d, db);
    expect(r.alarms).toEqual([]);
    expect(r.unaccounted).toBe(0);
    expect(r.ok).toBe(true);
    expect(r.notRun).toEqual(expect.arrayContaining(['contacts', 'campaigns', 'recipients']));
    expect(r.notRun).not.toContain('flow_bots');
    const row = (c: string) => r.collections.find((x) => x.collection === c)!;
    expect(row('contact_list')).toMatchObject({
      disposition: 'NOT RUN',
      unaccounted: 0,
      migrated: 0,
    });
    expect(row('broadcasting').disposition).toBe('NOT RUN');
    expect(row('chatbots').disposition).toBe('MIGRATE');
    // a row added to a table of a step that DID run is still caught
    await asOwner(db, (x) =>
      x.execute(
        sql.raw(
          `INSERT INTO flows (org_id, flow_name) SELECT id, 'Extra' FROM organizations LIMIT 1`,
        ),
      ),
    );
    expect((await rec(d, db)).alarms.join('\n')).toMatch(/EXTRA_ROWS/);
  });

  it('a run killed in the middle of a selected step resumes, with the same selection, to the state of a clean run', async () => {
    const a = acmeBcast();
    const d = await dumpsOf({ contact_list: a.contact_list, user: a.user });
    const clean = await clone('st-kill-clean');
    await runClient(opts(d, clean, { steps: ['access'] }));
    await runClient(opts(d, clean, { steps: ['fields', 'contacts', 'group_members'] }));
    const db = await clone('st-kill');
    await runClient(opts(d, db, { steps: ['access'] }));
    await expect(
      runClient(
        opts(d, db, {
          steps: ['fields', 'contacts', 'group_members'],
          batchSize: 3,
          afterBatch: ({ step, batch }) => {
            if (step === 'contacts' && batch === 2) throw new Error('simulated crash');
          },
        }),
      ),
    ).rejects.toThrow(/simulated crash/);
    const partial = Number((await rows(db, 'SELECT count(*)::int AS n FROM contacts'))[0]!.n);
    expect(partial).toBeGreaterThan(0);
    await runClient(opts(d, db, { steps: ['fields', 'contacts', 'group_members'], batchSize: 3 }));
    expect(await state(db)).toBe(await state(clean));
    expect((await rec(d, db)).alarms).toEqual([]);
  });
});
