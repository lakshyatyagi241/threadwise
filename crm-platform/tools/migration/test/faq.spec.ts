import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { runClient, type RunOptions } from '../load/run';
import { reconcile } from '../reconcile';
import { asOwner, cloneDb, customDumps, runOpts, type Dumps, type TestDb } from './helpers';
import { acmeFlows, globexFlows } from './flows-fixtures';
import { O } from './fixtures';

/**
 * The FAQ step (faq_knowledge): legacy FAQs become ONE text entry labelled "FAQ" per AI agent in the knowledge base (ai_training_sources),
 * in the format of the knowledge-base merge migration (20270205090000). Needs the database of test/global-setup.ts.
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
// one FAQ that answers inline (the fixtures' FAQs all start a journey), with a second phrasing
const inlineFaq = (g: ReturnType<typeof acmeFlows>) => {
  const botid = (g.bot_workspace[0] as { botid: string }).botid;
  g.bot_workspace.push({
    _id: O(9_900_001),
    botid,
    qid: 'FAQ-PAY',
    type: 'FAQ',
    question: 'How do I pay?',
    response: [{ type: 'text', value: '<p>Pay by card.</p>' }],
    createdAt: { $date: '2026-03-01T00:00:00Z' },
    updatedAt: { $date: '2026-03-02T00:00:00Z' },
  } as never);
  g.faq_variations.push({ _id: O(9_900_002), botid, qid: 'FAQ-PAY', phrases: ['ways to pay'] } as never);
  return g;
};

beforeAll(async () => {
  dumps = await customDumps({ acme: dumpOf(inlineFaq(acmeFlows())), globex: dumpOf(globexFlows()) });
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
  it('writes one text entry "FAQ" on one agent, in Q / Also asked as / A blocks, ready, no passages, no event', async () => {
    const e = await rows(
      base,
      `SELECT s.*, a.status AS agent_status FROM ai_training_sources s JOIN ai_chat_assistants a ON a.org_id = s.org_id AND a.id = s.assistant_id
       WHERE s.org_id = ${ACME} AND s.label = 'FAQ'`,
    );
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({
      kind: 'text',
      status: 'ready',
      content: 'Q: How do I pay?\nAlso asked as: ways to pay\nA: Pay by card.',
      agent_status: 'paused', // nothing answers a customer until a person enables the agent
    });
    expect(await one(base, `SELECT count(*)::int AS n FROM ai_training_chunks WHERE org_id = ${ACME}`)).toBe(0);
    expect(await one(base, `SELECT count(*)::int AS n FROM event_outbox WHERE org_id = ${ACME}`)).toBe(0);
  });

  it('the retired FAQ tables are gone, and the keyword replies are still written', async () => {
    const t = await rows(base, `SELECT to_regclass('faqs') AS a, to_regclass('faq_settings') AS b, to_regclass('faq_variations') AS c`);
    expect(t[0]).toEqual({ a: null, b: null, c: null });
    expect(await one(base, `SELECT count(*)::int AS n FROM keyword_replies WHERE org_id = ${ACME}`)).toBeGreaterThan(0);
  });

  it('a question that answers by starting a flow, or has no answer, is quarantined with its reason', async () => {
    const q = await rows(
      base,
      `SELECT reason_code FROM migration.quarantine WHERE source_client = 'acme' AND collection = 'faq_knowledge' ORDER BY reason_code`,
    );
    const codes = q.map((r) => r.reason_code);
    expect(codes).toContain('FLOW_ANSWER_NOT_CARRIED');
    expect(codes).toContain('NO_ANSWER'); // the Intent without a journey
  });

  it('is idempotent and verifies clean', async () => {
    const q = `SELECT count(*)::int AS a FROM ai_training_sources WHERE label = 'FAQ'`;
    const before = await rows(base, q);
    await runClient(opts(dumps, base, 'acme'));
    expect(await rows(base, q)).toEqual(before);
    expect((await check(dumps, base, 'acme')).alarms).toEqual([]);
    expect((await check(dumps, base, 'globex')).alarms).toEqual([]);
  });
});
