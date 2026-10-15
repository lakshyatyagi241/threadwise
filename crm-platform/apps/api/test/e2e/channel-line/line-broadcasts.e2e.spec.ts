import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LineBroadcastSenderService } from '../../../src/modules/channel-line/line-broadcast-sender.service';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';
import {
  FakeLine,
  connectChannel,
  delivery,
  deliver,
  textEvent,
  userId,
  type Connected,
} from './support';

/** LINE broadcasts: audience, draft, the sender run, pause, retry, consent, delete. Real Postgres, fake LINE. */
let h: Harness;
let api: Api;
let sender: LineBroadcastSenderService;
const fake = new FakeLine();

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  fake.install(h);
  sender = h.app.get(LineBroadcastSenderService);
  sender.sleep = () => Promise.resolve();
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => fake.reset());

/** A channel with `count` direct users (ids U…1, U…2, …) who each wrote once, so each has a thread. */
async function channelWithUsers(t: Tenant, count: number): Promise<Connected> {
  const c = await connectChannel(h, api, fake, t);
  for (let i = 1; i <= count; i++) {
    await deliver(api, c, delivery(textEvent(userId(i), `hi from ${i}`)));
  }
  fake.reset();
  return c;
}
const ids = (count: number) => Array.from({ length: count }, (_, i) => userId(i + 1));
const nameOf = (i: number) => `Name ${userId(i).slice(-3)}`;

const post = (t: Tenant, path: string, body?: object) =>
  api
    .http()
    .post(`/v2/line/${path}`)
    .set(bearer(t.admin))
    .set('idempotency-key', randomUUID())
    .send(body ?? {});
const create = (t: Tenant, c: Connected, over: object = {}) =>
  post(t, 'broadcasts', {
    name: 'Promo',
    channelId: c.uuid,
    body: 'Hi {{name}}',
    userIds: ids(3),
    ...over,
  });
const code = (res: { body: { code?: string; error?: { code?: string } } }) =>
  res.body.code ?? res.body.error?.code;
const recipients = async (id: string) =>
  (
    await h.owner.query(
      `SELECT r.line_user_id, r.status, r.error, r.provider_message_id FROM line_broadcast_recipients r
       JOIN line_broadcasts b ON b.org_id = r.org_id AND b.id = r.line_broadcast_id
       WHERE b.uuid = $1 ORDER BY r.id`,
      [id],
    )
  ).rows as Array<{
    line_user_id: string;
    status: string;
    error: string | null;
    provider_message_id: string | null;
  }>;
const rowOf = async (id: string) =>
  (await h.owner.query(`SELECT * FROM line_broadcasts WHERE uuid = $1`, [id])).rows[0];
const runId = async (id: string) => Number((await rowOf(id)).id);
const pushes = () =>
  fake.of('push').map((c) => ({
    to: c.args[0] as string,
    messages: c.args[1] as Array<Record<string, unknown>>,
  }));

describe('the audience is the direct users a channel carries', () => {
  it('lists only user ids (U…) of this channel, newest first; groups and other channels are left out', async () => {
    const t = await api.signup('lb1');
    const u = await api.signup('lb1b');
    const a = await channelWithUsers(t, 2);
    await deliver(
      api,
      a,
      delivery(
        textEvent(userId(9), 'in a group', {
          source: { type: 'group', groupId: 'Cgroup0001', userId: userId(9) },
        }),
      ),
    );
    await channelWithUsers(t, 3);
    const foreign = await channelWithUsers(u, 1);

    const res = await api.http().get(`/v2/line/channels/${a.uuid}/audience`).set(bearer(t.admin));
    expect(res.status).toBe(200);
    expect(res.body.data.map((x: { userId: string }) => x.userId)).toEqual([userId(2), userId(1)]);
    expect(res.body.data[0]).toMatchObject({ title: nameOf(2), unread: 1 });

    expect(
      (await api.http().get(`/v2/line/channels/${foreign.uuid}/audience`).set(bearer(t.admin)))
        .status,
    ).toBe(404);
  });
});

describe('composing a draft', () => {
  it('freezes the recipients, drops forged ids and totals what is left', async () => {
    const t = await api.signup('lb2');
    const c = await channelWithUsers(t, 3);
    const res = await create(t, c, {
      userIds: [userId(1), userId(2), 'Uforged', 'Cgroup0001', userId(1)],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      status: 'draft',
      total: 2,
      sent: 0,
      progress: 0,
      hasMedia: false,
    });
    expect((await recipients(res.body.id)).map((r) => r.line_user_id)).toEqual([
      userId(1),
      userId(2),
    ]);
    expect((await recipients(res.body.id))[0]).toMatchObject({ status: 'pending' });
    // The text is encrypted at rest.
    expect((await rowOf(res.body.id)).body).not.toContain('Hi');
    expect(await api.auditCount(t.orgId, 'line_broadcasts', 'insert')).toBe(1);
    expect((await api.events(t.orgId, 'line.broadcast.created'))[0]).toMatchObject({ total: 2 });
  });

  it('refuses nothing to send and nobody to send to', async () => {
    const t = await api.signup('lb3');
    const c = await channelWithUsers(t, 1);
    const empty = await create(t, c, { body: '' });
    expect(empty.status).toBe(422);
    expect(code(empty)).toBe('LINE_BROADCAST_EMPTY');
    const nobody = await create(t, c, { userIds: ['Unotmine'] });
    expect(nobody.status).toBe(422);
    expect(code(nobody)).toBe('LINE_NO_RECIPIENTS');
    expect(
      (
        await post(t, 'broadcasts', {
          name: '',
          channelId: c.uuid,
          body: 'x',
          userIds: [userId(1)],
        })
      ).status,
    ).toBe(422);
  });

  it("a LINE template fills an empty body and its buttons ride on the send; another workspace's channel is not found", async () => {
    const t = await api.signup('lb4');
    const u = await api.signup('lb4b');
    const c = await channelWithUsers(t, 1);
    const tpl = (
      await h.owner.query(
        `INSERT INTO wa_templates (org_id, template_name, template_body, buttons, channel)
         VALUES ($1, 'line-offer', 'Offer for {{name}}', $2::jsonb, 'line') RETURNING uuid`,
        [t.orgId, JSON.stringify([{ type: 'url', text: 'Shop', url: 'https://x.test' }])],
      )
    ).rows[0];
    await h.owner.query(
      `INSERT INTO wa_templates (org_id, template_name, template_body, buttons, channel) VALUES ($1, 'tg', 'x', '[]'::jsonb, 'telegram')`,
      [t.orgId],
    );
    const compose = await api.http().get('/v2/line/broadcasts/compose').set(bearer(t.admin));
    expect(compose.body.templates.map((x: { name: string }) => x.name)).toEqual(['line-offer']);
    expect(compose.body.channels.map((x: { id: string }) => x.id)).toEqual([c.uuid]);

    const made = await create(t, c, { body: '', templateId: tpl.uuid, userIds: [userId(1)] });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    await post(t, `broadcasts/${made.body.id}/start`);
    await sender.run(t.orgId, await runId(made.body.id));
    const [only] = pushes();
    expect(only!.messages).toHaveLength(1);
    expect(only!.messages[0]).toMatchObject({
      type: 'template',
      template: {
        type: 'buttons',
        text: `Offer for ${nameOf(1)}`,
        actions: [{ type: 'uri', label: 'Shop', uri: 'https://x.test' }],
      },
    });
    expect((await create(u, c)).status).toBe(404);
  });
});

describe('sending, pausing, retrying', () => {
  it('pushes in batches of 40, personalises, tells blocked from failed, mirrors into the thread and ends done', async () => {
    const t = await api.signup('lb5');
    const c = await channelWithUsers(t, 45);
    fake.push = (to) =>
      to === userId(2)
        ? { ok: false, status: 400, error: 'The user has blocked the account' }
        : to === userId(3)
          ? { ok: false, status: 500, error: 'Something odd' }
          : { ok: true, status: 200, data: { sentMessages: [{ id: `m-${to.slice(-2)}` }] } };
    const made = await create(t, c, { userIds: ids(45) });
    const started = await post(t, `broadcasts/${made.body.id}/start`);
    expect(started.status).toBe(200);
    expect(started.body.status).toBe('sending');
    expect(started.body.startedAt).not.toBeNull();

    const id = await runId(made.body.id);
    expect(await sender.run(t.orgId, id)).toBe('done');

    expect(pushes().map((p) => p.to)).toEqual(ids(45));
    expect(pushes().every((p) => p.messages.length <= 5)).toBe(true);
    expect(pushes()[0]!.messages).toEqual([{ type: 'text', text: `Hi ${nameOf(1)}` }]);
    // Every push carried the channel's own token.
    expect(new Set(fake.of('push').map((x) => x.token))).toEqual(new Set([c.accessToken]));

    const rows = await recipients(made.body.id);
    expect(rows.find((r) => r.line_user_id === userId(2))).toMatchObject({ status: 'blocked' });
    expect(rows.find((r) => r.line_user_id === userId(3))).toMatchObject({
      status: 'failed',
      error: 'Something odd',
    });
    expect(rows.find((r) => r.line_user_id === userId(4))).toMatchObject({
      status: 'sent',
      provider_message_id: 'm-04',
    });
    const row = await rowOf(made.body.id);
    expect(row).toMatchObject({ status: 'done', sent: 43, failed: 1, blocked: 1 });
    expect(row.finished_at).not.toBeNull();

    const outbound = await h.owner.query(
      `SELECT count(*)::int AS n FROM messages WHERE org_id = $1 AND direction = 'out' AND meta ->> 'source' = 'broadcast' AND sender_kind = 'broadcast'`,
      [t.orgId],
    );
    expect(outbound.rows[0].n).toBe(43);

    // A second run of a finished broadcast does nothing: nobody is messaged twice.
    fake.reset();
    expect(await sender.run(t.orgId, id)).toBe('skipped');
    expect(fake.of('push')).toHaveLength(0);
  });

  it('a picture goes first as its own bubble, then the text; video and audio have their own message types', async () => {
    const t = await api.signup('lb6');
    const c = await channelWithUsers(t, 2);
    const made = await create(t, c, {
      userIds: ids(1),
      mediaUrl: 'https://cdn.example.com/promo.png',
    });
    expect(made.body.hasMedia).toBe(true);
    await post(t, `broadcasts/${made.body.id}/start`);
    await sender.run(t.orgId, await runId(made.body.id));
    expect(pushes()[0]!.messages).toEqual([
      {
        type: 'image',
        originalContentUrl: 'https://cdn.example.com/promo.png',
        previewImageUrl: 'https://cdn.example.com/promo.png',
      },
      { type: 'text', text: `Hi ${nameOf(1)}` },
    ]);

    fake.reset();
    const video = await create(t, c, {
      userIds: [userId(2)],
      mediaUrl: 'https://cdn.example.com/clip.mp4',
      body: '',
    });
    expect((await rowOf(video.body.id)).media_kind).toBe('video');
    await post(t, `broadcasts/${video.body.id}/start`);
    await sender.run(t.orgId, await runId(video.body.id));
    expect(pushes()[0]!.messages).toHaveLength(1);
    expect(pushes()[0]!.messages[0]).toMatchObject({ type: 'video' });
  });

  it('a contact who withdrew consent is blocked and not messaged', async () => {
    const t = await api.signup('lb6c');
    const c = await channelWithUsers(t, 3);
    await h.owner.query(
      `UPDATE contacts SET is_unsubscribed = true WHERE org_id = $1 AND channel_uid = $2`,
      [t.orgId, userId(2)],
    );
    const made = await create(t, c, { userIds: ids(3) });
    await post(t, `broadcasts/${made.body.id}/start`);
    await sender.run(t.orgId, await runId(made.body.id));
    expect(pushes().map((p) => p.to)).toEqual([userId(1), userId(3)]);
    const rows = await recipients(made.body.id);
    expect(rows.find((r) => r.line_user_id === userId(2))).toMatchObject({ status: 'blocked' });
    expect(rows.find((r) => r.line_user_id === userId(2))!.error).toMatch(/consent/);
    expect(await rowOf(made.body.id)).toMatchObject({ status: 'done', sent: 2, blocked: 1 });
  });

  it('a paused channel cannot start a broadcast, and a channel paused mid-way fails a running one with a reason', async () => {
    const t = await api.signup('lb7');
    const c = await channelWithUsers(t, 2);
    const made = await create(t, c, { userIds: ids(2) });
    await post(t, `channels/${c.uuid}/toggle`);
    const refused = await post(t, `broadcasts/${made.body.id}/start`);
    expect(refused.status).toBe(422);
    expect(code(refused)).toBe('LINE_CHANNEL_UNAVAILABLE');

    await post(t, `channels/${c.uuid}/toggle`);
    await post(t, `broadcasts/${made.body.id}/start`);
    await h.owner.query(`UPDATE line_channels SET active = false WHERE id = $1`, [c.rowId]);
    expect(await sender.run(t.orgId, await runId(made.body.id))).toBe('failed');
    expect(await rowOf(made.body.id)).toMatchObject({ status: 'failed' });
    expect((await rowOf(made.body.id)).last_error).toMatch(/paused|connected/);
    expect(fake.of('push')).toHaveLength(0);
  });

  it('pause stops at the next batch, leaves the rest pending, and a second start sends only those', async () => {
    const t = await api.signup('lb8');
    const c = await channelWithUsers(t, 45);
    const made = await create(t, c, { userIds: ids(45) });
    await post(t, `broadcasts/${made.body.id}/start`);
    const id = await runId(made.body.id);

    let slept = 0;
    sender.sleep = async () => {
      slept += 1;
      if (slept === 40) await post(t, `broadcasts/${made.body.id}/pause`);
    };
    expect(await sender.run(t.orgId, id)).toBe('stopped');
    sender.sleep = () => Promise.resolve();
    expect(fake.of('push')).toHaveLength(40);
    expect(await rowOf(made.body.id)).toMatchObject({ status: 'draft', sent: 40 });
    expect((await recipients(made.body.id)).filter((r) => r.status === 'pending')).toHaveLength(5);

    await post(t, `broadcasts/${made.body.id}/start`);
    expect(await sender.run(t.orgId, id)).toBe('done');
    expect(fake.of('push')).toHaveLength(45);
    expect(new Set(pushes().map((p) => p.to)).size).toBe(45);
    expect(await rowOf(made.body.id)).toMatchObject({ status: 'done', sent: 45 });
  });

  it('retry puts only failed people back, blocked stay, and it is refused with nothing to retry', async () => {
    const t = await api.signup('lb9');
    const c = await channelWithUsers(t, 3);
    fake.push = (to) =>
      to === userId(1)
        ? { ok: false, status: 400, error: 'The user has blocked the account' }
        : to === userId(2)
          ? { ok: false, status: 503, error: 'Service unavailable' }
          : { ok: true, status: 200, data: { sentMessages: [{ id: 'x' }] } };
    const made = await create(t, c);
    await post(t, `broadcasts/${made.body.id}/start`);
    const id = await runId(made.body.id);
    await sender.run(t.orgId, id);

    const retried = await post(t, `broadcasts/${made.body.id}/retry`);
    expect(retried.status).toBe(200);
    expect(retried.body).toEqual({ retried: 1 });
    expect(await rowOf(made.body.id)).toMatchObject({
      status: 'draft',
      sent: 1,
      failed: 0,
      blocked: 1,
    });
    expect((await rowOf(made.body.id)).finished_at).toBeNull();
    expect(await api.events(t.orgId, 'line.broadcast.retry_requested')).toHaveLength(1);

    fake.reset();
    fake.push = () => ({ ok: true, status: 200, data: { sentMessages: [{ id: 'y' }] } });
    await post(t, `broadcasts/${made.body.id}/start`);
    await sender.run(t.orgId, id);
    expect(pushes().map((p) => p.to)).toEqual([userId(2)]);

    const again = await post(t, `broadcasts/${made.body.id}/retry`);
    expect(again.status).toBe(422);
    expect(code(again)).toBe('LINE_NOTHING_TO_RETRY');
  });

  it('start with nobody pending is refused', async () => {
    const t = await api.signup('lb10');
    const c = await channelWithUsers(t, 1);
    const made = await create(t, c, { userIds: ids(1) });
    await post(t, `broadcasts/${made.body.id}/start`);
    await sender.run(t.orgId, await runId(made.body.id));
    const again = await post(t, `broadcasts/${made.body.id}/start`);
    expect(again.status).toBe(422);
    expect(code(again)).toBe('LINE_NOTHING_TO_SEND');
  });
});

describe('listing, deleting, isolation, permissions', () => {
  it('the list carries totals across every broadcast, delete works in any status and takes the recipients with it', async () => {
    const t = await api.signup('lb11');
    const c = await channelWithUsers(t, 3);
    const one = await create(t, c);
    const two = await create(t, c, { name: 'Second' });
    await post(t, `broadcasts/${two.body.id}/start`);
    await sender.run(t.orgId, await runId(two.body.id));

    const list = await api.http().get('/v2/line/broadcasts').set(bearer(t.admin));
    expect(list.status).toBe(200);
    expect(list.body.stats).toMatchObject({ total: 2, sent: 3, audience: 6, sending: 0 });
    expect(list.body.data.map((x: { name: string }) => x.name)).toEqual(['Second', 'Promo']);
    expect(list.body.data[0]).toMatchObject({ channelId: c.uuid, status: 'done', progress: 100 });

    const del = await api
      .http()
      .delete(`/v2/line/broadcasts/${one.body.id}`)
      .set(bearer(t.admin))
      .set('idempotency-key', randomUUID());
    expect(del.status).toBe(204);
    expect(await recipients(one.body.id)).toEqual([]);
    expect(await rowOf(one.body.id)).toBeUndefined();
    expect(await api.events(t.orgId, 'line.broadcast.deleted')).toHaveLength(1);
  });

  it("another workspace's broadcast is 404 for every action, and each route needs its permission", async () => {
    const t = await api.signup('lb12');
    const u = await api.signup('lb12b');
    const c = await channelWithUsers(t, 1);
    const made = await create(t, c, { userIds: ids(1) });
    for (const path of ['start', 'pause', 'retry']) {
      expect((await post(u, `broadcasts/${made.body.id}/${path}`)).status).toBe(404);
    }
    const foreignDelete = await api
      .http()
      .delete(`/v2/line/broadcasts/${made.body.id}`)
      .set(bearer(u.admin))
      .set('idempotency-key', randomUUID());
    expect(foreignDelete.status).toBe(404);

    const viewer = await api.member(t, 'viewer', []);
    expect((await api.http().get('/v2/line/broadcasts').set(bearer(viewer.token))).status).toBe(
      403,
    );
    const reader = await api.member(t, 'reader', [['line.broadcasts.read']]);
    expect((await api.http().get('/v2/line/broadcasts').set(bearer(reader.token))).status).toBe(
      200,
    );
    const denied = await api
      .http()
      .post('/v2/line/broadcasts')
      .set(bearer(reader.token))
      .set('idempotency-key', randomUUID())
      .send({ name: 'x', channelId: c.uuid, body: 'x', userIds: [userId(1)] });
    expect(denied.status).toBe(403);
    expect((await api.http().get('/v2/line/broadcasts')).status).toBe(401);
  });
});
