import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FaqApi,
  code,
  indexAll,
  nextPeer,
  ops,
  sentTo,
  setPlatformKey,
  simChannel,
  simInbound,
  startPipeline,
  until,
  untilSent,
  type DecisionJson,
  type EntryJson,
  type Pipeline,
  type SimChannel,
  type Tenant,
} from './support';

/**
 * The three FAQ additions end to end (ADR-0021 addendum): "link to node" (an FAQ starts its flow at a chosen step), the borderline
 * check (a small model can veto an answer that only just cleared the threshold, and never breaks answering), and the Flow
 * "Answer from FAQ" node. Same pipeline as faq.e2e.spec.ts: real Postgres with pgvector, Redis, the inbox, the flow runtime and the FAQ
 * worker; the AI vendor is the offline fixture, so a score is a function of the words and a judge verdict is set by a marker.
 */
let p: Pipeline;
let api: FaqApi;

beforeAll(async () => {
  p = await startPipeline();
  api = new FaqApi(p.h);
  await setPlatformKey(p, true);
}, 300_000);
afterAll(async () => {
  await p?.stop();
});

interface GraphNode {
  id: string;
  type: string;
  data?: Record<string, unknown>;
}
interface GraphEdge {
  source: string;
  handle: string;
  target: string;
}

/** A published, active keyword flow with exactly this graph; the first node is the trigger. */
async function addGraphFlow(
  t: Tenant,
  name: string,
  keywords: string | null,
  nodes: GraphNode[],
  edges: GraphEdge[],
): Promise<{ id: number; uuid: string }> {
  const graph = {
    flowNodes: nodes.map((n, i) => ({
      id: n.id,
      type: n.type,
      data: n.data ?? {},
      ...(i === 0 ? { isStart: true } : {}),
    })),
    flowEdges: edges.map((e) => ({ source: e.source, sourceHandle: e.handle, target: e.target })),
    vars: {},
  };
  const res = await p.h.owner.query(
    `INSERT INTO flows (org_id, flow_name, flow_data, trigger_kind, trigger_keywords, is_published, is_active, provider, flow_type)
     VALUES ($1, $2, $3::jsonb, $4, $5, true, true, 'simulator', 'chat') RETURNING id, uuid`,
    [t.orgId, name, JSON.stringify(graph), keywords ? 'keyword' : 'manual_enroll', keywords],
  );
  return { id: Number(res.rows[0].id), uuid: String(res.rows[0].uuid) };
}

/** Trigger, two messages and an End: `a` says "Intro step", `b` says "Second step". */
const twoSteps = (t: Tenant, name: string, keywords: string | null) =>
  addGraphFlow(
    t,
    name,
    keywords,
    [
      { id: 't', type: 'trigger' },
      { id: 'a', type: 'message', data: { text: 'Intro step' } },
      { id: 'b', type: 'message', data: { label: 'Second', text: 'Second step' } },
      { id: 'z', type: 'end' },
    ],
    [
      { source: 't', handle: 'out', target: 'a' },
      { source: 'a', handle: 'out', target: 'b' },
      { source: 'b', handle: 'out', target: 'z' },
    ],
  );

const decision = async (t: Tenant, q: string): Promise<DecisionJson> => {
  const res = await api.faq(t.admin).test(q);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as DecisionJson;
};

const settingsBody = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  threshold: 0.45,
  minMargin: 0,
  logQueries: true,
  ...over,
});

async function saveSettings(t: Tenant, over: Record<string, unknown>) {
  const f = api.faq(t.admin);
  const cur = (await f.settings()).body;
  const res = await f.saveSettings(
    settingsBody({ ...(cur.rowVersion ? { rowVersion: cur.rowVersion } : {}), ...over }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

// =====================================================================================================================
describe('link to node: an FAQ starts its flow at a chosen step', () => {
  let t: Tenant;
  let ch: SimChannel;
  const say = (peer: string, text: string) =>
    simInbound(p, t, ch, { from: peer, name: 'Asha', text });

  beforeAll(async () => {
    t = await api.signup('faqnode');
    ch = await simChannel(p, t);
    await saveSettings(t, {});
  });

  it('lists the steps of a flow of this workspace, and refuses a flow that is not', async () => {
    const flow = await twoSteps(t, 'Steps flow', null);
    const res = await api.as(t.admin).get(`/v2/faq/flows/${flow.uuid}/nodes`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual([
      { id: 't', type: 'trigger', label: '' },
      { id: 'a', type: 'message', label: '' },
      { id: 'b', type: 'message', label: 'Second' },
      { id: 'z', type: 'end', label: '' },
    ]);
    const other = await api.signup('faqnodeother');
    const foreign = await twoSteps(other, 'Foreign flow', null);
    const refused = await api.as(t.admin).get(`/v2/faq/flows/${foreign.uuid}/nodes`);
    expect(refused.status).toBe(422);
    expect(code(refused)).toBe('FAQ_FLOW_NOT_FOUND');
    expect((await api.as(t.admin).get('/v2/faq/flows/not-a-uuid/nodes')).status).toBe(400);
    const nobody = await api.member(t, 'nofaq', [['record.contacts.read']]);
    expect((await api.as(nobody.token).get(`/v2/faq/flows/${flow.uuid}/nodes`)).status).toBe(403);
  });

  it('saves the node with the flow answer, shows its name, and clears it when the answer becomes a text', async () => {
    const flow = await twoSteps(t, 'Save flow', null);
    const f = api.faq(t.admin);
    const created = await f.create({
      question: 'Speak to sales',
      answerType: 'flow',
      flowId: flow.uuid,
      flowNodeId: 'b',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ flowNodeId: 'b', flowNodeLabel: 'Second' });
    const listed = ((await f.list('?limit=50')).body.data as EntryJson[]).find(
      (e) => e.id === created.body.id,
    )!;
    expect(listed).toMatchObject({ flowNodeId: 'b', flowNodeLabel: 'Second' });

    const text = await f.update(created.body.id, {
      question: 'Speak to sales',
      answerType: 'text',
      answerText: 'Call us.',
      status: 'active',
      flowNodeId: 'b',
      rowVersion: created.body.rowVersion,
    });
    expect(text.status, JSON.stringify(text.body)).toBe(200);
    expect(text.body).toMatchObject({
      answerType: 'text',
      flowId: null,
      flowNodeId: null,
      flowNodeLabel: null,
    });
    const stored = await p.h.owner.query(
      `SELECT flow_node_id FROM faqs WHERE org_id = $1 AND uuid = $2`,
      [t.orgId, created.body.id],
    );
    expect(stored.rows[0].flow_node_id).toBeNull();
  });

  it('refuses a step that is not in the flow, and a blank one means "start at the flow\'s start"', async () => {
    const flow = await twoSteps(t, 'Refuse flow', null);
    const f = api.faq(t.admin);
    const bad = await f.create({
      question: 'Bad node',
      answerType: 'flow',
      flowId: flow.uuid,
      flowNodeId: 'nope',
    });
    expect(bad.status).toBe(422);
    expect(code(bad)).toBe('FAQ_FLOW_NODE_NOT_FOUND');
    expect(JSON.stringify(bad.body)).toContain('flowNodeId');
    const blank = await f.create({
      question: 'Blank node',
      answerType: 'flow',
      flowId: flow.uuid,
      flowNodeId: '   ',
    });
    expect(blank.status, JSON.stringify(blank.body)).toBe(201);
    expect(blank.body.flowNodeId).toBeNull();
    const tooLong = await f.create({
      question: 'Long node',
      answerType: 'flow',
      flowId: flow.uuid,
      flowNodeId: 'x'.repeat(121),
    });
    expect(tooLong.status).toBe(422);
  });

  it("the customer lands on the chosen step, not on the flow's start", async () => {
    const flow = await twoSteps(t, 'Landing flow', 'zzneverlanding');
    await api.faq(t.admin).create({
      question: 'Pricing please',
      answerType: 'flow',
      flowId: flow.uuid,
      flowNodeId: 'b',
      variations: ['how much does it cost'],
    });
    await indexAll(p);
    const peer = nextPeer();
    await say(peer, 'how much does it cost');
    expect(await untilSent(p, t, ch, peer, 1)).toEqual(['Second step']);
    await new Promise((r) => setTimeout(r, 800));
    expect(await sentTo(p, t, ch, peer)).toEqual(['Second step']);
    const run = await p.h.owner.query(
      `SELECT source, current_node_id FROM flow_runs WHERE org_id = $1 AND flow_id = $2`,
      [t.orgId, flow.id],
    );
    expect(run.rows).toHaveLength(1);
    expect(run.rows[0].source).toBe('keyword');
  });

  it('without a chosen step the flow starts from its start, as before', async () => {
    const flow = await twoSteps(t, 'Plain flow', 'zzneverplain');
    await api.faq(t.admin).create({
      question: 'Show me the tour',
      answerType: 'flow',
      flowId: flow.uuid,
      variations: ['give me the tour'],
    });
    await indexAll(p);
    const peer = nextPeer();
    await say(peer, 'give me the tour');
    expect(await untilSent(p, t, ch, peer, 2)).toEqual(['Intro step', 'Second step']);
  });

  it('a step deleted from the flow after the FAQ was saved is logged as not sent, says why, and the editor shows the node as missing', async () => {
    const flow = await twoSteps(t, 'Drift flow', 'zzneverdrift');
    const e = (
      await api.faq(t.admin).create({
        question: 'Drifting question',
        answerType: 'flow',
        flowId: flow.uuid,
        flowNodeId: 'b',
        variations: ['drifting phrase'],
      })
    ).body as EntryJson;
    await indexAll(p);
    const edited = {
      flowNodes: [
        { id: 't', type: 'trigger', data: {}, isStart: true },
        { id: 'a', type: 'message', data: { text: 'Intro step' } },
      ],
      flowEdges: [{ source: 't', sourceHandle: 'out', target: 'a' }],
      vars: {},
    };
    await p.h.owner.query(`UPDATE flows SET flow_data = $2::jsonb WHERE id = $1`, [
      flow.id,
      JSON.stringify(edited),
    ]);
    const peer = nextPeer();
    await say(peer, 'drifting phrase');
    const row = await until('not_sent log', async () => {
      const r = (await api.faq(t.admin).log('?view=errors')).body.data as Array<
        Record<string, unknown>
      >;
      return r.find((x) => x.query === 'drifting phrase');
    });
    expect(row).toMatchObject({ outcome: 'not_sent' });
    expect(String(row.error)).toContain('no longer in the flow');
    expect(await sentTo(p, t, ch, peer)).toEqual([]);
    const got = (await api.faq(t.admin).get(e.id)).body as EntryJson;
    expect(got).toMatchObject({ flowNodeId: 'b', flowNodeLabel: null, flowName: 'Drift flow' });
  });

  it("is isolated per workspace: another workspace cannot point an FAQ at this flow's steps", async () => {
    const flow = await twoSteps(t, 'Mine flow', null);
    const other = await api.signup('faqnodeiso');
    const res = await api
      .faq(other.admin)
      .create({ question: 'Steal', answerType: 'flow', flowId: flow.uuid, flowNodeId: 'b' });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('FAQ_FLOW_NOT_FOUND');
  });
});

// =====================================================================================================================
describe('the borderline check: a second opinion that can only take an answer back', () => {
  let t: Tenant;
  let ch: SimChannel;
  const say = (peer: string, text: string) =>
    simInbound(p, t, ch, { from: peer, name: 'Asha', text });
  /** The score the fixture gives "refund" against the Refund FAQ, read from the playground so nothing here guesses it. */
  let base = 0;

  beforeAll(async () => {
    await ops(p)('patch', '/faq').send({ verifyEnabled: true, verifyPerHour: 300 });
    t = await api.signup('faqverify');
    ch = await simChannel(p, t);
    await api.entry(t.admin, 'How do I get a refund?', {
      answerText: 'Refunds take 5 days.',
      variations: ['Refund policy'],
    });
    await indexAll(p);
    await saveSettings(t, { threshold: 0.3 });
    base = (await decision(t, 'refund')).score!;
    expect(base).toBeGreaterThan(0.5);
  });

  const tune = (over: Record<string, unknown>) => saveSettings(t, over);

  it('is off by default and the platform exposes the model that would run', async () => {
    const s = (await api.faq(t.admin).settings()).body;
    expect(s).toMatchObject({
      verifyMode: 'off',
      verifyBand: 0.1,
      verifyAvailable: true,
      verifyModel: 'openai/gpt-4o-mini',
    });
    expect((await decision(t, 'refund')).verify).toBeNull();
  });

  it('validates the band and keeps the saved value when a client does not send it', async () => {
    const f = api.faq(t.admin);
    const rv = (await f.settings()).body.rowVersion;
    for (const bad of [{ verifyBand: 0.009 }, { verifyBand: 0.31 }, { verifyMode: 'always' }]) {
      const res = await f.saveSettings(settingsBody({ threshold: 0.3, rowVersion: rv, ...bad }));
      expect(res.status, JSON.stringify(bad)).toBe(422);
    }
    await tune({ verifyMode: 'borderline', verifyBand: 0.2 });
    const legacy = await f.saveSettings({
      enabled: true,
      threshold: 0.3,
      minMargin: 0,
      logQueries: true,
      rowVersion: (await f.settings()).body.rowVersion,
    });
    expect(legacy.status, JSON.stringify(legacy.body)).toBe(200);
    expect(legacy.body).toMatchObject({ verifyMode: 'borderline', verifyBand: 0.2 });
  });

  it('a borderline match is confirmed, answered, and the verdict is on the decision and in the log', async () => {
    await tune({ threshold: base - 0.01, verifyMode: 'borderline', verifyBand: 0.1 });
    const d = await decision(t, 'refund');
    expect(d.outcome).toBe('answered');
    expect(d.verify).toMatchObject({ verdict: 'confirmed', model: 'openai/gpt-4o-mini' });
    const peer = nextPeer();
    await say(peer, 'refund');
    expect(await untilSent(p, t, ch, peer, 1)).toEqual(['Refunds take 5 days.']);
    const log = (await api.faq(t.admin).log('?view=answered')).body.data[0];
    expect(log.verify).toMatchObject({ verdict: 'confirmed' });
  });

  it('a vetoed match is a silent miss: no reply, listed as unanswered with the reason, and a variation can still be learned from it', async () => {
    const d = await decision(t, 'refund [[reject]]');
    // The marker changes the words, so read this decision's own score and put the bar just under it.
    expect(d.score).not.toBeNull();
    await tune({ threshold: d.score! - 0.01, verifyBand: 0.1 });
    const vetoed = await decision(t, 'refund [[reject]]');
    expect(vetoed.outcome).toBe('below_threshold');
    expect(vetoed.faqId).toBeNull();
    expect(vetoed.verify).toMatchObject({ verdict: 'rejected' });
    expect(vetoed.note).toContain('second check');
    const peer = nextPeer();
    await say(peer, 'refund [[reject]]');
    const row = await until('vetoed log', async () => {
      const r = (await api.faq(t.admin).log('?view=unanswered')).body.data as Array<
        Record<string, unknown>
      >;
      return r.find((x) => x.query === 'refund [[reject]]');
    });
    expect(row).toMatchObject({
      outcome: 'below_threshold',
      verify: { verdict: 'rejected' },
      faqId: null,
    });
    expect(await sentTo(p, t, ch, peer)).toEqual([]);
  });

  it('a failed or unreadable check lets the match stand', async () => {
    const d0 = await decision(t, 'refund [[judge-fail]]');
    await tune({ threshold: d0.score! - 0.01, verifyBand: 0.1 });
    for (const marker of ['[[judge-fail]]', '[[judge-garbage]]']) {
      const d = await decision(t, `refund ${marker}`);
      expect(d.outcome, marker).toBe('answered');
      expect(d.verify, marker).toMatchObject({ verdict: 'error' });
    }
  });

  it('only looks at matches inside the band: well above the bar, and exact phrases, are never checked', async () => {
    await tune({ threshold: 0.3, verifyBand: 0.05 });
    expect((await decision(t, 'refund [[reject]]')).verify).toBeNull();
    expect((await decision(t, 'Refund policy')).verify).toBeNull();
  });

  it('is off when the workspace says off, and skipped (match stands) when the platform switches it off or caps it', async () => {
    const d0 = await decision(t, 'refund [[reject]]');
    await tune({ threshold: d0.score! - 0.01, verifyBand: 0.1, verifyMode: 'off' });
    expect((await decision(t, 'refund [[reject]]')).verify).toBeNull();
    await tune({ verifyMode: 'borderline' });
    await ops(p)('patch', '/faq').send({ verifyEnabled: false });
    try {
      const d = await decision(t, 'refund [[reject]]');
      expect(d.outcome).toBe('answered');
      expect(d.verify).toMatchObject({ verdict: 'skipped' });
      expect((await api.faq(t.admin).settings()).body.verifyAvailable).toBe(false);
    } finally {
      await ops(p)('patch', '/faq').send({ verifyEnabled: true });
    }
    await ops(p)('patch', '/faq').send({ verifyPerHour: 0 });
    try {
      const capped = await decision(t, 'refund [[reject]]');
      expect(capped.outcome).toBe('answered');
      expect(capped.verify).toMatchObject({ verdict: 'skipped' });
      expect(String((capped.verify as { reason: string }).reason)).toContain('limit');
    } finally {
      await ops(p)('patch', '/faq').send({ verifyPerHour: 300 });
    }
  });

  it('the platform operator controls the check: model, switch and cap are validated, audited and read back', async () => {
    const bad = await ops(p)('patch', '/faq').send({ verifyModel: 'bad model!' });
    expect(bad.status).toBe(422);
    expect((await ops(p)('patch', '/faq').send({ verifyPerHour: -1 })).status).toBe(422);
    const ok = await ops(p)('patch', '/faq').send({
      verifyModel: 'google/gemini-2.5-flash-lite',
      verifyPerHour: 50,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.config).toMatchObject({
      verifyEnabled: true,
      verifyModel: 'google/gemini-2.5-flash-lite',
      verifyPerHour: 50,
    });
    expect((await api.faq(t.admin).settings()).body.verifyModel).toBe(
      'google/gemini-2.5-flash-lite',
    );
    const stats = ok.body.stats;
    expect(typeof stats.verified30d).toBe('number');
    expect(stats.vetoed30d).toBeGreaterThanOrEqual(1);
    await ops(p)('patch', '/faq').send({ verifyModel: 'openai/gpt-4o-mini', verifyPerHour: 300 });
  });

  it('records the tokens of a check in the ledger', async () => {
    const n = await api.count(
      `SELECT count(*) AS n FROM ai_token_usage WHERE org_id = $1 AND model = 'openai/gpt-4o-mini' AND completion_tokens > 0`,
      [t.orgId],
    );
    expect(n).toBeGreaterThan(0);
  });
});

// =====================================================================================================================
describe('the Flow "Answer from FAQ" node', () => {
  let t: Tenant;
  let ch: SimChannel;
  const say = (peer: string, text: string) =>
    simInbound(p, t, ch, { from: peer, name: 'Asha', text });

  /** trigger -> faq -> matched: "Done: {{faq.answer}}" / no_match: "No FAQ for that". */
  const faqFlow = (name: string, keyword: string, node: Record<string, unknown>) =>
    addGraphFlow(
      t,
      name,
      keyword,
      [
        { id: 't', type: 'trigger' },
        { id: 'f', type: 'faq', data: node },
        { id: 'y', type: 'message', data: { text: 'Done: {{faq.answer}} ({{faq.matched}})' } },
        { id: 'n', type: 'message', data: { text: 'No FAQ for that ({{faq.matched}})' } },
        { id: 'z', type: 'end' },
      ],
      [
        { source: 't', handle: 'out', target: 'f' },
        { source: 'f', handle: 'matched', target: 'y' },
        { source: 'f', handle: 'no_match', target: 'n' },
        { source: 'y', handle: 'out', target: 'z' },
        { source: 'n', handle: 'out', target: 'z' },
      ],
    );

  beforeAll(async () => {
    t = await api.signup('faqnodeflow');
    ch = await simChannel(p, t);
    await api.entry(t.admin, 'Where is my order?', {
      answerText: 'Ships in 2 days.',
      category: 'orders',
      variations: ['Track my order', 'Order status'],
    });
    await api.entry(t.admin, 'How do I get a refund?', {
      answerText: 'Refunds take 5 days.',
      category: 'billing',
      variations: ['Refund policy'],
    });
    await indexAll(p);
    // The workspace never switched automatic answering on: the node is its own opt-in.
  });

  it('answers by meaning, sends the answer, and exposes the result to the next step', async () => {
    await faqFlow('Node flow A', 'asknodea', {
      query: 'order status',
      sendAnswer: true,
      save: 'faq',
    });
    const peer = nextPeer();
    await say(peer, 'asknodea');
    expect(await untilSent(p, t, ch, peer, 2)).toEqual([
      'Ships in 2 days.',
      'Done: Ships in 2 days. (yes)',
    ]);
  });

  it('leaves by no_match when nothing is close, and says so in a variable', async () => {
    await faqFlow('Node flow B', 'asknodeb', { query: 'do you sell hammocks', sendAnswer: true });
    const peer = nextPeer();
    await say(peer, 'asknodeb');
    expect(await untilSent(p, t, ch, peer, 1)).toEqual(['No FAQ for that (no)']);
  });

  it('with "send the answer" off it only saves the answer, so the flow words the reply', async () => {
    await faqFlow('Node flow C', 'asknodec', { query: 'track my order', sendAnswer: false });
    const peer = nextPeer();
    await say(peer, 'asknodec');
    expect(await untilSent(p, t, ch, peer, 1)).toEqual(['Done: Ships in 2 days. (yes)']);
    await new Promise((r) => setTimeout(r, 600));
    expect(await sentTo(p, t, ch, peer)).toHaveLength(1);
  });

  it("reads the customer's message when the query is {{user_message}}", async () => {
    await faqFlow('Node flow D', 'asknoded', { query: '{{user_message}}', sendAnswer: false });
    const peer = nextPeer();
    await say(peer, 'asknoded order status');
    expect(await untilSent(p, t, ch, peer, 1)).toEqual(['Done: Ships in 2 days. (yes)']);
  });

  it('a category narrows the search: the right FAQ in the wrong category is not offered', async () => {
    await faqFlow('Node flow E', 'asknodee', {
      query: 'order status',
      category: 'billing',
      sendAnswer: false,
    });
    const peer = nextPeer();
    await say(peer, 'asknodee');
    expect(await untilSent(p, t, ch, peer, 1)).toEqual(['No FAQ for that (no)']);
  });

  it('a node minimum score replaces the workspace bar for that node only', async () => {
    await faqFlow('Node flow F', 'asknodef', {
      query: 'refund',
      minScore: 0.99,
      sendAnswer: false,
    });
    const peer = nextPeer();
    await say(peer, 'asknodef');
    expect(await untilSent(p, t, ch, peer, 1)).toEqual(['No FAQ for that (no)']);
    await faqFlow('Node flow G', 'asknodeg', { query: 'refund', minScore: 0.3, sendAnswer: false });
    const peer2 = nextPeer();
    await say(peer2, 'asknodeg');
    expect(await untilSent(p, t, ch, peer2, 1)).toEqual(['Done: Refunds take 5 days. (yes)']);
  });

  it('a flow FAQ enters its flow at its chosen step and the run continues there', async () => {
    const target = await twoSteps(t, 'Node target flow', null);
    await api.faq(t.admin).create({
      question: 'Show me pricing plans',
      answerType: 'flow',
      flowId: target.uuid,
      flowNodeId: 'b',
      variations: ['pricing plans'],
    });
    await indexAll(p);
    await faqFlow('Node flow H', 'asknodeh', { query: 'pricing plans' });
    const peer = nextPeer();
    await say(peer, 'asknodeh');
    expect(await untilSent(p, t, ch, peer, 1)).toEqual(['Second step']);
    await new Promise((r) => setTimeout(r, 800));
    expect(await sentTo(p, t, ch, peer)).toEqual(['Second step']);
  });

  it('a flow FAQ whose step is gone leaves by no_match instead of pretending it answered', async () => {
    const target = await twoSteps(t, 'Node broken target', null);
    await api.faq(t.admin).create({
      question: 'Refer a friend scheme',
      answerType: 'flow',
      flowId: target.uuid,
      flowNodeId: 'b',
      variations: ['referral scheme'],
    });
    await indexAll(p);
    await p.h.owner.query(`UPDATE flows SET flow_data = $2::jsonb WHERE id = $1`, [
      target.id,
      JSON.stringify({
        flowNodes: [{ id: 't', type: 'trigger', data: {}, isStart: true }],
        flowEdges: [],
        vars: {},
      }),
    ]);
    await faqFlow('Node flow I', 'asknodei', { query: 'referral scheme' });
    const peer = nextPeer();
    await say(peer, 'asknodei');
    expect(await untilSent(p, t, ch, peer, 1)).toEqual(['No FAQ for that (no)']);
  });

  it('writes one flow-origin log row per match, kept out of the unanswered list and the insights', async () => {
    const rows = await p.h.owner.query(
      `SELECT outcome, origin FROM faq_match_logs WHERE org_id = $1 AND origin = 'flow'`,
      [t.orgId],
    );
    expect(rows.rows.length).toBeGreaterThanOrEqual(5);
    expect(rows.rows.some((r) => r.outcome === 'answered')).toBe(true);
    expect(rows.rows.some((r) => r.outcome === 'flow_started')).toBe(true);
    expect(rows.rows.some((r) => r.outcome === 'below_threshold')).toBe(true);
    const unanswered = (await api.faq(t.admin).log('?view=unanswered')).body.data as unknown[];
    expect(unanswered).toEqual([]);
    const summary = (await api.faq(t.admin).summary()).body;
    expect(summary.totals.messages).toBe(0);
  });

  it('the platform switch still stops the node: it leaves by no_match', async () => {
    await faqFlow('Node flow J', 'asknodej', { query: 'order status', sendAnswer: true });
    await ops(p)('patch', '/faq').send({ engineEnabled: false });
    try {
      const peer = nextPeer();
      await say(peer, 'asknodej');
      expect(await untilSent(p, t, ch, peer, 1)).toEqual(['No FAQ for that (no)']);
    } finally {
      await ops(p)('patch', '/faq').send({ engineEnabled: true });
    }
  });

  it('a node left blank with no query matches nothing and does not break the flow', async () => {
    await faqFlow('Node flow K', 'asknodek', { query: '', sendAnswer: true });
    const peer = nextPeer();
    await say(peer, 'asknodek');
    expect(await untilSent(p, t, ch, peer, 1)).toEqual(['No FAQ for that (no)']);
  });
});

// =====================================================================================================================
describe('order of answering: keyword flows first, then the FAQ', () => {
  it('a message a keyword flow takes is never matched, and the FAQ answers the rest (the contract the inbound hook enforces)', async () => {
    const t = await api.signup('faqorder');
    const ch = await simChannel(p, t);
    await api.entry(t.admin, 'Zebra facts', {
      answerText: 'Zebras have stripes.',
      variations: ['zebra stripes'],
    });
    await indexAll(p);
    await saveSettings(t, {});
    await addGraphFlow(
      t,
      'Zebra keyword',
      'zebra stripes',
      [
        { id: 't', type: 'trigger' },
        { id: 'm', type: 'message', data: { text: 'From the keyword flow' } },
        { id: 'z', type: 'end' },
      ],
      [
        { source: 't', handle: 'out', target: 'm' },
        { source: 'm', handle: 'out', target: 'z' },
      ],
    );
    const first = nextPeer();
    await simInbound(p, t, ch, { from: first, name: 'Asha', text: 'zebra stripes' });
    expect(await untilSent(p, t, ch, first, 1)).toEqual(['From the keyword flow']);
    const second = nextPeer();
    await simInbound(p, t, ch, { from: second, name: 'Asha', text: 'zebra facts' });
    expect(await untilSent(p, t, ch, second, 1)).toEqual(['Zebras have stripes.']);
  });
});
