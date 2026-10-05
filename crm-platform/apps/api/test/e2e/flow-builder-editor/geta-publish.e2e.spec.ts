import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  Api,
  startHarness,
  type Grant,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { OutboxSubscriberRegistry } from '../../../src/kernel/outbox/outbox-subscribers';
import { OutboxDrainService } from '../../../src/workers/outbox-drain.service';
import { GetaPublishConsumer } from '../../../src/modules/flow-builder-editor/geta-publish/geta-publish.consumer';
import { GETA_PUBLISH_REQUESTED } from '../../../src/modules/flow-builder-editor/geta-publish/geta-publish-sync.service';
import { GetaConsoleStub } from '../../fixtures/geta-console/stub-server';

/**
 * Geta console publishing end to end: Publish in the editor writes a sync row and an outbox event, the worker side (the REAL outbox
 * drain and the REAL consumer, the REAL HTTP adapter in live mode) calls a local stub of the console, and the state the editor reads
 * goes pending -> live / failed. The real Geta console is never called; every token, id and name below is fake.
 */
const FAKE_AUTH = 'fake-auth-token-AAAA1111';
const FAKE_HOST = 'fake-geta-host-BBBB2222';
const BOT_ID = '00000000-0000-4000-8000-000000000001';
const BUSINESS_ID = '00000000-0000-4000-8000-0000000000b1';
const CHATBOT_ID = 'fakeBot1';
const NOW = new Date('2026-10-05T16:37:00Z');

const record = (over: Record<string, unknown> = {}) => ({
  bot_category_id: 0,
  bot_enabled: true,
  bot_id: BOT_ID,
  bot_type_id: 1,
  business_id: BUSINESS_ID,
  channel: 'whatsapp',
  chatbot_configuration: 'CF_FAKE0001',
  chatbot_languages: [],
  chatbot_layout: 'LO_FAKE0001',
  chatbot_schema: 'fake-schema',
  chatbot_status: false,
  chatbot_theme: 'TH_FAKE0001',
  created_time: '10 Sep, 2026 11:00:10 AM',
  deleted_time: null,
  deploy_url: null,
  description: 'नमस्कार, हा एक चाचणी बॉट आहे \u{1F600}',
  id: CHATBOT_ID,
  is_active: true,
  modified_time: '01 Jan, 2020 1:00:00 AM',
  multi_lingual: { display_language_option: false, display_message: '', multi_lingual: false },
  name: 'Fake bot \u{1F916}',
  primary_language: 'english',
  project_version_id: 'fake-version',
  timezone: null,
  workspace_id: 'fake-workspace',
  ...over,
});

let h: Harness;
let api: Api;
let stub: GetaConsoleStub;
let drainer: OutboxDrainService;
let consumer: GetaPublishConsumer;
let t: Tenant;
let other: Tenant;

const ADMINISH: Grant[] = [
  ['flb.flows.read'],
  ['flb.flows.create'],
  ['flb.flows.update'],
  ['flb.flows.delete'],
  ['flb.flows.publish'],
];

const graph = () => ({
  flowNodes: [
    { id: 'n_trig', type: 'trigger', x: 0, y: 0, data: { kind: 'keyword', keywords: 'hi' } },
    { id: 'n_msg', type: 'message', x: 300, y: 0, data: { text: 'hello' } },
  ],
  flowEdges: [{ id: 'e_1', source: 'n_trig', sourceHandle: 'out', target: 'n_msg' }],
  vars: [],
});

interface Sync {
  state: string;
  step: string | null;
  failedStep: string | null;
  lastError: string | null;
  attemptedAt: string | null;
  botId: string | null;
  publishVersion: number | null;
  configured: boolean;
  chatbotOverride: { id: string; name: string | null; botId: string } | null;
}

async function createFlow(token: string, name: string): Promise<string> {
  const res = await api.as(token).post('/v2/flows').send({ name, graph: graph() });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}
async function publish(token: string, id: string) {
  const res = await api.as(token).post(`/v2/flows/${id}/publish`).send({});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { isPublished: boolean; getaSync: Sync };
}
const status = async (token: string, id: string): Promise<Sync> => {
  const res = await api.as(token).get(`/v2/flows/${id}/publish-sync`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Sync;
};
const retry = (token: string, id: string) =>
  api.as(token).post(`/v2/flows/${id}/publish-sync/retry`).send({});
const saveSettings = (token: string, body: Record<string, unknown>) =>
  api.as(token).put('/v2/flows/geta-publish/settings').send(body);

/** What the worker does: the outbox drain loop, with the real subscriber registry. */
const drain = async () => {
  await drainer.drain();
};
const configure = async (token: string, rec: Record<string, unknown> = record()) => {
  const res = await saveSettings(token, {
    baseUrl: stub.url,
    authorization: FAKE_AUTH,
    getaHost: FAKE_HOST,
    chatbotRecord: JSON.stringify(rec),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res;
};
const clearAll = async (token: string) => {
  expect((await api.as(token).delete('/v2/flows/geta-publish/settings')).status).toBe(200);
};

beforeAll(async () => {
  stub = await new GetaConsoleStub().start();
  Object.assign(process.env, {
    GETA_PUBLISH_MODE: 'live',
    GETA_PUBLISH_ALLOW_PRIVATE_HOSTS: 'true',
    GETA_PUBLISH_MAX_ATTEMPTS: '2',
    GETA_PUBLISH_BACKOFF_MS: '0',
    GETA_PUBLISH_TIMEOUT_MS: '3000',
  });
  h = await startHarness({
    loadModules: async () => {
      const { FlowBuilderEditorWorkerModule } =
        await import('../../../src/modules/flow-builder-editor');
      return [FlowBuilderEditorWorkerModule];
    },
  });
  api = new Api(h);
  drainer = new OutboxDrainService(h.app.get(DatabaseService), h.app.get(OutboxSubscriberRegistry));
  consumer = h.app.get(GetaPublishConsumer);
  consumer.now = () => NOW;
  t = await api.signup('geta');
  other = await api.signup('getb');
}, 240_000);

afterAll(async () => {
  await stub?.stop();
  await h?.stop();
});

beforeEach(() => stub.reset());

describe('no credentials: the flow is published here and the editor says so', () => {
  it('publish succeeds, answers not_configured, emits no Geta event and makes no call', async () => {
    await clearAll(t.admin);
    const id = await createFlow(t.admin, 'No creds');
    const pub = await publish(t.admin, id);
    expect(pub.isPublished).toBe(true);
    expect(pub.getaSync).toMatchObject({ state: 'not_configured', configured: false });
    await drain();
    expect(stub.requests).toHaveLength(0);
    expect(await api.events(t.orgId, GETA_PUBLISH_REQUESTED)).toHaveLength(0);
    expect((await status(t.admin, id)).state).toBe('not_configured');
  });

  it('retry says to set up Geta first (422), and a draft flow reads none, not not_configured', async () => {
    await clearAll(t.admin);
    const id = await createFlow(t.admin, 'Draft only');
    expect((await status(t.admin, id)).state).toBe('none');
    await publish(t.admin, id);
    const res = await retry(t.admin, id);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('FLB_GETA_NOT_CONFIGURED');
  });
});

describe('settings: secrets in, flags out', () => {
  it('saves, answers flags and a summary, and never returns a secret in any response', async () => {
    await clearAll(t.admin);
    const empty = await api.as(t.admin).get('/v2/flows/geta-publish/settings');
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({
      mode: 'live',
      baseUrl: null,
      authorizationSet: false,
      getaHostSet: false,
      chatbot: null,
      configured: false,
    });

    const saved = await configure(t.admin);
    const read = await api.as(t.admin).get('/v2/flows/geta-publish/settings');
    const id = await createFlow(t.admin, 'Secrets');
    const pub = await publish(t.admin, id);
    await drain();
    const detail = await api.as(t.admin).get(`/v2/flows/${id}`);
    const sync = await api.as(t.admin).get(`/v2/flows/${id}/publish-sync`);
    const list = await api.as(t.admin).get('/v2/flows');

    expect(read.body).toMatchObject({
      baseUrl: stub.url,
      authorizationSet: true,
      getaHostSet: true,
      configured: true,
      chatbot: { id: CHATBOT_ID, name: 'Fake bot \u{1F916}', botId: BOT_ID },
    });
    for (const res of [saved, read, detail, sync, list]) {
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(FAKE_AUTH);
      expect(text).not.toContain(FAKE_HOST);
      expect(text).not.toContain(BUSINESS_ID);
      expect(text).not.toContain('CF_FAKE0001');
    }
    expect(JSON.stringify(pub)).not.toContain(FAKE_AUTH);
  });

  it('stores the three secrets sealed, and the outbox, audit and sync rows never hold them', async () => {
    await configure(t.admin);
    const id = await createFlow(t.admin, 'At rest');
    await publish(t.admin, id);
    await drain();
    const row = (
      await h.owner.query(
        `SELECT authorization_enc, geta_host_enc, chatbot_record_enc FROM flb_geta_publish_settings WHERE org_id = $1`,
        [t.orgId],
      )
    ).rows[0];
    for (const v of [row.authorization_enc, row.geta_host_enc, row.chatbot_record_enc]) {
      expect(v).toMatch(/^v1:/);
    }
    expect(JSON.stringify(row)).not.toContain(FAKE_AUTH);
    expect(JSON.stringify(row)).not.toContain(BUSINESS_ID);
    for (const q of [
      `SELECT payload::text AS x FROM event_outbox WHERE org_id = $1`,
      `SELECT coalesce(delta::text, '') AS x FROM audit_log WHERE org_id = $1`,
      `SELECT to_jsonb(s)::text AS x FROM flb_geta_publish_syncs s WHERE org_id = $1`,
    ]) {
      const all = (await h.owner.query(q, [t.orgId])).rows.map((r) => r.x as string).join('\n');
      expect(all, q).not.toContain(FAKE_AUTH);
      expect(all, q).not.toContain(FAKE_HOST);
      expect(all, q).not.toContain(BUSINESS_ID);
    }
    const audits = await h.owner.query(
      `SELECT action, delta FROM audit_log WHERE org_id = $1 AND module = 'flb-geta-publish' ORDER BY id`,
      [t.orgId],
    );
    expect(audits.rowCount).toBeGreaterThan(0);
  });

  it('a save changes only the fields it names, and null clears one', async () => {
    await configure(t.admin);
    const a = await saveSettings(t.admin, { origin: 'https://console.example.test' });
    expect(a.body).toMatchObject({
      origin: 'https://console.example.test',
      authorizationSet: true,
      configured: true,
    });
    const b = await saveSettings(t.admin, { authorization: null });
    expect(b.body).toMatchObject({ authorizationSet: false, getaHostSet: true, configured: false });
    const c = await saveSettings(t.admin, { origin: null, authorization: FAKE_AUTH });
    expect(c.body).toMatchObject({ origin: null, authorizationSet: true, configured: true });
  });

  it('refuses a bad record or base URL with 422 and does not echo the input', async () => {
    const junk = 'this-is-not-json-NOECHO';
    const bad = await saveSettings(t.admin, { chatbotRecord: junk });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('FLB_GETA_SETTINGS_INVALID');
    expect(JSON.stringify(bad.body)).not.toContain('NOECHO');
    const noIds = await saveSettings(t.admin, { chatbotRecord: JSON.stringify({ id: 'x' }) });
    expect(noIds.status).toBe(422);
    const token = await saveSettings(t.admin, { authorization: 'line1\nline2' });
    expect(token.status).toBe(422);
  });

  it('requires https unless the deployment allows private hosts', async () => {
    process.env.GETA_PUBLISH_ALLOW_PRIVATE_HOSTS = 'false';
    try {
      const res = await saveSettings(t.admin, { baseUrl: 'http://api.example.test' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('FLB_GETA_SETTINGS_INVALID');
      const withLogin = await saveSettings(t.admin, {
        baseUrl: 'https://user:pw@api.example.test',
      });
      expect(withLogin.status).toBe(422);
      const ok = await saveSettings(t.admin, { baseUrl: 'https://api.example.test/' });
      expect(ok.body.baseUrl).toBe('https://api.example.test');
    } finally {
      process.env.GETA_PUBLISH_ALLOW_PRIVATE_HOSTS = 'true';
      await configure(t.admin);
    }
  });
});

describe('publish -> outbox -> worker -> live', () => {
  it('the local publish answers pending at once, then the worker makes the two calls in order and the flow goes live', async () => {
    await configure(t.admin);
    const id = await createFlow(t.admin, 'Goes live');
    const eventsBefore = (await api.events(t.orgId, GETA_PUBLISH_REQUESTED)).length;
    const pub = await publish(t.admin, id);
    expect(pub.isPublished).toBe(true);
    expect(pub.getaSync).toMatchObject({ state: 'pending', step: 'configuration_update' });
    // nothing was called inline
    expect(stub.requests).toHaveLength(0);
    const events = await api.events(t.orgId, GETA_PUBLISH_REQUESTED);
    expect(events).toHaveLength(eventsBefore + 1);
    expect(events[events.length - 1]).toMatchObject({ publishVersion: 1, retry: false });

    await drain();

    expect(stub.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      `PUT /api/v1/chatbot/${CHATBOT_ID}/configuration/update/`,
      'POST /api/v1/console/publish-bot',
    ]);
    const [update, publishCall] = stub.requests;
    // the record goes as pasted, except modified_time
    const sent = (JSON.parse(update!.body) as { chatbot: Record<string, unknown> }).chatbot;
    expect(sent.modified_time).toBe('05 Oct, 2026 4:37:00 PM');
    expect({ ...sent, modified_time: undefined }).toEqual({
      ...record(),
      modified_time: undefined,
    });
    expect(sent.chatbot_status).toBe(false);
    expect(sent.bot_enabled).toBe(true);
    expect(JSON.parse(update!.rawBody.toString('utf8')).chatbot.description).toBe(
      record().description,
    );
    for (const r of [update!, publishCall!]) {
      expect(r.headers.authorization).toBe(FAKE_AUTH);
      expect(r.headers['geta-host']).toBe(FAKE_HOST);
      expect(r.headers.accept).toBe('application/json');
      expect(r.headers['content-type']).toBe('application/json;charset=UTF-8');
    }
    expect(update!.headers.appid).toBeUndefined();
    expect(publishCall!.headers.appid).toBe(`{"botid":"${BOT_ID}"}`);
    expect(publishCall!.body).toBe('{}');

    const s = await status(t.admin, id);
    expect(s).toMatchObject({
      state: 'live',
      step: 'publish_bot',
      failedStep: null,
      lastError: null,
      botId: BOT_ID,
      publishVersion: 1,
      configured: true,
    });
    expect(s.attemptedAt).toMatch(/^\d{4}-/);
    const detail = await api.as(t.admin).get(`/v2/flows/${id}`);
    expect(detail.body.getaSync.state).toBe('live');
  });

  it('is idempotent per publish version: a redelivered event and a replay after live make no call', async () => {
    await configure(t.admin);
    const id = await createFlow(t.admin, 'Idempotent');
    await publish(t.admin, id);
    await drain();
    expect(stub.requests).toHaveLength(2);
    // redeliver the very same event
    await h.owner.query(
      `UPDATE event_outbox SET status = 'pending', processed_at = NULL WHERE org_id = $1 AND event_type = $2`,
      [t.orgId, GETA_PUBLISH_REQUESTED],
    );
    await drain();
    expect(stub.requests).toHaveLength(2);
    expect((await status(t.admin, id)).state).toBe('live');
  });

  it('a second publish is a new version and pushes again; an event for the older version does nothing', async () => {
    await configure(t.admin);
    const id = await createFlow(t.admin, 'Twice');
    await publish(t.admin, id);
    await drain();
    stub.reset();
    const second = await publish(t.admin, id);
    expect(second.getaSync).toMatchObject({ state: 'pending', publishVersion: 2 });
    await drain();
    expect(stub.requests).toHaveLength(2);
    expect((await status(t.admin, id)).publishVersion).toBe(2);
    // a stale version-1 event arrives late
    stub.reset();
    const flowId = Number(
      (await h.owner.query(`SELECT id FROM flows WHERE uuid = $1`, [id])).rows[0].id,
    );
    await consumer.handle({
      id: 'stale',
      orgId: t.orgId,
      aggregateModule: 'flows',
      aggregateId: String(flowId),
      eventType: GETA_PUBLISH_REQUESTED,
      payload: { uuid: id, publishVersion: 1 },
    });
    expect(stub.requests).toHaveLength(0);
  });

  it('the local publish never fails because the console does: the answer is 200 with the flow published', async () => {
    await configure(t.admin);
    stub.setDefault('update', { status: 500, body: 'console down' });
    const id = await createFlow(t.admin, 'Console down');
    const pub = await publish(t.admin, id);
    expect(pub.isPublished).toBe(true);
    expect(pub.getaSync.state).toBe('pending');
    const list = await api.as(t.admin).get('/v2/flows?status=live');
    expect(list.body.data.map((f: { id: string }) => f.id)).toContain(id);
    // let the worker settle it (it fails, visibly) so later tests start clean
    await drain();
    expect((await status(t.admin, id)).state).toBe('failed');
  });
});

describe('failure and retry', () => {
  it('a failed configuration update stops there: failed, the step named, publish-bot never called, then Retry goes live', async () => {
    await configure(t.admin);
    stub.setDefault('update', {
      status: 500,
      body: `Internal error ${FAKE_AUTH} ${'z'.repeat(1000)}`,
    });
    const id = await createFlow(t.admin, 'Update fails');
    await publish(t.admin, id);
    await drain();

    const s = await status(t.admin, id);
    expect(s).toMatchObject({
      state: 'failed',
      failedStep: 'configuration_update',
      step: 'configuration_update',
    });
    expect(s.lastError).toMatch(/^Geta answered 500: .*\(configuration update\)$/);
    expect(s.lastError!.length).toBeLessThan(400);
    expect(s.lastError).not.toContain(FAKE_AUTH);
    expect(stub.calls('publish')).toHaveLength(0);
    // the adapter retried the 500 once (2 attempts), the local publish is untouched
    expect(stub.calls('update')).toHaveLength(2);
    const flow = await api.as(t.admin).get(`/v2/flows/${id}`);
    expect(flow.body.isPublished).toBe(true);
    expect(flow.body.getaSync.state).toBe('failed');

    // the console recovers; Retry re-runs from the failed step
    stub.reset();
    const r = await retry(t.admin, id);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ state: 'pending', step: 'configuration_update' });
    await drain();
    expect(stub.requests.map((x) => x.method)).toEqual(['PUT', 'POST']);
    expect(await status(t.admin, id)).toMatchObject({
      state: 'live',
      failedStep: null,
      lastError: null,
      publishVersion: 1,
    });
  });

  it('a failed publish-bot after a good update names the publish step, and Retry resumes at publish-bot without repeating the update', async () => {
    await configure(t.admin);
    stub.setDefault('publish', { status: 400, body: '{"detail":"bot not found"}' });
    const id = await createFlow(t.admin, 'Publish fails');
    await publish(t.admin, id);
    await drain();

    const s = await status(t.admin, id);
    expect(s).toMatchObject({ state: 'failed', failedStep: 'publish_bot' });
    expect(s.lastError).toBe('Geta answered 400: {"detail":"bot not found"} (publish)');
    expect(stub.calls('update')).toHaveLength(1);
    expect(stub.calls('publish')).toHaveLength(1); // a 400 is never retried

    stub.reset();
    const r = await retry(t.admin, id);
    expect(r.body).toMatchObject({ state: 'pending', step: 'publish_bot' });
    await drain();
    expect(stub.calls('update')).toHaveLength(0);
    expect(stub.calls('publish')).toHaveLength(1);
    expect(stub.calls('publish')[0]!.headers.appid).toBe(`{"botid":"${BOT_ID}"}`);
    expect((await status(t.admin, id)).state).toBe('live');
  });

  it('a retry that fails again stays failed with the new reason', async () => {
    await configure(t.admin);
    stub.setDefault('publish', { status: 403, body: 'forbidden' });
    const id = await createFlow(t.admin, 'Fails twice');
    await publish(t.admin, id);
    await drain();
    stub.setDefault('publish', { status: 401, body: 'expired' });
    await retry(t.admin, id);
    await drain();
    const s = await status(t.admin, id);
    expect(s).toMatchObject({ state: 'failed', failedStep: 'publish_bot' });
    expect(s.lastError).toContain('401');
  });

  it('refuses a retry for a draft, a push in progress and a flow already live (409)', async () => {
    await configure(t.admin);
    const id = await createFlow(t.admin, 'Retry rules');
    const draft = await retry(t.admin, id);
    expect(draft.status).toBe(409);
    expect(draft.body.code).toBe('FLB_GETA_NOT_RETRYABLE');
    await publish(t.admin, id);
    const pending = await retry(t.admin, id);
    expect(pending.status).toBe(409);
    await drain();
    const live = await retry(t.admin, id);
    expect(live.status).toBe(409);
    expect(live.body.code).toBe('FLB_GETA_NOT_RETRYABLE');
  });

  it('a published flow that was never pushed (credentials added afterwards) can be pushed with the same endpoint', async () => {
    await clearAll(t.admin);
    const id = await createFlow(t.admin, 'Late setup');
    await publish(t.admin, id);
    expect((await status(t.admin, id)).state).toBe('not_configured');
    await configure(t.admin);
    expect((await status(t.admin, id)).state).toBe('none');
    const r = await retry(t.admin, id);
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('pending');
    await drain();
    expect((await status(t.admin, id)).state).toBe('live');
  });

  it('credentials removed between publish and the worker: failed with a clear reason, no call made', async () => {
    await configure(t.admin);
    const id = await createFlow(t.admin, 'Removed meanwhile');
    await publish(t.admin, id);
    await clearAll(t.admin);
    await drain();
    const s = await status(t.admin, id);
    expect(s.state).toBe('failed');
    expect(s.lastError).toBe('Geta publishing is no longer set up for this workspace.');
    expect(stub.requests).toHaveLength(0);
  });

  it('a console that cannot be reached ends failed with a sanitised reason, not an error', async () => {
    await saveSettings(t.admin, {
      baseUrl: 'http://127.0.0.1:1',
      authorization: FAKE_AUTH,
      getaHost: FAKE_HOST,
      chatbotRecord: JSON.stringify(record()),
    });
    const id = await createFlow(t.admin, 'Unreachable');
    await publish(t.admin, id);
    await drain();
    const s = await status(t.admin, id);
    expect(s).toMatchObject({ state: 'failed', failedStep: 'configuration_update' });
    expect(s.lastError).toMatch(/^Could not reach Geta: /);
    await configure(t.admin);
  });
});

describe('per-flow chatbot record', () => {
  it('replaces the workspace record for that flow only (chatbot id in the path, bot id in appid)', async () => {
    await configure(t.admin);
    const ownBot = '00000000-0000-4000-8000-0000000000f1';
    const mine = await createFlow(t.admin, 'With override');
    const plain = await createFlow(t.admin, 'Without override');
    const set = await api
      .as(t.admin)
      .put(`/v2/flows/${mine}/publish-sync/chatbot`)
      .send({
        chatbotRecord: JSON.stringify(record({ id: 'flowBot9', bot_id: ownBot, name: 'Flow bot' })),
      });
    expect(set.status).toBe(200);
    expect(set.body.chatbotOverride).toEqual({ id: 'flowBot9', name: 'Flow bot', botId: ownBot });
    expect(JSON.stringify(set.body)).not.toContain(BUSINESS_ID);

    await publish(t.admin, mine);
    await drain();
    expect(stub.requests[0]!.path).toBe('/api/v1/chatbot/flowBot9/configuration/update/');
    expect(stub.requests[1]!.headers.appid).toBe(`{"botid":"${ownBot}"}`);
    expect((await status(t.admin, mine)).botId).toBe(ownBot);

    stub.reset();
    await publish(t.admin, plain);
    await drain();
    expect(stub.requests[0]!.path).toBe(`/api/v1/chatbot/${CHATBOT_ID}/configuration/update/`);
    expect(stub.requests[1]!.headers.appid).toBe(`{"botid":"${BOT_ID}"}`);

    const removed = await api
      .as(t.admin)
      .put(`/v2/flows/${mine}/publish-sync/chatbot`)
      .send({ chatbotRecord: null });
    expect(removed.body.chatbotOverride).toBeNull();
  });

  it('a flow with its own record needs only the workspace base URL and tokens', async () => {
    await configure(t.admin);
    await saveSettings(t.admin, { chatbotRecord: null });
    const id = await createFlow(t.admin, 'Own record only');
    await api
      .as(t.admin)
      .put(`/v2/flows/${id}/publish-sync/chatbot`)
      .send({ chatbotRecord: JSON.stringify(record({ id: 'flowBot7', bot_id: 'own-bot-7' })) });
    const pub = await publish(t.admin, id);
    expect(pub.getaSync.state).toBe('pending');
    await drain();
    expect((await status(t.admin, id)).state).toBe('live');
    await configure(t.admin);
  });
});

describe('permissions and tenant isolation', () => {
  it('settings need flb.geta.manage; publish and retry keep the publish permission; reading needs flb.flows.read', async () => {
    await configure(t.admin);
    const editor = await api.member(t, 'editor', ADMINISH);
    const manager = await api.member(t, 'mgr', [['flb.geta.manage']]);
    const reader = await api.member(t, 'reader', [['flb.flows.read']]);
    const id = await createFlow(t.admin, 'Permissions');

    // an editor with every flow key but not the manage key cannot touch the credentials
    expect((await api.as(editor.token).get('/v2/flows/geta-publish/settings')).status).toBe(403);
    expect((await saveSettings(editor.token, { origin: null })).status).toBe(403);
    expect((await api.as(editor.token).delete('/v2/flows/geta-publish/settings')).status).toBe(403);
    expect(
      (
        await api
          .as(editor.token)
          .put(`/v2/flows/${id}/publish-sync/chatbot`)
          .send({ chatbotRecord: null })
      ).status,
    ).toBe(403);
    // the manager can, but cannot publish or retry
    expect((await api.as(manager.token).get('/v2/flows/geta-publish/settings')).status).toBe(200);
    expect((await api.as(manager.token).post(`/v2/flows/${id}/publish`).send({})).status).toBe(403);
    expect((await retry(manager.token, id)).status).toBe(403);
    // a reader sees the state but cannot retry
    expect((await api.as(reader.token).get(`/v2/flows/${id}/publish-sync`)).status).toBe(200);
    expect((await retry(reader.token, id)).status).toBe(403);
    // the editor publishes (rides the existing key)
    expect((await api.as(editor.token).post(`/v2/flows/${id}/publish`).send({})).status).toBe(200);
  });

  it("another workspace cannot read, retry or override this workspace's flow state, and has its own empty settings", async () => {
    await configure(t.admin);
    const id = await createFlow(t.admin, 'Tenant A flow');
    await publish(t.admin, id);
    await drain();

    expect((await api.as(other.admin).get(`/v2/flows/${id}/publish-sync`)).status).toBe(404);
    expect((await retry(other.admin, id)).status).toBe(404);
    expect(
      (
        await api
          .as(other.admin)
          .put(`/v2/flows/${id}/publish-sync/chatbot`)
          .send({ chatbotRecord: null })
      ).status,
    ).toBe(404);
    const theirs = await api.as(other.admin).get('/v2/flows/geta-publish/settings');
    expect(theirs.body).toMatchObject({
      baseUrl: null,
      authorizationSet: false,
      chatbot: null,
      configured: false,
    });

    // their publish uses no credentials of ours
    stub.reset();
    const theirFlow = await createFlow(other.admin, 'Tenant B flow');
    const pub = await publish(other.admin, theirFlow);
    expect(pub.getaSync.state).toBe('not_configured');
    await drain();
    expect(stub.requests).toHaveLength(0);

    // and their settings never touch ours
    await saveSettings(other.admin, { baseUrl: stub.url });
    const mine = await api.as(t.admin).get('/v2/flows/geta-publish/settings');
    expect(mine.body.authorizationSet).toBe(true);
    const rows = await h.owner.query(
      `SELECT org_id FROM flb_geta_publish_settings ORDER BY org_id`,
    );
    expect(rows.rows.map((r) => Number(r.org_id))).toEqual(
      [t.orgId, other.orgId].sort((a, b) => a - b),
    );
  });

  it('two workspaces publishing at once each use their own credentials', async () => {
    await configure(t.admin);
    const bBot = '00000000-0000-4000-8000-0000000000b2';
    await saveSettings(other.admin, {
      baseUrl: stub.url,
      authorization: 'fake-auth-token-OTHER9999',
      getaHost: 'fake-geta-host-OTHER8888',
      chatbotRecord: JSON.stringify(record({ id: 'otherBot', bot_id: bBot })),
    });
    const a = await createFlow(t.admin, 'A');
    const b = await createFlow(other.admin, 'B');
    await publish(t.admin, a);
    await publish(other.admin, b);
    await drain();
    const byBot = new Map(stub.calls('publish').map((r) => [r.headers.appid as string, r]));
    expect(byBot.get(`{"botid":"${BOT_ID}"}`)!.headers.authorization).toBe(FAKE_AUTH);
    expect(byBot.get(`{"botid":"${bBot}"}`)!.headers.authorization).toBe(
      'fake-auth-token-OTHER9999',
    );
    await saveSettings(other.admin, { baseUrl: null });
  });

  it('deleting a flow removes its sync row', async () => {
    await configure(t.admin);
    const id = await createFlow(t.admin, 'Deleted');
    await publish(t.admin, id);
    expect((await api.as(t.admin).delete(`/v2/flows/${id}`)).status).toBe(204);
    const left = await h.owner.query(
      `SELECT count(*)::int AS n FROM flb_geta_publish_syncs s LEFT JOIN flows f ON f.org_id = s.org_id AND f.id = s.flow_id WHERE f.id IS NULL`,
    );
    expect(left.rows[0].n).toBe(0);
  });
});
