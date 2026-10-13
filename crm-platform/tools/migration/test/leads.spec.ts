import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { runClient, type RunOptions } from '../load/run';
import { reconcile } from '../reconcile';
import { resolve } from '../registry';
import { STEPS } from '../transform';
import { selectSteps } from '../load/steps';
import { asOwner, cloneDb, customDumps, runOpts, type Dumps, type TestDb } from './helpers';
import { acmeLeads, globexLeads } from './leads-fixtures';

/** INVENTED fixtures only (test/leads-fixtures.ts). Shapes follow the real contact_attribution dump and the masked leadrepo / leads profiles. */
const BULK = 14;
const opts = (d: Dumps, db: TestDb, client: 'acme' | 'globex', extra: Partial<RunOptions> = {}) =>
  runOpts(d, db, client, extra);
const check = (d: Dumps, db: TestDb, client: 'acme' | 'globex', allowExtraRows = false) =>
  reconcile({
    source: d.source,
    dumpsDir: d.dir,
    client,
    targetUrl: db.workerUrl,
    sampleSize: 1000,
    allowExtraRows,
  });
const rows = async (db: TestDb, text: string): Promise<Array<Record<string, any>>> =>
  asOwner(db, async (d) => (await d.execute(sql.raw(text))).rows as Array<Record<string, any>>);
const one = async (db: TestDb, text: string): Promise<number> =>
  Number((await rows(db, text))[0]!.n);

/** Content that does not depend on ids or timing: two clean runs must agree on it. */
async function snapshot(db: TestDb): Promise<string> {
  const s = await rows(
    db,
    `SELECT uuid::text, to_jsonb(s) - 'id' - 'org_id' AS rest FROM lead_sources s ORDER BY uuid`,
  );
  const e = await rows(
    db,
    `SELECT e.uuid::text, ls.uuid::text AS src, c.legacy_id AS contact, to_jsonb(e) - 'id' - 'org_id' - 'source_id' - 'contact_id' AS rest
     FROM lead_events e JOIN lead_sources ls ON ls.org_id = e.org_id AND ls.id = e.source_id
     LEFT JOIN contacts c ON c.org_id = e.org_id AND c.id = e.contact_id ORDER BY e.uuid`,
  );
  const a = await rows(
    db,
    `SELECT a.uuid::text, c.legacy_id AS contact, to_jsonb(a) - 'id' - 'org_id' - 'contact_id' AS rest
     FROM contact_attributions a JOIN contacts c ON c.org_id = a.org_id AND c.id = a.contact_id ORDER BY a.uuid`,
  );
  return JSON.stringify({ s, e, a });
}
const TABLES = [
  'lead_sources',
  'lead_events',
  'contact_attributions',
  'migration.id_map',
  'migration.quarantine',
];
const totals = async (db: TestDb): Promise<Record<string, number>> =>
  Object.fromEntries(
    await Promise.all(
      TABLES.map(async (t) => [t, await one(db, `SELECT count(*)::int AS n FROM ${t}`)] as const),
    ),
  );

let dumps: Dumps;
let base: TestDb;
const dbs: TestDb[] = [];
const clone = async (label: string, from?: string): Promise<TestDb> => {
  const d = await cloneDb(label, from);
  dbs.push(d);
  return d;
};

beforeAll(async () => {
  const a = acmeLeads(BULK);
  const g = globexLeads();
  dumps = await customDumps({
    acme: {
      contact_list: a.contact_list,
      leadrepo: a.leadrepo,
      leads: a.leads,
      contact_attribution: a.contact_attribution,
    },
    globex: {
      contact_list: g.contact_list,
      leadrepo: g.leadrepo,
      contact_attribution: g.contact_attribution,
    },
  });
  base = await clone('ld-base');
  await runClient(opts(dumps, base, 'acme'));
  await runClient(opts(dumps, base, 'globex'));
}, 1_800_000);

afterAll(async () => {
  for (const d of dbs) await d.drop();
  dumps.cleanup();
});

describe('registry and order', () => {
  it('the three lead collections are migrated, the dictionaries and the audit log are not', () => {
    expect(resolve('leadrepo')).toMatchObject({ disposition: 'MIGRATE', handler: 'lead_events' });
    expect(resolve('leads')).toMatchObject({
      disposition: 'MIGRATE',
      handler: 'lead_events_leads',
    });
    expect(resolve('contact_attribution')).toMatchObject({
      disposition: 'MIGRATE',
      handler: 'attributions',
    });
    for (const c of ['medium_registry', 'source_registry', 'contact_attribution_audit_log'])
      expect(resolve(c).disposition, c).toBe('EXCLUDE');
  });
  it('the lead steps come after contacts and the sources before their events', () => {
    const order = STEPS.map((s) => s.handler);
    expect(order.indexOf('contacts')).toBeLessThan(order.indexOf('lead_sources'));
    expect(order.indexOf('lead_sources')).toBeLessThan(order.indexOf('lead_events'));
    expect(order.indexOf('lead_events')).toBeLessThan(order.indexOf('lead_events_leads'));
    expect(selectSteps(['leads']).selected).toEqual([
      'lead_sources',
      'lead_events',
      'lead_events_leads',
      'attributions',
    ]);
  });
});

describe('what loads', () => {
  it('reconcile passes on both clients (equation, every column against the independent oracle, safety)', async () => {
    for (const c of ['acme', 'globex'] as const) {
      const r = await check(dumps, base, c);
      expect(r.alarms, c).toEqual([]);
      expect(r.integrity, c).toEqual([]);
      expect(r.ok).toBe(true);
      for (const row of r.collections.filter((x) =>
        ['leadrepo', 'leads', 'contact_attribution'].includes(x.collection),
      ))
        expect(row.unaccounted, row.collection).toBe(0);
    }
  });

  it('loads, quarantines and excludes exactly the documents the fixtures are built to', async () => {
    const org = `(SELECT id FROM organizations WHERE slug = 'acme')`;
    expect(
      await one(base, `SELECT count(*)::int AS n FROM lead_sources WHERE org_id = ${org}`),
    ).toBe(2);
    expect(
      await one(base, `SELECT count(*)::int AS n FROM lead_events WHERE org_id = ${org}`),
    ).toBe(5 + BULK + 1);
    expect(
      await one(base, `SELECT count(*)::int AS n FROM contact_attributions WHERE org_id = ${org}`),
    ).toBe(4);
    const q = await rows(
      base,
      `SELECT collection, reason_code, count(*)::int AS n FROM migration.quarantine WHERE source_client = 'acme' AND position('#' in source_key) = 0 GROUP BY 1, 2 ORDER BY 1, 2`,
    );
    expect(q.map((r) => `${r.collection}:${r.reason_code}:${r.n}`)).toEqual([
      'contact_attribution:CONTACT_NOT_MIGRATED:1',
      'contact_attribution:NO_SOURCE_LABEL:1',
      'leadrepo:CONTACT_NOT_MIGRATED:1',
      'leadrepo:NO_CONTACT_ID:1',
      'leads:NO_CONTACT_ID:1',
    ]);
    // the repeated primary key is the engine's DUPLICATE_KEY, under key#dupN
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM migration.quarantine WHERE source_client = 'acme' AND reason_code = 'DUPLICATE_KEY'`,
      ),
    ).toBe(1);
  });

  it('imported leads are finished, quiet history under paused connector sources', async () => {
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM lead_events WHERE status <> 'created' OR is_test OR deal_id IS NOT NULL OR reason IS NOT NULL OR attempts <> 1 OR payload_expires_at IS NULL`,
      ),
    ).toBe(0);
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM lead_sources WHERE status <> 'paused' OR kind <> 'connector' OR token_hash IS NOT NULL OR secret_enc IS NOT NULL`,
      ),
    ).toBe(0);
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM event_outbox WHERE event_type LIKE 'lead.%' OR aggregate_module LIKE 'lead%'`,
      ),
    ).toBe(0);
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM contact_attributions WHERE lead_event_id IS NOT NULL OR source_id IS NOT NULL`,
      ),
    ).toBe(0);
  });

  it('keeps the dynamic form answers in payload.fields, scrubbed, and the campaign and device keys apart', async () => {
    const l1 = (
      await rows(
        base,
        `SELECT payload FROM lead_events WHERE external_id = 'leadrepo:${(acmeLeads().leadrepo[0]!._id as { $oid: string }).$oid}'`,
      )
    )[0]!.payload as Record<string, any>;
    expect(l1.fields.ratha_yatra_2026).toBe('yes');
    expect(l1.fields.attendees).toBe('4');
    expect(l1.fields.patron_code).toBe('PAT12345');
    expect(l1.attribution.source).toBe('hitpay_patron_webhook');
    expect(l1.attribution.channel).toBe('api');
    expect(JSON.stringify(l1)).not.toMatch(/sk-live|api_token/);
    expect(l1.fields.browser).toBeUndefined(); // null device keys are dropped
    expect(Object.keys(l1.device)).toEqual([]);
    const wa = await rows(
      base,
      `SELECT payload FROM lead_events WHERE payload->'legacy'->'waboo'->>'sessionId' = 'a0000000-0000-4000-8000-000000000001'`,
    );
    expect(wa).toHaveLength(1); // the leads copy of the same session was excluded
    expect(wa[0]!.payload.legacy.waboo.botId).toBe('c0000000-0000-4000-8000-000000000001');
    expect(wa[0]!.payload.device.matomo).toBe(true);
  });

  it('reads the date formats: BSON date, ISO string, epoch seconds, a bad date falls back to the ObjectId time, updated never before created', async () => {
    const ev = await rows(
      base,
      `SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS') AS c, to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS') AS u
       FROM lead_events ORDER BY external_id`,
    );
    expect(ev.every((r) => r.u >= r.c)).toBe(true);
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM lead_events WHERE created_at = '2026-05-06T12:00:00Z' AND updated_at = created_at`,
      ),
    ).toBe(1);
    // the document with an unreadable createdAt took the ObjectId's time (2024-03-12), not the manifest time
    expect(
      await one(base, `SELECT count(*)::int AS n FROM lead_events WHERE created_at < '2025-01-01'`),
    ).toBeGreaterThanOrEqual(2);
  });

  it('keeps only the first touch of a contact, from first_touch, and records the differing current touch', async () => {
    const a = await rows(
      base,
      `SELECT c.legacy_id, a.platform, a.source_label, a.campaign, a.form, to_char(a.captured_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS d
       FROM contact_attributions a JOIN contacts c ON c.org_id = a.org_id AND c.id = a.contact_id
       JOIN organizations o ON o.id = a.org_id AND o.slug = 'acme' ORDER BY a.captured_at, a.platform`,
    );
    expect(a.map((r) => `${r.platform}|${r.source_label}|${r.campaign}|${r.form}|${r.d}`)).toEqual([
      'Geta|Import|spring|Contacts import|2026-02-01',
      'Geta|Import|null|Contacts import|2026-03-01',
      'Geta|Import|null|Contacts import|2026-03-01',
      'WhatsApp|WhatsApp Direct|null|Contacts import|2026-03-01',
    ]);
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM migration.quarantine WHERE reason_code = 'LATEST_TOUCH_DIFFERS' AND source_client = 'acme'`,
      ),
    ).toBe(1);
  });

  it('the second client has its own organization, sources and rows', async () => {
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM lead_events e JOIN organizations o ON o.id = e.org_id WHERE o.slug = 'globex'`,
      ),
    ).toBe(1);
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM lead_sources s JOIN organizations o ON o.id = s.org_id WHERE o.slug = 'globex'`,
      ),
    ).toBe(1);
  });
});

describe('dry run, idempotency, resume', () => {
  it('a dry run writes nothing', async () => {
    const db = await clone('ld-dry');
    await runClient(opts(dumps, db, 'acme', { dryRun: true }));
    expect(await totals(db)).toEqual({
      lead_sources: 0,
      lead_events: 0,
      contact_attributions: 0,
      'migration.id_map': 0,
      'migration.quarantine': 0,
    });
    expect(await one(db, 'SELECT count(*)::int AS n FROM organizations')).toBe(0);
  });

  it('a second run, with and without --force, changes nothing', async () => {
    const db = await clone('ld-idem');
    await runClient(opts(dumps, db, 'acme'));
    const t1 = await totals(db);
    const s1 = await snapshot(db);
    await runClient(opts(dumps, db, 'acme'));
    await runClient(opts(dumps, db, 'acme', { force: true }));
    expect(await totals(db)).toEqual(t1);
    expect(await snapshot(db)).toBe(s1);
    expect((await check(dumps, db, 'acme')).alarms).toEqual([]);
  });

  it('a run killed between batches or inside a batch resumes to exactly the result of a clean run', async () => {
    const clean = await clone('ld-clean');
    await runClient(opts(dumps, clean, 'acme'));
    const after = await clone('ld-after');
    await expect(
      runClient(
        opts(dumps, after, 'acme', {
          afterBatch: ({ step, batch }) => {
            if (step === 'lead_events' && batch === 2) throw new Error('simulated crash');
          },
        }),
      ),
    ).rejects.toThrow(/simulated crash/);
    const part = await one(after, 'SELECT count(*)::int AS n FROM lead_events');
    expect(part).toBeGreaterThan(0);
    expect(part).toBeLessThan(5 + BULK);
    const mid = await clone('ld-mid');
    await expect(
      runClient(
        opts(dumps, mid, 'acme', {
          midBatch: ({ step, batch }) => {
            if (step === 'attributions' && batch === 1) throw new Error('simulated crash');
          },
        }),
      ),
    ).rejects.toThrow(/simulated crash/);
    expect(await one(mid, 'SELECT count(*)::int AS n FROM contact_attributions')).toBe(0);
    for (const d of [after, mid]) {
      await runClient(opts(dumps, d, 'acme'));
      expect(await snapshot(d)).toBe(await snapshot(clean));
      expect(await totals(d)).toEqual(await totals(clean));
      expect((await check(dumps, d, 'acme')).alarms).toEqual([]);
    }
  });

  it('--steps runs the lead steps alone and ends in the same state as an all-at-once run', async () => {
    const db = await clone('ld-steps');
    await runClient(opts(dumps, db, 'acme', { steps: ['fields', 'contacts'] }));
    await runClient(opts(dumps, db, 'acme', { steps: ['leads'] }));
    const clean = await clone('ld-steps-clean');
    await runClient(opts(dumps, clean, 'acme'));
    expect(await snapshot(db)).toBe(await snapshot(clean));
  });
});

describe('events without their import source', () => {
  it('are refused before anything is written', async () => {
    const db = await clone('ld-nosrc');
    await runClient(opts(dumps, db, 'acme', { steps: ['fields', 'contacts'] }));
    await expect(runClient(opts(dumps, db, 'acme', { steps: ['lead_events'] }))).rejects.toThrow(
      /lead_events needs lead_sources/,
    );
  });
});

const ACME = `(SELECT id FROM organizations WHERE slug = 'acme')`;
const mutations: Array<[string, string, RegExp]> = [
  [
    'delete a lead event',
    `DELETE FROM lead_events WHERE id = (SELECT min(id) FROM lead_events)`,
    /TARGET_MISSING|IDMAP|NOT_LOADED/,
  ],
  [
    'change a lead event status to failed (the ingest retry picks it up)',
    `UPDATE lead_events SET status = 'failed' WHERE id = (SELECT min(id) FROM lead_events)`,
    /SENDABLE_LEAD|ORACLE_MISMATCH/,
  ],
  [
    'change the payload',
    `UPDATE lead_events SET payload = jsonb_set(payload, '{fields,attendees}', '"99"') WHERE id = (SELECT min(id) FROM lead_events)`,
    /ORACLE_MISMATCH.*payload/,
  ],
  [
    'point an event at another contact',
    `UPDATE lead_events SET contact_id = (SELECT max(id) FROM contacts WHERE org_id = ${ACME}) WHERE id = (SELECT min(id) FROM lead_events WHERE org_id = ${ACME} AND contact_id <> (SELECT max(id) FROM contacts WHERE org_id = ${ACME}))`,
    /ORACLE_MISMATCH.*contact_id/,
  ],
  [
    'change the source of an event',
    `UPDATE lead_events SET source_id = (SELECT max(id) FROM lead_sources WHERE org_id = ${ACME}) WHERE source_id = (SELECT min(id) FROM lead_sources WHERE org_id = ${ACME})`,
    /ORACLE_MISMATCH.*source_id/,
  ],
  [
    'activate an import source',
    `UPDATE lead_sources SET status = 'active' WHERE id = (SELECT min(id) FROM lead_sources)`,
    /LIVE_SOURCE|ORACLE_MISMATCH/,
  ],
  [
    'give an import source a token',
    `UPDATE lead_sources SET token_hash = 'x' WHERE id = (SELECT min(id) FROM lead_sources)`,
    /LIVE_SOURCE|ORACLE_MISMATCH/,
  ],
  [
    'purge a retention clock',
    `UPDATE lead_events SET payload_expires_at = NULL WHERE id = (SELECT min(id) FROM lead_events)`,
    /LEAD_NO_RETENTION|ORACLE_MISMATCH/,
  ],
  [
    'duplicate an event',
    `INSERT INTO lead_events (org_id, source_id, external_id, status, payload, payload_expires_at, received_at, created_at, updated_at) SELECT org_id, source_id, external_id || '-copy', status, payload, payload_expires_at, received_at, created_at, updated_at FROM lead_events WHERE id = (SELECT min(id) FROM lead_events)`,
    /EXTRA_ROWS.*lead_events/,
  ],
  [
    'add a source',
    `INSERT INTO lead_sources (org_id, kind, name, status, token_hash) SELECT org_id, 'webhook', 'Rogue', 'active', 'h' FROM lead_sources WHERE id = (SELECT min(id) FROM lead_sources)`,
    /EXTRA_ROWS.*lead_sources/,
  ],
  [
    'add an outbox row',
    `INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload) SELECT id, 'leads', 1, 'lead.created', '{}' FROM organizations WHERE slug = 'acme'`,
    /SIDE_EFFECT|EXTRA_ROWS.*event_outbox/,
  ],
  [
    'change an attribution (append-only trigger off)',
    `ALTER TABLE contact_attributions DISABLE TRIGGER trg_contact_attributions_append_only; UPDATE contact_attributions SET platform = 'Hacked' WHERE id = (SELECT min(id) FROM contact_attributions); ALTER TABLE contact_attributions ENABLE TRIGGER trg_contact_attributions_append_only`,
    /ORACLE_MISMATCH.*platform/,
  ],
  [
    'link an attribution to an event',
    `UPDATE contact_attributions SET lead_event_id = (SELECT min(id) FROM lead_events) WHERE id = (SELECT min(id) FROM contact_attributions)`,
    /ATTRIBUTION_LINKED|ORACLE_MISMATCH/,
  ],
  [
    'delete an attribution',
    `DELETE FROM contact_attributions WHERE id = (SELECT min(id) FROM contact_attributions)`,
    /TARGET_MISSING|IDMAP|NOT_LOADED/,
  ],
  [
    'add an attribution',
    `INSERT INTO contact_attributions (org_id, contact_id, source_label) SELECT org_id, id, 'Rogue' FROM contacts WHERE id = (SELECT min(id) FROM contacts WHERE org_id = ${ACME})`,
    /EXTRA_ROWS.*contact_attributions/,
  ],
  [
    'delete an id_map row',
    `DELETE FROM migration.id_map WHERE source_collection = 'leadrepo' AND source_key = (SELECT source_key FROM migration.id_map WHERE source_collection = 'leadrepo' LIMIT 1)`,
    /IDMAP_MISSING|IDMAP_EXTRA|NOT_LOADED/,
  ],
];

describe('damage is caught', () => {
  it.each(mutations)('%s', async (name, statement, expected) => {
    const db = await clone('ld-dmg', base.name);
    try {
      await asOwner(db, (d) => d.execute(sql.raw(statement)));
      const r = await check(dumps, db, 'acme');
      expect(r.ok, name).toBe(false);
      expect(r.alarms.join('\n') + r.integrity.join('\n'), name).toMatch(expected);
    } finally {
      await db.drop();
      dbs.splice(dbs.indexOf(db), 1);
    }
  });
  it('the untouched copy still passes', async () => {
    const db = await clone('ld-ok', base.name);
    expect((await check(dumps, db, 'acme')).alarms).toEqual([]);
  });
});
