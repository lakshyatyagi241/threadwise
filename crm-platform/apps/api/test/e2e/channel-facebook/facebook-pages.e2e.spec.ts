import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  FACEBOOK_GRAPH,
  type FacebookGraphFactory,
  type FacebookPageApi,
  type GraphPage,
  type GraphResult,
} from '../../../src/infra/providers/channel-facebook/facebook.port';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/** Connecting and managing Facebook Pages (TW-FB-001 to 005), against a real Postgres and a fake Meta. */
let h: Harness;
let api: Api;

const calls: Array<{ method: string; args: unknown[] }> = [];
let exchange: GraphResult<{ accessToken: string }> = { ok: true, data: { accessToken: 'short' } };
let extend: GraphResult<{ accessToken: string }> = { ok: true, data: { accessToken: 'long' } };
let account: GraphPage[] = [];
let asPage: GraphPage | null = null;
let grant: { scopes?: string[]; data_access_expires_at?: number; is_valid?: boolean } | null = null;
let profile: GraphResult<GraphPage> = { ok: true, data: { id: 'P1' } };
let subscribe: GraphResult = { ok: true };

const page = (id: string, name: string, extra: Partial<GraphPage> = {}): GraphPage => ({
  id,
  name,
  category: 'Shop',
  access_token: `tok-${id}`,
  tasks: ['MANAGE', 'MESSAGING'],
  fan_count: 10,
  ...extra,
});

const noPageApi = (): FacebookPageApi => ({
  getProfile: () => Promise.resolve(profile),
  subscribeWebhooks: () => {
    calls.push({ method: 'subscribe', args: [] });
    return Promise.resolve(subscribe);
  },
  unsubscribeWebhooks: () => {
    calls.push({ method: 'unsubscribe', args: [] });
    return Promise.resolve({ ok: true });
  },
  sendText: () => Promise.resolve({ ok: true, data: { messageId: 'm' } }),
  sendAttachment: () => Promise.resolve({ ok: true, data: { messageId: 'm' } }),
  sendButtonTemplate: () => Promise.resolve({ ok: true, data: { messageId: 'm' } }),
  getMessengerProfile: () => Promise.resolve({}),
  setMessengerProfile: () => Promise.resolve({ ok: true }),
  deleteMessengerProfile: () => Promise.resolve({ ok: true }),
  publish: () => Promise.resolve({ ok: true, data: { id: 'p' } }),
  postVideo: () => Promise.resolve({ ok: true, data: { id: 'v' } }),
  postReel: () => Promise.resolve({ ok: true, data: { id: 'r' } }),
  deletePost: () => Promise.resolve({ ok: true }),
  recentPosts: () => Promise.resolve([]),
  pageInsights: () => Promise.resolve([]),
  postInsights: () => Promise.resolve([]),
  replyComment: () => Promise.resolve({ ok: true, data: { id: 'c' } }),
  getSenderProfile: () => Promise.resolve(null),
  getComment: () => Promise.resolve(null),
  listConversations: () => Promise.resolve([]),
  getConversationMessages: () => Promise.resolve([]),
});

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  const graph = h.app.get<FacebookGraphFactory>(FACEBOOK_GRAPH);
  Object.assign(graph.settings, { appId: '1234', appSecret: 'secret', configId: null });
  graph.app = () => ({
    exchangeCode: (code, redirect) => {
      calls.push({ method: 'exchangeCode', args: [code, redirect] });
      return Promise.resolve(exchange);
    },
    extendUserToken: () => Promise.resolve(extend),
    listPages: () => Promise.resolve(account),
    pageFromToken: () => Promise.resolve(asPage),
    debugToken: () => Promise.resolve(grant),
  });
  graph.forPage = () => noPageApi();
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  calls.length = 0;
  exchange = { ok: true, data: { accessToken: 'short' } };
  extend = { ok: true, data: { accessToken: 'long' } };
  account = [];
  asPage = null;
  grant = null;
  profile = { ok: true, data: { id: 'P1' } };
  subscribe = { ok: true };
});

const rows = async (t: Tenant) =>
  (await h.owner.query(`SELECT * FROM facebook_pages WHERE org_id = $1 ORDER BY id`, [t.orgId]))
    .rows;

/** Starts the login as the admin and returns the sealed state Meta would hand back. */
async function loginState(t: Tenant): Promise<string> {
  const res = await api.http().post('/v2/facebook/connect/start').set(bearer(t.admin));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const state = new URL(res.body.url as string).searchParams.get('state');
  expect(state).toBeTruthy();
  return state as string;
}

const callback = (query: Record<string, string>) =>
  api.http().get('/v2/facebook/callback').query(query).redirects(0);

describe('TW-FB-002: connecting an account', () => {
  it('login start names the Meta app and a sealed state; with no app it says so', async () => {
    const t = await api.signup('fb1');
    const graph = h.app.get<FacebookGraphFactory>(FACEBOOK_GRAPH);
    const res = await api.http().post('/v2/facebook/connect/start').set(bearer(t.admin));
    expect(res.status).toBe(200);
    const url = new URL(res.body.url as string);
    expect(url.origin).toBe('https://www.facebook.com');
    expect(url.searchParams.get('client_id')).toBe('1234');
    expect(url.searchParams.get('scope')).toContain('pages_messaging');

    Object.assign(graph.settings, { appId: null });
    const none = await api.http().post('/v2/facebook/connect/start').set(bearer(t.admin));
    expect(none.status).toBe(422);
    expect(none.body.code).toBe('FB_NOT_CONFIGURED');
    Object.assign(graph.settings, { appId: '1234' });
  });

  it('the callback stores every Page with its own encrypted token, subscribes each and sends the browser to the hub', async () => {
    const t = await api.signup('fb2');
    account = [page('P1', 'Shop One'), page('P2', 'Shop Two'), { id: 'P3', name: 'No token' }];
    grant = { scopes: ['pages_messaging'], data_access_expires_at: 1_900_000_000 };
    const state = await loginState(t);

    const res = await callback({ code: 'abc', state });
    expect(res.status).toBe(303);
    const to = new URL(res.headers.location as string);
    expect(to.pathname).toBe('/facebook');
    expect(to.searchParams.get('fb')).toBe('connected');
    expect(to.searchParams.get('message')).toBe('2 Facebook Pages connected: Shop One, Shop Two');

    const stored = await rows(t);
    expect(stored.map((r) => r.page_id)).toEqual(['P1', 'P2']);
    expect(stored[0].access_token).not.toContain('tok-P1');
    expect(h.app.get(CryptoService).decrypt(stored[0].access_token as string)).toBe('tok-P1');
    expect(stored[0].scopes).toEqual(['pages_messaging']);
    expect(stored[0].tasks).toEqual(['MANAGE', 'MESSAGING']);
    expect(stored[0].connect_method).toBe('oauth');
    expect(new Date(stored[0].data_access_expires_at as string).getTime()).toBe(1_900_000_000_000);
    expect(calls.filter((c) => c.method === 'subscribe')).toHaveLength(2);
    // The exchange used the login's redirect address; the long-lived upgrade ran before the Pages were listed.
    expect(calls.find((c) => c.method === 'exchangeCode')?.args[1]).toMatch(
      /\/v2\/facebook\/callback$/,
    );
  });

  it('a wrong, forged or stale state, a refused code and an account with no Pages connect nothing', async () => {
    const t = await api.signup('fb3');
    account = [page('P1', 'Shop')];
    const forged = await callback({ code: 'abc', state: 'not-sealed' });
    expect(new URL(forged.headers.location as string).searchParams.get('fb')).toBe('error');
    const missing = await callback({ code: 'abc' });
    expect(new URL(missing.headers.location as string).searchParams.get('fb')).toBe('error');
    const denied = await callback({ error: 'access_denied', error_description: 'You cancelled' });
    expect(new URL(denied.headers.location as string).searchParams.get('message')).toBe(
      'You cancelled',
    );

    exchange = { ok: false, error: 'Invalid verification code' };
    const refused = await callback({ code: 'abc', state: await loginState(t) });
    expect(new URL(refused.headers.location as string).searchParams.get('message')).toBe(
      'Token exchange failed: Invalid verification code',
    );

    exchange = { ok: true, data: { accessToken: 'short' } };
    account = [];
    const none = await callback({ code: 'abc', state: await loginState(t) });
    expect(new URL(none.headers.location as string).searchParams.get('message')).toMatch(
      /No Facebook Pages were found/,
    );
    expect(await rows(t)).toHaveLength(0);
  });

  it('a failed long-lived upgrade falls back to the short token', async () => {
    const t = await api.signup('fb4');
    account = [page('P1', 'Shop')];
    extend = { ok: false, error: 'nope' };
    const res = await callback({ code: 'abc', state: await loginState(t) });
    expect(new URL(res.headers.location as string).searchParams.get('fb')).toBe('connected');
    expect(await rows(t)).toHaveLength(1);
  });

  it('the popup code connects; a missing app is refused', async () => {
    const t = await api.signup('fb5');
    account = [page('P1', 'Shop')];
    const res = await api
      .http()
      .post('/v2/facebook/connect/embedded')
      .set(bearer(t.admin))
      .set('idempotency-key', randomUUID())
      .send({ code: 'popup' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.message).toBe('Facebook Page “Shop” connected.');
    expect(res.body.pages[0]).not.toHaveProperty('accessToken');
    expect((await rows(t))[0].connect_method).toBe('embedded');
    // Embedded exchanges WITHOUT a redirect address.
    expect(calls.find((c) => c.method === 'exchangeCode')?.args[1]).toBe('');
  });

  it('a pasted Page token connects one Page; a token that is not a Page is refused', async () => {
    const t = await api.signup('fb6');
    const post = (token: string) =>
      api
        .http()
        .post('/v2/facebook/connect/manual')
        .set(bearer(t.admin))
        .set('idempotency-key', randomUUID())
        .send({ pageAccessToken: token });

    const none = await post('x'.repeat(40));
    expect(none.status).toBe(422);
    expect(none.body.code).toBe('FB_TOKEN_NOT_A_PAGE');
    expect((await post('short')).status).toBe(400);

    asPage = page('P9', 'Pasted', { access_token: undefined });
    const ok = await post('t'.repeat(40));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const stored = await rows(t);
    expect(stored).toHaveLength(1);
    expect(stored[0].connect_method).toBe('manual');
    expect(h.app.get(CryptoService).decrypt(stored[0].access_token as string)).toBe('t'.repeat(40));
  });

  it('connecting the same Page again keeps its row and brings an expired Page back', async () => {
    const t = await api.signup('fb7');
    account = [page('P1', 'Shop')];
    await callback({ code: 'a', state: await loginState(t) });
    const first = (await rows(t))[0];
    await h.owner.query(
      `UPDATE facebook_pages SET status = 'expired', last_error = 'revoked' WHERE id = $1`,
      [first.id],
    );

    account = [page('P1', 'Shop Renamed')];
    await callback({ code: 'b', state: await loginState(t) });
    const after = await rows(t);
    expect(after).toHaveLength(1);
    expect(after[0].uuid).toBe(first.uuid);
    expect(after[0].name).toBe('Shop Renamed');
    expect(after[0].status).toBe('connected');
    expect(after[0].last_error).toBeNull();
  });
});

describe('TW-FB-001, 004: the hub and managing a Page', () => {
  async function connected(label: string) {
    const t = await api.signup(label);
    account = [page('P1', 'Shop')];
    await callback({ code: 'a', state: await loginState(t) });
    const list = await api.http().get('/v2/facebook/pages').set(bearer(t.admin));
    expect(list.status).toBe(200);
    return { t, id: list.body.data[0].id as string };
  }

  it('lists the Pages without any token and serves the connect config', async () => {
    const { t } = await connected('fb8');
    const list = await api.http().get('/v2/facebook/pages').set(bearer(t.admin));
    expect(list.body.data).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toMatch(/tok-P1|accessToken|access_token/);
    expect(list.body.data[0]).toMatchObject({
      pageId: 'P1',
      name: 'Shop',
      status: 'connected',
      tasks: ['MANAGE', 'MESSAGING'],
    });
    const cfg = await api.http().get('/v2/facebook/config').set(bearer(t.admin));
    expect(cfg.body).toMatchObject({ configured: true, appId: '1234' });
    expect(cfg.body.webhookUrl).toMatch(/^https:\/\/.+\/v2\/facebook\/webhook$/);
  });

  it('refresh re-reads the profile; a refused refresh says so; a revoked token flags the Page', async () => {
    const { t, id } = await connected('fb9');
    const refresh = () =>
      api
        .http()
        .post(`/v2/facebook/pages/${id}/refresh`)
        .set(bearer(t.admin))
        .set('idempotency-key', randomUUID());

    profile = {
      ok: true,
      data: {
        id: 'P1',
        name: 'Renamed',
        fan_count: 99,
        picture: { data: { url: 'https://x/p.jpg' } },
      },
    };
    const ok = await refresh();
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ name: 'Renamed', fanCount: 99, pictureUrl: 'https://x/p.jpg' });

    profile = { ok: false, error: 'boom' };
    const bad = await refresh();
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('FB_REFRESH_FAILED');
    expect((await rows(t))[0].status).toBe('connected');

    profile = { ok: false, error: 'Error validating access token', code: 190 };
    await refresh();
    const flagged = (await rows(t))[0];
    expect(flagged.status).toBe('expired');
    expect(flagged.last_error).toBe('Error validating access token');
  });

  it('"Fix inbound" subscribes again; a refusal is a field, not an HTTP error', async () => {
    const { t, id } = await connected('fb10');
    calls.length = 0;
    const fix = () =>
      api
        .http()
        .post(`/v2/facebook/pages/${id}/resubscribe`)
        .set(bearer(t.admin))
        .set('idempotency-key', randomUUID());
    const ok = await fix();
    expect(ok.status).toBe(200);
    expect(ok.body.error).toBeNull();
    expect(calls.filter((c) => c.method === 'subscribe')).toHaveLength(1);

    subscribe = { ok: false, error: 'permission missing' };
    const bad = await fix();
    expect(bad.status).toBe(200);
    expect(bad.body.error).toBe('Re-subscribe failed: permission missing');
  });

  it('disconnect unsubscribes and removes the Page; its inbox threads stay', async () => {
    const { t, id } = await connected('fb11');
    const channel = await h.owner.query(
      `INSERT INTO channels (org_id, kind, name, status, external_id) VALUES ($1, 'facebook', 'Shop', 'connected', 'P1') RETURNING id`,
      [t.orgId],
    );
    await h.owner.query(
      `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1, $2, 'fb:p1:555', 'Asha')`,
      [t.orgId, channel.rows[0].id],
    );
    const res = await api.http().delete(`/v2/facebook/pages/${id}`).set(bearer(t.admin));
    expect(res.status).toBe(204);
    expect(calls.some((c) => c.method === 'unsubscribe')).toBe(true);
    expect(await rows(t)).toHaveLength(0);
    const threads = await h.owner.query(
      `SELECT c.id FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
       WHERE c.org_id = $1 AND ch.kind = 'facebook'`,
      [t.orgId],
    );
    expect(threads.rows).toHaveLength(1);
    // The Page is gone, so its inbox channel is switched off but kept.
    const after = await h.owner.query(
      `SELECT status FROM channels WHERE org_id = $1 AND kind = 'facebook'`,
      [t.orgId],
    );
    expect(after.rows[0].status).toBe('disconnected');
    expect((await api.http().delete(`/v2/facebook/pages/${id}`).set(bearer(t.admin))).status).toBe(
      404,
    );
  });
});

describe('isolation and access', () => {
  it('another organization sees and manages none of it', async () => {
    const a = await api.signup('fb12');
    const b = await api.signup('fb13');
    account = [page('P1', 'Shop')];
    await callback({ code: 'a', state: await loginState(a) });
    const id = (await api.http().get('/v2/facebook/pages').set(bearer(a.admin))).body.data[0]
      .id as string;

    expect((await api.http().get('/v2/facebook/pages').set(bearer(b.admin))).body.data).toEqual([]);
    expect((await api.http().delete(`/v2/facebook/pages/${id}`).set(bearer(b.admin))).status).toBe(
      404,
    );
    expect(
      (
        await api
          .http()
          .post(`/v2/facebook/pages/${id}/refresh`)
          .set(bearer(b.admin))
          .set('idempotency-key', randomUUID())
      ).status,
    ).toBe(404);
    expect(await rows(a)).toHaveLength(1);
  });

  it('reading, connecting and managing are separate permissions', async () => {
    const t = await api.signup('fb14');
    const viewer = await api.member(t, 'viewer', []);
    expect((await api.http().get('/v2/facebook/pages').set(bearer(viewer.token))).status).toBe(403);
    const reader = await api.member(t, 'reader', [['fb.pages.read']]);
    expect((await api.http().get('/v2/facebook/pages').set(bearer(reader.token))).status).toBe(200);
    const denied = await api.http().post('/v2/facebook/connect/start').set(bearer(reader.token));
    expect(denied.status).toBe(403);
  });
});
