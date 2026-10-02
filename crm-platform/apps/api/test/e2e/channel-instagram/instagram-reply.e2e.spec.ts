import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  INSTAGRAM_BRIDGE,
  type BridgeFlow,
  type BridgeReply,
  type BridgeResult,
  type InstagramBridgeFactory,
} from '../../../src/infra/providers/channel-instagram/instagram-bridge.port';
import { PlatformSettingsService } from '../../../src/modules/auth';
import { SenderService } from '../../../src/modules/channel-instagram/sender.service';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/** Replying on an Instagram thread and running an engine flow (WD-IG-010, 012), against a real Postgres and a fake engine. */
let h: Harness;
let api: Api;
let settings: PlatformSettingsService;
let sender: SenderService;

const sent: Array<{ thread: string; reply: BridgeReply }> = [];
const ran: Array<{ thread: string; flow: number }> = [];
let replyAnswer: BridgeResult<{ messageId: string | null }> = {
  ok: true,
  data: { messageId: 'mid-1' },
};
let runAnswer: BridgeResult<null> = { ok: true, data: null };
let flowsByAccount: Record<string, BridgeFlow[]> = {};

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  settings = h.app.get(PlatformSettingsService);
  sender = h.app.get(SenderService);
  const bridge = h.app.get<InstagramBridgeFactory>(INSTAGRAM_BRIDGE);
  bridge.with = () => ({
    accounts: (q) =>
      Promise.resolve(
        q.workspace !== undefined
          ? [
              { id: 'A1', username: 'shop', name: 'Shop', avatar: '', connected: true },
              { id: 'A2', username: 'shop2', name: 'Shop 2', avatar: '', connected: true },
            ]
          : [],
      ),
    conversations: () => Promise.resolve([]),
    messages: () => Promise.resolve([]),
    reply: (thread, reply) => {
      sent.push({ thread, reply });
      return Promise.resolve(replyAnswer);
    },
    flows: (account) => Promise.resolve(flowsByAccount[account] ?? []),
    runFlow: (thread, flow) => {
      ran.push({ thread, flow });
      return Promise.resolve(runAnswer);
    },
    connectStart: () => Promise.resolve({ ok: true, data: { url: 'https://engine.test/x' } }),
  });
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

async function engine(on: boolean): Promise<void> {
  await settings.mergeMember(
    'addons.engines',
    'instagram',
    { url: on ? 'https://engine.test/' : '', brand: 'IgDesk', connected: on },
    null,
  );
  if (on) await settings.setSecret('addons.engine.instagram.secret', 's3cret', null);
  else await settings.clearSecret('addons.engine.instagram.secret');
}

beforeEach(async () => {
  sent.length = 0;
  ran.length = 0;
  replyAnswer = { ok: true, data: { messageId: 'mid-1' } };
  runAnswer = { ok: true, data: null };
  flowsByAccount = {};
  await engine(true);
});

async function thread(t: Tenant, channel: string, key: string): Promise<string> {
  const c = await h.owner.query(
    `INSERT INTO conversations (org_id, title, channel, provider, origin, status, inbox_status, raw_jid, last_message_at)
     VALUES ($1, 'T', $2, $2, $2, 'pending', 'open', $3, now()) RETURNING uuid`,
    [t.orgId, channel, key],
  );
  return c.rows[0].uuid as string;
}

const link = (t: Tenant, id: string) =>
  api.http().post('/v2/instagram/accounts').set(bearer(t.admin)).send({ instaflowAccountId: id });

describe('the reply sender (WD-IG-010)', () => {
  it('sends text to the engine thread named by the key and returns the engine’s message id', async () => {
    const out = await sender.reply({ rawJid: 'ig:A1_555', text: 'hello' });
    expect(out).toEqual({ ok: true, providerMessageId: 'mid-1', error: null });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ thread: 'A1_555', reply: { type: 'text', text: 'hello' } });
  });

  it('shapes template buttons and attachments', async () => {
    await sender.reply({
      rawJid: 'ig:A1_555',
      text: 'pick',
      buttons: [{ text: 'Yes' }, { text: 'Site', url: 'https://x.test' }],
    });
    expect(sent[0]!.reply.type).toBe('buttons');
    await sender.reply({
      rawJid: 'ig:A1_555',
      text: '',
      media: { type: 'image', path: 'https://cdn.test/p.jpg' },
    });
    expect(sent[1]!.reply).toMatchObject({
      type: 'image',
      mediaUrl: 'https://cdn.test/p.jpg',
      text: null,
    });
  });

  it('says why when it cannot send, and never throws', async () => {
    expect((await sender.reply({ rawJid: null, text: 'x' })).error).toBe(
      'This Instagram thread has no IgDesk conversation id.',
    );
    expect(
      (
        await sender.reply({
          rawJid: 'ig:A1_5',
          text: 'x',
          media: { type: 'image', path: 'uploads/p.jpg' },
        })
      ).error,
    ).toContain('no public address');
    replyAnswer = { ok: false, error: 'Outside the 24 hour window', status: 400 };
    expect(await sender.reply({ rawJid: 'ig:A1_5', text: 'x' })).toEqual({
      ok: false,
      providerMessageId: null,
      error: 'IgDesk HTTP 400: Outside the 24 hour window',
    });
    await engine(false);
    const off = await sender.reply({ rawJid: 'ig:A1_5', text: 'x' });
    expect(off.ok).toBe(false);
    expect(off.error).toContain('connect IgDesk in Admin');
  });
});

describe('the flows list (WD-IG-012)', () => {
  it('lists each flow of the linked accounts once, with where to author more', async () => {
    const t = await api.signup('igfa');
    await link(t, 'A1');
    await link(t, 'A2');
    flowsByAccount = {
      A1: [
        { id: 1, name: 'Welcome' },
        { id: 2, name: '' },
      ],
      A2: [
        { id: 2, name: 'dup' },
        { id: 3, name: 'Promo' },
      ],
    };
    const res = await api.http().get('/v2/instagram/flows').set(bearer(t.admin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.flows).toEqual([
      { id: 1, name: 'Welcome' },
      { id: 2, name: 'Flow #2' },
      { id: 3, name: 'Promo' },
    ]);
    expect(res.body.authorUrl).toBe('https://engine.test/instagram/flows');
  });

  it('is empty with no linked account or no engine', async () => {
    const t = await api.signup('igfb');
    flowsByAccount = { A1: [{ id: 1, name: 'Welcome' }] };
    expect((await api.http().get('/v2/instagram/flows').set(bearer(t.admin))).body).toEqual({
      flows: [],
      authorUrl: null,
    });
    await link(t, 'A1');
    await engine(false);
    expect((await api.http().get('/v2/instagram/flows').set(bearer(t.admin))).body).toEqual({
      flows: [],
      authorUrl: null,
    });
  });
});

describe('run a flow on a thread (WD-IG-012)', () => {
  const run = (t: Tenant, id: string, flowId: unknown = 5) =>
    api
      .http()
      .post(`/v2/instagram/conversations/${id}/run-flow`)
      .set(bearer(t.admin))
      .send({ flowId });

  it('starts the flow on the engine thread', async () => {
    const t = await api.signup('igra');
    const id = await thread(t, 'instagram', 'ig:A1_555');
    const res = await run(t, id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(ran).toEqual([{ thread: 'A1_555', flow: 5 }]);
  });

  it('refuses a thread that is not Instagram, one with no engine id, an unknown one and another organization’s', async () => {
    const t = await api.signup('igrb');
    const other = await api.signup('igrc');
    const wa = await thread(t, 'whatsapp', 'wa:1');
    const empty = await thread(t, 'instagram', 'ig:');
    const foreign = await thread(other, 'instagram', 'ig:A1_9');
    expect((await run(t, wa)).body.code).toBe('IG_NOT_AN_INSTAGRAM_THREAD');
    expect((await run(t, empty)).body.code).toBe('IG_THREAD_NO_ENGINE_ID');
    expect((await run(t, foreign)).status).toBe(404);
    expect((await run(t, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect(ran).toHaveLength(0);
  });

  it('turns the engine’s refusal into a 502 with its words, and an off engine into a 422', async () => {
    const t = await api.signup('igrd');
    const id = await thread(t, 'instagram', 'ig:A1_555');
    runAnswer = { ok: false, error: 'flow is not published', status: 409 };
    const bad = await run(t, id);
    expect(bad.status).toBe(502);
    expect(bad.body.code).toBe('IG_FLOW_RUN_FAILED');
    expect(JSON.stringify(bad.body)).toContain('IgDesk HTTP 409: flow is not published');
    await engine(false);
    const off = await run(t, id);
    expect(off.status).toBe(422);
    expect(off.body.code).toBe('IG_NOT_CONNECTED');
  });

  it('needs the ig.flows.run permission and a whole positive flow id', async () => {
    const t = await api.signup('igre');
    const id = await thread(t, 'instagram', 'ig:A1_555');
    const viewer = await api.member(t, 'viewer', [['ig.accounts.read']]);
    const denied = await api
      .http()
      .post(`/v2/instagram/conversations/${id}/run-flow`)
      .set(bearer(viewer.token))
      .send({ flowId: 5 });
    expect(denied.status).toBe(403);
    expect((await run(t, id, 0)).status).toBe(400);
    expect((await run(t, id, 'abc')).status).toBe(400);
  });
});
