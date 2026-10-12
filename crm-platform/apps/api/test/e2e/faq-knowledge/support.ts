import request from 'supertest';
import { expect } from 'vitest';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { OPERATOR_EMAIL, OPERATOR_PASSWORD } from '../auth-registration-security/harness';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';
import {
  simChannel,
  simInbound,
  until,
  type SimChannel,
} from '../chat-conversations/pipeline-support';

export { Api, bearer, until, simChannel, simInbound, type Harness, type Tenant, type SimChannel };

export const code = (res: { body: { code?: string } }): string | undefined => res.body.code;
export const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface Pipeline {
  h: Harness;
  api: Api;
  superToken: string;
  stop(): Promise<void>;
}

/**
 * The FAQ engine end to end: the real API, the inbox pipeline (ingest, dispatch), the flow runtime and the FAQ worker side (embedding
 * queue, inbound listener) in one process over real Postgres with pgvector (restricted role) and real Redis. The AI vendor is the
 * offline fixture (FAQ_AI_DRIVER=fixture): deterministic, no network, no cost.
 */
export async function startPipeline(opts: { live?: boolean } = {}): Promise<Pipeline> {
  // `live` leaves the driver alone, so the real OpenRouter adapter runs (the opt-in live spec).
  if (opts.live) delete process.env.FAQ_AI_DRIVER;
  else process.env.FAQ_AI_DRIVER = 'fixture';
  process.env.CHANNEL_SIMULATOR_ENABLED = 'true';
  const h = await startHarness({
    loadModules: async () => [
      (await import('../../../src/modules/chat-conversations/chat-conversations-worker.module'))
        .ChatConversationsWorkerModule,
      (await import('../../../src/modules/flow-runtime-engine')).FlowRuntimeEngineWorkerModule,
      (await import('../../../src/modules/faq-knowledge/faq-knowledge-worker.module'))
        .FaqKnowledgeWorkerModule,
    ],
  });
  await h.app.listen(0, '127.0.0.1');
  const api = new Api(h);

  const first = await api
    .http()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  expect(first.status, JSON.stringify(first.body)).toBe(201);
  const token = first.body.tokens.accessToken as string;
  const setup = await api.http().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  const enabled = await api
    .http()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: hotp(base32Decode(setup.body.secret as string), totpStep(Date.now())) });
  expect(enabled.status, JSON.stringify(enabled.body)).toBe(201);
  return { h, api, superToken: token, stop: () => h.stop() };
}

/** The platform operator's calls: `ops(p)('get', '/faq')`. */
export const ops =
  (p: Pipeline, token = p.superToken) =>
  (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) =>
    request(p.h.app.getHttpServer())[method](`/v2/platform${path}`).set(bearer(token));

/** The platform's OpenRouter key: saved and active, which is what lets a workspace without its own key use the engine. */
export async function setPlatformKey(
  p: Pipeline,
  on: boolean,
  key = 'sk-or-test-PLATFORM-0123456789',
): Promise<void> {
  const list = await ops(p)('get', '/ai-keys');
  expect(list.status, JSON.stringify(list.body)).toBe(200);
  const k = (list.body.data as Array<{ id: string; provider: string; rowVersion: number }>).find(
    (x) => x.provider === 'openrouter',
  )!;
  if (on) {
    const save = await ops(p)('patch', `/ai-keys/${k.id}`).send({
      rowVersion: k.rowVersion,
      apiKey: key,
      defaultModel: 'openai/gpt-4o-mini',
    });
    expect(save.status, JSON.stringify(save.body)).toBe(200);
  } else {
    const save = await ops(p)('patch', `/ai-keys/${k.id}`).send({
      rowVersion: k.rowVersion,
      removeKey: true,
    });
    expect(save.status, JSON.stringify(save.body)).toBe(200);
  }
}

export interface EntryJson {
  id: string;
  question: string;
  answerType: 'text' | 'flow';
  answerText?: string | null;
  answerPreview?: string | null;
  flowId: string | null;
  flowName: string | null;
  category: string | null;
  status: 'active' | 'paused';
  thresholdOverride: number | null;
  hitCount: number;
  lastHitAt: string | null;
  variationCount: number;
  readyCount: number;
  pendingCount: number;
  failedCount: number;
  rowVersion: number;
  variations?: Array<{
    id: string;
    text: string;
    source: string;
    embedState: 'pending' | 'ready' | 'failed';
    embedError: string | null;
    rowVersion: number;
  }>;
  [k: string]: unknown;
}

export interface DecisionJson {
  outcome: string;
  tier: string | null;
  faqId: string | null;
  score: number | null;
  secondScore: number | null;
  threshold: number;
  minMargin: number;
  candidates: Array<{
    faqId: string;
    question: string;
    score: number;
    matchedText: string;
    status: string;
  }>;
  embeddingModel: string | null;
  note: string | null;
  [k: string]: unknown;
}

export class FaqApi extends Api {
  faq(token: string) {
    const as = this.as(token);
    return {
      list: (qs = '') => as.get(`/v2/faq/entries${qs}`),
      get: (id: string) => as.get(`/v2/faq/entries/${id}`),
      create: (body: Record<string, unknown>) =>
        as.post('/v2/faq/entries').set('idempotency-key', `k-${Math.random()}`).send(body),
      update: (id: string, body: Record<string, unknown>) =>
        as.patch(`/v2/faq/entries/${id}`).send(body),
      remove: (id: string) => as.delete(`/v2/faq/entries/${id}`),
      bulk: (body: Record<string, unknown>) => as.post('/v2/faq/entries/bulk').send(body),
      addVariations: (id: string, body: Record<string, unknown>) =>
        as.post(`/v2/faq/entries/${id}/variations`).send(body),
      updateVariation: (id: string, vid: string, body: Record<string, unknown>) =>
        as.patch(`/v2/faq/entries/${id}/variations/${vid}`).send(body),
      removeVariation: (id: string, vid: string) =>
        as.delete(`/v2/faq/entries/${id}/variations/${vid}`),
      generate: (id: string, body: Record<string, unknown> = {}) =>
        as.post(`/v2/faq/entries/${id}/variations/generate`).send(body),
      test: (query: string) => as.post('/v2/faq/test').send({ query }),
      settings: () => as.get('/v2/faq/settings'),
      saveSettings: (body: Record<string, unknown>) => as.put('/v2/faq/settings').send(body),
      summary: (qs = '') => as.get(`/v2/faq/insights/summary${qs}`),
      log: (qs = '') => as.get(`/v2/faq/insights/log${qs}`),
      learn: (id: string, body: Record<string, unknown>) =>
        as.post(`/v2/faq/insights/log/${id}/learn`).send(body),
      dismiss: (id: string) => as.post(`/v2/faq/insights/log/${id}/dismiss`),
    };
  }

  /** A FAQ with a text answer; returns the full entry. */
  async entry(
    token: string,
    question: string,
    over: Record<string, unknown> = {},
  ): Promise<EntryJson> {
    const res = await this.faq(token).create({
      question,
      answerType: 'text',
      answerText: `Answer to: ${question}`,
      variations: [],
      ...over,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as EntryJson;
  }

  async count(sql: string, params: unknown[] = []): Promise<number> {
    const r = await this.h.owner.query(sql, params);
    return Number(r.rows[0].n);
  }
}

/** Runs the embedding worker until no variation of any workspace is pending (or `max` passes). */
export async function indexAll(p: Pipeline, max = 12): Promise<number> {
  const { FaqEmbedWorker } = await import('../../../src/modules/faq-knowledge/faq-embed.worker');
  const worker = p.h.app.get(FaqEmbedWorker);
  let stored = 0;
  for (let i = 0; i < max; i++) {
    stored += await worker.runOnce();
    const pending = Number(
      (
        await p.h.owner.query(
          `SELECT count(*) AS n FROM faq_variations WHERE embed_state = 'pending' AND embed_attempts < 5`,
        )
      ).rows[0].n,
    );
    if (pending === 0) break;
  }
  return stored;
}

/** A flow arranged straight in the table: the editor is another domain. */
export async function addFlow(
  p: Pipeline,
  t: Tenant,
  name: string,
  keywords: string | null,
  graphText = 'Hello from the flow',
): Promise<{ id: number; uuid: string }> {
  const graph = {
    flowNodes: [
      { id: 't', type: 'trigger', data: {}, isStart: true },
      { id: 'a', type: 'message', data: { text: graphText } },
      { id: 'z', type: 'end', data: {} },
    ],
    flowEdges: [
      { source: 't', sourceHandle: 'out', target: 'a' },
      { source: 'a', sourceHandle: 'out', target: 'z' },
    ],
    vars: {},
  };
  const res = await p.h.owner.query(
    `INSERT INTO flows (org_id, flow_name, flow_data, trigger_kind, trigger_keywords, is_published, is_active, provider, flow_type)
     VALUES ($1, $2, $3::jsonb, 'keyword', $4, true, true, 'simulator', 'chat') RETURNING id, uuid`,
    [t.orgId, name, JSON.stringify(graph), keywords],
  );
  return { id: Number(res.rows[0].id), uuid: String(res.rows[0].uuid) };
}

/** What the customer received on the channel, in order. */
export async function sentTo(
  p: Pipeline,
  t: Tenant,
  ch: SimChannel,
  peer: string,
): Promise<string[]> {
  const r = await p.h.owner.query(
    `SELECT m.body FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
     WHERE c.org_id = $1 AND c.channel_id = $2 AND c.peer_key = $3 AND m.direction = 'out' ORDER BY m.seq`,
    [t.orgId, ch.internalId, peer],
  );
  return r.rows.map((x) => String(x.body));
}

export async function untilSent(
  p: Pipeline,
  t: Tenant,
  ch: SimChannel,
  peer: string,
  count: number,
  ms = 20_000,
): Promise<string[]> {
  return until(
    `${count} messages sent to ${peer}`,
    async () => {
      const got = await sentTo(p, t, ch, peer);
      return got.length >= count ? got : undefined;
    },
    ms,
  );
}

let peerCounter = 0;
export const nextPeer = (): string => `9197${String(10000000 + peerCounter++).padStart(8, '0')}`;
