import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  FACEBOOK_GRAPH,
  type FacebookGraphFactory,
  type FacebookPageApi,
  type GraphInsightMetric,
  type GraphPage,
  type GraphPublishedPost,
  type GraphResult,
} from '../../../src/infra/providers/channel-facebook/facebook.port';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/** Facebook Page insights (TW-FB-019): live metrics blended with local analytics. Real Postgres, fake Meta. */
let h: Harness;
let api: Api;

let profile: GraphResult<GraphPage> = { ok: false, error: 'down' };
let metrics: GraphInsightMetric[] = [];
let recent: GraphPublishedPost[] = [];
const postMetrics = new Map<string, GraphInsightMetric[]>();

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  h.app.get<FacebookGraphFactory>(FACEBOOK_GRAPH).forPage = () =>
    ({
      getProfile: () => Promise.resolve(profile),
      pageInsights: () => Promise.resolve(metrics),
      recentPosts: () => Promise.resolve(recent),
      postInsights: (id: string) => Promise.resolve(postMetrics.get(id) ?? []),
    }) as unknown as FacebookPageApi;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  profile = { ok: false, error: 'down' };
  metrics = [];
  recent = [];
  postMetrics.clear();
});

async function connectPage(
  t: Tenant,
  pageId: string,
  extra: { name?: string; fans?: number } = {},
) {
  const r = await h.owner.query(
    `INSERT INTO facebook_pages (org_id, page_id, name, category, username, picture_url, fan_count, access_token, status)
     VALUES ($1, $2, $3, 'Stored category', 'stored_user', 'https://x/stored.jpg', $4, $5, 'connected') RETURNING id, uuid`,
    [
      t.orgId,
      pageId,
      extra.name ?? `Page ${pageId}`,
      extra.fans ?? 77,
      h.app.get(CryptoService).encrypt(`tok-${pageId}`),
    ],
  );
  return { rowId: Number(r.rows[0].id), uuid: r.rows[0].uuid as string };
}
type Page = Awaited<ReturnType<typeof connectPage>>;

/** A Messenger thread: it lives on its Page's `facebook` channel, keyed by the thread key (`fb:<page>:...`). */
async function thread(t: Tenant, jid: string, status: string) {
  const pageId = jid.split(':')[1]!;
  const ch = await h.owner.query(
    `INSERT INTO channels (org_id, kind, name, status, external_id) VALUES ($1, 'facebook', $2, 'connected', $3)
     ON CONFLICT (org_id, kind, external_id) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [t.orgId, `Page ${pageId}`, pageId],
  );
  const r = await h.owner.query(
    `INSERT INTO conversations (org_id, channel_id, peer_key, title, status) VALUES ($1, $2, $3, 'T', $4) RETURNING id`,
    [t.orgId, ch.rows[0].id, jid, status],
  );
  return Number(r.rows[0].id);
}
async function message(t: Tenant, conv: number, direction: 'in' | 'out', daysAgo: number) {
  await h.owner.query(
    `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, body, status, created_at)
     VALUES ($1, $2, (SELECT coalesce(max(seq), 0) + 1 FROM messages WHERE org_id = $1 AND conversation_id = $2),
             $3, $4, 'x', $5, now() - ($6 || ' days')::interval)`,
    [
      t.orgId,
      conv,
      direction,
      direction === 'in' ? 'customer' : 'agent',
      direction === 'in' ? 'received' : 'sent',
      String(daysAgo),
    ],
  );
}
async function post(
  page: Page,
  t: Tenant,
  type: string,
  status: string,
  over: { message?: string; fb?: string; photo?: string } = {},
) {
  await h.owner.query(
    `INSERT INTO facebook_posts (org_id, facebook_page_id, type, status, message, fb_post_id, media_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      t.orgId,
      page.rowId,
      type,
      status,
      over.message ?? 'a post',
      over.fb ?? null,
      JSON.stringify(over.photo ? { photos: [over.photo] } : {}),
    ],
  );
}

const view = (t: Tenant, query: object = {}) =>
  api.http().get('/v2/facebook/insights').query(query).set(bearer(t.admin));
const todayUtc = () => new Date().toISOString().slice(0, 10);

describe('the blended screen', () => {
  it('live identity, followers, metrics and recent posts, with this system’s counts and trend beside them', async () => {
    const t = await api.signup('fbi1');
    const page = await connectPage(t, 'P1');
    const dm = await thread(t, 'fb:P1:555', 'open');
    const comments = await thread(t, 'fb:P1:post:P1_7:777', 'resolved');
    const elsewhere = await thread(t, 'fb:P2:999', 'open');
    await message(t, dm, 'in', 0);
    await message(t, dm, 'in', 3);
    await message(t, dm, 'out', 0);
    await message(t, comments, 'in', 20);
    await message(t, dm, 'in', 40);
    await message(t, elsewhere, 'in', 0);
    await post(page, t, 'text', 'published');
    await post(page, t, 'photo', 'published');
    await post(page, t, 'text', 'scheduled');

    profile = {
      ok: true,
      data: {
        id: 'P1',
        name: 'Live Name',
        category: 'Live Category',
        username: 'liveuser',
        followers_count: 1234,
        fan_count: 1000,
        picture: { data: { url: 'https://x/live.jpg' } },
      },
    };
    metrics = [
      { name: 'page_impressions', values: [{ value: 5 }, { value: 900 }] },
      { name: 'page_post_engagements', values: [{ value: 42 }] },
    ];
    recent = [
      {
        id: 'P1_1',
        message: 'Live post',
        created_time: '2026-10-01T10:00:00+0000',
        permalink_url: 'https://fb.test/1',
        full_picture: 'https://x/p.jpg',
      },
    ];
    postMetrics.set('P1_1', [
      { name: 'post_impressions', values: [{ value: 300 }] },
      { name: 'post_engaged_users', values: [{ value: 12 }] },
    ]);

    const res = await view(t, { tz: 'UTC' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.page).toMatchObject({ id: page.uuid, pageId: 'P1' });
    expect(res.body.identity).toEqual({
      name: 'Live Name',
      category: 'Live Category',
      username: 'liveuser',
      avatar: 'https://x/live.jpg',
      pageId: 'P1',
    });
    expect(res.body.followers).toBe(1234);
    expect(res.body.kpis).toEqual({ page_impressions: 900, page_post_engagements: 42 });
    expect(res.body.local).toEqual({
      convos: 2,
      convosOpen: 1,
      msgIn: 3,
      msgOut: 1,
      posts: 3,
      postsPublished: 2,
      postsScheduled: 1,
    });
    expect(res.body.convoMix).toEqual({ open: 1, resolved: 1 });
    expect(res.body.contentMix).toEqual({ text: 2, photo: 1 });
    expect(res.body.trend.days).toHaveLength(14);
    expect(res.body.trend.days.at(-1)).toBe(todayUtc());
    expect(res.body.trend.in.at(-1)).toBe(1);
    expect(res.body.trend.out.at(-1)).toBe(1);
    expect(res.body.trend.in.at(-4)).toBe(1);
    expect(res.body.trend.in.reduce((a: number, b: number) => a + b, 0)).toBe(2);
    expect(res.body.posts).toEqual([
      {
        message: 'Live post',
        created: '2026-10-01T10:00:00+0000',
        permalink: 'https://fb.test/1',
        picture: 'https://x/p.jpg',
        type: 'live',
        status: null,
        stats: { impressions: 300, engaged: 12 },
      },
    ]);
  });

  it('when Meta says nothing the stored identity and this system’s own posts fill the screen', async () => {
    const t = await api.signup('fbi2');
    const page = await connectPage(t, 'P1', { fans: 77 });
    await post(page, t, 'photo', 'published', {
      message: 'older',
      fb: 'P1_9',
      photo: 'https://x/o.jpg',
    });
    await post(page, t, 'text', 'failed', { message: 'newer' });

    const res = await view(t);
    expect(res.status).toBe(200);
    expect(res.body.identity).toEqual({
      name: 'Page P1',
      category: 'Stored category',
      username: 'stored_user',
      avatar: 'https://x/stored.jpg',
      pageId: 'P1',
    });
    expect(res.body.followers).toBe(77);
    expect(res.body.kpis).toEqual({});
    expect(res.body.local).toMatchObject({ convos: 0, msgIn: 0, posts: 2, postsPublished: 1 });
    expect(res.body.trend.in).toEqual(Array(14).fill(0));
    expect(res.body.posts.map((p: { message: string }) => p.message)).toEqual(['newer', 'older']);
    expect(res.body.posts[1]).toMatchObject({
      permalink: 'https://facebook.com/P1_9',
      picture: 'https://x/o.jpg',
      type: 'photo',
      status: 'published',
      stats: { impressions: 0, engaged: 0 },
    });
    expect(res.body.posts[0]).toMatchObject({ permalink: '', type: 'text', status: 'failed' });
  });

  it('the followers count prefers followers_count, then fan_count', async () => {
    const t = await api.signup('fbi3');
    await connectPage(t, 'P1', { fans: 5 });
    profile = { ok: true, data: { id: 'P1', fan_count: 1000 } };
    expect((await view(t)).body.followers).toBe(1000);
  });
});

describe('the viewer’s time zone and the Page picker', () => {
  it('the trend is read in the viewer’s zone; an unknown zone is UTC', async () => {
    const t = await api.signup('fbi4');
    await connectPage(t, 'P1');
    const kolkata = await view(t, { tz: 'Asia/Kolkata' });
    const expected = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    expect(kolkata.body.trend.days.at(-1)).toBe(expected);
    const unknown = await view(t, { tz: 'Nowhere/Land' });
    expect(unknown.status).toBe(200);
    expect(unknown.body.trend.days.at(-1)).toBe(todayUtc());
  });

  it('picks the first Page by default and the asked one with ?page; with no Page the screen is empty', async () => {
    const t = await api.signup('fbi5');
    const empty = await view(t);
    expect(empty.body).toMatchObject({
      pages: [],
      page: null,
      identity: null,
      followers: null,
      kpis: {},
      posts: [],
    });

    const a = await connectPage(t, 'P1', { name: 'Alpha' });
    const b = await connectPage(t, 'P2', { name: 'Beta' });
    expect((await view(t)).body.page.id).toBe(a.uuid);
    const second = await view(t, { page: b.uuid });
    expect(second.body.page.id).toBe(b.uuid);
    expect(second.body.pages.map((p: { name: string }) => p.name)).toEqual(['Alpha', 'Beta']);
  });
});

describe('isolation and access', () => {
  it('another organization sees none of it, and insights are their own permission', async () => {
    const a = await api.signup('fbi6');
    const b = await api.signup('fbi7');
    const page = await connectPage(a, 'P1');
    await post(page, a, 'text', 'published');
    expect((await view(b)).body.page).toBeNull();
    expect((await view(b, { page: page.uuid })).body.page).toBeNull();

    const reader = await api.member(a, 'reader', [['fb.posts.read']]);
    expect((await api.http().get('/v2/facebook/insights').set(bearer(reader.token))).status).toBe(
      403,
    );
    const insights = await api.member(a, 'insights', [['fb.insights.read']]);
    expect((await api.http().get('/v2/facebook/insights').set(bearer(insights.token))).status).toBe(
      200,
    );
  });
});
