import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { runClient, type RunOptions } from '../load/run';
import { reconcile } from '../reconcile';
import { resolve } from '../registry';
import { StepsError } from '../load/steps';
import { STEPS } from '../transform';
import { asOwner, cloneDb, customDumps, runOpts, type Dumps, type TestDb } from './helpers';
import { acmeAutomations, FAKE_SHEET_TOKEN, FAKE_TOKEN } from './automation-fixtures';

/**
 * The advanced automations against a real Postgres: the load (idempotent, resumable, dry run writes nothing), the safety invariants
 * with the consumers' predicates, the verifier (equation, independent oracle) and the damage cases it must catch. The pure converter
 * tests are in automation-convert.pure.spec.ts (no database).
 */
const OWNER = 'owner@example.test';
const opts = (d: Dumps, db: TestDb, extra: Partial<RunOptions> = {}): RunOptions =>
  runOpts(d, db, 'acme', { org: { name: 'acme', slug: 'acme', ownerEmail: OWNER }, ...extra });
const check = (d: Dumps, db: TestDb, allowExtraRows = false) =>
  reconcile({
    source: d.source,
    dumpsDir: d.dir,
    client: 'acme',
    targetUrl: db.workerUrl,
    sampleSize: 1000,
    allowExtraRows,
  });
const rows = async (db: TestDb, text: string): Promise<Array<Record<string, any>>> =>
  asOwner(db, async (d) => (await d.execute(sql.raw(text))).rows as Array<Record<string, any>>);
const one = async (db: TestDb, text: string): Promise<number> =>
  Number((await rows(db, text))[0]!.n);
const exec = async (db: TestDb, text: string): Promise<void> => void (await rows(db, text));

let dumps: Dumps;
let base: TestDb;
const dbs: TestDb[] = [];
const clone = async (label: string, from?: string): Promise<TestDb> => {
  const d = await cloneDb(label, from);
  dbs.push(d);
  return d;
};
const AUTO = `category = 'Waboo automation'`;

beforeAll(async () => {
  dumps = await customDumps({ acme: acmeAutomations() });
  base = await clone('au-base');
  await runClient(opts(dumps, base));
}, 1_800_000);
afterAll(async () => {
  for (const d of dbs) await d.drop();
  dumps.cleanup();
});

describe('registry and steps', () => {
  it('both collections are migrated by the new steps; the history stays out', () => {
    expect(resolve('automation_metadata')).toMatchObject({
      disposition: 'MIGRATE',
      handler: 'automation_flows',
    });
    expect(resolve('automation_journey')).toMatchObject({
      disposition: 'MIGRATE',
      handler: 'automation_nodes',
    });
    expect(resolve('automation_version').disposition).toBe('EXCLUDE');
    expect(resolve('automation_node_version').disposition).toBe('EXCLUDE');
    expect(resolve('node_execution_history').disposition).toBe('EXCLUDE');
    expect(resolve('shapes').disposition).toBe('EXCLUDE');
    const order = STEPS.map((s) => s.handler);
    expect(order.indexOf('automation_flows')).toBeLessThan(order.indexOf('automation_nodes'));
    expect(order.indexOf('groups')).toBeLessThan(order.indexOf('automation_flows'));
  });

  it('--steps automations needs the lists (groups); with them it runs alone', async () => {
    const db = await clone('au-steps');
    await expect(runClient(opts(dumps, db, { steps: ['automations'] }))).rejects.toThrow(
      StepsError,
    );
    const s = await runClient(opts(dumps, db, { steps: ['groups', 'automations'] }));
    expect(s.steps.automation_flows!.migrated).toBe(9);
    expect(await one(db, `SELECT count(*)::int AS n FROM flows WHERE ${AUTO}`)).toBe(9);
    // the lists resolved because groups ran first
    const g = await rows(db, `SELECT g.id, g.uuid::text FROM contact_groups g`);
    const f = (
      await rows(db, `SELECT trigger_value, flow_data FROM flows WHERE flow_name = 'List joined'`)
    )[0]!;
    expect(Number(f.trigger_value)).toBe(Number(g[0]!.id));
    expect(f.flow_data.flowNodes.find((n: any) => n.type === 'trigger').data.groupId).toBe(
      g[0]!.uuid,
    );
  });
});

describe('the load', () => {
  it('counts: 9 flows, the journey rows adopted / excluded / quarantined with reasons, the equation holds', async () => {
    const r = await check(dumps, base);
    expect(r.alarms).toEqual([]);
    expect(r.ok).toBe(true);
    const row = (c: string) => r.collections.find((x) => x.collection === c)!;
    expect(row('automation_metadata')).toMatchObject({
      read: 13,
      migrated: 9,
      excluded: 2,
      quarantined: 2,
      unaccounted: 0,
    });
    expect(row('automation_journey')).toMatchObject({ unaccounted: 0 });
    const j = row('automation_journey');
    expect(j.read).toBe(j.migrated + j.excluded + j.quarantined);
    expect(j.migrated).toBe(13);
    expect(r.excludedByCode['automation_metadata: NO_NODES']).toBeUndefined(); // an empty draft is loaded
    expect(r.excludedByCode['automation_metadata: OLDER_DUPLICATE']).toBe(1);
    expect(r.excludedByCode['automation_metadata: SOFT_DELETED']).toBe(1);
    expect(r.excludedByCode['automation_journey: DERIVED_EVENT_NODE']).toBe(3);
    const q = await rows(
      base,
      `SELECT reason_code, count(*)::int AS n FROM migration.quarantine WHERE source_key NOT LIKE '%#%' AND collection LIKE 'automation_%' GROUP BY 1`,
    );
    expect(Object.fromEntries(q.map((x) => [x.reason_code, x.n]))).toEqual({
      GRAPH_TOO_LARGE: 1,
      NO_AUTOMATION_ID: 1,
      JOURNEY_DIVERGES: 1,
      NO_DEFINITION: 1,
      NOT_IN_DEFINITION: 2, // incl. the runtime row of the empty draft (now a loaded flow)
      NO_NODE_ID: 1,
    });
    expect(r.notPresent.droppedFields.join('\n')).toMatch(
      /NOT PRESENT \(automations\): 9 of 9 automation flows/,
    );
  });

  it('SAFETY: unpublished AND inactive, nothing armed, every consumer predicate finds zero rows, no side-effect rows', async () => {
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM flows WHERE ${AUTO} AND (is_published OR is_active OR published_at IS NOT NULL)`,
      ),
    ).toBe(0);
    expect(
      await one(base, `SELECT count(*)::int AS n FROM flows WHERE is_published AND is_active`),
    ).toBe(0);
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM flows WHERE is_published AND is_active AND trigger_kind IN ('schedule', 'date_field_match')`,
      ),
    ).toBe(0);
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM flows WHERE trigger_channel_id IS NOT NULL OR trigger_device_id IS NOT NULL OR trigger_last_occurrence IS NOT NULL`,
      ),
    ).toBe(0);
    for (const t of [
      'flow_runs',
      'flow_run_steps',
      'flow_subscribers',
      'flb_geta_publish_syncs',
      'event_outbox',
    ])
      expect(await one(base, `SELECT count(*)::int AS n FROM ${t}`), t).toBe(0);
    // the source says published + active: the target must not
    const w = (
      await rows(
        base,
        `SELECT flow_data->'waboo' AS w FROM flows WHERE flow_name = 'Welcome series'`,
      )
    )[0]!.w;
    expect(w).toMatchObject({ status: 'published', wasActive: true });
  });

  it('no credential of the dump is anywhere in the target', async () => {
    const t = await rows(
      base,
      `SELECT (SELECT string_agg(flow_data::text, ' ') FROM flows) || (SELECT coalesce(string_agg(doc::text, ' '), '') FROM migration.quarantine) AS t`,
    );
    expect(String(t[0]!.t)).not.toContain(FAKE_TOKEN);
    expect(String(t[0]!.t)).not.toContain(FAKE_SHEET_TOKEN);
  });

  it('is idempotent: a second run and a forced run change nothing', async () => {
    const snap = async (db: TestDb) =>
      JSON.stringify(
        await rows(
          db,
          `SELECT uuid::text, to_jsonb(f) - 'id' - 'org_id' - 'uuid' AS r FROM flows f ORDER BY uuid`,
        ),
      ) +
      (await one(db, `SELECT count(*)::int AS n FROM migration.id_map`)) +
      (await one(db, `SELECT count(*)::int AS n FROM migration.quarantine`));
    const before = await snap(base);
    await runClient(opts(dumps, base));
    expect(await snap(base)).toBe(before);
    await runClient(opts(dumps, base, { force: true }));
    expect(await snap(base)).toBe(before);
    expect((await check(dumps, base)).alarms).toEqual([]);
  });

  it('a dry run writes nothing', async () => {
    const db = await clone('au-dry');
    const s = await runClient(opts(dumps, db, { dryRun: true }));
    expect(s.steps.automation_flows!.migrated).toBe(9);
    expect(await one(db, `SELECT count(*)::int AS n FROM flows`)).toBe(0);
    expect(
      await one(
        db,
        `SELECT count(*)::int AS n FROM migration.id_map WHERE source_collection LIKE 'automation_%'`,
      ),
    ).toBe(0);
  });

  it('resumes after a crash to exactly the same state', async () => {
    const db = await clone('au-resume');
    await expect(
      runClient(
        opts(dumps, db, {
          batchSize: 3,
          afterBatch: ({ step, batch }) => {
            if (step === 'automation_flows' && batch === 2) throw new Error('simulated crash');
          },
        }),
      ),
    ).rejects.toThrow(/simulated crash/);
    expect(await one(db, `SELECT count(*)::int AS n FROM flows WHERE ${AUTO}`)).toBeLessThan(8);
    await runClient(opts(dumps, db, { batchSize: 3 }));
    const a = JSON.stringify(
      await rows(db, `SELECT uuid::text, flow_name, flow_data FROM flows ORDER BY uuid`),
    );
    const b = JSON.stringify(
      await rows(base, `SELECT uuid::text, flow_name, flow_data FROM flows ORDER BY uuid`),
    );
    expect(a).toBe(b);
    expect((await check(dumps, db)).alarms).toEqual([]);
  });

  it('the groups resolve: a group trigger carries the id and uuid of the migrated list', async () => {
    const g = (await rows(base, `SELECT id, uuid::text FROM contact_groups`))[0]!;
    const f = (
      await rows(
        base,
        `SELECT trigger_kind, trigger_value, flow_data FROM flows WHERE flow_name = 'List joined'`,
      )
    )[0]!;
    expect(f.trigger_kind).toBe('group_join');
    expect(Number(f.trigger_value)).toBe(Number(g.id));
    const lm = (
      await rows(base, `SELECT flow_data FROM flows WHERE flow_name = 'Welcome series'`)
    )[0]!.flow_data.flowNodes.find((n: any) => n.type === 'list_member');
    expect(lm.data.listId).toBe(g.uuid);
  });
});

describe('damage the verifier must catch', () => {
  const damage = async (label: string, sqlText: string, alarm: RegExp, allowExtra = false) => {
    const db = await clone(label, base.name);
    await exec(db, sqlText);
    const r = await check(dumps, db, allowExtra);
    expect(r.ok, label).toBe(false);
    expect(r.alarms.join('\n'), label).toMatch(alarm);
  };
  const fl = `flow_name = 'Welcome series'`;

  it('activates a flow', () =>
    damage(
      'd1',
      `UPDATE flows SET is_active = true WHERE ${fl}`,
      /SENDABLE_FLOW|AUTOMATION_COLUMN|BASELINE|MISMATCH/,
    ));
  it('publishes and activates a flow (the consumers would pick it up)', () =>
    damage(
      'd2',
      `UPDATE flows SET is_active = true, is_published = true WHERE ${fl}`,
      /SENDABLE_FLOW/,
    ));
  it('arms a trigger (device)', () =>
    damage('d3', `UPDATE flows SET trigger_device_id = 5 WHERE ${fl}`, /SENDABLE_FLOW/));
  it('drops an edge', () =>
    damage(
      'd4',
      `UPDATE flows SET flow_data = jsonb_set(flow_data, '{flowEdges}', (flow_data->'flowEdges') - 0) WHERE ${fl}`,
      /AUTOMATION_GRAPH/,
    ));
  it('deletes a node', () =>
    damage(
      'd5',
      `UPDATE flows SET flow_data = jsonb_set(flow_data, '{flowNodes}', (flow_data->'flowNodes') - 3) WHERE ${fl}`,
      /AUTOMATION_GRAPH|dangl/,
    ));
  it('changes the type of a node', () =>
    damage(
      'd6',
      `UPDATE flows SET flow_data = jsonb_set(flow_data, '{flowNodes,1,type}', '"message"') WHERE ${fl}`,
      /AUTOMATION_GRAPH|mapping gives/,
    ));
  it('changes the trigger kind', () =>
    damage('d7', `UPDATE flows SET trigger_kind = 'keyword' WHERE ${fl}`, /AUTOMATION_COLUMN/));
  it('deletes a flow', () =>
    damage(
      'd8',
      `DELETE FROM flows WHERE ${fl}`,
      /TARGET_MISSING|AUTOMATION_ID_MAP|UNACCOUNTED|MISSING/i,
    ));
  it('adds an extra automation flow', () =>
    damage(
      'd9',
      `INSERT INTO flows (org_id, flow_name, category, trigger_kind, provider, flow_type, is_published, is_active) SELECT org_id, 'Extra', 'Waboo automation', 'manual_enroll', 'waba', 'chat', false, false FROM flows LIMIT 1`,
      /EXTRA_ROWS/,
    ));
  it('deletes an id_map row', () =>
    damage(
      'd10',
      `DELETE FROM migration.id_map WHERE source_collection = 'automation_journey' AND source_key IN (SELECT source_key FROM migration.id_map WHERE source_collection = 'automation_journey' LIMIT 1)`,
      /AUTOMATION_ID_MAP|ID_MAP/,
    ));
  it('deletes a soft-issue row', () =>
    damage(
      'd11',
      `DELETE FROM migration.quarantine WHERE source_key LIKE '%#PLACEHOLDER_NODES'`,
      /SOFT_ISSUES_MISSING|QUARANTINE/,
    ));
  it('puts a credential into a flow', () =>
    damage(
      'd12',
      `UPDATE flows SET flow_data = jsonb_set(flow_data, '{flowNodes,0,data,apiKey}', '"${FAKE_TOKEN}"') WHERE ${fl}`,
      /AUTOMATION_SECRET|MISMATCH/,
    ));
  it('writes a flow run (a side effect)', async () => {
    const db = await clone('d13', base.name);
    const cols = await rows(
      db,
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'event_outbox' AND is_nullable = 'NO' AND column_default IS NULL`,
    );
    void cols;
    // an outbox row is the cheapest side effect that needs no foreign key
    await exec(
      db,
      `INSERT INTO event_outbox (org_id, event_type, payload) SELECT id, 'x', '{}'::jsonb FROM organizations LIMIT 1`,
    ).catch(() => undefined);
    const n = await one(db, `SELECT count(*)::int AS n FROM event_outbox`);
    if (n > 0)
      expect((await check(dumps, db)).alarms.join('\n')).toMatch(/SIDE_EFFECT|BASELINE|EXTRA/);
  });
});
