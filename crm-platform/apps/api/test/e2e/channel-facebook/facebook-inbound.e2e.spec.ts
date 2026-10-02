import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  FACEBOOK_GRAPH,
  type FacebookGraphFactory,
  type FacebookPageApi,
  type GraphConversation,
  type GraphMessage,
} from '../../../src/infra/providers/channel-facebook/facebook.port';
import {
  INBOUND_HOOKS,
  type InboundHooks,
} from '../../../src/modules/channel-facebook/_shims/tokens';
import { BackfillService } from '../../../src/modules/channel-facebook/backfill.service';
import { SenderService } from '../../../src/modules/channel-facebook/sender.service';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/** The Facebook webhook, the inbox writes, the backfill and the reply (TW-FB-006 to 011), against a real Postgres and a fake Meta. */
let h: Harness;
let api: Api;

const handed: Array<{ kind: string; ctx: Record<string, unknown> }> = [];
let consume = false;
const sent: Array<{ method: string; args: unknown[] }> = [];
let override: Partial<FacebookPageApi> = {};
let conversations: GraphConversation[] = [];
let history: Record<string, GraphMessage[]> = {};

const defaults = (): FacebookPageApi => ({
  getProfile: () => Promise.resolve({ ok: true, data: { id: 'P1' } }),
  subscribeWebhooks: () => Promise.resolve({ ok: true }),
  unsubscribeWebhooks: () => Promise.resolve({ ok: true }),
  sendText: (psid, text) => {
    sent.push({ method: 'sendText', args: [psid, text] });
    return Promise.resolve({ ok: true, data: { messageId: 'mid.out' } });
  },
  sendAttachment: (psid, type, url) => {
    sent.push({ method: 'sendAttachment', args: [psid, type, url] });
    return Promise.resolve({ ok: true, data: { messageId: 'mid.att' } });
  },
  sendButtonTemplate: () => Promise.resolve({ ok: true, data: { messageId: 'mid.btn' } }),
  getMessengerProfile: () => Promise.resolve({}),
  setMessengerProfile: () => Promise.resolve({ ok: true }),
  deleteMessengerProfile: () => Promise.resolve({ ok: true }),
  replyComment: (id, text) => {
    sent.push({ method: 'replyComment', args: [id, text] });
    return Promise.resolve({ ok: true, data: { id: 'c.reply' } });
  },
  getSenderProfile: () => Promise.resolve({ name: 'Asha Rao', profile_pic: 'https://x/asha.jpg' }),
  getComment: () => Promise.resolve({ message: 'fetched text' }),
  listConversations: () => Promise.resolve(conversations),
  getConversationMessages: (id) => Promise.resolve(history[id] ?? []),
});

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  const graph = h.app.get<FacebookGraphFactory>(FACEBOOK_GRAPH);
  Object.assign(graph.settings, { verifyToken: 'vt', signingSecrets: [] });
  graph.forPage = () => ({ ...defaults(), ...override });
  const hooks = h.app.get<InboundHooks>(INBOUND_HOOKS);
  hooks.handoffToFlow = (ctx) => {
    handed.push({
      kind: ctx.postback ? 'postback' : 'flow',
      ctx: ctx as unknown as Record<string, unknown>,
    });
    return Promise.resolve(consume);
  };
  hooks.automate = (ctx) => {
    handed.push({ kind: 'automate', ctx: ctx as unknown as Record<string, unknown> });
    return Promise.resolve();
  };
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  handed.length = 0;
  sent.length = 0;
  consume = false;
  override = {};
  conversations = [];
  history = {};
  Object.assign(h.app.get<FacebookGraphFactory>(FACEBOOK_GRAPH).settings, { signingSecrets: [] });
});

/** A connected Page row for the tenant, its token sealed the way the app seals it. */
async function connect(t: Tenant, pageId = 'P1', status = 'connected'): Promise<number> {
  const token = h.app.get(CryptoService).encrypt(`tok-${pageId}`);
  const r = await h.owner.query(
    `INSERT INTO facebook_pages (org_id, page_id, name, access_token, status) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [t.orgId, pageId, `Page ${pageId}`, token, status],
  );
  return Number(r.rows[0].id);
}

const post = (body: unknown, secret?: string) => {
  const raw = JSON.stringify(body);
  const req = api.http().post('/v2/facebook/webhook').set('content-type', 'application/json');
  if (secret)
    req.set(
      'x-hub-signature-256',
      `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`,
    );
  return req.send(raw);
};

const entry = (extra: object, pageId = 'P1') => ({
  object: 'page',
  entry: [{ id: pageId, ...extra }],
});
const dm = (mid: string, text: string, extra: object = {}) =>
  entry({
    messaging: [
      { sender: { id: '555' }, timestamp: 1_700_000_000_000, message: { mid, text, ...extra } },
    ],
  });
const comment = (id: string, over: object = {}) =>
  entry({
    changes: [
      {
        field: 'feed',
        value: {
          item: 'comment',
          verb: 'add',
          comment_id: id,
          post_id: 'P1_77',
          from: { id: '777', name: 'Ravi' },
          message: 'nice post',
          ...over,
        },
      },
    ],
  });

const convs = async (t: Tenant) =>
  (
    await h.owner.query(
      `SELECT * FROM conversations WHERE org_id = $1 AND channel = 'facebook' ORDER BY id`,
      [t.orgId],
    )
  ).rows;
const msgs = async (t: Tenant) =>
  (
    await h.owner.query(
      `SELECT * FROM messages WHERE org_id = $1 AND provider = 'facebook' ORDER BY id`,
      [t.orgId],
    )
  ).rows;
const contacts = async (t: Tenant) =>
  (
    await h.owner.query(`SELECT * FROM contacts WHERE org_id = $1 AND channel = 'facebook'`, [
      t.orgId,
    ])
  ).rows;

describe('TW-FB-006: the webhook door', () => {
  it('the handshake echoes the challenge only for subscribe with the right token', async () => {
    const ok = await api
      .http()
      .get('/v2/facebook/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'vt', 'hub.challenge': 'abc123' });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('abc123');
    const bad = await api
      .http()
      .get('/v2/facebook/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': 'abc123' });
    expect(bad.status).toBe(403);
  });

  it('with a secret configured a bad or missing signature is refused and writes nothing; a good one is accepted', async () => {
    const t = await api.signup('fi1');
    await connect(t);
    Object.assign(h.app.get<FacebookGraphFactory>(FACEBOOK_GRAPH).settings, {
      signingSecrets: ['s3cret'],
    });
    expect((await post(dm('m1', 'hi'))).status).toBe(403);
    expect((await post(dm('m1', 'hi'), 'wrong')).status).toBe(403);
    expect(await msgs(t)).toHaveLength(0);
    expect((await post(dm('m1', 'hi'), 's3cret')).status).toBe(200);
    expect(await msgs(t)).toHaveLength(1);
  });

  it('with no secret configured an unsigned event is still accepted (Reference behaviour)', async () => {
    const t = await api.signup('fi2');
    await connect(t);
    expect((await post(dm('m1', 'hi'))).status).toBe(200);
    expect(await msgs(t)).toHaveLength(1);
  });

  it('another object, an unknown Page and a disconnected Page answer 200 and write nothing', async () => {
    const t = await api.signup('fi3');
    await connect(t, 'P1', 'expired');
    expect((await post({ object: 'instagram', entry: [] })).status).toBe(200);
    expect((await post(dm('m1', 'hi'))).status).toBe(200);
    expect((await post(dm('m2', 'hi'), undefined)).status).toBe(200);
    expect((await post(entry({ messaging: [] }, 'UNKNOWN'))).status).toBe(200);
    expect(await msgs(t)).toHaveLength(0);
  });

  it('one webhook for a Page connected in two organizations reaches both', async () => {
    const a = await api.signup('fi4');
    const b = await api.signup('fi5');
    await connect(a);
    await connect(b);
    expect((await post(dm('m1', 'hi'))).status).toBe(200);
    expect(await msgs(a)).toHaveLength(1);
    expect(await msgs(b)).toHaveLength(1);
  });
});

describe('TW-FB-007, 008: a Messenger message', () => {
  it('the first message makes the thread, the contact and the message, and learns the sender’s name', async () => {
    const t = await api.signup('fi6');
    await connect(t);
    expect((await post(dm('m1', 'hello there'))).status).toBe(200);

    const [c] = await convs(t);
    expect(c).toMatchObject({
      raw_jid: 'fb:P1:555',
      provider: 'facebook',
      origin: 'facebook',
      status: 'pending',
      inbox_status: 'open',
      title: 'Asha Rao',
      unread_count: 1,
      preview: 'hello there',
    });
    expect(c.routing_meta).toMatchObject({ fb_avatar: 'https://x/asha.jpg' });
    const [m] = await msgs(t);
    expect(m).toMatchObject({
      direction: 'in',
      body: 'hello there',
      status: 'received',
      from_number: '555',
    });
    expect(m.meta.facebook).toMatchObject({ message_id: 'm1', psid: '555', kind: 'dm' });
    expect(new Date(m.sent_at as string).getTime()).toBe(1_700_000_000_000);
    const [ct] = await contacts(t);
    expect(ct).toMatchObject({
      channel_uid: '555',
      name: 'Asha Rao',
      message: 'Source: Facebook DM',
    });
    expect(c.contact_id).toBe(ct.id);
  });

  it('a redelivery of the same message id is dropped; a new one joins the thread and counts unread', async () => {
    const t = await api.signup('fi7');
    await connect(t);
    await post(dm('m1', 'hello'));
    await post(dm('m1', 'hello'));
    await post(dm('m2', 'again'));
    expect(await convs(t)).toHaveLength(1);
    expect(await msgs(t)).toHaveLength(2);
    expect((await convs(t))[0].unread_count).toBe(2);
    expect(await contacts(t)).toHaveLength(1);
  });

  it('two deliveries at once make one thread and one message', async () => {
    const t = await api.signup('fi8');
    await connect(t);
    await Promise.all([post(dm('m1', 'hello')), post(dm('m1', 'hello'))]);
    expect(await convs(t)).toHaveLength(1);
    expect(await msgs(t)).toHaveLength(1);
  });

  it('a resolved thread reopens on the next message', async () => {
    const t = await api.signup('fi9');
    await connect(t);
    await post(dm('m1', 'hello'));
    await h.owner.query(`UPDATE conversations SET inbox_status = 'resolved' WHERE org_id = $1`, [
      t.orgId,
    ]);
    await post(dm('m2', 'still there?'));
    expect((await convs(t))[0].inbox_status).toBe('open');
  });

  it('a photo keeps its address and type; echoes and receipts are ignored', async () => {
    const t = await api.signup('fi10');
    await connect(t);
    await post(
      dm('m1', '', { attachments: [{ type: 'image', payload: { url: 'https://x/a.jpg' } }] }),
    );
    await post(dm('m2', 'ours', { is_echo: true }));
    await post(entry({ messaging: [{ sender: { id: '555' }, delivery: { mids: ['m1'] } }] }));
    const all = await msgs(t);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ media_path: 'https://x/a.jpg', media_type: 'image' });
  });

  it('a flow gets the message first; only when it does not consume it does automation run', async () => {
    const t = await api.signup('fi11');
    await connect(t);
    await post(dm('m1', 'hello'));
    expect(handed.map((x) => x.kind)).toEqual(['flow', 'automate']);
    expect(handed[0]!.ctx).toMatchObject({
      pageId: 'P1',
      psid: '555',
      text: 'hello',
      newThread: true,
      postback: false,
    });

    handed.length = 0;
    consume = true;
    await post(dm('m2', 'order'));
    expect(handed.map((x) => x.kind)).toEqual(['flow']);
  });

  it('a button tap goes to the flow runtime and is never stored', async () => {
    const t = await api.signup('fi12');
    await connect(t);
    await post(
      entry({
        messaging: [
          { sender: { id: '555' }, postback: { payload: 'GET_STARTED', title: 'Start' } },
        ],
      }),
    );
    expect(handed).toHaveLength(1);
    expect(handed[0]).toMatchObject({
      kind: 'postback',
      ctx: { psid: '555', text: 'GET_STARTED', conversationId: null },
    });
    expect(await msgs(t)).toHaveLength(0);
    expect(await convs(t)).toHaveLength(0);
  });
});

describe('TW-FB-009: a comment on a post', () => {
  it('makes a thread per post and commenter, with no contact and no automation', async () => {
    const t = await api.signup('fi13');
    await connect(t);
    await post(comment('c1'));
    await post(comment('c2', { from: { id: '888', name: 'Mina' }, message: 'me too' }));
    const all = await convs(t);
    expect(all.map((c) => c.raw_jid)).toEqual(['fb:P1:post:P1_77:777', 'fb:P1:post:P1_77:888']);
    expect(all[0].title).toBe('Ravi');
    expect((await msgs(t))[0].meta.facebook).toMatchObject({
      comment_id: 'c1',
      post_id: 'P1_77',
      from_id: '777',
      from_name: 'Ravi',
      kind: 'comment',
    });
    expect(await contacts(t)).toHaveLength(0);
    expect(handed).toHaveLength(0);
  });

  it('a redelivery is dropped before any Graph call; a comment with no text is fetched; the Page’s own comment is ignored', async () => {
    const t = await api.signup('fi14');
    await connect(t);
    let fetched = 0;
    override = {
      getComment: () => {
        fetched += 1;
        return Promise.resolve({ message: 'fetched text' });
      },
    };
    await post(comment('c1', { message: '' }));
    await post(comment('c1', { message: '' }));
    expect(fetched).toBe(1);
    expect((await msgs(t))[0].body).toBe('fetched text');

    override = { getComment: () => Promise.resolve(null) };
    await post(comment('c2', { message: '' }));
    expect((await msgs(t)).map((m) => m.body)).toEqual(['fetched text', '[comment]']);

    await post(comment('c3', { from: { id: 'P1', name: 'Page P1' } }));
    expect(await msgs(t)).toHaveLength(2);
  });
});

describe('TW-FB-010: history backfill', () => {
  it('imports the customer’s past messages oldest first, never answers them, and is safe to repeat', async () => {
    const t = await api.signup('fi15');
    const pageRowId = await connect(t);
    conversations = [
      { id: 't_1', participants: { data: [{ id: 'P1' }, { id: '555' }] } },
      { id: 't_2' },
    ];
    history = {
      t_1: [
        {
          id: 'h3',
          message: 'newest',
          created_time: '2026-01-03T00:00:00+0000',
          from: { id: '555' },
        },
        {
          id: 'h2',
          message: 'our reply',
          created_time: '2026-01-02T00:00:00+0000',
          from: { id: 'P1' },
        },
        {
          id: 'h1',
          message: 'oldest',
          created_time: '2026-01-01T00:00:00+0000',
          from: { id: '555' },
        },
      ],
      t_2: [],
    };
    const svc = h.app.get(BackfillService);
    const first = await svc.run(t.orgId, pageRowId);
    expect(first).toMatchObject({ threads: 1, messages: 2 });
    expect((await msgs(t)).map((m) => m.body)).toEqual(['oldest', 'newest']);
    expect((await convs(t))[0].raw_jid).toBe('fb:P1:555');
    expect(new Date((await convs(t))[0].last_message_at as string).toISOString()).toBe(
      '2026-01-03T00:00:00.000Z',
    );
    expect(handed).toHaveLength(0);

    const again = await svc.run(t.orgId, pageRowId);
    expect(again).toMatchObject({ threads: 0, messages: 0 });
    expect(await msgs(t)).toHaveLength(2);
  });

  it('a live message after the import joins the same thread and an old import never drags the clock back', async () => {
    const t = await api.signup('fi16');
    const pageRowId = await connect(t);
    await post(dm('live1', 'live now'));
    const live = new Date((await convs(t))[0].last_message_at as string).getTime();
    conversations = [{ id: 't_1', participants: { data: [{ id: '555' }] } }];
    history = {
      t_1: [
        {
          id: 'old1',
          message: 'ancient',
          created_time: '2020-01-01T00:00:00+0000',
          from: { id: '555' },
        },
      ],
    };
    await h.app.get(BackfillService).run(t.orgId, pageRowId);
    expect(await convs(t)).toHaveLength(1);
    expect(new Date((await convs(t))[0].last_message_at as string).getTime()).toBe(live);
  });
});

describe('TW-FB-011: replying through the Page', () => {
  it('a DM goes out through the Page named in the thread key', async () => {
    const t = await api.signup('fi17');
    await connect(t);
    const out = await h.app
      .get(SenderService)
      .reply(t.orgId, { rawJid: 'fb:P1:555', text: 'Thanks!' });
    expect(out).toEqual({ ok: true, providerMessageId: 'mid.out', error: null });
    expect(sent).toEqual([{ method: 'sendText', args: ['555', 'Thanks!'] }]);
  });

  it('a file goes first and its text follows as its own message; a file with no public address is refused', async () => {
    const t = await api.signup('fi18');
    await connect(t);
    const svc = h.app.get(SenderService);
    const ok = await svc.reply(t.orgId, {
      rawJid: 'fb:P1:555',
      text: 'See this',
      media: { type: 'image', path: 'https://x/a.jpg' },
    });
    expect(ok.ok).toBe(true);
    expect(sent.map((s) => s.method)).toEqual(['sendAttachment', 'sendText']);
    expect(sent[0]!.args).toEqual(['555', 'image', 'https://x/a.jpg']);
    sent.length = 0;
    const bad = await svc.reply(t.orgId, {
      rawJid: 'fb:P1:555',
      text: 'x',
      media: { type: 'image', path: 'stored/a.jpg' },
    });
    expect(bad).toEqual({
      ok: false,
      providerMessageId: null,
      error: 'The file could not be reached.',
    });
    expect(sent).toHaveLength(0);
  });

  it('a comment thread is answered in public under that thread’s latest comment', async () => {
    const t = await api.signup('fi19');
    await connect(t);
    await post(comment('c1'));
    await post(comment('c2', { message: 'second' }));
    const out = await h.app
      .get(SenderService)
      .reply(t.orgId, { rawJid: 'fb:P1:post:P1_77:777', text: 'Thank you' });
    expect(out.ok).toBe(true);
    expect(sent).toEqual([{ method: 'replyComment', args: ['c2', 'Thank you'] }]);
  });

  it('a thread that is not Facebook, a Page that is gone and a refusal come back as ok = false; a revoked token flags the Page', async () => {
    const t = await api.signup('fi20');
    await connect(t);
    const svc = h.app.get(SenderService);
    expect((await svc.reply(t.orgId, { rawJid: 'tg:1:2', text: 'x' })).error).toBe(
      'Not a Facebook thread.',
    );
    expect((await svc.reply(t.orgId, { rawJid: 'fb:OTHER:555', text: 'x' })).error).toBe(
      'Facebook Page not connected',
    );

    override = {
      sendText: () => Promise.resolve({ ok: false, error: 'outside window', code: 10 }),
    };
    expect(await svc.reply(t.orgId, { rawJid: 'fb:P1:555', text: 'x' })).toEqual({
      ok: false,
      providerMessageId: null,
      error: 'outside window',
    });
    expect(
      (await h.owner.query(`SELECT status FROM facebook_pages WHERE org_id = $1`, [t.orgId]))
        .rows[0].status,
    ).toBe('connected');

    override = {
      sendText: () =>
        Promise.resolve({ ok: false, error: 'Error validating access token', code: 190 }),
    };
    await svc.reply(t.orgId, { rawJid: 'fb:P1:555', text: 'x' });
    expect(
      (await h.owner.query(`SELECT status FROM facebook_pages WHERE org_id = $1`, [t.orgId]))
        .rows[0].status,
    ).toBe('expired');
    expect((await svc.reply(t.orgId, { rawJid: 'fb:P1:555', text: 'x' })).error).toBe(
      'Facebook Page not connected',
    );
  });
});
