import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { runClient, type RunOptions } from '../load/run';
import { reconcile } from '../reconcile';
import { asOwner, cloneDb, customDumps, runOpts, type Dumps, type TestDb } from './helpers';
import { acmeFlows, globexFlows } from './flows-fixtures';

/**
 * The FAQ feature step (faq_knowledge). Needs the database of test/global-setup.ts built from a schema that HAS the FAQ migrations
 * (faq_core, faq_permissions, faq_flow_node_verify, faq_per_flow: they are on main; an older checkout does not have them).
 */
const OWNER = 'owner@example.test';
const opts = (d: Dumps, db: TestDb, client: 'acme' | 'globex', extra: Partial<RunOptions> = {}): RunOptions =>
  runOpts(d, db, client, {
    org: { name: client, slug: client, ownerEmail: client === 'acme' ? OWNER : null },
    allowNoOwner: client === 'globex',
    ...extra,
  });
const check = (d: Dumps, db: TestDb, client: 'acme' | 'globex') =>
  reconcile({ source: d.source, dumpsDir: d.dir, client, targetUrl: db.workerUrl, sampleSize: 1000 });
const rows = async (db: TestDb, text: string): Promise<Array<Record<string, any>>> =>
  asOwner(db, async (d) => (await d.execute(sql.raw(text))).rows as Array<Record<string, any>>);
const one = async (db: TestDb, text: string): Promise<number> => Number((await rows(db, text))[0]!.n);

let dumps: Dumps;
let base: TestDb;
const dbs: TestDb[] = [];
const dumpOf = (g: ReturnType<typeof acmeFlows>) => ({ contact_list: [], ...g });

beforeAll(async () => {
  dumps = await customDumps({ acme: dumpOf(acmeFlows()), globex: dumpOf(globexFlows()) });
  base = await cloneDb('faq-base');
  dbs.push(base);
  await runClient(opts(dumps, base, 'acme'));
  await runClient(opts(dumps, base, 'globex'));
}, 1_800_000);

afterAll(async () => {
  for (const d of dbs) await d.drop();
  dumps.cleanup();
});

const ACME = `(SELECT id FROM organizations WHERE slug = 'acme')`;

describe('faq_knowledge', () => {
  it('writes PAUSED FAQs owned by the flow of the bot, a flow answer where the record has no text', async () => {
    const f = await rows(
      base,
      `SELECT q.*, fl.flow_name FROM faqs q JOIN flows fl ON fl.org_id = q.org_id AND fl.id = q.owner_flow_id WHERE q.org_id = ${ACME} ORDER BY q.question`,
    );
    expect(f.length).toBeGreaterThanOrEqual(2);
    for (const r of f)
      expect(r).toMatchObject({
        status: 'paused',
        flow_name: 'Support Bot',
        answer_type: 'flow',
        answer_text: null,
        flow_node_id: null,
        category: null,
        threshold_override: null,
        created_by: null,
      });
    for (const r of f) expect(Number(r.flow_id)).toBe(Number(r.owner_flow_id));
    expect(await one(base, `SELECT count(*)::int AS n FROM faqs WHERE status <> 'paused'`)).toBe(0);
  });

  it('variations: the question as source question, the phrases as import, all pending, no vector, no event', async () => {
    const v = await rows(
      base,
      `SELECT v.*, q.question FROM faq_variations v JOIN faqs q ON q.org_id = v.org_id AND q.id = v.faq_id WHERE v.org_id = ${ACME}`,
    );
    expect(v.length).toBeGreaterThan(0);
    for (const r of v)
      expect(r).toMatchObject({
        embed_state: 'pending',
        embedding: null,
        embedding_model: null,
        embedded_at: null,
        embed_attempts: 0,
        embed_error: null,
        row_version: 1,
      });
    for (const q of new Set(v.map((r) => r.faq_id))) {
      const mine = v.filter((r) => r.faq_id === q);
      expect(mine.filter((r) => r.source === 'question')).toHaveLength(1);
      expect(mine.find((r) => r.source === 'question')!.text).toBe(mine[0]!.question);
      expect(mine.length).toBeLessThanOrEqual(60);
      expect(mine.filter((r) => r.source !== 'question').every((r) => r.source === 'import')).toBe(true);
    }
    // the 300-character phrase is no keyword (255 limit) but is a legal variation (500)
    expect(v.some((r) => String(r.text).startsWith('zzzz'))).toBe(true);
    expect(await one(base, `SELECT count(*)::int AS n FROM event_outbox WHERE org_id = ${ACME}`)).toBe(0);
    expect(await one(base, `SELECT count(*)::int AS n FROM faq_match_logs WHERE org_id = ${ACME}`)).toBe(0);
  });

  it('one settings row per flow that owns an FAQ, switched OFF; the keyword replies are still written', async () => {
    const s = await rows(base, `SELECT * FROM faq_settings WHERE org_id = ${ACME}`);
    const owners = await rows(base, `SELECT DISTINCT owner_flow_id FROM faqs WHERE org_id = ${ACME}`);
    expect(s.map((r) => Number(r.flow_id)).sort()).toEqual(owners.map((r) => Number(r.owner_flow_id)).sort());
    expect(s.every((r) => r.enabled === false)).toBe(true);
    expect(await one(base, `SELECT count(*)::int AS n FROM keyword_replies WHERE org_id = ${ACME}`)).toBeGreaterThan(0);
  });

  it('a record with no answer is quarantined, with a counted soft issue for the journey', async () => {
    const q = await rows(
      base,
      `SELECT reason_code FROM migration.quarantine WHERE source_client = 'acme' AND collection = 'faq_knowledge' ORDER BY reason_code`,
    );
    const codes = q.map((r) => r.reason_code);
    expect(codes).toContain('NO_ANSWER'); // the Intent without a journey
    expect(codes).toContain('QID_NOT_ADDRESSABLE');
  });

  it('is idempotent and verifies clean', async () => {
    const before = await rows(
      base,
      `SELECT (SELECT count(*) FROM faqs)::int AS a, (SELECT count(*) FROM faq_variations)::int AS b, (SELECT count(*) FROM faq_settings)::int AS c`,
    );
    await runClient(opts(dumps, base, 'acme'));
    expect(
      await rows(
        base,
        `SELECT (SELECT count(*) FROM faqs)::int AS a, (SELECT count(*) FROM faq_variations)::int AS b, (SELECT count(*) FROM faq_settings)::int AS c`,
      ),
    ).toEqual(before);
    expect((await check(dumps, base, 'acme')).alarms).toEqual([]);
    expect((await check(dumps, base, 'globex')).alarms).toEqual([]);
  });
});
