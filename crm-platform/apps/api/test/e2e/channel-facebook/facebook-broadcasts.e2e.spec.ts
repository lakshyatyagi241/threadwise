import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  FACEBOOK_GRAPH,
  type FacebookGraphFactory,
  type FacebookPageApi,
  type GraphResult,
  type MessengerButton,
} from '../../../src/infra/providers/channel-facebook/facebook.port';
import { FbBroadcastSenderService } from '../../../src/modules/channel-facebook/fb-broadcast-sender.service';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/** Messenger broadcasts (TW-FB-012 to 014): audience, draft, the sender run, pause, retry, delete. Real Postgres, fake Meta. */
let h: Harness;
let api: Api;
let sender: FbBroadcastSenderService;

interface Call {
  method: 'sendText' | 'sendButtonTemplate';
  psid: string;
  text: string;
  buttons?: readonly MessengerButton[];
}
const calls: Call[] = [];
/** What Meta answers for a person; the default is a success. */
let answer: (psid: string) => GraphResult<{ messageId: string }> = () => ({
  ok: true,
  data: { messageId: 'mid.sent' },
});

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  sender = h.app.get(FbBroadcastSenderService);
  sender.sleep = () => Promise.resolve();
  const graph = h.app.get<FacebookGraphFactory>(FACEBOOK_GRAPH);
  graph.forPage = () =>
    ({
      sendText: (psid: string, text: string) => {
        calls.push({ method: 'sendText', psid, text });
        return Promise.resolve(answer(psid));
      },
      sendButtonTemplate: (psid: string, text: string, buttons: readonly MessengerButton[]) => {
        calls.push({ method: 'sendButtonTemplate', psid, text, buttons });
        return Promise.resolve(answer(psid));
      },
    }) as unknown as FacebookPageApi;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  calls.length = 0;
  answer = () => ({ ok: true, data: { messageId: 'mid.sent' } });
  sender.now = () => new Date();
});

/** A connected Page row for the tenant, its token sealed the way the app seals it. */
async function connectPage(t: Tenant, pageId: string, status = 'connected') {
  const r = await h.owner.query(
    `INSERT INTO facebook_pages (org_id, page_id, name, access_token, status) VALUES ($1, $2, $3, $4, $5) RETURNING id, uuid`,
    [t.orgId, pageId, `Page ${pageId}`, h.app.get(CryptoService).encrypt(`tok-${pageId}`), status],
  );
  return { rowId: Number(r.rows[0].id), uuid: r.rows[0].uuid as string, pageId };
}
type Page = Awaited<ReturnType<typeof connectPage>>;

/** A Messenger thread whose person last wrote `hoursAgo` hours ago. */
async function thread(
  t: Tenant,
  page: Page,
  psid: string,
  hoursAgo: number,
  title = `Person ${psid}`,
) {
  const r = await h.owner.query(
    `INSERT INTO conversations (org_id, title, channel, provider, origin, status, inbox_status, raw_jid, last_inbound_at, last_message_at)
     VALUES ($1, $2, 'facebook', 'facebook', 'facebook', 'pending', 'open', $3, now() - ($4 || ' hours')::interval, now())
     RETURNING id`,
    [t.orgId, title, `fb:${page.pageId}:${psid}`, String(hoursAgo)],
  );
  return Number(r.rows[0].id);
}

/** A Page with `count` people inside the window (psids 1001.., named Person 1001..). */
async function pageWithPeople(t: Tenant, pageId: string, count: number) {
  const page = await connectPage(t, pageId);
  for (let i = 0; i < count; i++) await thread(t, page, String(1001 + i), 1);
  return page;
}
const psids = (count: number, from = 1001) =>
  Array.from({ length: count }, (_, i) => String(from + i));

const post = (t: Tenant, path: string, body?: object) =>
  api
    .http()
    .post(`/v2/facebook/${path}`)
    .set(bearer(t.admin))
    .set('idempotency-key', randomUUID())
    .send(body ?? {});
const create = (t: Tenant, page: Page, over: Record<string, unknown> = {}) =>
  post(t, 'broadcasts', {
    name: 'Weekend sale',
    pageId: page.uuid,
    body: 'Hi {name}!',
    psids: psids(2),
    ...over,
  });
const rowId = async (uuid: string) =>
  Number(
    (await h.owner.query(`SELECT id FROM facebook_broadcasts WHERE uuid = $1`, [uuid])).rows[0].id,
  );
const run = async (t: Tenant, uuid: string) => sender.run(t.orgId, await rowId(uuid));
const recipients = async (uuid: string) =>
  (
    await h.owner.query(
      `SELECT r.* FROM facebook_broadcast_recipients r JOIN facebook_broadcasts b ON b.org_id = r.org_id AND b.id = r.facebook_broadcast_id
       WHERE b.uuid = $1 ORDER BY r.id`,
      [uuid],
    )
  ).rows;
const broadcast = async (uuid: string) =>
  (await h.owner.query(`SELECT * FROM facebook_broadcasts WHERE uuid = $1`, [uuid])).rows[0];

describe('TW-FB-012: the audience and the draft', () => {
  it('compose lists each connected Page with only its Messenger threads inside 24 hours, newest first', async () => {
    const t = await api.signup('fbb1');
    const page = await connectPage(t, 'P1');
    await connectPage(t, 'P2', 'expired');
    await thread(t, page, '1001', 30); // too old
    await thread(t, page, '1002', 5);
    await thread(t, page, '1003', 1);
    await h.owner.query(
      `INSERT INTO conversations (org_id, title, channel, provider, origin, status, inbox_status, raw_jid, last_inbound_at)
       VALUES ($1, 'Ravi', 'facebook', 'facebook', 'facebook', 'pending', 'open', 'fb:P1:post:P1_77:777', now())`,
      [t.orgId],
    );
    await h.owner.query(
      `INSERT INTO conversations (org_id, title, channel, provider, origin, status, inbox_status, raw_jid, last_inbound_at)
       VALUES ($1, 'Other page', 'facebook', 'facebook', 'facebook', 'pending', 'open', 'fb:OTHER:555', now())`,
      [t.orgId],
    );
    const res = await api.http().get('/v2/facebook/broadcasts/compose').set(bearer(t.admin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.pages).toHaveLength(1);
    expect(res.body.pages[0]).toMatchObject({ id: page.uuid, pageId: 'P1', name: 'Page P1' });
    expect(res.body.pages[0].audience.map((a: { psid: string }) => a.psid)).toEqual([
      '1003',
      '1002',
    ]);
    expect(res.body.templates).toEqual([]);
  });

  it('a draft freezes the picked people; a forged id is dropped; the counts and status are set', async () => {
    const t = await api.signup('fbb2');
    const page = await pageWithPeople(t, 'P1', 3);
    const res = await create(t, page, { psids: ['1001', '1002', '9999', '1001'] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Weekend sale',
      status: 'draft',
      total: 2,
      sent: 0,
      progress: 0,
      pageName: 'Page P1',
    });
    const rows = await recipients(res.body.id);
    expect(rows.map((r) => r.psid)).toEqual(['1001', '1002']);
    expect(rows.every((r) => r.status === 'pending' && r.conversation_id !== null)).toBe(true);
    // The body is sealed at rest.
    expect((await broadcast(res.body.id)).body).not.toContain('Hi {name}');
    // A person who writes in after the draft is not added.
    await thread(t, page, '2000', 1);
    expect(await recipients(res.body.id)).toHaveLength(2);
  });

  it('no message, nobody inside the window and a Page that is not connected are refused', async () => {
    const t = await api.signup('fbb3');
    const page = await pageWithPeople(t, 'P1', 2);
    const empty = await create(t, page, { body: '' });
    expect(empty.status).toBe(422);
    expect(empty.body.code).toBe('FB_BROADCAST_EMPTY');
    const old = await thread(t, page, '3000', 30);
    expect(old).toBeGreaterThan(0);
    const none = await create(t, page, { psids: ['3000', '8888'] });
    expect(none.status).toBe(422);
    expect(none.body.code).toBe('FB_NO_RECIPIENTS');
    const dead = await connectPage(t, 'P3', 'expired');
    const gone = await create(t, dead);
    expect(gone.status).toBe(422);
    expect(gone.body.code).toBe('FB_PAGE_UNAVAILABLE');
    expect(
      (await post(t, 'broadcasts', { name: 'x', pageId: page.uuid, body: 'x', psids: [] })).status,
    ).toBe(400);
  });

  it('a Facebook template fills an empty body and carries its buttons; another channel’s or an unknown template is ignored', async () => {
    const t = await api.signup('fbb4');
    const page = await pageWithPeople(t, 'P1', 1);
    const tpl = (
      await h.owner.query(
        `INSERT INTO wa_templates (org_id, template_name, template_body, buttons, channel)
         VALUES ($1, 'fb-offer', 'Offer for {{name}}', $2::jsonb, 'facebook') RETURNING uuid`,
        [
          t.orgId,
          JSON.stringify([{ type: 'url', text: 'Shop', url: 'https://x.test' }, { text: 'Yes' }]),
        ],
      )
    ).rows[0];
    const tg = (
      await h.owner.query(
        `INSERT INTO wa_templates (org_id, template_name, template_body, channel) VALUES ($1, 'tg-offer', 'TG body', 'telegram') RETURNING uuid`,
        [t.orgId],
      )
    ).rows[0];
    const compose = await api.http().get('/v2/facebook/broadcasts/compose').set(bearer(t.admin));
    expect(compose.body.templates.map((x: { name: string }) => x.name)).toEqual(['fb-offer']);

    const made = await create(t, page, { body: '', templateId: tpl.uuid, psids: ['1001'] });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.templateId).toBe(tpl.uuid);
    await post(t, `broadcasts/${made.body.id}/start`);
    await run(t, made.body.id);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'sendButtonTemplate',
      psid: '1001',
      text: 'Offer for Person 1001',
    });
    expect(calls[0]!.buttons).toEqual([
      { type: 'web_url', title: 'Shop', url: 'https://x.test' },
      { type: 'postback', title: 'Yes', payload: 'tqr:Yes' },
    ]);

    const other = await create(t, page, {
      body: 'own words',
      templateId: tg.uuid,
      psids: ['1001'],
    });
    expect(other.status).toBe(201);
    expect(other.body.templateId).toBeNull();
    const unknown = await create(t, page, {
      body: 'own words',
      templateId: randomUUID(),
      psids: ['1001'],
    });
    expect(unknown.status).toBe(201);
    expect(unknown.body.templateId).toBeNull();
  });
});

describe('TW-FB-013: sending', () => {
  it('a run sends to everyone, personalised, in batches, mirrors into each thread and ends done', async () => {
    const t = await api.signup('fbb5');
    const page = await pageWithPeople(t, 'P1', 30);
    const made = await create(t, page, { psids: psids(30) });
    expect(made.body.total).toBe(30);
    const started = await post(t, `broadcasts/${made.body.id}/start`);
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body.status).toBe('sending');

    expect(await run(t, made.body.id)).toBe('done');
    expect(calls).toHaveLength(30);
    expect(calls[0]).toMatchObject({ method: 'sendText', psid: '1001', text: 'Hi Person 1001!' });
    const b = await broadcast(made.body.id);
    expect(b).toMatchObject({ status: 'done', sent: 30, failed: 0, blocked: 0 });
    expect(b.started_at).not.toBeNull();
    expect(b.finished_at).not.toBeNull();
    const rows = await recipients(made.body.id);
    expect(
      rows.every(
        (r) => r.status === 'sent' && r.provider_message_id === 'mid.sent' && r.sent_at !== null,
      ),
    ).toBe(true);

    const mirrored = await h.owner.query(
      `SELECT meta, direction, body FROM messages WHERE org_id = $1 AND provider = 'facebook' AND direction = 'out' ORDER BY id`,
      [t.orgId],
    );
    expect(mirrored.rows).toHaveLength(30);
    expect(mirrored.rows[0].meta).toMatchObject({
      source: 'facebook_broadcast',
      broadcast_id: made.body.id,
      wa_message_id: 'mid.sent',
    });
    const thread1 = (
      await h.owner.query(
        `SELECT unread_count, last_outbound_at FROM conversations WHERE org_id = $1 AND raw_jid = 'fb:P1:1001'`,
        [t.orgId],
      )
    ).rows[0];
    expect(thread1.last_outbound_at).not.toBeNull();
    expect(thread1.unread_count).toBe(0);
  });

  it('Meta’s refusals split into blocked (cannot be reached) and failed (can be retried); the counters follow the rows', async () => {
    const t = await api.signup('fbb6');
    const page = await pageWithPeople(t, 'P1', 4);
    answer = (psid) =>
      psid === '1002'
        ? {
            ok: false,
            error: '(#10) This message is sent outside of the allowed window.',
            code: 10,
          }
        : psid === '1003'
          ? { ok: false, error: 'Facebook could not be reached' }
          : { ok: true, data: { messageId: `mid.${psid}` } };
    const made = await create(t, page, { psids: psids(4) });
    await post(t, `broadcasts/${made.body.id}/start`);
    await run(t, made.body.id);
    const rows = await recipients(made.body.id);
    expect(rows.map((r) => r.status)).toEqual(['sent', 'blocked', 'failed', 'sent']);
    expect(rows[1].error).toMatch(/outside of the allowed window/);
    const b = await broadcast(made.body.id);
    expect(b).toMatchObject({ status: 'done', sent: 2, failed: 1, blocked: 1 });
    const list = await api.http().get('/v2/facebook/broadcasts').set(bearer(t.admin));
    expect(list.body.data[0]).toMatchObject({ sent: 2, failed: 1, blocked: 1, progress: 100 });
  });

  it('the window is checked again for each person when sending: one that closed after the draft is blocked, not sent', async () => {
    const t = await api.signup('fbb7');
    const page = await pageWithPeople(t, 'P1', 3);
    const made = await create(t, page, { psids: psids(3) });
    await h.owner.query(
      `UPDATE conversations SET last_inbound_at = now() - interval '30 hours' WHERE org_id = $1 AND raw_jid = 'fb:P1:1002'`,
      [t.orgId],
    );
    await post(t, `broadcasts/${made.body.id}/start`);
    await run(t, made.body.id);
    expect(calls.map((c) => c.psid)).toEqual(['1001', '1003']);
    const rows = await recipients(made.body.id);
    expect(rows[1]).toMatchObject({
      status: 'blocked',
      error: 'Outside the 24-hour messaging window.',
    });
    expect((await broadcast(made.body.id)).blocked).toBe(1);
  });

  it('a Page that is no longer connected when the job runs fails the broadcast with the reason', async () => {
    const t = await api.signup('fbb8');
    const page = await pageWithPeople(t, 'P1', 2);
    const made = await create(t, page);
    await post(t, `broadcasts/${made.body.id}/start`);
    await h.owner.query(`UPDATE facebook_pages SET status = 'expired' WHERE id = $1`, [page.rowId]);
    expect(await run(t, made.body.id)).toBe('failed');
    expect(await broadcast(made.body.id)).toMatchObject({
      status: 'failed',
      last_error: 'The Page this broadcast belongs to is no longer connected.',
    });
    expect(calls).toHaveLength(0);
  });

  it('a token Meta revoked mid-run flags the Page and the next batch stops', async () => {
    const t = await api.signup('fbb9');
    const page = await pageWithPeople(t, 'P1', 30);
    answer = () => ({ ok: false, error: 'Error validating access token', code: 190 });
    const made = await create(t, page, { psids: psids(30) });
    await post(t, `broadcasts/${made.body.id}/start`);
    expect(await run(t, made.body.id)).toBe('failed');
    expect(
      (await h.owner.query(`SELECT status FROM facebook_pages WHERE id = $1`, [page.rowId])).rows[0]
        .status,
    ).toBe('expired');
    // The first batch of 25 was attempted, the rest were left for after reconnecting.
    expect(calls).toHaveLength(25);
    expect((await broadcast(made.body.id)).status).toBe('failed');
  });
});

describe('TW-FB-014: start, pause, retry, delete', () => {
  it('start refuses when nobody is pending or the Page is revoked; pause then start sends each person once', async () => {
    const t = await api.signup('fbb10');
    const page = await pageWithPeople(t, 'P1', 4);
    const made = await create(t, page, { psids: psids(4) });

    await h.owner.query(`UPDATE facebook_pages SET status = 'expired' WHERE id = $1`, [page.rowId]);
    const revoked = await post(t, `broadcasts/${made.body.id}/start`);
    expect(revoked.status).toBe(422);
    expect(revoked.body.code).toBe('FB_PAGE_UNAVAILABLE');
    await h.owner.query(`UPDATE facebook_pages SET status = 'connected' WHERE id = $1`, [
      page.rowId,
    ]);

    expect((await post(t, `broadcasts/${made.body.id}/start`)).body.status).toBe('sending');
    expect((await post(t, `broadcasts/${made.body.id}/start`)).body.status).toBe('sending');
    const paused = await post(t, `broadcasts/${made.body.id}/pause`);
    expect(paused.body.status).toBe('draft');
    expect(await run(t, made.body.id)).toBe('skipped');
    expect(calls).toHaveLength(0);

    await post(t, `broadcasts/${made.body.id}/start`);
    await run(t, made.body.id);
    expect(calls.map((c) => c.psid)).toEqual(psids(4));
    await post(t, `broadcasts/${made.body.id}/start`).then((r) => {
      expect(r.status).toBe(422);
      expect(r.body.code).toBe('FB_NOTHING_TO_SEND');
    });
    expect(calls).toHaveLength(4);
  });

  it('retry puts failed people back (blocked stay), refuses with none failed and while sending', async () => {
    const t = await api.signup('fbb11');
    const page = await pageWithPeople(t, 'P1', 3);
    answer = (psid) =>
      psid === '1001'
        ? { ok: false, error: 'Facebook could not be reached' }
        : psid === '1002'
          ? { ok: false, error: "(#551) This person isn't available right now." }
          : { ok: true, data: { messageId: 'mid' } };
    const made = await create(t, page, { psids: psids(3) });
    await post(t, `broadcasts/${made.body.id}/start`);
    await run(t, made.body.id);
    expect(await broadcast(made.body.id)).toMatchObject({
      status: 'done',
      sent: 1,
      failed: 1,
      blocked: 1,
    });

    answer = () => ({ ok: true, data: { messageId: 'mid.retry' } });
    calls.length = 0;
    const retried = await post(t, `broadcasts/${made.body.id}/retry`);
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect(retried.body).toEqual({ retried: 1 });
    expect(await broadcast(made.body.id)).toMatchObject({ status: 'draft', failed: 0, blocked: 1 });
    await post(t, `broadcasts/${made.body.id}/start`);
    await run(t, made.body.id);
    expect(calls.map((c) => c.psid)).toEqual(['1001']);
    expect((await recipients(made.body.id)).map((r) => r.status)).toEqual([
      'sent',
      'blocked',
      'sent',
    ]);

    const again = await post(t, `broadcasts/${made.body.id}/retry`);
    expect(again.status).toBe(422);
    expect(again.body.code).toBe('FB_NOTHING_TO_RETRY');

    const live = await create(t, page);
    await post(t, `broadcasts/${live.body.id}/start`);
    const busy = await post(t, `broadcasts/${live.body.id}/retry`);
    expect(busy.status).toBe(409);
  });

  it('delete removes the broadcast and its recipients in any status; the list totals cover them all', async () => {
    const t = await api.signup('fbb12');
    const page = await pageWithPeople(t, 'P1', 3);
    const a = await create(t, page, { psids: psids(3) });
    const b = await create(t, page, { psids: psids(2) });
    await post(t, `broadcasts/${a.body.id}/start`);
    await run(t, a.body.id);
    const list = await api.http().get('/v2/facebook/broadcasts').set(bearer(t.admin));
    expect(list.body.data).toHaveLength(2);
    expect(list.body.stats).toEqual({
      total: 2,
      sent: 3,
      failed: 0,
      blocked: 0,
      audience: 5,
      sending: 0,
    });

    expect(
      (await api.http().delete(`/v2/facebook/broadcasts/${a.body.id}`).set(bearer(t.admin))).status,
    ).toBe(204);
    expect(
      (await api.http().delete(`/v2/facebook/broadcasts/${b.body.id}`).set(bearer(t.admin))).status,
    ).toBe(204);
    expect(await recipients(a.body.id)).toHaveLength(0);
    expect(
      (await api.http().delete(`/v2/facebook/broadcasts/${b.body.id}`).set(bearer(t.admin))).status,
    ).toBe(404);
  });
});

describe('isolation and access', () => {
  it('another organization cannot see, start or delete a broadcast, nor pick from another Page', async () => {
    const a = await api.signup('fbb13');
    const b = await api.signup('fbb14');
    const page = await pageWithPeople(a, 'P1', 2);
    const made = await create(a, page);
    expect(
      (await api.http().get('/v2/facebook/broadcasts').set(bearer(b.admin))).body.data,
    ).toEqual([]);
    expect((await post(b, `broadcasts/${made.body.id}/start`)).status).toBe(404);
    expect(
      (await api.http().delete(`/v2/facebook/broadcasts/${made.body.id}`).set(bearer(b.admin)))
        .status,
    ).toBe(404);
    const stolen = await post(b, 'broadcasts', {
      name: 'x',
      pageId: page.uuid,
      body: 'x',
      psids: ['1001'],
    });
    expect(stolen.status).toBe(422);
    expect(stolen.body.code).toBe('FB_PAGE_UNAVAILABLE');
  });

  it('reading and managing broadcasts are separate permissions', async () => {
    const t = await api.signup('fbb15');
    const viewer = await api.member(t, 'viewer', []);
    expect((await api.http().get('/v2/facebook/broadcasts').set(bearer(viewer.token))).status).toBe(
      403,
    );
    const reader = await api.member(t, 'reader', [['fb.broadcasts.read']]);
    expect((await api.http().get('/v2/facebook/broadcasts').set(bearer(reader.token))).status).toBe(
      200,
    );
    const denied = await api
      .http()
      .post('/v2/facebook/broadcasts')
      .set(bearer(reader.token))
      .set('idempotency-key', randomUUID())
      .send({ name: 'x', pageId: randomUUID(), body: 'x', psids: ['1'] });
    expect(denied.status).toBe(403);
  });
});
