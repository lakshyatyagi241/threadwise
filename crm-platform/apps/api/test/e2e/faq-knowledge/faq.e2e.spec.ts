import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FaqApi,
  addFlow,
  code,
  indexAll,
  nextPeer,
  ops,
  sentTo,
  setPlatformKey,
  simChannel,
  simInbound,
  startPipeline,
  untilSent,
  until,
  uuidRe,
  type DecisionJson,
  type EntryJson,
  type Pipeline,
  type SimChannel,
  type Tenant,
} from './support';

/**
 * The FAQ engine end to end through HTTP and the real inbox pipeline (ADR-0021): permissions, the save rules, indexing (the embedding
 * worker, the token ledger, failure and retry), the matcher's tiers and its decisions, what a customer receives on a channel, the
 * learning loop from unanswered messages, the platform operator's controls, and tenant isolation down to row-level security.
 *
 * One app, one throw-away Postgres with pgvector. The AI vendor is the offline fixture, so a vector is a deterministic function of the
 * words in the text and every score below can be reasoned about: a one-word query against a two-word variation that shares it scores
 * about 0.71, and two texts that share nothing score 0.
 */
let p: Pipeline;
let api: FaqApi;

beforeAll(async () => {
  p = await startPipeline();
  api = new FaqApi(p.h);
}, 300_000);
afterAll(async () => {
  await p?.stop();
});

const ORDER = 'Where is my order?';
const REFUND = 'How do I get a refund?';
const HOURS = 'What are your opening hours?';

/** Three FAQs the matching tests share, each with a few variations. */
async function seedBasics(
  t: Tenant,
): Promise<{ order: EntryJson; refund: EntryJson; hours: EntryJson }> {
  const order = await api.entry(t.admin, ORDER, {
    answerText: 'Your order ships in 2 days.',
    variations: ['Track my order', 'Order status', 'When will my parcel arrive'],
  });
  const refund = await api.entry(t.admin, REFUND, {
    answerText: 'Refunds take 5 days.',
    variations: ['Refund policy', 'I want my money back'],
  });
  const hours = await api.entry(t.admin, HOURS, {
    answerText: 'We open 9 to 5.',
    variations: ['Opening hours', 'When are you open'],
  });
  return { order, refund, hours };
}

const decision = async (t: Tenant, q: string): Promise<DecisionJson> => {
  const res = await api.faq(t.admin).test(q);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as DecisionJson;
};

// =====================================================================================================================
describe('permissions (every route, every key)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('faqperm');
  });

  it('without a sign-in every route is 401', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    const f = `/v2/faq/flows/${id}`;
    for (const [verb, path] of [
      ['get', `${f}/entries`],
      ['post', `${f}/entries`],
      ['post', `${f}/entries/bulk`],
      ['get', `${f}/entries/${id}`],
      ['patch', `${f}/entries/${id}`],
      ['delete', `${f}/entries/${id}`],
      ['post', `${f}/entries/${id}/variations`],
      ['patch', `${f}/entries/${id}/variations/${id}`],
      ['delete', `${f}/entries/${id}/variations/${id}`],
      ['post', `${f}/entries/${id}/variations/generate`],
      ['post', `${f}/test`],
      ['get', `${f}/settings`],
      ['put', `${f}/settings`],
      ['get', `${f}/insights/summary`],
      ['get', `${f}/insights/log`],
      ['post', `${f}/insights/log/${id}/learn`],
      ['post', `${f}/insights/log/${id}/dismiss`],
      ['get', `/v2/faq/flow-nodes/${id}`],
    ] as const) {
      expect((await api.http()[verb](path)).status, `${verb} ${path}`).toBe(401);
    }
  });

  it('a member with no FAQ key is refused with 403 everywhere', async () => {
    const e = await api.entry(t.admin, 'Gate question');
    const none = await api.member(t, 'nokeys', [['record.contacts.read']]);
    const f = api.faq(none.token);
    expect((await f.list()).status).toBe(403);
    expect((await f.get(e.id)).status).toBe(403);
    expect((await f.create({ question: 'q', answerType: 'text', answerText: 'a' })).status).toBe(
      403,
    );
    expect((await f.test('anything')).status).toBe(403);
    expect((await f.settings()).status).toBe(403);
    expect((await f.summary()).status).toBe(403);
    expect((await f.log()).status).toBe(403);
  });

  it('each action has its own key', async () => {
    const e = await api.entry(t.admin, 'Keys question', { variations: ['Keys variation'] });
    const reader = await api.member(t, 'reader', [['faq.entries.read']]);
    const r = api.faq(reader.token);
    expect((await r.list()).status).toBe(200);
    expect((await r.get(e.id)).status).toBe(200);
    expect((await r.settings()).status).toBe(200);
    expect((await r.test('keys question')).status).toBe(200);
    expect((await r.create({ question: 'x', answerType: 'text', answerText: 'y' })).status).toBe(
      403,
    );
    expect((await r.update(e.id, { ...e, rowVersion: e.rowVersion })).status).toBe(403);
    expect((await r.addVariations(e.id, { texts: ['z'] })).status).toBe(403);
    expect((await r.generate(e.id)).status).toBe(403);
    expect((await r.remove(e.id)).status).toBe(403);
    expect(
      (await r.saveSettings({ enabled: true, threshold: 0.5, minMargin: 0, logQueries: true }))
        .status,
    ).toBe(403);
    expect((await r.summary()).status).toBe(403);

    const maker = await api.member(t, 'maker', [['faq.entries.read'], ['faq.entries.create']]);
    const m = api.faq(maker.token);
    expect(
      (await m.create({ question: 'Made by maker', answerType: 'text', answerText: 'ok' })).status,
    ).toBe(201);
    expect((await m.addVariations(e.id, { texts: ['from maker'] })).status).toBe(201);
    expect((await m.remove(e.id)).status).toBe(403);
    expect((await m.bulk({ action: 'pause', ids: [e.id] })).status).toBe(403);

    const editor = await api.member(t, 'editor', [['faq.entries.read'], ['faq.entries.update']]);
    const ed = api.faq(editor.token);
    const cur = (await ed.get(e.id)).body as EntryJson;
    expect(
      (
        await ed.update(e.id, {
          question: cur.question,
          answerType: 'text',
          answerText: 'edited',
          status: 'active',
          rowVersion: cur.rowVersion,
        })
      ).status,
    ).toBe(200);
    expect((await ed.bulk({ action: 'pause', ids: [e.id] })).status).toBe(200);
    expect((await ed.remove(e.id)).status).toBe(403);

    const deleter = await api.member(t, 'deleter', [['faq.entries.read'], ['faq.entries.delete']]);
    expect((await api.faq(deleter.token).remove(e.id)).status).toBe(204);

    const manager = await api.member(t, 'manager', [['faq.entries.read'], ['faq.settings.manage']]);
    const s = (await api.faq(manager.token).settings()).body;
    expect(
      (
        await api
          .faq(manager.token)
          .saveSettings({ enabled: true, threshold: 0.5, minMargin: 0, logQueries: true })
      ).status,
      JSON.stringify(s),
    ).toBe(200);

    const insights = await api.member(t, 'insights', [['faq.insights.read']]);
    expect((await api.faq(insights.token).summary()).status).toBe(200);
    expect((await api.faq(insights.token).log()).status).toBe(200);
    expect((await api.faq(insights.token).list()).status).toBe(403);
  });
});

describe('who holds the FAQ keys in a new workspace', () => {
  it('owner and admin hold all six, the manager the five that do not switch answering, agent and viewer none', async () => {
    const x = await api.signup('faqpreset');
    const rows = await p.h.owner.query(
      `SELECT r.system_key,
              COALESCE(array_agg(g.permission_key ORDER BY g.permission_key) FILTER (WHERE g.permission_key LIKE 'faq.%'), '{}') AS keys
       FROM roles r LEFT JOIN role_grants g ON g.org_id = r.org_id AND g.role_id = r.id AND g.effect = 'allow'
       WHERE r.org_id = $1 AND r.system_key IS NOT NULL GROUP BY r.system_key`,
      [x.orgId],
    );
    const by = Object.fromEntries(
      rows.rows.map((r) => [r.system_key as string, r.keys as string[]]),
    );
    const all = [
      'faq.entries.create',
      'faq.entries.delete',
      'faq.entries.read',
      'faq.entries.update',
      'faq.insights.read',
      'faq.settings.manage',
    ];
    expect(by.admin).toEqual(all);
    expect(by.manager).toEqual(all.filter((k) => k !== 'faq.settings.manage'));
    expect(by.agent ?? []).toEqual([]);
    expect(by.viewer ?? []).toEqual([]);
  });
});

// =====================================================================================================================
describe('saving FAQs', () => {
  let t: Tenant;
  beforeAll(async () => {
    await setPlatformKey(p, true);
    t = await api.signup('faqsave');
  });

  it('creates an FAQ with uuid-only ids, its question as the first variation, and the extras after it', async () => {
    const e = await api.entry(t.admin, '  Where   is my order? ', {
      variations: ['Track my order', ' track   MY order ', 'Order status', 'where is my order?'],
      category: ' Shipping ',
    });
    expect(e.id).toMatch(uuidRe);
    expect(e.question).toBe('Where is my order?');
    expect(e.category).toBe('Shipping');
    expect(e.status).toBe('active');
    // The question itself, plus two new phrasings: the repeats and the question's own text are dropped.
    expect(e.variations!.map((v) => v.text)).toEqual([
      'Where is my order?',
      'Track my order',
      'Order status',
    ]);
    expect(e.variations![0]).toMatchObject({ source: 'question', embedState: 'pending' });
    expect(e.variations!.every((v) => v.id.match(uuidRe))).toBe(true);
    expect(e.variationCount).toBe(3);
    expect(JSON.stringify(e)).not.toMatch(/"org_?id"|"id":\d/);
  });

  it('refuses a question another FAQ has, ignoring case and spacing, with 409 FAQ_DUPLICATE_QUESTION', async () => {
    await api.entry(t.admin, 'Do you deliver on Sundays?');
    const res = await api.faq(t.admin).create({
      question: '  do YOU deliver on   sundays? ',
      answerType: 'text',
      answerText: 'x',
    });
    expect(res.status).toBe(409);
    expect(code(res)).toBe('FAQ_DUPLICATE_QUESTION');
  });

  it.each([
    ['an empty question', { question: '   ' }, 'question'],
    ['a text answer with no text', { answerText: '  ' }, 'answerText'],
    ['a flow answer with no flow', { answerType: 'flow', answerText: null }, 'answerText'],
    ['a question over 500 characters', { question: 'q'.repeat(501) }, 'question'],
    ['an answer over 4096 characters', { answerText: 'a'.repeat(4097) }, 'answerText'],
    ['a threshold under the floor', { thresholdOverride: 0.01 }, 'thresholdOverride'],
    ['a threshold over the ceiling', { thresholdOverride: 1 }, 'thresholdOverride'],
    ['an unknown status', { status: 'draft' }, 'status'],
    [
      'more than 50 variations',
      { variations: Array.from({ length: 51 }, (_, i) => `v${i}`) },
      'variations',
    ],
    ['an empty variation', { variations: ['ok', ' '] }, 'variations'],
  ])('%s is a 422 and nothing is written', async (_label, over, path) => {
    const before = await api.count(`SELECT count(*) AS n FROM faqs WHERE org_id = $1`, [t.orgId]);
    const res = await api
      .faq(t.admin)
      .create({ question: 'Valid question', answerType: 'text', answerText: 'ok', ...over });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(code(res)).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(res.body.errors)).toContain(path);
    expect(await api.count(`SELECT count(*) AS n FROM faqs WHERE org_id = $1`, [t.orgId])).toBe(
      before,
    );
  });

  it('a NUL character is a 422, not a 500', async () => {
    const res = await api
      .faq(t.admin)
      .create({ question: 'a\u0000b', answerType: 'text', answerText: 'x' });
    expect(res.status).toBe(422);
  });

  it('keeps emoji, Hindi and markup as text, and never executes or strips them', async () => {
    const e = await api.entry(t.admin, 'मेरा ऑर्डर कहाँ है? 📦 <img src=x onerror=alert(1)>', {
      answerText: '<b>Soon</b> 🚚',
    });
    expect(e.question).toContain('📦');
    const got = (await api.faq(t.admin).get(e.id)).body as EntryJson;
    expect(got.answerText).toBe('<b>Soon</b> 🚚');
    expect(got.question).toContain('<img src=x onerror=alert(1)>');
  });

  it('a flow answer needs a flow of this workspace: another workspace’s flow is 422 FAQ_FLOW_NOT_FOUND', async () => {
    const other = await api.signup('faqother');
    const foreign = await addFlow(p, other, 'Foreign flow', 'zzforeign');
    const own = await addFlow(p, t, 'Own flow', 'zzown');
    const bad = await api
      .faq(t.admin)
      .create({ question: 'Flow question A', answerType: 'flow', flowId: foreign.uuid });
    expect(bad.status).toBe(422);
    expect(code(bad)).toBe('FAQ_FLOW_NOT_FOUND');
    const missing = await api.faq(t.admin).create({
      question: 'Flow question B',
      answerType: 'flow',
      flowId: '00000000-0000-4000-8000-0000000000aa',
    });
    expect(code(missing)).toBe('FAQ_FLOW_NOT_FOUND');
    const ok = await api.faq(t.admin).create({
      question: 'Flow question C',
      answerType: 'flow',
      flowId: own.uuid,
      answerText: 'ignored',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({
      answerType: 'flow',
      flowId: own.uuid,
      flowName: 'Own flow',
      answerText: null,
    });
  });

  it('an update changes the form, bumps the row version, and a stale version is 409 ROW_VERSION_CONFLICT', async () => {
    const e = await api.entry(t.admin, 'Update me');
    const save = (over: Record<string, unknown>, rv = e.rowVersion) =>
      api.faq(t.admin).update(e.id, {
        question: 'Update me',
        answerType: 'text',
        answerText: 'new answer',
        status: 'paused',
        category: 'Billing',
        thresholdOverride: 0.7,
        rowVersion: rv,
        ...over,
      });
    const first = await save({});
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({
      status: 'paused',
      category: 'Billing',
      thresholdOverride: 0.7,
      answerText: 'new answer',
    });
    expect(first.body.rowVersion).toBe(e.rowVersion + 1);
    const stale = await save({ answerText: 'second editor' });
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('ROW_VERSION_CONFLICT');
    expect(((await api.faq(t.admin).get(e.id)).body as EntryJson).answerText).toBe('new answer');
  });

  it('switching an answer from a flow back to text drops the flow, and the other way', async () => {
    const f = await addFlow(p, t, 'Swap flow', 'zzswap');
    const e = await api.entry(t.admin, 'Swap answer');
    const toFlow = await api.faq(t.admin).update(e.id, {
      question: 'Swap answer',
      answerType: 'flow',
      flowId: f.uuid,
      status: 'active',
      rowVersion: e.rowVersion,
    });
    expect(toFlow.status, JSON.stringify(toFlow.body)).toBe(200);
    expect(toFlow.body).toMatchObject({
      answerType: 'flow',
      answerText: null,
      flowName: 'Swap flow',
    });
    const back = await api.faq(t.admin).update(e.id, {
      question: 'Swap answer',
      answerType: 'text',
      answerText: 'plain',
      status: 'active',
      rowVersion: toFlow.body.rowVersion,
    });
    expect(back.body).toMatchObject({
      answerType: 'text',
      flowId: null,
      flowName: null,
      answerText: 'plain',
    });
  });

  it('renaming the question renames its variation and sends it for a new vector; renaming into a taken question is 409', async () => {
    const a = await api.entry(t.admin, 'Rename source');
    const b = await api.entry(t.admin, 'Rename taken');
    await indexAll(p);
    const before = ((await api.faq(t.admin).get(a.id)).body as EntryJson).variations!;
    expect(before[0]).toMatchObject({ source: 'question', embedState: 'ready' });
    const save = (question: string, rv: number) =>
      api.faq(t.admin).update(a.id, {
        question,
        answerType: 'text',
        answerText: 'x',
        status: 'active',
        rowVersion: rv,
      });
    const taken = await save('rename TAKEN', a.rowVersion);
    expect(taken.status).toBe(409);
    expect(code(taken)).toBe('FAQ_DUPLICATE_QUESTION');
    const ok = await save('Renamed question', a.rowVersion);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.variations[0]).toMatchObject({
      text: 'Renamed question',
      source: 'question',
      embedState: 'pending',
    });
    expect(ok.body.variations).toHaveLength(1);
    void b;
  });

  it('renaming a question to the text of one of its own variations keeps one variation, not two', async () => {
    const a = await api.entry(t.admin, 'Collapse source', { variations: ['Collapse target'] });
    const res = await api.faq(t.admin).update(a.id, {
      question: 'Collapse target',
      answerType: 'text',
      answerText: 'x',
      status: 'active',
      rowVersion: a.rowVersion,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.variations.map((v: { text: string }) => v.text)).toEqual(['Collapse target']);
  });

  it('adds variations (new ones only), rewords one with a new vector, refuses to touch the question, and removes one', async () => {
    const e = await api.entry(t.admin, 'Variation host', { variations: ['Existing one'] });
    await indexAll(p);
    const add = await api
      .faq(t.admin)
      .addVariations(e.id, { texts: ['existing ONE', 'Brand new', 'Brand  new', 'Another'] });
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    expect(add.body.map((v: { text: string }) => v.text)).toEqual(['Brand new', 'Another']);
    expect(
      add.body.every(
        (v: { embedState: string; source: string }) =>
          v.embedState === 'pending' && v.source === 'manual',
      ),
    ).toBe(true);

    const cur = (await api.faq(t.admin).get(e.id)).body as EntryJson;
    const question = cur.variations!.find((v) => v.source === 'question')!;
    const existing = cur.variations!.find((v) => v.text === 'Existing one')!;
    expect(existing.embedState).toBe('ready');
    const reword = await api.faq(t.admin).updateVariation(e.id, existing.id, {
      text: 'Reworded one',
      rowVersion: existing.rowVersion,
    });
    expect(reword.status, JSON.stringify(reword.body)).toBe(200);
    expect(reword.body).toMatchObject({ text: 'Reworded one', embedState: 'pending' });
    const stale = await api
      .faq(t.admin)
      .updateVariation(e.id, existing.id, { text: 'Again', rowVersion: existing.rowVersion });
    expect(code(stale)).toBe('ROW_VERSION_CONFLICT');
    const clash = await api.faq(t.admin).updateVariation(e.id, existing.id, {
      text: 'brand NEW',
      rowVersion: reword.body.rowVersion,
    });
    expect(clash.status).toBe(409);
    const onQuestion = await api
      .faq(t.admin)
      .updateVariation(e.id, question.id, { text: 'Nope', rowVersion: question.rowVersion });
    expect(onQuestion.status).toBe(422);
    expect((await api.faq(t.admin).removeVariation(e.id, question.id)).status).toBe(422);
    expect((await api.faq(t.admin).removeVariation(e.id, existing.id)).status).toBe(204);
    expect((await api.faq(t.admin).removeVariation(e.id, existing.id)).status).toBe(404);
    const left = ((await api.faq(t.admin).get(e.id)).body as EntryJson).variations!.map(
      (v) => v.text,
    );
    expect(left).toEqual(['Variation host', 'Brand new', 'Another']);
  });

  it('deleting an FAQ deletes its variations and a second delete is 404', async () => {
    const e = await api.entry(t.admin, 'Delete me', { variations: ['One', 'Two'] });
    expect(
      await api.count(
        `SELECT count(*) AS n FROM faq_variations WHERE org_id = $1 AND faq_id = (SELECT id FROM faqs WHERE uuid = $2)`,
        [t.orgId, e.id],
      ),
    ).toBe(3);
    expect((await api.faq(t.admin).remove(e.id)).status).toBe(204);
    expect((await api.faq(t.admin).remove(e.id)).status).toBe(404);
    expect((await api.faq(t.admin).get(e.id)).status).toBe(404);
    expect(
      await api.count(
        `SELECT count(*) AS n FROM faq_variations WHERE org_id = $1 AND text = 'Two'`,
        [t.orgId],
      ),
    ).toBe(0);
  });

  it('every write leaves an audit row and an outbox event', async () => {
    const e = await api.entry(t.admin, 'Audited question');
    await api.faq(t.admin).update(e.id, {
      question: 'Audited question',
      answerType: 'text',
      answerText: 'changed',
      status: 'paused',
      rowVersion: e.rowVersion,
    });
    await api.faq(t.admin).remove(e.id);
    const audit = await p.h.owner.query(
      `SELECT action FROM audit_log WHERE org_id = $1 AND module = 'faqs' ORDER BY at DESC LIMIT 3`,
      [t.orgId],
    );
    expect(audit.rows.map((r) => r.action).sort()).toEqual(['delete', 'insert', 'update']);
    const events = await p.h.owner.query(
      `SELECT event_type FROM event_outbox WHERE org_id = $1 AND aggregate_module = 'faqs' ORDER BY id DESC LIMIT 3`,
      [t.orgId],
    );
    expect(events.rows.map((r) => r.event_type).sort()).toEqual([
      'faq.created',
      'faq.deleted',
      'faq.updated',
    ]);
    // The audit delta says the answer changed, never what it said.
    const upd = await p.h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'faqs' AND action = 'update' ORDER BY at DESC LIMIT 1`,
      [t.orgId],
    );
    expect(JSON.stringify(upd.rows[0].delta)).toContain('[changed]');
    expect(JSON.stringify(upd.rows[0].delta)).not.toContain('"changed"');
  });
});

// =====================================================================================================================
describe('listing, searching and bulk actions', () => {
  let t: Tenant;
  const flow: { uuid?: string } = {};
  beforeAll(async () => {
    t = await api.signup('faqlist');
    flow.uuid = (await addFlow(p, t, 'List flow', 'zzlist')).uuid;
    for (let i = 1; i <= 25; i++) {
      await api.entry(t.admin, `List question ${String(i).padStart(2, '0')}`, {
        category: i % 2 ? 'Odd' : 'Even',
        variations: i === 7 ? ['needle phrase'] : [],
      });
    }
    await api
      .faq(t.admin)
      .create({ question: 'Flow backed FAQ', answerType: 'flow', flowId: flow.uuid });
  });

  it('pages newest first with a cursor and never repeats or skips a row', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await api
        .faq(t.admin)
        .list(`?limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      seen.push(...res.body.data.map((x: EntryJson) => x.question));
      cursor = res.body.page.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(26);
    expect(new Set(seen).size).toBe(26);
    expect(seen[0]).toBe('Flow backed FAQ');
    expect(seen[1]).toBe('List question 25');
  });

  it('the list carries previews, counts and the workspace stats; the stats ignore the page', async () => {
    const res = await api.faq(t.admin).list('?limit=3');
    expect(res.body.stats).toMatchObject({
      total: 26,
      active: 26,
      paused: 0,
      variations: 27,
      pending: 27,
      failed: 0,
    });
    expect(res.body.stats.categories).toEqual(['Even', 'Odd']);
    expect(res.body.data[0]).toMatchObject({
      answerType: 'flow',
      flowName: 'List flow',
      answerPreview: null,
      hitCount: 0,
      lastHitAt: null,
    });
    expect(res.body.data[1].answerPreview).toBe('Answer to: List question 25');
    expect(res.body.data[0].answerText).toBeUndefined();
  });

  it('searches the question and the variations, case-insensitively, and treats % and _ as plain text', async () => {
    const byVariation = await api.faq(t.admin).list('?search=NEEDLE');
    expect(byVariation.body.data.map((x: EntryJson) => x.question)).toEqual(['List question 07']);
    const byQuestion = await api.faq(t.admin).list('?search=question%2012');
    expect(byQuestion.body.data.map((x: EntryJson) => x.question)).toEqual(['List question 12']);
    expect((await api.faq(t.admin).list('?search=%25')).body.data).toHaveLength(0);
    expect((await api.faq(t.admin).list('?search=_')).body.data).toHaveLength(0);
  });

  it('filters by status, category and indexing state', async () => {
    const odd = await api.faq(t.admin).list('?category=Odd&limit=100');
    expect(odd.body.data).toHaveLength(13);
    expect((await api.faq(t.admin).list('?indexing=pending&limit=100')).body.data).toHaveLength(26);
    expect((await api.faq(t.admin).list('?indexing=failed')).body.data).toHaveLength(0);
    expect((await api.faq(t.admin).list('?status=paused')).body.data).toHaveLength(0);
    expect((await api.faq(t.admin).list('?limit=0')).status).toBe(422);
    expect((await api.faq(t.admin).list('?limit=101')).status).toBe(422);
    expect((await api.faq(t.admin).list('?status=nope')).status).toBe(422);
  });

  it('bulk pause, activate and delete act on what is in this workspace and ignore ids that are not', async () => {
    const all = (await api.faq(t.admin).list('?limit=100')).body.data as EntryJson[];
    const ids = all.slice(0, 5).map((x) => x.id);
    const foreign = '00000000-0000-4000-8000-0000000000ff';
    const paused = await api.faq(t.admin).bulk({ action: 'pause', ids: [...ids, foreign] });
    expect(paused.body).toEqual({ affected: 5 });
    expect((await api.faq(t.admin).list('?status=paused')).body.data).toHaveLength(5);
    expect((await api.faq(t.admin).bulk({ action: 'pause', ids })).body).toEqual({ affected: 0 });
    expect((await api.faq(t.admin).bulk({ action: 'activate', ids })).body).toEqual({
      affected: 5,
    });
    const gone = await api.faq(t.admin).bulk({ action: 'delete', ids: ids.slice(0, 2) });
    expect(gone.body).toEqual({ affected: 2 });
    expect((await api.faq(t.admin).list('?limit=100')).body.stats.total).toBe(24);
    expect((await api.faq(t.admin).bulk({ action: 'delete', ids: [] })).status).toBe(422);
    expect((await api.faq(t.admin).bulk({ action: 'burn', ids })).status).toBe(422);
  });
});

// =====================================================================================================================
describe('limits the platform sets', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('faqlimit');
  });

  it('refuses the FAQ over the cap and the variation over the cap, with 422 FAQ_LIMIT_REACHED', async () => {
    const set = await ops(p)('patch', '/faq').send({ maxFaqs: 2, maxVariationsPerFaq: 3 });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    try {
      const a = await api.entry(t.admin, 'Cap one');
      await api.entry(t.admin, 'Cap two');
      const third = await api
        .faq(t.admin)
        .create({ question: 'Cap three', answerType: 'text', answerText: 'x' });
      expect(third.status).toBe(422);
      expect(code(third)).toBe('FAQ_LIMIT_REACHED');
      expect(await api.count(`SELECT count(*) AS n FROM faqs WHERE org_id = $1`, [t.orgId])).toBe(
        2,
      );

      // The question counts as one of the three.
      const tooMany = await api.faq(t.admin).create({
        question: 'Cap four',
        answerType: 'text',
        answerText: 'x',
        variations: ['a', 'b', 'c'],
      });
      expect(code(tooMany)).toBe('FAQ_LIMIT_REACHED');
      const room = await api
        .faq(t.admin)
        .addVariations(a.id, { texts: ['one', 'two', 'three', 'four'] });
      expect(room.status).toBe(201);
      // Only what fits was taken: 3 in total, the question and two more.
      expect(room.body).toHaveLength(2);
      const full = await api.faq(t.admin).addVariations(a.id, { texts: ['five'] });
      expect(code(full)).toBe('FAQ_LIMIT_REACHED');

      const settings = (await api.faq(t.admin).settings()).body;
      expect(settings.limits).toEqual({ maxFaqs: 2, maxVariationsPerFaq: 3 });
      // 'Cap one' holds its question and two more (three), 'Cap two' only its question.
      expect(settings.usage).toEqual({ faqs: 2, variations: 4 });
    } finally {
      await ops(p)('patch', '/faq').send({ maxFaqs: 500, maxVariationsPerFaq: 60 });
    }
  });
});

// =====================================================================================================================
describe('without any AI key (phase one: the engine must degrade, never break)', () => {
  let t: Tenant;
  let order: EntryJson;
  beforeAll(async () => {
    await setPlatformKey(p, false);
    t = await api.signup('faqnokey');
    order = await api.entry(t.admin, ORDER, { variations: ['Track my order', 'Order status'] });
  });

  it('saving works; the variations wait, with the reason, and fail after five attempts', async () => {
    const stored = await indexAll(p, 1);
    expect(stored).toBe(0);
    const got = (await api.faq(t.admin).get(order.id)).body as EntryJson;
    expect(got.variations!.every((v) => v.embedState === 'pending')).toBe(true);
    expect(got.variations![0]!.embedError).toContain('No OpenRouter key');
    for (let i = 0; i < 6; i++) await indexAll(p, 1);
    const after = (await api.faq(t.admin).get(order.id)).body as EntryJson;
    expect(after.variations!.every((v) => v.embedState === 'failed')).toBe(true);
    expect(after.failedCount).toBe(3);
    expect((await api.faq(t.admin).list('?indexing=failed')).body.data).toHaveLength(1);
    expect((await api.faq(t.admin).list()).body.stats.failed).toBe(3);
  });

  it('the playground still answers an exact phrase, and says why it used spelling for the rest', async () => {
    const exact = await decision(t, 'order status');
    expect(exact).toMatchObject({ outcome: 'answered', tier: 'exact', score: 1 });
    const fuzzy = await decision(t, 'order statuss');
    expect(fuzzy.tier).toBe('trigram');
    expect(fuzzy.note).toMatch(/No variation has its vector yet|No OpenRouter key/);
    expect(fuzzy.outcome).toBe('answered');
    // Nothing similar and no vector to ask: not an FAQ answer, and not 'no FAQs' either (this workspace has one).
    expect((await decision(t, 'capital of france')).outcome).toBe('below_threshold');
  });

  it('generating suggestions is 422 FAQ_EMBEDDING_UNAVAILABLE with a message a person can act on', async () => {
    const res = await api.faq(t.admin).generate(order.id);
    expect(res.status).toBe(422);
    expect(code(res)).toBe('FAQ_EMBEDDING_UNAVAILABLE');
    expect(res.body.detail).toContain('OpenRouter key');
  });

  it('once a key exists, the failed variations come back with a retry and get their vectors', async () => {
    await setPlatformKey(p, true);
    const overview = (await ops(p)('get', '/faq')).body;
    expect(overview.platformKeyReady).toBe(true);
    expect(overview.stats.failed).toBeGreaterThanOrEqual(3);
    const retry = await ops(p)('post', '/faq/reindex').send({ scope: 'failed' });
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(retry.body.queued).toBeGreaterThanOrEqual(3);
    await indexAll(p);
    const got = (await api.faq(t.admin).get(order.id)).body as EntryJson;
    expect(got.variations!.every((v) => v.embedState === 'ready' && v.embedError === null)).toBe(
      true,
    );
    expect(got.readyCount).toBe(3);
  });
});

// =====================================================================================================================
describe('indexing', () => {
  let t: Tenant;
  beforeAll(async () => {
    await setPlatformKey(p, true);
    t = await api.signup('faqindex');
  });

  it('stores one 3072-wide vector per variation with the model that made it, and records the tokens', async () => {
    const e = await api.entry(t.admin, 'Indexed question', {
      variations: ['First phrase', 'Second phrase'],
    });
    expect(await indexAll(p)).toBeGreaterThanOrEqual(3);
    const rows = await p.h.owner.query(
      `SELECT embed_state, embedding_model, vector_dims(embedding) AS dims, embed_attempts, embedded_at IS NOT NULL AS stamped
       FROM faq_variations WHERE org_id = $1 AND faq_id = (SELECT id FROM faqs WHERE uuid = $2)`,
      [t.orgId, e.id],
    );
    expect(rows.rows).toHaveLength(3);
    for (const r of rows.rows) {
      expect(r).toMatchObject({
        embed_state: 'ready',
        embedding_model: 'openai/text-embedding-3-large',
        dims: 3072,
        embed_attempts: 0,
        stamped: true,
      });
    }
    const ledger = await p.h.owner.query(
      `SELECT provider, model, billed_against, prompt_tokens, completion_tokens FROM ai_token_usage WHERE org_id = $1 ORDER BY id DESC LIMIT 1`,
      [t.orgId],
    );
    expect(ledger.rows[0]).toMatchObject({
      provider: 'openrouter',
      model: 'openai/text-embedding-3-large',
      billed_against: 'admin',
      completion_tokens: 0,
    });
    expect(Number(ledger.rows[0].prompt_tokens)).toBeGreaterThan(0);
    const got = (await api.faq(t.admin).get(e.id)).body as EntryJson;
    expect(got.readyCount).toBe(3);
    expect(got.pendingCount).toBe(0);
  });

  it('a second pass has nothing to do (idempotent) and never re-embeds a ready row', async () => {
    const before = await api.count(`SELECT count(*) AS n FROM ai_token_usage WHERE org_id = $1`, [
      t.orgId,
    ]);
    expect(await indexAll(p)).toBe(0);
    expect(
      await api.count(`SELECT count(*) AS n FROM ai_token_usage WHERE org_id = $1`, [t.orgId]),
    ).toBe(before);
  });

  it('a text edited while its vector was being made is left pending, not stored under the old text', async () => {
    const { FaqRepository } = await import('../../../src/modules/faq-knowledge/faq.repository');
    const { DatabaseService } = await import('../../../src/infra/db/database.service');
    const repo = p.h.app.get(FaqRepository);
    const db = p.h.app.get(DatabaseService);
    const e = await api.entry(t.admin, 'Race question');
    const vid = (
      await p.h.owner.query(
        `SELECT id FROM faq_variations WHERE org_id = $1 AND text = 'Race question'`,
        [t.orgId],
      )
    ).rows[0].id as number;
    const ok = await db.txAs({ orgId: t.orgId, userId: null }, (tx) =>
      repo.markReady(
        tx,
        t.orgId,
        Number(vid),
        'Old text',
        '[' + new Array(3072).fill(0.1).join(',') + ']',
        'm',
      ),
    );
    expect(ok).toBe(false);
    expect(
      await api.count(
        `SELECT count(*) AS n FROM faq_variations WHERE id = $1 AND embed_state = 'pending'`,
        [vid],
      ),
    ).toBe(1);
    void e;
  });

  it('vectors made under a replaced model and rows that gave up are re-queued by the self-heal pass, so indexing passes', async () => {
    const { FaqEmbedWorker } = await import('../../../src/modules/faq-knowledge/faq-embed.worker');
    const worker = p.h.app.get(FaqEmbedWorker);
    const x = await api.signup('faqheal');
    const e = await api.entry(x.admin, 'Heal question', { variations: ['heal one', 'heal two'] });
    await indexAll(p);
    // Simulates a batch that was being embedded when the operator switched the model: stored as ready, but under the old model.
    await p.h.owner.query(
      `UPDATE faq_variations SET embedding_model = 'openai/older-model' WHERE org_id = $1 AND text = 'heal one'`,
      [x.orgId],
    );
    await p.h.owner.query(
      `UPDATE faq_variations SET embed_state = 'failed', embed_attempts = 5, embed_error = 'gave up', embedding = NULL, embedding_model = NULL
       WHERE org_id = $1 AND text = 'heal two'`,
      [x.orgId],
    );
    // Both come back: the stale vector and the row that gave up are queued again (the self-heal pass retries by default).
    expect(await worker.healStale()).toBeGreaterThanOrEqual(2);
    const states = async () =>
      Object.fromEntries(
        (
          await p.h.owner.query(
            `SELECT text, embed_state, embedding_model FROM faq_variations WHERE org_id = $1`,
            [x.orgId],
          )
        ).rows.map((r) => [r.text as string, r]),
      );
    let now = await states();
    expect(now['heal one']).toMatchObject({ embed_state: 'pending' });
    expect(now['heal two']).toMatchObject({ embed_state: 'pending' });
    await indexAll(p);
    now = await states();
    expect(now['heal one']).toMatchObject({
      embed_state: 'ready',
      embedding_model: 'openai/text-embedding-3-large',
    });
    expect(now['heal two']).toMatchObject({ embed_state: 'ready' });
    expect(((await api.faq(x.admin).get(e.id)).body as EntryJson).failedCount).toBe(0);
  });

  it('a provider failure for one workspace leaves others indexing and the failing rows pending with a reason', async () => {
    const bad = await api.signup('faqbad');
    const good = await api.signup('faqgood');
    const b = await api.entry(bad.admin, 'Broken one [[fail]]');
    const g = await api.entry(good.admin, 'Healthy one');
    await indexAll(p, 1);
    const gb = (await api.faq(bad.admin).get(b.id)).body as EntryJson;
    const gg = (await api.faq(good.admin).get(g.id)).body as EntryJson;
    expect(gb.variations![0]).toMatchObject({ embedState: 'pending' });
    expect(gb.variations![0]!.embedError).toBeTruthy();
    expect(gb.variations![0]!.embedError).not.toContain('sk-or');
    expect(gg.variations![0]).toMatchObject({ embedState: 'ready' });
    // The failing one is retried until it gives up; it does not block the healthy workspace.
    for (let i = 0; i < 6; i++) await indexAll(p, 1);
    expect(
      ((await api.faq(bad.admin).get(b.id)).body as EntryJson).variations![0]!.embedState,
    ).toBe('failed');
  });

  it('an exhausted monthly allowance on the platform key holds indexing with a clear reason, and lifting it resumes', async () => {
    const x = await api.signup('faqallow');
    const e = await api.entry(x.admin, 'Allowance question');
    await p.h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"limits": {"ai_token_limit_monthly": 1}}'::jsonb WHERE org_id = $1`,
      [x.orgId],
    );
    await p.h.owner.query(
      `INSERT INTO ai_token_usage (org_id, provider, model, prompt_tokens, completion_tokens, total_tokens, billed_against) VALUES ($1,'openrouter','m',5,5,10,'admin')`,
      [x.orgId],
    );
    await indexAll(p, 1);
    const held = (await api.faq(x.admin).get(e.id)).body as EntryJson;
    expect(held.variations![0]).toMatchObject({ embedState: 'pending' });
    expect(held.variations![0]!.embedError).toMatch(/allowance/i);
    await p.h.owner.query(`UPDATE org_plan_state SET overrides = '{}'::jsonb WHERE org_id = $1`, [
      x.orgId,
    ]);
    await p.h.owner.query(`UPDATE faq_variations SET embed_attempts = 0 WHERE org_id = $1`, [
      x.orgId,
    ]);
    await indexAll(p);
    expect(((await api.faq(x.admin).get(e.id)).body as EntryJson).variations![0]).toMatchObject({
      embedState: 'ready',
    });
  });
});

// =====================================================================================================================
describe('the matcher (playground)', () => {
  let t: Tenant;
  let e: { order: EntryJson; refund: EntryJson; hours: EntryJson };
  beforeAll(async () => {
    await setPlatformKey(p, true);
    t = await api.signup('faqmatch');
    e = await seedBasics(t);
    await indexAll(p);
  });

  it('an exact phrase wins on the exact tier at score 1, whatever the case or spacing', async () => {
    for (const q of [
      'order status',
      'ORDER   STATUS',
      '  Where is my order?  ',
      'where IS my ORDER?',
    ]) {
      const d = await decision(t, q);
      expect(d, q).toMatchObject({
        outcome: 'answered',
        tier: 'exact',
        score: 1,
        faqId: e.order.id,
      });
    }
  });

  it('a paraphrase is answered by the semantic tier with the numbers that justify it', async () => {
    const d = await decision(t, 'refunds please');
    expect(d).toMatchObject({
      outcome: 'answered',
      tier: 'semantic',
      faqId: e.refund.id,
      embeddingModel: 'openai/text-embedding-3-large',
    });
    expect(d.score).toBeGreaterThan(0.6);
    expect(d.score).toBeLessThan(1);
    expect(d.threshold).toBe(0.5);
    expect(d.candidates[0]).toMatchObject({ faqId: e.refund.id, question: REFUND });
    expect(d.candidates.length).toBeGreaterThan(1);
    expect(d.candidates.map((c) => c.score)).toEqual(
      [...d.candidates.map((c) => c.score)].sort((a, b) => b - a),
    );
  });

  it('something unrelated is below the threshold, with the near misses shown and nothing chosen', async () => {
    const d = await decision(t, 'what is the capital of france');
    expect(d.outcome).toBe('below_threshold');
    expect(d.faqId).toBeNull();
    expect(d.score ?? 0).toBeLessThan(0.45);
  });

  it('a message too short to be a question is refused with the reason, and never reaches the vendor', async () => {
    const before = await api.count(`SELECT count(*) AS n FROM ai_token_usage WHERE org_id = $1`, [
      t.orgId,
    ]);
    for (const q of ['?', '👍', 'a', '...']) {
      const d = await decision(t, q);
      expect(d.outcome, q).toBe('below_threshold');
      expect(d.note).toContain('Too short');
    }
    expect(
      await api.count(`SELECT count(*) AS n FROM ai_token_usage WHERE org_id = $1`, [t.orgId]),
    ).toBe(before);
  });

  it('a paused FAQ is never matched, not even by its exact phrase', async () => {
    const q = await api.entry(t.admin, 'Paused topic', { variations: ['zebra crossing'] });
    await indexAll(p);
    expect((await decision(t, 'zebra crossing')).outcome).toBe('answered');
    await api.faq(t.admin).bulk({ action: 'pause', ids: [q.id] });
    const d = await decision(t, 'zebra crossing');
    expect(d.outcome).toBe('below_threshold');
    expect(d.candidates.find((c) => c.faqId === q.id)).toBeUndefined();
    await api.faq(t.admin).bulk({ action: 'activate', ids: [q.id] });
    expect((await decision(t, 'zebra crossing')).outcome).toBe('answered');
  });

  it("a FAQ's own threshold overrides the workspace's: a stricter FAQ refuses what the workspace would accept", async () => {
    const q = await api.entry(t.admin, 'Strict topic', {
      variations: ['quartz crystal'],
      thresholdOverride: 0.95,
    });
    await indexAll(p);
    const near = await decision(t, 'quartz');
    expect(near.outcome).toBe('below_threshold');
    expect(near.threshold).toBe(0.95);
    expect((await decision(t, 'quartz crystal')).outcome).toBe('answered');
    const cur = (await api.faq(t.admin).get(q.id)).body as EntryJson;
    await api.faq(t.admin).update(q.id, {
      question: cur.question,
      answerType: 'text',
      answerText: 'x',
      status: 'active',
      thresholdOverride: null,
      rowVersion: cur.rowVersion,
    });
    expect((await decision(t, 'quartz')).outcome).toBe('answered');
  });

  it('a margin refuses two FAQs that score alike (low_margin) and the playground reports the margin it used', async () => {
    const amb = await api.signup('faqamb');
    await api.entry(amb.admin, 'Alpha topic', { variations: ['refund hours'] });
    await api.entry(amb.admin, 'Beta topic', { variations: ['opening hours'] });
    await indexAll(p);
    const saved = await api
      .faq(amb.admin)
      .saveSettings({ enabled: true, threshold: 0.4, minMargin: 0, logQueries: true });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const open = await decision(amb, 'hours');
    expect(open.outcome).toBe('answered');
    const s = (await api.faq(amb.admin).settings()).body;
    await api.faq(amb.admin).saveSettings({
      enabled: true,
      threshold: 0.4,
      minMargin: 0.1,
      logQueries: true,
      rowVersion: s.rowVersion,
    });
    const tie = await decision(amb, 'hours');
    expect(tie).toMatchObject({ outcome: 'low_margin', minMargin: 0.1, faqId: null });
    expect(tie.secondScore).not.toBeNull();
    expect(Math.abs((tie.score ?? 0) - (tie.secondScore ?? 0))).toBeLessThan(0.1);
  });

  it('the workspace threshold changes the decision at the boundary', async () => {
    const th = await api.signup('faqthresh');
    await api.entry(th.admin, 'Boundary topic', { variations: ['violet shade'] });
    await indexAll(p);
    const s1 = await api
      .faq(th.admin)
      .saveSettings({ enabled: true, threshold: 0.5, minMargin: 0, logQueries: true });
    expect((await decision(th, 'violet')).outcome).toBe('answered');
    await api.faq(th.admin).saveSettings({
      enabled: true,
      threshold: 0.9,
      minMargin: 0,
      logQueries: true,
      rowVersion: s1.body.rowVersion,
    });
    const strict = await decision(th, 'violet');
    expect(strict.outcome).toBe('below_threshold');
    expect(strict.threshold).toBe(0.9);
  });

  it('a vendor failure falls back to spelling similarity, and says so; when spelling finds nothing it is reported as an error', async () => {
    const fb = await api.entry(t.admin, 'Fallback topic', { variations: ['quokka sighting'] });
    await indexAll(p);
    const typo = await decision(t, 'quokka sightin [[fail]]');
    expect(typo.note).toMatch(/Spelling similarity was used/);
    expect(typo.tier).toBe('trigram');
    const nothing = await decision(t, 'zzzz qqqq [[fail]]');
    expect(nothing.outcome).toBe('provider_error');
    expect(nothing.faqId).toBeNull();
    void fb;
  });

  it('the hourly semantic cap sends the rest to spelling similarity', async () => {
    await ops(p)('patch', '/faq').send({ semanticPerHour: 0 });
    try {
      const d = await decision(t, 'refunds please');
      expect(d.tier).not.toBe('semantic');
      expect(d.note).toMatch(/hourly limit/);
    } finally {
      await ops(p)('patch', '/faq').send({ semanticPerHour: 600 });
    }
  });

  it('the playground never counts in the insights and never writes an unanswered row', async () => {
    const s = (await api.faq(t.admin).summary()).body;
    expect(s.totals.messages).toBe(0);
    expect((await api.faq(t.admin).log()).body.data).toHaveLength(0);
    expect(
      await api.count(
        `SELECT count(*) AS n FROM faq_match_logs WHERE org_id = $1 AND origin = 'test'`,
        [t.orgId],
      ),
    ).toBeGreaterThan(5);
  });

  it('a workspace with no FAQs answers no_faqs; the playground refuses an empty or over-long message', async () => {
    const empty = await api.signup('faqempty');
    expect(await decision(empty, 'anything at all')).toMatchObject({
      outcome: 'no_faqs',
      faqId: null,
    });
    expect((await api.faq(t.admin).test('')).status).toBe(422);
    expect((await api.faq(t.admin).test('x'.repeat(1001))).status).toBe(422);
  });
});

// =====================================================================================================================
describe('suggestions', () => {
  let t: Tenant;
  let e: EntryJson;
  beforeAll(async () => {
    await setPlatformKey(p, true);
    t = await api.signup('faqgen');
    e = await api.entry(t.admin, 'Gift wrapping', { variations: ['Do you wrap gifts'] });
  });

  it('returns suggestions without saving any, leaves out what the FAQ has, and records the tokens', async () => {
    const res = await api.faq(t.admin).generate(e.id, { count: 5 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.suggestions).toHaveLength(5);
    expect(res.body.model).toBe('openai/gpt-4o-mini');
    expect(res.body.suggestions.map((s: string) => s.toLowerCase())).not.toContain('gift wrapping');
    expect(
      await api.count(`SELECT count(*) AS n FROM faq_variations WHERE org_id = $1`, [t.orgId]),
    ).toBe(2);
    const ledger = await p.h.owner.query(
      `SELECT model, completion_tokens FROM ai_token_usage WHERE org_id = $1 AND model = 'openai/gpt-4o-mini'`,
      [t.orgId],
    );
    expect(ledger.rows).toHaveLength(1);
    expect(Number(ledger.rows[0].completion_tokens)).toBeGreaterThan(0);
  });

  it('the person adds the ones they pick, as source ai', async () => {
    const res = await api.faq(t.admin).generate(e.id, { count: 4 });
    const pick = res.body.suggestions.slice(0, 2) as string[];
    const add = await api.faq(t.admin).addVariations(e.id, { texts: pick, source: 'ai' });
    expect(add.status).toBe(201);
    expect(add.body.map((v: { source: string }) => v.source)).toEqual(['ai', 'ai']);
  });

  it('validates the count and the FAQ', async () => {
    expect((await api.faq(t.admin).generate(e.id, { count: 2 })).status).toBe(422);
    expect((await api.faq(t.admin).generate(e.id, { count: 21 })).status).toBe(422);
    expect((await api.faq(t.admin).generate('00000000-0000-4000-8000-0000000000bb')).status).toBe(
      404,
    );
  });
});

// =====================================================================================================================
describe('answering customers on a channel', () => {
  let t: Tenant;
  let ch: SimChannel;
  beforeAll(async () => {
    await setPlatformKey(p, true);
    t = await api.signup('faqchat');
    ch = await simChannel(p, t);
    await seedBasics(t);
    await indexAll(p);
  });

  const say = (peer: string, text: string) =>
    simInbound(p, t, ch, { from: peer, name: 'Asha', text });

  it('stays silent for a phrase no FAQ has, with answering on by default', async () => {
    const peer = nextPeer();
    await say(peer, 'order status');
    await new Promise((r) => setTimeout(r, 1500));
    expect(await sentTo(p, t, ch, peer)).toEqual([]);
    expect(
      await api.count(
        `SELECT count(*) AS n FROM faq_match_logs WHERE org_id = $1 AND origin = 'inbound'`,
        [t.orgId],
      ),
    ).toBe(0);
  });

  it('settings: defaults, a first save without a version, then versioned saves', async () => {
    const f = api.faq(t.admin);
    const before = (await f.settings()).body;
    expect(before).toMatchObject({
      enabled: true,
      // The default follows the embedding model: 0.5 is the one measured for text-embedding-3-large.
      threshold: 0.5,
      recommendedThreshold: 0.5,
      tunedForModel: null,
      modelChanged: false,
      minMargin: 0,
      logQueries: true,
      isDefault: true,
      engineEnabled: true,
      embeddingModel: 'openai/text-embedding-3-large',
      rowVersion: null,
    });
    expect(
      (
        await f.saveSettings({
          enabled: true,
          threshold: 0.45,
          minMargin: 0,
          logQueries: true,
          rowVersion: 1,
        })
      ).status,
    ).toBe(409);
    const first = await f.saveSettings({
      enabled: true,
      threshold: 0.45,
      minMargin: 0,
      logQueries: true,
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ enabled: true, isDefault: false, rowVersion: 1 });
    const noVersion = await f.saveSettings({
      enabled: true,
      threshold: 0.5,
      minMargin: 0,
      logQueries: true,
    });
    expect(noVersion.status).toBe(409);
    const stale = await f.saveSettings({
      enabled: true,
      threshold: 0.5,
      minMargin: 0,
      logQueries: true,
      rowVersion: 7,
    });
    expect(code(stale)).toBe('ROW_VERSION_CONFLICT');
    for (const bad of [
      { threshold: 0.04 },
      { threshold: 1 },
      { minMargin: -0.1 },
      { minMargin: 0.6 },
      { enabled: 'yes' },
    ]) {
      const res = await f.saveSettings({
        enabled: true,
        threshold: 0.45,
        minMargin: 0,
        logQueries: true,
        rowVersion: 1,
        ...bad,
      });
      expect(res.status, JSON.stringify(bad)).toBe(422);
    }
    const audit = await p.h.owner.query(
      `SELECT action FROM audit_log WHERE org_id = $1 AND module = 'faq_settings'`,
      [t.orgId],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('an FAQ matched by exact phrase is sent to the customer as a bot message, and the decision is logged', async () => {
    const peer = nextPeer();
    await say(peer, 'Order Status');
    const got = await untilSent(p, t, ch, peer, 1);
    expect(got).toEqual(['Your order ships in 2 days.']);
    const log = (await api.faq(t.admin).log()).body.data[0];
    expect(log).toMatchObject({
      outcome: 'answered',
      tier: 'exact',
      query: 'Order Status',
      score: 1,
      origin: 'inbound',
      resolved: false,
    });
    expect(log.faqQuestion).toBe(ORDER);
  });

  it('a paraphrase is answered by meaning, and the hit counters follow', async () => {
    const peer = nextPeer();
    await say(peer, 'refunds please');
    expect(await untilSent(p, t, ch, peer, 1)).toEqual(['Refunds take 5 days.']);
    // The reply is queued before the decision is logged, so wait for this message's row.
    const log = await until('the paraphrase is logged', async () => {
      const row = (await api.faq(t.admin).log('?view=answered')).body.data[0];
      return row?.query === 'refunds please' ? row : undefined;
    });
    expect(log).toMatchObject({ outcome: 'answered', tier: 'semantic', faqQuestion: REFUND });
    expect(log.score).toBeGreaterThan(0.45);
    const list = (await api.faq(t.admin).list('?limit=50')).body.data as EntryJson[];
    const refund = list.find((x) => x.question === REFUND)!;
    expect(refund.hitCount).toBe(1);
    expect(refund.lastHitAt).not.toBeNull();
    // A hit does not touch the row version, so an editor with the form open does not get a 409.
    expect(refund.rowVersion).toBe(1);
  });

  it('answers each message once, even when the same message is delivered twice', async () => {
    const peer = nextPeer();
    const first = await say(peer, 'track my order');
    await untilSent(p, t, ch, peer, 1);
    await new Promise((r) => setTimeout(r, 800));
    expect(await sentTo(p, t, ch, peer)).toHaveLength(1);
    void first;
  });

  it('a message nothing answers gets no reply and appears as unanswered, with its near misses', async () => {
    const peer = nextPeer();
    await say(peer, 'do you sell hammocks');
    const row = await until('unanswered log', async () => {
      const r = (await api.faq(t.admin).log('?view=unanswered')).body.data as Array<
        Record<string, unknown>
      >;
      return r.find((x) => x.query === 'do you sell hammocks');
    });
    expect(row).toMatchObject({ outcome: 'below_threshold', faqId: null, resolved: false });
    expect(await sentTo(p, t, ch, peer)).toEqual([]);
  });

  it('a keyword flow wins: the flow runs and the FAQ stays quiet for that message', async () => {
    const f = await addFlow(p, t, 'Keyword flow', 'zebra', 'The keyword flow spoke');
    void f;
    const peer = nextPeer();
    await api.entry(t.admin, 'Zebra facts', { variations: ['zebra stripes'] });
    await indexAll(p);
    await say(peer, 'zebra stripes');
    const got = await untilSent(p, t, ch, peer, 1);
    expect(got).toEqual(['The keyword flow spoke']);
    await new Promise((r) => setTimeout(r, 800));
    expect(await sentTo(p, t, ch, peer)).toHaveLength(1);
    expect(
      await api.count(
        `SELECT count(*) AS n FROM faq_match_logs WHERE org_id = $1 AND query = 'zebra stripes'`,
        [t.orgId],
      ),
    ).toBe(0);
  });

  it('an FAQ linked to a flow starts that flow for the customer', async () => {
    const flow = await addFlow(p, t, 'Agent flow', 'zzneverTyped', 'Connecting you with a person');
    await api.faq(t.admin).create({
      question: 'Talk to a human',
      answerType: 'flow',
      flowId: flow.uuid,
      variations: ['I need an agent'],
    });
    await indexAll(p);
    const peer = nextPeer();
    await say(peer, 'i need an agent');
    expect(await untilSent(p, t, ch, peer, 1)).toEqual(['Connecting you with a person']);
    const runs = await p.h.owner.query(
      `SELECT source, trigger_text FROM flow_runs WHERE org_id = $1 AND flow_id = $2`,
      [t.orgId, flow.id],
    );
    expect(runs.rows).toHaveLength(1);
    expect(runs.rows[0]).toMatchObject({ source: 'keyword', trigger_text: 'i need an agent' });
    const log = (await api.faq(t.admin).log('?view=answered')).body.data[0];
    expect(log.outcome).toBe('flow_started');
  });

  it('a matched FAQ whose flow was deleted is logged as not sent and answers nothing, and the list marks it', async () => {
    const flow = await addFlow(p, t, 'Doomed flow', 'zzdoomed');
    const e = (
      await api.faq(t.admin).create({
        question: 'Doomed question',
        answerType: 'flow',
        flowId: flow.uuid,
        variations: ['doomed phrase'],
      })
    ).body as EntryJson;
    await indexAll(p);
    await p.h.owner.query(`DELETE FROM flows WHERE id = $1`, [flow.id]);
    const peer = nextPeer();
    await say(peer, 'doomed phrase');
    const row = await until('not_sent log', async () => {
      const r = (await api.faq(t.admin).log('?view=errors')).body.data as Array<
        Record<string, unknown>
      >;
      return r.find((x) => x.query === 'doomed phrase');
    });
    expect(row).toMatchObject({ outcome: 'not_sent' });
    expect(String(row.error)).toContain('no longer exists');
    expect(await sentTo(p, t, ch, peer)).toEqual([]);
    const got = (await api.faq(t.admin).get(e.id)).body as EntryJson;
    expect(got).toMatchObject({ answerType: 'flow', flowId: null, flowName: null });
  });

  it('a customer message that is not text (an image, a tap) is never matched', async () => {
    const before = await api.count(`SELECT count(*) AS n FROM faq_match_logs WHERE org_id = $1`, [
      t.orgId,
    ]);
    const { InboundIngestService } =
      await import('../../../src/modules/chat-conversations/inbound-ingest.service');
    const { RequestContextStore } = await import('../../../src/common/context/request-context');
    const ingest = p.h.app.get(InboundIngestService);
    await RequestContextStore.run(
      { requestId: 'spec', orgId: t.orgId, actorType: 'system', actorId: null, userId: null },
      () =>
        ingest.ingest({
          orgId: t.orgId,
          channelUuid: ch.id,
          message: {
            providerMessageId: `spec.tap.${Math.random()}`,
            peerKey: nextPeer(),
            kind: 'interactive',
            body: 'order status',
            meta: { interactive: { type: 'button_reply', id: 'b1', title: 'order status' } },
            providerTimestamp: new Date().toISOString(),
          } as never,
        }),
    );
    await new Promise((r) => setTimeout(r, 1000));
    expect(
      await api.count(`SELECT count(*) AS n FROM faq_match_logs WHERE org_id = $1`, [t.orgId]),
    ).toBe(before);
  });

  it('survives an emoji-only message and a very long one (the long one is cut, not refused) without breaking the pipeline', async () => {
    const peer = nextPeer();
    await say(peer, '🙏🙏');
    await say(peer, 'where is my order '.repeat(200));
    await new Promise((r) => setTimeout(r, 1500));
    const sent = await sentTo(p, t, ch, peer);
    expect(sent.length).toBeGreaterThanOrEqual(1);
  });

  it('the insights add up: answered, flows, unanswered, the daily split and the top FAQs', async () => {
    const s = (await api.faq(t.admin).summary('?days=30')).body;
    expect(s.days).toBe(30);
    expect(s.totals.messages).toBe(
      s.totals.answered +
        s.totals.flowStarted +
        s.totals.unanswered +
        s.totals.providerErrors +
        s.totals.notSent,
    );
    expect(s.totals.answered).toBeGreaterThanOrEqual(3);
    expect(s.totals.flowStarted).toBeGreaterThanOrEqual(1);
    expect(s.totals.unanswered).toBeGreaterThanOrEqual(1);
    expect(s.answerRate).toBeGreaterThan(0);
    expect(s.answerRate).toBeLessThanOrEqual(1);
    expect(s.scoreHistogram).toHaveLength(10);
    expect(
      s.scoreHistogram.reduce(
        (n: number, b: { answered: number; unanswered: number }) => n + b.answered + b.unanswered,
        0,
      ),
    ).toBeGreaterThan(0);
    expect(s.daily.length).toBeGreaterThanOrEqual(1);
    expect(s.topFaqs[0].hits).toBeGreaterThanOrEqual(1);
    expect(s.neverMatched).toBeGreaterThanOrEqual(0);
    expect(s.unresolvedUnanswered).toBeGreaterThanOrEqual(1);
    expect((await api.faq(t.admin).summary('?days=0')).status).toBe(422);
    expect((await api.faq(t.admin).summary('?days=91')).status).toBe(422);
  });

  it('the log pages, searches and filters by FAQ', async () => {
    const all = (await api.faq(t.admin).log('?limit=2')).body;
    expect(all.data).toHaveLength(2);
    expect(all.page.hasMore).toBe(true);
    const next = (
      await api.faq(t.admin).log(`?limit=2&cursor=${encodeURIComponent(all.page.nextCursor)}`)
    ).body;
    expect(next.data[0].id).not.toBe(all.data[0].id);
    expect((await api.faq(t.admin).log('?search=hammocks')).body.data).toHaveLength(1);
    const order = (
      (await api.faq(t.admin).list('?search=Where%20is%20my%20order')).body.data as EntryJson[]
    )[0]!;
    const forOrder = (await api.faq(t.admin).log(`?faqId=${order.id}`)).body.data;
    expect(forOrder.length).toBeGreaterThanOrEqual(2);
    expect(forOrder.every((x: { faqId: string }) => x.faqId === order.id)).toBe(true);
    expect(
      (await api.faq(t.admin).log('?faqId=00000000-0000-4000-8000-0000000000cc')).body.data,
    ).toHaveLength(0);
  });

  it('learning from an unanswered message makes it a variation, resolves every copy of it, and the next one is answered', async () => {
    const peer = nextPeer();
    await say(peer, 'is the courier late');
    await say(nextPeer(), 'Is the courier  late');
    const row = await until('unanswered courier', async () => {
      const r = (await api.faq(t.admin).log('?view=unanswered')).body.data as Array<
        Record<string, unknown>
      >;
      return r.filter(
        (x) => String(x.query).toLowerCase().replace(/\s+/g, ' ') === 'is the courier late',
      ).length === 2
        ? r.find((x) => x.query === 'is the courier late')
        : undefined;
    });
    const order = (
      (await api.faq(t.admin).list('?search=Where%20is%20my%20order')).body.data as EntryJson[]
    )[0]!;
    const learn = await api.faq(t.admin).learn(row.id as string, { faqId: order.id });
    expect(learn.status, JSON.stringify(learn.body)).toBe(200);
    expect(learn.body).toEqual({ added: true });
    const got = (await api.faq(t.admin).get(order.id)).body as EntryJson;
    expect(got.variations!.find((v) => v.text === 'is the courier late')).toMatchObject({
      source: 'learned',
      embedState: 'pending',
    });
    const left = (await api.faq(t.admin).log('?view=unanswered')).body.data as Array<
      Record<string, unknown>
    >;
    expect(left.filter((x) => String(x.query).toLowerCase().includes('courier'))).toHaveLength(0);
    await indexAll(p);
    const again = nextPeer();
    await say(again, 'IS THE COURIER LATE');
    expect(await untilSent(p, t, ch, again, 1)).toEqual(['Your order ships in 2 days.']);
    // Learning twice is harmless.
    expect((await api.faq(t.admin).learn(row.id as string, { faqId: order.id })).body).toEqual({
      added: false,
    });
  });

  it('dismissing resolves a message without touching any FAQ; unknown ids are 404', async () => {
    await say(nextPeer(), 'random chatter about the weather');
    const row = await until('chatter', async () =>
      (
        (await api.faq(t.admin).log('?view=unanswered')).body.data as Array<Record<string, unknown>>
      ).find((x) => x.query === 'random chatter about the weather'),
    );
    const before = (await api.faq(t.admin).list()).body.stats.variations;
    expect((await api.faq(t.admin).dismiss(row.id as string)).status).toBe(204);
    expect((await api.faq(t.admin).list()).body.stats.variations).toBe(before);
    const after = (await api.faq(t.admin).log('?view=unanswered')).body.data as Array<
      Record<string, unknown>
    >;
    expect(after.find((x) => x.id === row.id)).toBeUndefined();
    expect((await api.faq(t.admin).dismiss('00000000-0000-4000-8000-0000000000dd')).status).toBe(
      404,
    );
    const order = (
      (await api.faq(t.admin).list('?search=Where%20is%20my%20order')).body.data as EntryJson[]
    )[0]!;
    expect(
      (await api.faq(t.admin).learn('00000000-0000-4000-8000-0000000000dd', { faqId: order.id }))
        .status,
    ).toBe(404);
    expect(
      (
        await api
          .faq(t.admin)
          .learn(row.id as string, { faqId: '00000000-0000-4000-8000-0000000000ee' })
      ).status,
    ).toBe(404);
  });

  it('with query logging switched off the text is not kept, and learning from such a row is refused', async () => {
    const s = (await api.faq(t.admin).settings()).body;
    await api.faq(t.admin).saveSettings({
      enabled: true,
      threshold: 0.45,
      minMargin: 0,
      logQueries: false,
      rowVersion: s.rowVersion,
    });
    const peer = nextPeer();
    await say(peer, 'secret question about my account number');
    const row = await until('private log', async () => {
      const r = (await api.faq(t.admin).log('?view=unanswered')).body.data as Array<
        Record<string, unknown>
      >;
      return r.find(
        (x) =>
          x.query === null &&
          Number(x.queryLength) === 'secret question about my account number'.length,
      );
    });
    expect(row.candidates).toBeDefined();
    expect(JSON.stringify(row)).not.toContain('secret question');
    expect(
      (row.candidates as Array<{ matchedText: string }>).every((c) => c.matchedText === ''),
    ).toBe(true);
    const order = (
      (await api.faq(t.admin).list('?search=Where%20is%20my%20order')).body.data as EntryJson[]
    )[0]!;
    const learn = await api.faq(t.admin).learn(row.id as string, { faqId: order.id });
    expect(learn.status).toBe(422);
    const raw = await p.h.owner.query(
      `SELECT count(*) AS n FROM faq_match_logs WHERE org_id = $1 AND query ILIKE '%secret question%'`,
      [t.orgId],
    );
    expect(Number(raw.rows[0].n)).toBe(0);
    const back = (await api.faq(t.admin).settings()).body;
    await api.faq(t.admin).saveSettings({
      enabled: true,
      threshold: 0.45,
      minMargin: 0,
      logQueries: true,
      rowVersion: back.rowVersion,
    });
  });

  it('switching answering off stops it at once, and the platform switch overrides the workspace', async () => {
    const s = (await api.faq(t.admin).settings()).body;
    const off = await api.faq(t.admin).saveSettings({
      enabled: false,
      threshold: 0.45,
      minMargin: 0,
      logQueries: true,
      rowVersion: s.rowVersion,
    });
    const peer = nextPeer();
    await say(peer, 'order status');
    await new Promise((r) => setTimeout(r, 1200));
    expect(await sentTo(p, t, ch, peer)).toEqual([]);
    const on = await api.faq(t.admin).saveSettings({
      enabled: true,
      threshold: 0.45,
      minMargin: 0,
      logQueries: true,
      rowVersion: off.body.rowVersion,
    });
    expect(on.status).toBe(200);
    await ops(p)('patch', '/faq').send({ engineEnabled: false });
    try {
      const quiet = nextPeer();
      await say(quiet, 'order status');
      await new Promise((r) => setTimeout(r, 1200));
      expect(await sentTo(p, t, ch, quiet)).toEqual([]);
      expect((await api.faq(t.admin).settings()).body.engineEnabled).toBe(false);
      expect((await api.faq(t.admin).list()).status).toBe(200);
      const blocked = await api
        .faq(t.admin)
        .create({ question: 'Blocked question', answerType: 'text', answerText: 'x' });
      expect(blocked.status).toBe(422);
      expect(code(blocked)).toBe('FAQ_ENGINE_DISABLED');
      expect(code(await api.faq(t.admin).test('order status'))).toBe('FAQ_ENGINE_DISABLED');
      const e = ((await api.faq(t.admin).list('?limit=1')).body.data as EntryJson[])[0]!;
      expect(code(await api.faq(t.admin).generate(e.id))).toBe('FAQ_ENGINE_DISABLED');
    } finally {
      await ops(p)('patch', '/faq').send({ engineEnabled: true });
    }
  });

  it('retention removes log rows older than 90 days and keeps the rest', async () => {
    await p.h.owner.query(
      `UPDATE faq_match_logs SET created_at = now() - interval '91 days' WHERE org_id = $1 AND id = (SELECT min(id) FROM faq_match_logs WHERE org_id = $1)`,
      [t.orgId],
    );
    const total = await api.count(`SELECT count(*) AS n FROM faq_match_logs WHERE org_id = $1`, [
      t.orgId,
    ]);
    const { FaqRetentionService } =
      await import('../../../src/modules/faq-knowledge/faq-retention.service');
    const removed = await p.h.app.get(FaqRetentionService).sweep();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(
      await api.count(`SELECT count(*) AS n FROM faq_match_logs WHERE org_id = $1`, [t.orgId]),
    ).toBe(total - 1);
  });
});

// =====================================================================================================================
describe('platform operator controls', () => {
  beforeAll(async () => {
    await setPlatformKey(p, true);
  });

  it('is for super admins only: a support operator, a workspace user and no token are refused', async () => {
    const t = await api.signup('faqplat');
    expect((await api.as(t.admin).get('/v2/platform/faq')).status).toBe(401);
    expect((await api.http().get('/v2/platform/faq')).status).toBe(401);
    const support = await api
      .http()
      .post('/v2/platform/auth/login')
      .send({ email: 'support@platform.test', password: 'Op3rator!Pass#2026' });
    if (support.status === 201) {
      const token = support.body.tokens.accessToken as string;
      expect((await ops(p, token)('get', '/faq')).status).toBe(403);
      expect((await ops(p, token)('patch', '/faq').send({ engineEnabled: false })).status).toBe(
        403,
      );
      expect((await ops(p, token)('post', '/faq/reindex').send({ scope: 'all' })).status).toBe(403);
    }
    expect((await ops(p)('get', '/faq')).status).toBe(200);
  });

  it('shows the config with the allow-listed models and the health numbers', async () => {
    const res = await ops(p)('get', '/faq');
    expect(res.status).toBe(200);
    expect(res.body.config).toMatchObject({
      engineEnabled: true,
      embeddingModel: 'openai/text-embedding-3-large',
      generationModel: 'openai/gpt-4o-mini',
      defaultThreshold: 0.5,
      defaultThresholdCustom: false,
      maxFaqs: 500,
      maxVariationsPerFaq: 60,
      semanticPerHour: 600,
    });
    expect(res.body.config.allowedModels.map((m: { id: string }) => m.id)).toEqual([
      'openai/text-embedding-3-large',
      'google/gemini-embedding-2',
    ]);
    expect(
      res.body.config.allowedModels.every((m: { dimensions: number }) => m.dimensions === 3072),
    ).toBe(true);
    expect(
      res.body.config.allowedModels.map(
        (m: { recommendedThreshold: number }) => m.recommendedThreshold,
      ),
    ).toEqual([0.5, 0.72]);
    expect(res.body.platformKeyReady).toBe(true);
    for (const k of [
      'workspacesEnabled',
      'faqs',
      'variations',
      'ready',
      'pending',
      'failed',
      'staleModel',
      'matches30d',
      'answered30d',
      'embeddingTokens30d',
    ]) {
      expect(typeof res.body.stats[k], k).toBe('number');
    }
    expect(res.body.stats.embeddingTokens30d).toBeGreaterThan(0);
  });

  it('lists workspaces by activity with their numbers, and searches by name', async () => {
    const res = await ops(p)('get', '/faq/workspaces?limit=100');
    expect(res.status).toBe(200);
    const enabled = res.body.data.filter((w: { enabled: boolean }) => w.enabled);
    expect(enabled.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.indexOf(enabled[0])).toBeLessThan(
      res.body.data.findIndex((w: { enabled: boolean }) => !w.enabled),
    );
    expect(res.body.data[0].workspaceId).toMatch(uuidRe);
    expect(JSON.stringify(res.body)).not.toMatch(/"org_?id"/);
    const one = await ops(p)(
      'get',
      `/faq/workspaces?search=${encodeURIComponent(enabled[0].name)}`,
    );
    expect(one.body.data.some((w: { name: string }) => w.name === enabled[0].name)).toBe(true);
    expect((await ops(p)('get', '/faq/workspaces?search=%25')).body.data).toHaveLength(0);
    expect((await ops(p)('get', '/faq/workspaces?limit=0')).status).toBe(422);
  });

  it('validates every change and applies a partial one without touching the rest', async () => {
    for (const bad of [
      {},
      { embeddingModel: 'openai/text-embedding-3-small' },
      { embeddingModel: 'made/up' },
      { defaultThreshold: 0 },
      { defaultThreshold: 1 },
      { defaultThreshold: 'high' },
      { maxFaqs: 0 },
      { maxVariationsPerFaq: 501 },
      { semanticPerHour: -1 },
      { generationModel: 'bad model!' },
      { engineEnabled: 'no' },
    ]) {
      const res = await ops(p)('patch', '/faq').send(bad);
      expect(res.status, JSON.stringify(bad)).toBe(422);
    }
    const ok = await ops(p)('patch', '/faq').send({
      defaultThreshold: 0.6,
      generationModel: 'google/gemini-2.5-flash-lite',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.config).toMatchObject({
      defaultThreshold: 0.6,
      defaultThresholdCustom: true,
      generationModel: 'google/gemini-2.5-flash-lite',
      maxFaqs: 500,
      engineEnabled: true,
    });
    // A workspace that never saved uses the platform default threshold; one that saved keeps its own.
    const fresh = await api.signup('faqdefault');
    expect((await api.faq(fresh.admin).settings()).body).toMatchObject({
      threshold: 0.6,
      recommendedThreshold: 0.5,
      isDefault: true,
    });
    // `null` hands the default back to the model.
    const back = await ops(p)('patch', '/faq').send({
      defaultThreshold: null,
      generationModel: 'openai/gpt-4o-mini',
    });
    expect(back.body.config).toMatchObject({
      defaultThreshold: 0.5,
      defaultThresholdCustom: false,
    });
    const audit = await p.h.owner
      .query(
        `SELECT payload FROM auth_audit_log WHERE event = 'platform.faq_config_updated' ORDER BY id DESC LIMIT 1`,
      )
      .catch(() => ({ rows: [] }));
    if (audit.rows.length) expect(JSON.stringify(audit.rows[0].payload)).toContain('fields');
  });

  it('changing the embedding model re-queues every vector, matching degrades to spelling meanwhile, and re-indexing restores it', async () => {
    const t = await api.signup('faqmodel');
    const a = await api.entry(t.admin, 'Model question', { variations: ['violin lessons'] });
    await api
      .faq(t.admin)
      .saveSettings({ enabled: true, threshold: 0.45, minMargin: 0, logQueries: true });
    await indexAll(p);
    expect((await decision(t, 'violin')).tier).toBe('semantic');
    const swap = await ops(p)('patch', '/faq').send({
      embeddingModel: 'google/gemini-embedding-2',
    });
    expect(swap.status, JSON.stringify(swap.body)).toBe(200);
    try {
      expect(swap.body.config.embeddingModel).toBe('google/gemini-embedding-2');
      const stale = (await api.faq(t.admin).get(a.id)).body as EntryJson;
      expect(stale.variations!.every((v) => v.embedState === 'pending')).toBe(true);
      const during = await decision(t, 'violin');
      expect(during.tier).toBe('trigram');
      expect(during.note).toContain('still indexing');
      await indexAll(p);
      const after = await decision(t, 'violin');
      expect(after).toMatchObject({
        tier: 'semantic',
        embeddingModel: 'google/gemini-embedding-2',
      });
      const rows = await p.h.owner.query(
        `SELECT DISTINCT embedding_model FROM faq_variations WHERE org_id = $1`,
        [t.orgId],
      );
      expect(rows.rows).toEqual([{ embedding_model: 'google/gemini-embedding-2' }]);
    } finally {
      await ops(p)('patch', '/faq').send({ embeddingModel: 'openai/text-embedding-3-large' });
      await indexAll(p);
    }
  });

  it('the default threshold follows the model, a number fixed for the old model is dropped, and tuned workspaces are flagged until they save', async () => {
    const tuned = await api.signup('faqtuned');
    const never = await api.signup('faqnever');
    const saved = await api
      .faq(tuned.admin)
      .saveSettings({ enabled: true, threshold: 0.55, minMargin: 0, logQueries: true });
    expect(saved.body).toMatchObject({
      tunedForModel: 'openai/text-embedding-3-large',
      modelChanged: false,
    });
    await ops(p)('patch', '/faq').send({ defaultThreshold: 0.6 });
    try {
      const swap = await ops(p)('patch', '/faq').send({
        embeddingModel: 'google/gemini-embedding-2',
      });
      expect(swap.status, JSON.stringify(swap.body)).toBe(200);
      // The 0.6 the operator fixed was right for the old scale: it is gone, and the default is the new model's.
      expect(swap.body.config).toMatchObject({
        defaultThreshold: 0.72,
        defaultThresholdCustom: false,
      });
      const flagged = (await api.faq(tuned.admin).settings()).body;
      expect(flagged).toMatchObject({
        threshold: 0.55,
        modelChanged: true,
        tunedForModel: 'openai/text-embedding-3-large',
        recommendedThreshold: 0.72,
        embeddingModel: 'google/gemini-embedding-2',
      });
      // A workspace that never saved follows the model, so there is nothing for it to review.
      expect((await api.faq(never.admin).settings()).body).toMatchObject({
        threshold: 0.72,
        modelChanged: false,
        isDefault: true,
      });
      // Saving is the owner's confirmation.
      const again = await api.faq(tuned.admin).saveSettings({
        enabled: true,
        threshold: 0.72,
        minMargin: 0,
        logQueries: true,
        rowVersion: flagged.rowVersion,
      });
      expect(again.body).toMatchObject({
        modelChanged: false,
        tunedForModel: 'google/gemini-embedding-2',
      });
    } finally {
      await ops(p)('patch', '/faq').send({ embeddingModel: 'openai/text-embedding-3-large' });
      await indexAll(p);
    }
  });

  it('re-indexing everything remakes every vector', async () => {
    const before = await api.count(
      `SELECT count(*) AS n FROM faq_variations WHERE embed_state = 'ready'`,
    );
    const res = await ops(p)('post', '/faq/reindex').send({ scope: 'all' });
    expect(res.status).toBe(200);
    expect(res.body.queued).toBe(await api.count(`SELECT count(*) AS n FROM faq_variations`));
    await indexAll(p, 40);
    expect(
      await api.count(`SELECT count(*) AS n FROM faq_variations WHERE embed_state = 'ready'`),
    ).toBeGreaterThanOrEqual(before);
    expect((await ops(p)('post', '/faq/reindex').send({ scope: 'bogus' })).status).toBe(422);
  });
});

// =====================================================================================================================
describe('tenant isolation', () => {
  let a: Tenant;
  let b: Tenant;
  let mine: EntryJson;
  beforeAll(async () => {
    await setPlatformKey(p, true);
    a = await api.signup('faqiso-a');
    b = await api.signup('faqiso-b');
    mine = await api.entry(a.admin, 'Only workspace A knows this', {
      variations: ['zxqv wombat'],
    });
    await api.entry(b.admin, 'Only workspace B knows this', { variations: ['blorp quokka'] });
    await indexAll(p);
  });

  it('another workspace cannot read, change, delete, extend, or generate for my FAQ', async () => {
    const f = api.faq(b.admin);
    expect((await f.get(mine.id)).status).toBe(404);
    expect(
      (
        await f.update(mine.id, {
          question: 'hijack',
          answerType: 'text',
          answerText: 'x',
          status: 'active',
          rowVersion: 1,
        })
      ).status,
    ).toBe(404);
    expect((await f.remove(mine.id)).status).toBe(404);
    expect((await f.addVariations(mine.id, { texts: ['sneaky'] })).status).toBe(404);
    expect((await f.generate(mine.id)).status).toBe(404);
    const cur = ((await api.faq(a.admin).get(mine.id)).body as EntryJson).variations![1]!;
    expect((await f.updateVariation(mine.id, cur.id, { text: 'x', rowVersion: 1 })).status).toBe(
      404,
    );
    expect((await f.removeVariation(mine.id, cur.id)).status).toBe(404);
    expect((await f.bulk({ action: 'delete', ids: [mine.id] })).body).toEqual({ affected: 0 });
    expect((await api.faq(a.admin).get(mine.id)).status).toBe(200);
  });

  it('lists, searches, tests and logs only my own', async () => {
    const list = (await api.faq(b.admin).list('?search=zxqv')).body;
    expect(list.data).toHaveLength(0);
    expect((await api.faq(b.admin).list()).body.data.map((x: EntryJson) => x.question)).toEqual([
      'Only workspace B knows this',
    ]);
    const d = await decision(b, 'zxqv wombat');
    expect(d.outcome).toBe('below_threshold');
    expect(d.candidates.map((c) => c.question)).not.toContain('Only workspace A knows this');
    expect((await decision(a, 'zxqv wombat')).outcome).toBe('answered');
  });

  it('cannot learn from, dismiss, or file under another workspace’s log or FAQ', async () => {
    const s = (await api.faq(a.admin).settings()).body;
    await api.faq(a.admin).saveSettings({
      enabled: true,
      threshold: 0.45,
      minMargin: 0,
      logQueries: true,
      rowVersion: s.rowVersion ?? undefined,
    });
    const ch = await simChannel(p, a);
    await simInbound(p, a, ch, { from: nextPeer(), name: 'X', text: 'a question nobody answers' });
    const row = await until(
      'a log row',
      async () =>
        (
          (await api.faq(a.admin).log('?view=unanswered')).body.data as Array<
            Record<string, unknown>
          >
        )[0],
    );
    const mineB = ((await api.faq(b.admin).list()).body.data as EntryJson[])[0]!;
    expect((await api.faq(b.admin).learn(row.id as string, { faqId: mineB.id })).status).toBe(404);
    expect((await api.faq(b.admin).dismiss(row.id as string)).status).toBe(404);
    expect((await api.faq(a.admin).learn(row.id as string, { faqId: mineB.id })).status).toBe(404);
    expect((await api.faq(b.admin).log()).body.data).toHaveLength(0);
    expect((await api.faq(b.admin).log(`?faqId=${mine.id}`)).body.data).toHaveLength(0);
  });

  it('row-level security hides every FAQ table from another tenant and from a session with no tenant', async () => {
    const tables = ['faq_settings', 'faqs', 'faq_variations', 'faq_match_logs'];
    const asTenant = async (orgId: number | null, table: string): Promise<number> => {
      await p.h.owner.query('BEGIN');
      try {
        await p.h.owner.query('SET LOCAL ROLE crm_app_user');
        if (orgId !== null)
          await p.h.owner.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgId)]);
        const r = await p.h.owner.query(`SELECT count(*) AS n FROM ${table}`);
        return Number(r.rows[0].n);
      } finally {
        await p.h.owner.query('ROLLBACK');
      }
    };
    for (const table of tables) {
      const total = Number((await p.h.owner.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
      const seenByA = await asTenant(a.orgId, table);
      const seenByB = await asTenant(b.orgId, table);
      const seenByNone = await asTenant(null, table);
      expect(seenByNone, `${table} with no tenant`).toBe(0);
      expect(seenByA + seenByB, `${table} partitions`).toBeLessThanOrEqual(total);
      expect(seenByA, `${table} tenant A`).toBe(
        Number(
          (await p.h.owner.query(`SELECT count(*) AS n FROM ${table} WHERE org_id = $1`, [a.orgId]))
            .rows[0].n,
        ),
      );
    }
    // A write for another tenant is refused by the policy, not silently dropped.
    await p.h.owner.query('BEGIN');
    try {
      await p.h.owner.query('SET LOCAL ROLE crm_app_user');
      await p.h.owner.query(`SELECT set_config('app.org_id', $1, true)`, [String(b.orgId)]);
      await expect(
        p.h.owner.query(
          `INSERT INTO faqs (org_id, question, answer_type, answer_text) VALUES ($1, 'smuggled', 'text', 'x')`,
          [a.orgId],
        ),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await p.h.owner.query('ROLLBACK');
    }
  });

  it('a composite foreign key keeps a variation from pointing at another workspace’s FAQ', async () => {
    const other = (
      await p.h.owner.query(`SELECT id FROM faqs WHERE org_id = $1 LIMIT 1`, [b.orgId])
    ).rows[0].id;
    await expect(
      p.h.owner.query(
        `INSERT INTO faq_variations (org_id, faq_id, text) VALUES ($1, $2, 'cross tenant')`,
        [a.orgId, other],
      ),
    ).rejects.toThrow(/foreign key/);
  });
});

// =====================================================================================================================
// FAQs belong to a flow (ADR-0021, addendum 2): every FAQ, setting and log row lives in one flow and answers only inside it.

const settingsOf = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  threshold: 0.45,
  minMargin: 0,
  logQueries: true,
  ...over,
});

/** Saves a flow's settings, sending the row version only when the flow already has a row. */
async function setFlow(t: Tenant, flowUuid: string, over: Record<string, unknown> = {}) {
  const f = api.faq(t.admin, flowUuid);
  const cur = (await f.settings()).body;
  const res = await f.saveSettings(
    settingsOf({ ...(cur.rowVersion ? { rowVersion: cur.rowVersion } : {}), ...over }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

const logRows = async (t: Tenant, flowUuid: string, view = 'all') =>
  (await api.faq(t.admin, flowUuid).log(`?view=${view}`)).body.data as Array<
    Record<string, unknown>
  >;

describe('FAQs belong to a flow: settings, limits and who may see what', () => {
  let t: Tenant;
  let A: { id: number; uuid: string };
  let B: { id: number; uuid: string };
  let ch: SimChannel;
  const say = (peer: string, text: string) =>
    simInbound(p, t, ch, { from: peer, name: 'Asha', text });

  beforeAll(async () => {
    await setPlatformKey(p, true);
    t = await api.signup('faqflows');
    ch = await simChannel(p, t);
    A = api.flowOf(t);
    B = await api.flow(t, 'Flow B');
    await api.entry(
      t.admin,
      ORDER,
      { answerText: 'A: order', variations: ['Track my order'] },
      A.uuid,
    );
    await api.entry(
      t.admin,
      REFUND,
      { answerText: 'B: refund', variations: ['Refund policy'] },
      B.uuid,
    );
    await indexAll(p);
  });

  it('the switch, the numbers and the versions of each flow are independent', async () => {
    const fa = api.faq(t.admin, A.uuid);
    const fb = api.faq(t.admin, B.uuid);
    for (const f of [fa, fb]) {
      expect((await f.settings()).body).toMatchObject({
        enabled: true,
        isDefault: true,
        rowVersion: null,
        threshold: 0.5,
      });
    }

    // A saves first: B is untouched, and B's first save needs no version although A's row exists.
    expect((await fa.saveSettings(settingsOf({ threshold: 0.45 }))).body).toMatchObject({
      enabled: true,
      isDefault: false,
      rowVersion: 1,
    });
    expect((await fb.settings()).body).toMatchObject({
      enabled: true,
      isDefault: true,
      rowVersion: null,
    });
    expect((await fb.saveSettings(settingsOf({ enabled: false, rowVersion: 1 }))).status).toBe(409);
    const bFirst = await fb.saveSettings(settingsOf({ enabled: false, threshold: 0.6 }));
    expect(bFirst.status, JSON.stringify(bFirst.body)).toBe(200);
    expect(bFirst.body).toMatchObject({ enabled: false, threshold: 0.6, rowVersion: 1 });
    // A second save of A moves A's version only.
    expect(
      (await fa.saveSettings(settingsOf({ threshold: 0.5, rowVersion: 1 }))).body,
    ).toMatchObject({
      rowVersion: 2,
      threshold: 0.5,
    });
    expect((await fa.saveSettings(settingsOf({ rowVersion: 1 }))).status).toBe(409);
    expect((await fb.settings()).body).toMatchObject({
      rowVersion: 1,
      threshold: 0.6,
      enabled: false,
    });
    expect((await fa.settings()).body).toMatchObject({
      rowVersion: 2,
      threshold: 0.5,
      enabled: true,
    });
    expect(
      await api.count(`SELECT count(*) AS n FROM faq_settings WHERE org_id = $1`, [t.orgId]),
    ).toBe(2);

    // A answers, B (switched off) stays silent on its own exact phrase.
    const peer = nextPeer();
    await say(peer, 'Track my order');
    expect(await untilSent(p, t, ch, peer, 1)).toEqual(['A: order']);
    const silent = nextPeer();
    await say(silent, 'Refund policy');
    await new Promise((r) => setTimeout(r, 1500));
    expect(await sentTo(p, t, ch, silent)).toEqual([]);

    // Switching B on is enough: it answers from then on.
    await setFlow(t, B.uuid, { enabled: true, threshold: 0.45 });
    const on = nextPeer();
    await say(on, 'Refund policy');
    expect(await untilSent(p, t, ch, on, 1)).toEqual(['B: refund']);

    // Each flow's log holds only its own decisions.
    const a = await until('A log', async () => {
      const r = await logRows(t, A.uuid, 'answered');
      return r.length >= 1 ? r : undefined;
    });
    expect(a.map((x) => x.faqQuestion)).toEqual([ORDER]);
    const b = await until('B log', async () => {
      const r = await logRows(t, B.uuid, 'answered');
      return r.length >= 1 ? r : undefined;
    });
    expect(b.map((x) => x.faqQuestion)).toEqual([REFUND]);
    // A also saw B's phrase while B was off: the only candidate then, so its miss is A's row (the nearest candidate speaks).
    expect((await api.faq(t.admin, A.uuid).summary()).body.totals).toMatchObject({
      messages: 2,
      answered: 1,
      unanswered: 1,
    });
    expect((await api.faq(t.admin, B.uuid).summary()).body.totals.messages).toBe(1);
  });

  it('the same question is allowed in two flows, a duplicate inside one flow is refused, and an FAQ is only reachable through its own flow', async () => {
    const mine = await api.entry(t.admin, 'Shared question', { answerText: 'in A' }, A.uuid);
    const twin = await api.entry(t.admin, 'Shared question', { answerText: 'in B' }, B.uuid);
    expect(twin.id).not.toBe(mine.id);
    const dup = await api
      .faq(t.admin, A.uuid)
      .create({ question: ' shared   QUESTION ', answerType: 'text', answerText: 'x' });
    expect(dup.status).toBe(409);
    expect(code(dup)).toBe('FAQ_DUPLICATE_QUESTION');
    // Renaming into a question the other flow has is fine; into one of the same flow is not.
    const other = await api.entry(t.admin, 'Another one', {}, A.uuid);
    const clash = await api.faq(t.admin, A.uuid).update(other.id, {
      question: 'Shared question',
      answerType: 'text',
      answerText: 'x',
      status: 'active',
      rowVersion: other.rowVersion,
    });
    expect(code(clash)).toBe('FAQ_DUPLICATE_QUESTION');

    // The FAQ of A through B's routes: not found everywhere, and nothing changes.
    const fb = api.faq(t.admin, B.uuid);
    expect((await fb.get(other.id)).status).toBe(404);
    expect(
      (
        await fb.update(other.id, {
          question: 'Hijacked',
          answerType: 'text',
          answerText: 'x',
          status: 'active',
          rowVersion: other.rowVersion,
        })
      ).status,
    ).toBe(404);
    expect((await fb.addVariations(other.id, { texts: ['sneaky'] })).status).toBe(404);
    expect((await fb.generate(other.id)).status).toBe(404);
    expect((await fb.remove(other.id)).status).toBe(404);
    expect((await fb.bulk({ action: 'delete', ids: [other.id] })).body).toEqual({ affected: 0 });
    const still = (await api.faq(t.admin, A.uuid).get(other.id)).body as EntryJson;
    expect(still.question).toBe('Another one');
    // Lists, counts and the playground see their own flow only.
    const listA = (await api.faq(t.admin, A.uuid).list('?limit=50')).body;
    const listB = (await fb.list('?limit=50')).body;
    expect((listA.data as EntryJson[]).map((e) => e.question)).not.toContain(REFUND);
    expect((listB.data as EntryJson[]).map((e) => e.question)).not.toContain(ORDER);
    expect(listA.stats.total).toBe(listA.data.length);
    expect(listB.stats.total).toBe(listB.data.length);
    const probe = await fb.test('Track my order');
    expect((probe.body as DecisionJson).candidates.map((c) => c.question)).not.toContain(ORDER);
  });

  it('limits and usage count one flow at a time', async () => {
    const lt = await api.signup('faqperflowlimit');
    const x = api.flowOf(lt);
    const y = await api.flow(lt, 'Second');
    expect(
      (await ops(p)('patch', '/faq').send({ maxFaqs: 2, maxVariationsPerFaq: 3 })).status,
    ).toBe(200);
    try {
      await api.entry(lt.admin, 'Cap one', { variations: ['v1', 'v2'] }, x.uuid);
      await api.entry(lt.admin, 'Cap two', {}, x.uuid);
      const over = await api
        .faq(lt.admin, x.uuid)
        .create({ question: 'Cap three', answerType: 'text', answerText: 'x' });
      expect(over.status).toBe(422);
      expect(code(over)).toBe('FAQ_LIMIT_REACHED');
      // The other flow still has all its room, and the same cap applies to it on its own.
      await api.entry(lt.admin, 'Cap one', { variations: ['w1', 'w2'] }, y.uuid);
      await api.entry(lt.admin, 'Cap two', {}, y.uuid);
      const overY = await api
        .faq(lt.admin, y.uuid)
        .create({ question: 'Cap three', answerType: 'text', answerText: 'x' });
      expect(code(overY)).toBe('FAQ_LIMIT_REACHED');
      const tooMany = await api.faq(lt.admin, y.uuid).create({
        question: 'Fits nowhere',
        answerType: 'text',
        answerText: 'x',
        variations: ['a', 'b', 'c'],
      });
      expect(code(tooMany)).toBe('FAQ_LIMIT_REACHED');
      const sx = (await api.faq(lt.admin, x.uuid).settings()).body;
      expect(sx.limits).toEqual({ maxFaqs: 2, maxVariationsPerFaq: 3 });
      expect(sx.usage).toEqual({ faqs: 2, variations: 4 });
      // A flow with nothing in it has no usage, whatever the workspace holds.
      const z = await api.flow(lt, 'Empty');
      expect((await api.faq(lt.admin, z.uuid).settings()).body.usage).toEqual({
        faqs: 0,
        variations: 0,
      });
      expect((await api.entry(lt.admin, 'Fits in empty', {}, z.uuid)).id).toMatch(uuidRe);
    } finally {
      await ops(p)('patch', '/faq').send({ maxFaqs: 500, maxVariationsPerFaq: 60 });
    }
  });

  it("another workspace's flow id is 404 on every route", async () => {
    const o = await api.signup('faqforeignflow');
    const foreign = api.flowOf(o).uuid;
    const mine = await api.entry(t.admin, 'Foreign probe', {}, A.uuid);
    const id = mine.id;
    const f = api.faq(t.admin, foreign);
    const body = { question: 'x', answerType: 'text', answerText: 'y' };
    const checks: Array<[string, { status: number }]> = [
      ['list', await f.list()],
      ['create', await f.create(body)],
      ['bulk', await f.bulk({ action: 'pause', ids: [id] })],
      ['get', await f.get(id)],
      ['update', await f.update(id, { ...body, status: 'active', rowVersion: 1 })],
      ['remove', await f.remove(id)],
      ['addVariations', await f.addVariations(id, { texts: ['x'] })],
      ['updateVariation', await f.updateVariation(id, id, { text: 'x', rowVersion: 1 })],
      ['removeVariation', await f.removeVariation(id, id)],
      ['generate', await f.generate(id)],
      ['test', await f.test('anything')],
      ['settings', await f.settings()],
      ['saveSettings', await f.saveSettings(settingsOf())],
      ['summary', await f.summary()],
      ['log', await f.log()],
      ['learn', await f.learn(id, { faqId: id })],
      ['dismiss', await f.dismiss(id)],
    ];
    for (const [name, res] of checks) expect(res.status, name).toBe(404);
    // The reverse direction too, and a flow that does not exist at all.
    expect((await api.faq(o.admin, A.uuid).list()).status).toBe(404);
    expect((await api.faq(t.admin, '00000000-0000-4000-8000-00000000abcd').settings()).status).toBe(
      404,
    );
    expect((await api.faq(t.admin, 'not-a-uuid').list()).status).toBe(400);
    // Nothing was written on either side.
    expect(
      await api.count(`SELECT count(*) AS n FROM faq_settings WHERE org_id = $1`, [o.orgId]),
    ).toBe(0);
    expect(await api.count(`SELECT count(*) AS n FROM faqs WHERE org_id = $1`, [o.orgId])).toBe(0);
  });

  it('the old workspace-level routes are gone, and the step picker lists any flow of the workspace', async () => {
    const as = api.as(t.admin);
    const id = '00000000-0000-4000-8000-000000000000';
    for (const [verb, path] of [
      ['get', '/v2/faq/entries'],
      ['post', '/v2/faq/entries'],
      ['post', '/v2/faq/entries/bulk'],
      ['get', `/v2/faq/entries/${id}`],
      ['patch', `/v2/faq/entries/${id}`],
      ['delete', `/v2/faq/entries/${id}`],
      ['post', `/v2/faq/entries/${id}/variations`],
      ['post', '/v2/faq/test'],
      ['get', '/v2/faq/settings'],
      ['put', '/v2/faq/settings'],
      ['get', '/v2/faq/insights/summary'],
      ['get', '/v2/faq/insights/log'],
      ['post', `/v2/faq/insights/log/${id}/learn`],
      ['get', `/v2/faq/flows/${A.uuid}/nodes`],
    ] as const) {
      expect((await as[verb](path).send({})).status, `${verb} ${path}`).toBe(404);
    }
    // The steps of a flow other than the one asking: the picker is about the answer target.
    const nodes = await api.faq(t.admin, A.uuid).flowNodes(B.uuid);
    expect(nodes.status).toBe(200);
    expect((nodes.body.data as Array<{ id: string }>).map((n) => n.id)).toEqual(['t', 'a', 'z']);
  });

  it('learn and dismiss work inside one flow: a log row of another flow, or an FAQ of another flow, is 404', async () => {
    const lt = await api.signup('faqlearnflow');
    const la = api.flowOf(lt);
    const lb = await api.flow(lt, 'Learn B');
    const lch = await simChannel(p, lt);
    const ea = await api.entry(lt.admin, ORDER, { answerText: 'A: order' }, la.uuid);
    const eb = await api.entry(lt.admin, REFUND, { answerText: 'B: refund' }, lb.uuid);
    await indexAll(p);
    await setFlow(lt, la.uuid);
    await setFlow(lt, lb.uuid);
    // Nearest to A's question, below the bar everywhere: the row is A's.
    await simInbound(p, lt, lch, { from: nextPeer(), name: 'X', text: 'order zzq xxw yyv kkj' });
    const row = await until(
      'an unanswered row in A',
      async () => (await logRows(lt, la.uuid, 'unanswered'))[0],
    );
    expect(await logRows(lt, lb.uuid)).toHaveLength(0);
    const fa = api.faq(lt.admin, la.uuid);
    const fb = api.faq(lt.admin, lb.uuid);
    expect((await fb.learn(row.id as string, { faqId: eb.id })).status).toBe(404);
    expect((await fb.dismiss(row.id as string)).status).toBe(404);
    expect((await fa.learn(row.id as string, { faqId: eb.id })).status).toBe(404);
    expect((await fa.learn(row.id as string, { faqId: ea.id })).body).toEqual({ added: true });
    expect(await logRows(lt, la.uuid, 'unanswered')).toHaveLength(0);
    // A resolve with a log id of another flow neither resolves it nor fails the save.
    await simInbound(p, lt, lch, { from: nextPeer(), name: 'X', text: 'order qpw eoi rty uyt' });
    const row2 = await until(
      'a second unanswered row',
      async () => (await logRows(lt, la.uuid, 'unanswered'))[0],
    );
    const made = await fb.create({
      question: 'Fresh in B',
      answerType: 'text',
      answerText: 'x',
      resolveLogId: row2.id,
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(await logRows(lt, la.uuid, 'unanswered')).toHaveLength(1);
    expect((await fa.dismiss(row2.id as string)).status).toBe(204);
    expect(await logRows(lt, la.uuid, 'unanswered')).toHaveLength(0);
  });

  it('deleting a flow removes its FAQs, variations, settings and log; the other flows keep theirs', async () => {
    const dt = await api.signup('faqdeleteflow');
    const keep = api.flowOf(dt);
    const doomed = await api.flow(dt, 'Doomed');
    const dch = await simChannel(p, dt);
    await api.entry(dt.admin, 'Keep me', { variations: ['keep phrase'] }, keep.uuid);
    await api.entry(
      dt.admin,
      'Doomed one',
      { answerText: 'bye', variations: ['doomed phrase'] },
      doomed.uuid,
    );
    await indexAll(p);
    await setFlow(dt, doomed.uuid);
    await setFlow(dt, keep.uuid);
    const peer = nextPeer();
    await simInbound(p, dt, dch, { from: peer, name: 'X', text: 'doomed phrase' });
    expect(await untilSent(p, dt, dch, peer, 1)).toEqual(['bye']);
    await api.faq(dt.admin, doomed.uuid).test('doomed phrase');
    const count = (table: string, col: string, flowId: number) =>
      api.count(`SELECT count(*) AS n FROM ${table} WHERE org_id = $1 AND ${col} = $2`, [
        dt.orgId,
        flowId,
      ]);
    await until('the inbound decision is logged', async () =>
      (await count('faq_match_logs', 'flow_id', doomed.id)) >= 2 ? true : undefined,
    );
    expect(await count('faqs', 'owner_flow_id', doomed.id)).toBe(1);
    expect(await count('faq_settings', 'flow_id', doomed.id)).toBe(1);
    await p.h.owner.query(`DELETE FROM flows WHERE id = $1`, [doomed.id]);
    expect(await count('faqs', 'owner_flow_id', doomed.id)).toBe(0);
    expect(await count('faq_settings', 'flow_id', doomed.id)).toBe(0);
    expect(await count('faq_match_logs', 'flow_id', doomed.id)).toBe(0);
    expect(
      await api.count(
        `SELECT count(*) AS n FROM faq_variations v WHERE v.org_id = $1 AND NOT EXISTS (SELECT 1 FROM faqs f WHERE f.org_id = v.org_id AND f.id = v.faq_id)`,
        [dt.orgId],
      ),
    ).toBe(0);
    expect(await count('faqs', 'owner_flow_id', keep.id)).toBe(1);
    expect(await count('faq_settings', 'flow_id', keep.id)).toBe(1);
    expect((await api.faq(dt.admin, doomed.uuid).list()).status).toBe(404);
  });
});

describe('FAQs belong to a flow: which flows answer a message', () => {
  let t: Tenant;
  let ch: SimChannel;
  const say = (peer: string, text: string) =>
    simInbound(p, t, ch, { from: peer, name: 'Asha', text });

  beforeAll(async () => {
    await setPlatformKey(p, true);
    t = await api.signup('faqwhich');
    ch = await simChannel(p, t);
  });

  /** A flow with one FAQ (its answer names the flow), indexed, with answering switched on. */
  async function answering(
    name: string,
    question: string,
    over: Parameters<FaqApi['flow']>[2] = {},
    on = true,
  ) {
    const flow = await api.flow(t, name, over);
    await api.entry(t.admin, question, { answerText: `From ${name}` }, flow.uuid);
    await indexAll(p);
    if (on) await setFlow(t, flow.uuid);
    return flow;
  }

  const silentFor = async (peer: string, text: string, ms = 1500) => {
    await say(peer, text);
    await new Promise((r) => setTimeout(r, ms));
    expect(await sentTo(p, t, ch, peer), text).toEqual([]);
  };

  it("a flow's FAQs never answer on a channel the flow is not bound to", async () => {
    const other = await simChannel(p, t);
    const tied = await answering('Tied flow', 'Zeta policy', {
      triggerChannelId: other.internalId,
    });
    const waba = await answering('Cloud flow', 'Omega policy', { provider: 'waba' });
    // The simulator channel is not the tied flow's channel, and not the cloud flow's engine.
    await silentFor(nextPeer(), 'zeta policy');
    await silentFor(nextPeer(), 'omega policy');
    expect(await logRows(t, tied.uuid)).toHaveLength(0);
    expect(await logRows(t, waba.uuid)).toHaveLength(0);
    // On its own channel the tied flow answers, tagged with its flow.
    const peer = nextPeer();
    await simInbound(p, t, other, { from: peer, name: 'Asha', text: 'zeta policy' });
    expect(await untilSent(p, t, other, peer, 1)).toEqual(['From Tied flow']);
    const row = await until(
      'the tied flow log',
      async () => (await logRows(t, tied.uuid, 'answered'))[0],
    );
    expect(row).toMatchObject({ outcome: 'answered', tier: 'exact' });
    expect(await logRows(t, waba.uuid)).toHaveLength(0);
  });

  it('a flow that is not published, or not active, or has no active FAQ, does not answer', async () => {
    const draft = await answering('Draft flow', 'Draft policy', { published: false });
    const off = await answering('Inactive flow', 'Inactive policy', { active: false });
    const empty = await api.flow(t, 'No FAQ flow');
    await setFlow(t, empty.uuid);
    await silentFor(nextPeer(), 'draft policy');
    await silentFor(nextPeer(), 'inactive policy');
    expect(await logRows(t, draft.uuid)).toHaveLength(0);
    expect(await logRows(t, off.uuid)).toHaveLength(0);
    expect(await logRows(t, empty.uuid)).toHaveLength(0);
    // Publishing and activating them is all it takes.
    await p.h.owner.query(`UPDATE flows SET is_published = true WHERE id = $1`, [draft.id]);
    await p.h.owner.query(`UPDATE flows SET is_active = true WHERE id = $1`, [off.id]);
    for (const [text, name] of [
      ['draft policy', 'Draft flow'],
      ['inactive policy', 'Inactive flow'],
    ]) {
      const peer = nextPeer();
      await say(peer, text);
      expect(await untilSent(p, t, ch, peer, 1)).toEqual([`From ${name}`]);
    }
  });

  it('two flows on one channel: each answers its own FAQs, the best score wins, a tie goes to the lowest flow id', async () => {
    const first = await answering('Multi one', 'Shipping cost');
    const second = await answering('Multi two', 'Shipping rates');
    for (const [text, name, win] of [
      ['shipping cost', 'Multi one', first],
      ['shipping rates', 'Multi two', second],
    ] as const) {
      const peer = nextPeer();
      await say(peer, text);
      expect(await untilSent(p, t, ch, peer, 1)).toEqual([`From ${name}`]);
      const row = await until(`${name} log`, async () =>
        (await logRows(t, win.uuid, 'answered')).find((r) => r.query === text),
      );
      expect(row.score).toBe(1);
    }
    // One log row per message: the loser's flow has none for it.
    expect((await logRows(t, second.uuid)).filter((r) => r.query === 'shipping cost')).toHaveLength(
      0,
    );
    expect((await logRows(t, first.uuid)).filter((r) => r.query === 'shipping rates')).toHaveLength(
      0,
    );

    // The same exact phrase in both (a tie at 1): the lower flow id answers.
    await api.entry(t.admin, 'Opening hours', { answerText: 'Hours from one' }, first.uuid);
    await api.entry(t.admin, 'Opening hours', { answerText: 'Hours from two' }, second.uuid);
    await indexAll(p);
    const tie = nextPeer();
    await say(tie, 'opening hours');
    expect(await untilSent(p, t, ch, tie, 1)).toEqual(['Hours from one']);
    expect(first.id).toBeLessThan(second.id);
    const row = await until('the tie log', async () =>
      (await logRows(t, first.uuid, 'answered')).find((r) => r.query === 'opening hours'),
    );
    expect(row).toBeTruthy();
    expect((await logRows(t, second.uuid)).filter((r) => r.query === 'opening hours')).toHaveLength(
      0,
    );

    // A partial match: the flow whose FAQ is closer answers (both clear a low bar).
    await setFlow(t, first.uuid, { threshold: 0.2 });
    await setFlow(t, second.uuid, { threshold: 0.2 });
    const near = nextPeer();
    await say(near, 'shipping rates today');
    expect(await untilSent(p, t, ch, near, 1)).toEqual(['From Multi two']);
  });

  it("the customer's live run flow is tried first: it wins a tie", async () => {
    // A flow that parks the customer in a delay (a live, sleeping run) and also holds an FAQ that ties with another flow's.
    const graph = {
      flowNodes: [
        { id: 't', type: 'trigger', data: {}, isStart: true },
        { id: 'd', type: 'delay', data: { amount: 60, unit: 'min' } },
        { id: 'z', type: 'end', data: {} },
      ],
      flowEdges: [
        { source: 't', sourceHandle: 'out', target: 'd' },
        { source: 'd', sourceHandle: 'out', target: 'z' },
      ],
      vars: {},
    };
    const early = await answering('Early flow', 'Holiday schedule');
    const res = await p.h.owner.query(
      `INSERT INTO flows (org_id, flow_name, flow_data, trigger_kind, trigger_keywords, is_published, is_active, provider, flow_type)
       VALUES ($1, 'Parking flow', $2::jsonb, 'keyword', 'parkme', true, true, 'simulator', 'chat') RETURNING id, uuid`,
      [t.orgId, JSON.stringify(graph)],
    );
    const parking = { id: Number(res.rows[0].id), uuid: String(res.rows[0].uuid) };
    await api.entry(t.admin, 'Holiday schedule', { answerText: 'From Parking flow' }, parking.uuid);
    await indexAll(p);
    await setFlow(t, parking.uuid);
    expect(early.id).toBeLessThan(parking.id);

    const plain = nextPeer();
    await say(plain, 'holiday schedule');
    expect(await untilSent(p, t, ch, plain, 1)).toEqual(['From Early flow']);

    const peer = nextPeer();
    await say(peer, 'parkme');
    await until('a sleeping run', async () => {
      const r = await p.h.owner.query(
        `SELECT 1 FROM flow_runs WHERE org_id = $1 AND flow_id = $2 AND status = 'sleeping'`,
        [t.orgId, parking.id],
      );
      return r.rows.length > 0 ? true : undefined;
    });
    await say(peer, 'holiday schedule');
    expect(await untilSent(p, t, ch, peer, 1)).toEqual(['From Parking flow']);
    const row = await until('the parking flow log', async () =>
      (await logRows(t, parking.uuid, 'answered')).find((r) => r.query === 'holiday schedule'),
    );
    expect(row).toBeTruthy();
    expect(
      (await logRows(t, early.uuid)).filter((r) => r.query === 'holiday schedule'),
    ).toHaveLength(1);
  });

  it('when no flow answers, the nearest flow gets the one log row, with the real outcome', async () => {
    const near = await answering('Near flow', 'Warranty period details');
    const far = await answering('Far flow', 'Gift wrapping options');
    const peer = nextPeer();
    await say(peer, 'warranty zzq xxw yyv kkj');
    const row = await until('the unanswered row', async () =>
      (await logRows(t, near.uuid, 'unanswered')).find(
        (r) => r.query === 'warranty zzq xxw yyv kkj',
      ),
    );
    expect(row.outcome).toBe('below_threshold');
    expect(
      (await logRows(t, far.uuid)).filter((r) => r.query === 'warranty zzq xxw yyv kkj'),
    ).toHaveLength(0);
    expect(await sentTo(p, t, ch, peer)).toEqual([]);
    // A workspace where nothing is a candidate writes nothing at all.
    const nobody = await api.signup('faqnobody');
    const nch = await simChannel(p, nobody);
    await simInbound(p, nobody, nch, { from: nextPeer(), name: 'X', text: 'anyone there' });
    await new Promise((r) => setTimeout(r, 1500));
    expect(
      await api.count(`SELECT count(*) AS n FROM faq_match_logs WHERE org_id = $1`, [nobody.orgId]),
    ).toBe(0);
  });
});

describe('FAQs belong to a flow: the platform sees the whole workspace', () => {
  it('stats and the workspaces table add up across flows; a workspace is enabled when any flow is', async () => {
    await setPlatformKey(p, true);
    const t = await api.signup('faqplatflows');
    const a = api.flowOf(t);
    const b = await api.flow(t, 'Second flow');
    await api.entry(t.admin, 'One', { variations: ['uno'] }, a.uuid);
    await api.entry(t.admin, 'Two', { variations: ['dos', 'tres'] }, b.uuid);
    const name = (await p.h.owner.query(`SELECT name FROM organizations WHERE id = $1`, [t.orgId]))
      .rows[0].name as string;
    const mine = async () =>
      (
        (await ops(p)('get', `/faq/workspaces?search=${encodeURIComponent(name)}`)).body
          .data as Array<Record<string, unknown>>
      ).find((w) => w.name === name)!;
    const enabledCount = async () =>
      (await ops(p)('get', '/faq')).body.stats.workspacesEnabled as number;

    const before = await enabledCount();
    expect(await mine()).toMatchObject({ enabled: false, faqs: 2, variations: 5 });
    await setFlow(t, a.uuid);
    expect(await mine()).toMatchObject({ enabled: true, faqs: 2, variations: 5 });
    expect(await enabledCount()).toBe(before + 1);
    // A second flow switched on is still one workspace.
    await setFlow(t, b.uuid);
    expect(await enabledCount()).toBe(before + 1);
    // Off in one flow, still enabled; off in both, not.
    await setFlow(t, a.uuid, { enabled: false });
    expect((await mine()).enabled).toBe(true);
    await setFlow(t, b.uuid, { enabled: false });
    expect((await mine()).enabled).toBe(false);
    expect(await enabledCount()).toBe(before);
    const overview = (await ops(p)('get', '/faq')).body.stats;
    expect(overview.faqs).toBeGreaterThanOrEqual(2);
  });

  it('answered and total matches of the last 30 days sum the logs of every flow', async () => {
    const t = await api.signup('faqplatlogs');
    const ch = await simChannel(p, t);
    const a = api.flowOf(t);
    const b = await api.flow(t, 'Other');
    await api.entry(t.admin, 'Alpha question', { answerText: 'alpha' }, a.uuid);
    await api.entry(t.admin, 'Beta question', { answerText: 'beta' }, b.uuid);
    await indexAll(p);
    await setFlow(t, a.uuid);
    await setFlow(t, b.uuid);
    for (const text of ['alpha question', 'beta question']) {
      const peer = nextPeer();
      await simInbound(p, t, ch, { from: peer, name: 'X', text });
      await untilSent(p, t, ch, peer, 1);
    }
    const name = (await p.h.owner.query(`SELECT name FROM organizations WHERE id = $1`, [t.orgId]))
      .rows[0].name as string;
    const row = await until('both logged', async () => {
      const w = (
        (await ops(p)('get', `/faq/workspaces?search=${encodeURIComponent(name)}`)).body
          .data as Array<Record<string, unknown>>
      ).find((x) => x.name === name)!;
      return w.matches30d === 2 ? w : undefined;
    });
    expect(row).toMatchObject({ matches30d: 2, answered30d: 2, faqs: 2 });
  });
});
