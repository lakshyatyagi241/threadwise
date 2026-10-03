import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  FACEBOOK_GRAPH,
  type FacebookGraphFactory,
  type FacebookPageApi,
  type GraphResult,
} from '../../../src/infra/providers/channel-facebook/facebook.port';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/** Messenger setup (TW-FB-015): Get Started, greeting, persistent menu, ice breakers, against a real Postgres and a fake Meta. */
let h: Harness;
let api: Api;

interface Call {
  op: 'get' | 'set' | 'delete';
  payload?: Record<string, unknown>;
  fields?: readonly string[];
  version?: string;
}
const calls: Call[] = [];
let profile: Record<string, unknown> = {};
/** What Meta answers to a write; the default is a success. */
let answer: (c: Call) => GraphResult = () => ({ ok: true });

const DROPPED =
  '(#100) Requires one of the params: get_started,persistent_menu,whitelisted_domains,account_linking_url,home_url,ice_breakers,platform,description,commands';

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  const graph = h.app.get<FacebookGraphFactory>(FACEBOOK_GRAPH);
  Object.assign(graph.settings, { graphVersion: 'v23.0', greetingFallbackVersion: 'v19.0' });
  graph.forPage = () =>
    ({
      getMessengerProfile: () => {
        calls.push({ op: 'get' });
        return Promise.resolve(profile);
      },
      setMessengerProfile: (payload: Record<string, unknown>, version?: string) => {
        const c: Call = { op: 'set', payload, version };
        calls.push(c);
        return Promise.resolve(answer(c));
      },
      deleteMessengerProfile: (fields: readonly string[], version?: string) => {
        const c: Call = { op: 'delete', fields, version };
        calls.push(c);
        return Promise.resolve(answer(c));
      },
    }) as unknown as FacebookPageApi;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  calls.length = 0;
  profile = {};
  answer = () => ({ ok: true });
});

async function connectPage(t: Tenant, pageId: string, status = 'connected') {
  const r = await h.owner.query(
    `INSERT INTO facebook_pages (org_id, page_id, name, access_token, status) VALUES ($1, $2, $3, $4, $5) RETURNING id, uuid`,
    [t.orgId, pageId, `Page ${pageId}`, h.app.get(CryptoService).encrypt(`tok-${pageId}`), status],
  );
  return { rowId: Number(r.rows[0].id), uuid: r.rows[0].uuid as string };
}

const put = (t: Tenant, pageUuid: string, path: string, body: object) =>
  api.http().put(`/v2/facebook/setup/${pageUuid}/${path}`).set(bearer(t.admin)).send(body);
const del = (t: Tenant, pageUuid: string, path: string) =>
  api.http().delete(`/v2/facebook/setup/${pageUuid}/${path}`).set(bearer(t.admin));
const sets = () => calls.filter((c) => c.op === 'set');
const deletes = () => calls.filter((c) => c.op === 'delete');

describe('reading the profile', () => {
  it('lists the connected Pages and shows the picked Page’s live profile; the first Page when none is picked', async () => {
    const t = await api.signup('fbs1');
    const a = await connectPage(t, 'P1');
    const b = await connectPage(t, 'P2');
    await connectPage(t, 'P3', 'expired');
    profile = {
      get_started: { payload: 'GET_STARTED' },
      greeting: [{ locale: 'default', text: 'Hello' }],
      persistent_menu: [
        {
          locale: 'default',
          composer_input_disabled: true,
          call_to_actions: [{ type: 'postback', title: 'Talk', payload: 'T' }],
        },
      ],
      ice_breakers: [
        { locale: 'default', call_to_actions: [{ question: 'Hours?', payload: 'H' }] },
      ],
    };
    const res = await api.http().get('/v2/facebook/setup').set(bearer(t.admin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.pages.map((p: { pageId: string }) => p.pageId)).toEqual(['P1', 'P2']);
    expect(res.body.page).toMatchObject({ id: a.uuid, pageId: 'P1' });
    expect(res.body).toMatchObject({
      getStarted: 'GET_STARTED',
      greeting: 'Hello',
      menu: {
        composerInputDisabled: true,
        items: [{ title: 'Talk', type: 'postback', payload: 'T' }],
      },
      iceBreakers: [{ question: 'Hours?', payload: 'H' }],
    });
    const second = await api
      .http()
      .get('/v2/facebook/setup')
      .query({ page: b.uuid })
      .set(bearer(t.admin));
    expect(second.body.page.pageId).toBe('P2');
  });

  it('with no Page connected it answers with an empty screen', async () => {
    const t = await api.signup('fbs2');
    const res = await api.http().get('/v2/facebook/setup').set(bearer(t.admin));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      pages: [],
      page: null,
      getStarted: '',
      greeting: '',
      iceBreakers: [],
    });
    expect(calls).toHaveLength(0);
  });
});

describe('Get Started and the greeting', () => {
  it('Get Started is saved, a blank payload removes it, and delete removes it', async () => {
    const t = await api.signup('fbs3');
    const p = await connectPage(t, 'P1');
    const saved = await put(t, p.uuid, 'get-started', { payload: ' GET_STARTED ' });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.message).toBe('Get Started button saved.');
    expect(sets()[0]!.payload).toEqual({ get_started: { payload: 'GET_STARTED' } });

    const blank = await put(t, p.uuid, 'get-started', { payload: '  ' });
    expect(blank.body.message).toBe('Get Started button removed.');
    expect(deletes()[0]!.fields).toEqual(['get_started']);
    expect((await del(t, p.uuid, 'get-started')).body.message).toBe('Get Started button removed.');
  });

  it('the greeting is cut to 160 characters and a blank one removes it', async () => {
    const t = await api.signup('fbs4');
    const p = await connectPage(t, 'P1');
    const res = await put(t, p.uuid, 'greeting', { greeting: 'x'.repeat(200) });
    expect(res.body.message).toBe('Greeting saved.');
    expect(sets()[0]!.payload).toEqual({
      greeting: [{ locale: 'default', text: 'x'.repeat(160) }],
    });
    const blank = await put(t, p.uuid, 'greeting', { greeting: '' });
    expect(blank.body.message).toBe('Greeting removed.');
    expect(deletes()[0]!.fields).toEqual(['greeting']);
  });

  it('when the Graph version has dropped the greeting it is retried once on the older version', async () => {
    const t = await api.signup('fbs5');
    const p = await connectPage(t, 'P1');
    answer = (c) => (c.version === undefined ? { ok: false, error: DROPPED } : { ok: true });
    const res = await put(t, p.uuid, 'greeting', { greeting: 'Hello' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(sets().map((c) => c.version)).toEqual([undefined, 'v19.0']);
  });

  it('when the older version refuses too it is reported as unsupported, in Meta-free words, not as a rejection', async () => {
    const t = await api.signup('fbs6');
    const p = await connectPage(t, 'P1');
    answer = () => ({ ok: false, error: DROPPED });
    const res = await put(t, p.uuid, 'greeting', { greeting: 'Hello' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('FB_SETUP_UNSUPPORTED');
    expect(res.body.message).toMatch(/Use Ice breakers instead/);
    expect(res.body.message).not.toMatch(/rejected the change/);
  });

  it('removing a greeting Facebook no longer stores is a success; a real failure is not swallowed', async () => {
    const t = await api.signup('fbs7');
    const p = await connectPage(t, 'P1');
    answer = () => ({ ok: false, error: DROPPED });
    expect((await del(t, p.uuid, 'greeting')).body.message).toBe('Greeting removed.');
    answer = () => ({ ok: false, error: 'Error validating access token' });
    const real = await del(t, p.uuid, 'greeting');
    expect(real.status).toBe(422);
    expect(real.body.code).toBe('FB_SETUP_REJECTED');
    expect(real.body.message).toBe('Facebook rejected the change: Error validating access token');
  });
});

describe('the persistent menu and ice breakers', () => {
  it('the menu is built by the rules, with a Get Started button created first when the Page has none', async () => {
    const t = await api.signup('fbs8');
    const p = await connectPage(t, 'P1');
    const res = await put(t, p.uuid, 'menu', {
      composerInputDisabled: true,
      items: [
        { title: '', type: 'postback' },
        { title: 'Talk to us', type: 'postback' },
        { title: 'Shop', type: 'web_url', url: 'https://x.test' },
        { title: 'No address', type: 'web_url' },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.message).toBe('Persistent menu saved.');
    expect(sets().map((c) => Object.keys(c.payload!)[0])).toEqual([
      'get_started',
      'persistent_menu',
    ]);
    expect(sets()[0]!.payload).toEqual({ get_started: { payload: 'GET_STARTED' } });
    expect(sets()[1]!.payload).toEqual({
      persistent_menu: [
        {
          locale: 'default',
          composer_input_disabled: true,
          call_to_actions: [
            { type: 'postback', title: 'Talk to us', payload: 'MENU_2' },
            { type: 'web_url', title: 'Shop', url: 'https://x.test', webview_height_ratio: 'full' },
          ],
        },
      ],
    });
  });

  it('an existing Get Started button is left alone; no usable item removes the menu', async () => {
    const t = await api.signup('fbs9');
    const p = await connectPage(t, 'P1');
    profile = { get_started: { payload: 'MINE' } };
    await put(t, p.uuid, 'menu', { items: [{ title: 'Talk', type: 'postback', payload: 'T' }] });
    expect(sets()).toHaveLength(1);
    expect(Object.keys(sets()[0]!.payload!)).toEqual(['persistent_menu']);

    calls.length = 0;
    const none = await put(t, p.uuid, 'menu', { items: [{ title: '', type: 'postback' }] });
    expect(none.body.message).toBe('Persistent menu removed.');
    expect(deletes()[0]!.fields).toEqual(['persistent_menu']);
    expect(sets()).toHaveLength(0);
  });

  it('a refusal from Meta comes back with its reason', async () => {
    const t = await api.signup('fbs10');
    const p = await connectPage(t, 'P1');
    profile = { get_started: { payload: 'X' } };
    answer = () => ({ ok: false, error: 'Invalid menu' });
    const res = await put(t, p.uuid, 'menu', { items: [{ title: 'Talk', type: 'postback' }] });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('FB_SETUP_REJECTED');
    expect(res.body.message).toBe('Facebook rejected the change: Invalid menu');
  });

  it('ice breakers keep four, cut questions, name blank payloads; none removes them all', async () => {
    const t = await api.signup('fbs11');
    const p = await connectPage(t, 'P1');
    const res = await put(t, p.uuid, 'ice-breakers', {
      items: [
        { question: 'Hours?', payload: '' },
        { question: '', payload: 'x' },
        { question: 'Returns?', payload: 'R' },
        { question: 'c' },
        { question: 'd' },
        { question: 'e' },
      ],
    });
    expect(res.body.message).toBe('Ice breakers saved.');
    expect(sets()[0]!.payload).toEqual({
      ice_breakers: [
        {
          locale: 'default',
          call_to_actions: [
            { question: 'Hours?', payload: 'ICE_BREAKER_1' },
            { question: 'Returns?', payload: 'R' },
            { question: 'c', payload: 'ICE_BREAKER_4' },
            { question: 'd', payload: 'ICE_BREAKER_5' },
          ],
        },
      ],
    });
    const none = await put(t, p.uuid, 'ice-breakers', { items: [] });
    expect(none.body.message).toBe('Ice breakers removed.');
    expect(deletes()[0]!.fields).toEqual(['ice_breakers']);
    expect((await del(t, p.uuid, 'ice-breakers')).body.message).toBe('Ice breakers removed.');
  });
});

describe('Pages, isolation and access', () => {
  it('a Page that is not connected, or not ours, is refused; a revoked token flags the Page', async () => {
    const t = await api.signup('fbs12');
    const u = await api.signup('fbs12b');
    const dead = await connectPage(t, 'P1', 'expired');
    const live = await connectPage(t, 'P2');
    const foreign = await connectPage(u, 'P9');
    for (const id of [dead.uuid, foreign.uuid]) {
      const res = await put(t, id, 'get-started', { payload: 'X' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('FB_PAGE_UNAVAILABLE');
    }
    expect(calls).toHaveLength(0);

    answer = () => ({ ok: false, error: 'Error validating access token', code: 190 });
    await put(t, live.uuid, 'get-started', { payload: 'X' });
    expect(
      (await h.owner.query(`SELECT status FROM facebook_pages WHERE id = $1`, [live.rowId])).rows[0]
        .status,
    ).toBe('expired');
  });

  it('setting up Messenger is its own permission', async () => {
    const t = await api.signup('fbs13');
    const p = await connectPage(t, 'P1');
    const reader = await api.member(t, 'reader', [['fb.pages.read']]);
    expect((await api.http().get('/v2/facebook/setup').set(bearer(reader.token))).status).toBe(403);
    const denied = await api
      .http()
      .put(`/v2/facebook/setup/${p.uuid}/greeting`)
      .set(bearer(reader.token))
      .send({ greeting: 'x' });
    expect(denied.status).toBe(403);
    const setup = await api.member(t, 'setup', [['fb.setup.manage']]);
    expect((await api.http().get('/v2/facebook/setup').set(bearer(setup.token))).status).toBe(200);
  });
});
