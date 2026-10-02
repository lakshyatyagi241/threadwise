import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  FACEBOOK_GRAPH,
  type FacebookGraphFactory,
  type FacebookPageApi,
  type GraphPublishedPost,
  type GraphResult,
  type PublishSpec,
} from '../../../src/infra/providers/channel-facebook/facebook.port';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/** Facebook posts (WD-FB-016 to 018): compose, schedule, list, retry, delete, My posts. Real Postgres, fake Meta. */
let h: Harness;
let api: Api;

interface Call {
  method: 'publish' | 'postVideo' | 'postReel' | 'deletePost';
  args: unknown[];
}
const calls: Call[] = [];
let answer: GraphResult<{ id: string }> = { ok: true, data: { id: 'fb_1' } };
let deleteAnswer: GraphResult = { ok: true };
let feed: GraphPublishedPost[] = [];
let feedFails = false;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  const graph = h.app.get<FacebookGraphFactory>(FACEBOOK_GRAPH);
  graph.forPage = () =>
    ({
      publish: (spec: PublishSpec) => {
        calls.push({ method: 'publish', args: [spec] });
        return Promise.resolve(answer);
      },
      postVideo: (url: string, text: string, ts: number | null) => {
        calls.push({ method: 'postVideo', args: [url, text, ts] });
        return Promise.resolve(answer);
      },
      postReel: (url: string, text: string, ts: number | null) => {
        calls.push({ method: 'postReel', args: [url, text, ts] });
        return Promise.resolve(answer);
      },
      deletePost: (id: string) => {
        calls.push({ method: 'deletePost', args: [id] });
        return Promise.resolve(deleteAnswer);
      },
      recentPosts: () => (feedFails ? Promise.reject(new Error('down')) : Promise.resolve(feed)),
    }) as unknown as FacebookPageApi;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  calls.length = 0;
  answer = { ok: true, data: { id: 'fb_1' } };
  deleteAnswer = { ok: true };
  feed = [];
  feedFails = false;
});

async function connectPage(t: Tenant, pageId: string, status = 'connected') {
  const r = await h.owner.query(
    `INSERT INTO facebook_pages (org_id, page_id, name, access_token, status) VALUES ($1, $2, $3, $4, $5) RETURNING id, uuid`,
    [t.orgId, pageId, `Page ${pageId}`, h.app.get(CryptoService).encrypt(`tok-${pageId}`), status],
  );
  return { rowId: Number(r.rows[0].id), uuid: r.rows[0].uuid as string };
}
type Page = Awaited<ReturnType<typeof connectPage>>;

const make = (t: Tenant, page: Page, over: Record<string, unknown> = {}) =>
  api
    .http()
    .post('/v2/facebook/posts')
    .set(bearer(t.admin))
    .set('idempotency-key', randomUUID())
    .send({ pageId: page.uuid, message: 'Hello world', ...over });
const rows = async (t: Tenant) =>
  (await h.owner.query(`SELECT * FROM facebook_posts WHERE org_id = $1 ORDER BY id`, [t.orgId]))
    .rows;
/** An instant `m` minutes from now (the service reads the real clock, so a fixed date would drift). */
const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

describe('WD-FB-016: making a post', () => {
  it('a text post is saved, published, and stores Meta’s id and time', async () => {
    const t = await api.signup('fbp1');
    const page = await connectPage(t, 'P1');
    const res = await make(t, page);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      type: 'text',
      status: 'published',
      message: 'Hello world',
      fbPostId: 'fb_1',
      error: null,
      pageName: 'Page P1',
    });
    expect(res.body.publishedAt).not.toBeNull();
    expect(calls).toEqual([
      {
        method: 'publish',
        args: [{ message: 'Hello world', link: '', photos: [], scheduledTs: null }],
      },
    ]);
    const [row] = await rows(t);
    expect(row).toMatchObject({ status: 'published', fb_post_id: 'fb_1', type: 'text' });
  });

  it('photos, several photos and a link are typed and sent as given; extra photos beyond ten are dropped', async () => {
    const t = await api.signup('fbp2');
    const page = await connectPage(t, 'P1');
    expect((await make(t, page, { photoUrls: ['https://x/a.jpg'] })).body.type).toBe('photo');
    expect(
      (await make(t, page, { photoUrls: ['https://x/a.jpg', 'https://x/b.jpg'] })).body.type,
    ).toBe('multi_photo');
    expect((await make(t, page, { link: 'https://x.test/p' })).body.type).toBe('link');
    const many = Array.from({ length: 14 }, (_, i) => `https://x/${i}.jpg`);
    const big = await make(t, page, { photoUrls: many });
    expect(big.body.photos).toHaveLength(10);
    expect((calls.at(-1)!.args[0] as PublishSpec).photos).toHaveLength(10);
  });

  it('nothing to post, photos with a link, a video that is not HTTPS and a Page that is not connected are refused, and nothing is saved', async () => {
    const t = await api.signup('fbp3');
    const page = await connectPage(t, 'P1');
    const empty = await make(t, page, { message: '' });
    expect(empty.status).toBe(422);
    expect(empty.body.code).toBe('FB_POST_INVALID');
    expect(empty.body.message).toBe('Write something, add a link, or attach a photo.');
    const both = await make(t, page, { photoUrls: ['https://x/a.jpg'], link: 'https://x.test' });
    expect(both.body.message).toBe('A post can have photos or a link, not both. Remove one.');
    const http = await make(t, page, { videoUrl: 'http://x/v.mp4' });
    expect(http.body.message).toBe('The video URL must be a public HTTPS link.');
    const dead = await connectPage(t, 'P2', 'expired');
    const gone = await make(t, dead);
    expect(gone.body.code).toBe('FB_PAGE_UNAVAILABLE');
    expect(await rows(t)).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('a video and a reel go through their own calls with the description and no schedule', async () => {
    const t = await api.signup('fbp4');
    const page = await connectPage(t, 'P1');
    const video = await make(t, page, {
      videoUrl: 'https://x/v.mp4',
      photoUrls: ['https://x/a.jpg'],
    });
    expect(video.body).toMatchObject({
      type: 'video',
      video: 'https://x/v.mp4',
      photos: [],
      status: 'published',
    });
    expect(calls[0]).toEqual({
      method: 'postVideo',
      args: ['https://x/v.mp4', 'Hello world', null],
    });
    const reel = await make(t, page, { videoUrl: 'https://x/r.mp4', asReel: true });
    expect(reel.body.type).toBe('reel');
    expect(calls[1]).toEqual({
      method: 'postReel',
      args: ['https://x/r.mp4', 'Hello world', null],
    });
  });

  it('a schedule inside Meta’s window is held (status scheduled, the time sent in seconds); outside it is refused', async () => {
    const t = await api.signup('fbp5');
    const page = await connectPage(t, 'P1');
    const at = inMin(60);
    const ok = await make(t, page, { scheduledAt: at });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({
      status: 'scheduled',
      publishedAt: null,
      scheduledPublishTime: at,
    });
    expect((calls[0]!.args[0] as PublishSpec).scheduledTs).toBe(
      Math.floor(new Date(at).getTime() / 1000),
    );

    const soon = await make(t, page, { scheduledAt: inMin(9) });
    expect(soon.status).toBe(422);
    expect(soon.body.code).toBe('FB_SCHEDULE_INVALID');
    expect(soon.body.message).toBe('Scheduled time must be at least 10 minutes from now.');
    const far = await make(t, page, { scheduledAt: inMin(75 * 24 * 60 + 1) });
    expect(far.body.message).toBe('Scheduled time cannot be more than 75 days out.');
    expect(await rows(t)).toHaveLength(1);
  });

  it('when Meta refuses, the post stays as failed with the reason and the answer is the failed post, not an error', async () => {
    const t = await api.signup('fbp6');
    const page = await connectPage(t, 'P1');
    answer = { ok: false, error: '(#100) Invalid parameter'.padEnd(1500, '!') };
    const res = await make(t, page);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('failed');
    expect(res.body.error).toHaveLength(990);
    expect(res.body.fbPostId).toBeNull();
    expect((await rows(t))[0].status).toBe('failed');

    answer = { ok: false, error: 'Error validating access token', code: 190 };
    await make(t, page);
    expect(
      (await h.owner.query(`SELECT status FROM facebook_pages WHERE id = $1`, [page.rowId])).rows[0]
        .status,
    ).toBe('expired');
  });
});

describe('WD-FB-017: retry, list and delete', () => {
  it('publish now retries a failed post (video posts resend their video); a published one is refused', async () => {
    const t = await api.signup('fbp7');
    const page = await connectPage(t, 'P1');
    answer = { ok: false, error: 'boom' };
    const failed = await make(t, page, { photoUrls: ['https://x/a.jpg'], message: 'caption' });
    const failedVideo = await make(t, page, { videoUrl: 'https://x/v.mp4' });
    calls.length = 0;

    answer = { ok: true, data: { id: 'fb_ok' } };
    const retried = await api
      .http()
      .post(`/v2/facebook/posts/${failed.body.id}/publish`)
      .set(bearer(t.admin))
      .set('idempotency-key', randomUUID());
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect(retried.body).toMatchObject({ status: 'published', fbPostId: 'fb_ok', error: null });
    expect(calls[0]).toEqual({
      method: 'publish',
      args: [{ message: 'caption', link: '', photos: ['https://x/a.jpg'], scheduledTs: null }],
    });
    await api
      .http()
      .post(`/v2/facebook/posts/${failedVideo.body.id}/publish`)
      .set(bearer(t.admin))
      .set('idempotency-key', randomUUID());
    expect(calls[1]).toEqual({ method: 'postVideo', args: ['https://x/v.mp4', '', null] });

    calls.length = 0;
    const again = await api
      .http()
      .post(`/v2/facebook/posts/${failed.body.id}/publish`)
      .set(bearer(t.admin))
      .set('idempotency-key', randomUUID());
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('FB_POST_INVALID');
    expect(calls).toHaveLength(0);
  });

  it('the list orders scheduled first, then failed and draft, then published; counts ignore every filter but the Page', async () => {
    const t = await api.signup('fbp8');
    const page = await connectPage(t, 'P1');
    const other = await connectPage(t, 'P2');
    await make(t, page, { message: 'published one' });
    await make(t, page, { message: 'scheduled one', scheduledAt: inMin(60) });
    answer = { ok: false, error: 'boom' };
    await make(t, page, { message: 'failed one', link: 'https://x.test/sale' });
    answer = { ok: true, data: { id: 'fb_2' } };
    await make(t, other, { message: 'other page' });
    await h.owner.query(`UPDATE facebook_posts SET status = 'draft' WHERE message = 'other page'`);

    const all = await api.http().get('/v2/facebook/posts').set(bearer(t.admin));
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body.data.map((p: { message: string }) => p.message)).toEqual([
      'scheduled one',
      'other page',
      'failed one',
      'published one',
    ]);
    expect(all.body.counts).toEqual({ scheduled: 1, published: 1, failed: 2 });
    expect(all.body.typeCounts).toMatchObject({ all: 4, text: 3, link: 1 });
    expect(all.body.pages.map((p: { pageId: string }) => p.pageId)).toEqual(['P1', 'P2']);

    const failedOnly = await api
      .http()
      .get('/v2/facebook/posts')
      .query({ status: 'failed' })
      .set(bearer(t.admin));
    expect(failedOnly.body.data.map((p: { message: string }) => p.message)).toEqual([
      'other page',
      'failed one',
    ]);
    expect(failedOnly.body.counts).toEqual({ scheduled: 1, published: 1, failed: 2 });

    const byPage = await api
      .http()
      .get('/v2/facebook/posts')
      .query({ account: page.uuid })
      .set(bearer(t.admin));
    expect(byPage.body.meta.total).toBe(3);
    expect(byPage.body.counts).toEqual({ scheduled: 1, published: 1, failed: 1 });
    const unknown = await api
      .http()
      .get('/v2/facebook/posts')
      .query({ account: randomUUID() })
      .set(bearer(t.admin));
    expect(unknown.body.data).toEqual([]);
    expect(unknown.body.counts).toEqual({ scheduled: 0, published: 0, failed: 0 });
  });

  it('type, range and search filter the list; a search takes % literally', async () => {
    const t = await api.signup('fbp9');
    const page = await connectPage(t, 'P1');
    await make(t, page, { message: '50% off today' });
    await make(t, page, { message: 'plain', link: 'https://x.test/50-off' });
    await make(t, page, { message: 'old post' });
    await h.owner.query(
      `UPDATE facebook_posts SET created_at = created_at - interval '40 days' WHERE message = 'old post'`,
    );
    const get = (query: object) =>
      api.http().get('/v2/facebook/posts').query(query).set(bearer(t.admin));
    expect(
      (await get({ type: 'link' })).body.data.map((p: { message: string }) => p.message),
    ).toEqual(['plain']);
    expect((await get({ q: '50%' })).body.data.map((p: { message: string }) => p.message)).toEqual([
      '50% off today',
    ]);
    expect((await get({ q: 'x.test' })).body.data).toHaveLength(1);
    expect((await get({ range: '30d' })).body.meta.total).toBe(2);
    expect((await get({ range: '90d' })).body.meta.total).toBe(3);
  });

  it('the list is 15 a page', async () => {
    const t = await api.signup('fbp10');
    const page = await connectPage(t, 'P1');
    for (let i = 0; i < 17; i++) await make(t, page, { message: `post ${i}` });
    const p1 = await api.http().get('/v2/facebook/posts').set(bearer(t.admin));
    expect(p1.body.data).toHaveLength(15);
    expect(p1.body.meta).toEqual({ page: 1, perPage: 15, total: 17, lastPage: 2 });
    const p2 = await api.http().get('/v2/facebook/posts').query({ page: 2 }).set(bearer(t.admin));
    expect(p2.body.data).toHaveLength(2);
  });

  it('delete removes a live post from Meta first and ignores Meta failing; a post never sent makes no call', async () => {
    const t = await api.signup('fbp11');
    const page = await connectPage(t, 'P1');
    const live = await make(t, page);
    answer = { ok: false, error: 'boom' };
    const never = await make(t, page, { message: 'never sent' });
    calls.length = 0;

    expect(
      (await api.http().delete(`/v2/facebook/posts/${never.body.id}`).set(bearer(t.admin))).status,
    ).toBe(204);
    expect(calls).toHaveLength(0);
    deleteAnswer = { ok: false, error: 'already gone' };
    expect(
      (await api.http().delete(`/v2/facebook/posts/${live.body.id}`).set(bearer(t.admin))).status,
    ).toBe(204);
    expect(calls).toEqual([{ method: 'deletePost', args: ['fb_1'] }]);
    expect(await rows(t)).toHaveLength(0);
    expect(
      (await api.http().delete(`/v2/facebook/posts/${live.body.id}`).set(bearer(t.admin))).status,
    ).toBe(404);
  });
});

describe('WD-FB-018: My posts', () => {
  it('shows the Page’s live feed; Meta not answering is an empty grid; no Page is an empty screen', async () => {
    const t = await api.signup('fbp12');
    const none = await api.http().get('/v2/facebook/my-posts').set(bearer(t.admin));
    expect(none.body).toEqual({ pages: [], page: null, items: [] });

    const page = await connectPage(t, 'P1');
    feed = [
      {
        id: 'P1_1',
        message: 'Hi',
        created_time: '2026-10-01T10:00:00+0000',
        permalink_url: 'https://fb.test/1',
        full_picture: 'https://x/p.jpg',
      },
      { id: 'P1_2' },
    ];
    const res = await api.http().get('/v2/facebook/my-posts').set(bearer(t.admin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.page).toMatchObject({ id: page.uuid, pageId: 'P1' });
    expect(res.body.items).toEqual([
      {
        id: 'P1_1',
        message: 'Hi',
        createdTime: '2026-10-01T10:00:00+0000',
        permalinkUrl: 'https://fb.test/1',
        picture: 'https://x/p.jpg',
      },
      { id: 'P1_2', message: '', createdTime: '', permalinkUrl: '', picture: '' },
    ]);

    feedFails = true;
    const down = await api.http().get('/v2/facebook/my-posts').set(bearer(t.admin));
    expect(down.status).toBe(200);
    expect(down.body.items).toEqual([]);
  });
});

describe('isolation and access', () => {
  it('another organization cannot see, retry or delete a post, nor post on another Page', async () => {
    const a = await api.signup('fbp13');
    const b = await api.signup('fbp14');
    const page = await connectPage(a, 'P1');
    answer = { ok: false, error: 'boom' };
    const post = await make(a, page);
    expect((await api.http().get('/v2/facebook/posts').set(bearer(b.admin))).body.data).toEqual([]);
    expect(
      (
        await api
          .http()
          .post(`/v2/facebook/posts/${post.body.id}/publish`)
          .set(bearer(b.admin))
          .set('idempotency-key', randomUUID())
      ).status,
    ).toBe(404);
    expect(
      (await api.http().delete(`/v2/facebook/posts/${post.body.id}`).set(bearer(b.admin))).status,
    ).toBe(404);
    const stolen = await make(b, page);
    expect(stolen.status).toBe(422);
    expect(stolen.body.code).toBe('FB_PAGE_UNAVAILABLE');
  });

  it('reading and making posts are separate permissions', async () => {
    const t = await api.signup('fbp15');
    const page = await connectPage(t, 'P1');
    const viewer = await api.member(t, 'viewer', []);
    expect((await api.http().get('/v2/facebook/posts').set(bearer(viewer.token))).status).toBe(403);
    const reader = await api.member(t, 'reader', [['fb.posts.read']]);
    expect((await api.http().get('/v2/facebook/posts').set(bearer(reader.token))).status).toBe(200);
    expect((await api.http().get('/v2/facebook/my-posts').set(bearer(reader.token))).status).toBe(
      200,
    );
    const denied = await api
      .http()
      .post('/v2/facebook/posts')
      .set(bearer(reader.token))
      .set('idempotency-key', randomUUID())
      .send({ pageId: page.uuid, message: 'x' });
    expect(denied.status).toBe(403);
  });
});
