import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { ChannelIngestPublisher } from '../../../src/modules/chat-conversations';
import { ReceiptsService } from '../../../src/modules/chat-conversations/receipts.service';
import { VibBroadcastSenderService } from '../../../src/modules/channel-viber/vib-broadcast-sender.service';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';
import { connect, fake, installFake, push, resetFake, textEvent, type Channel } from './support';

/** Viber broadcasts (TW-VIB-010 to 014): audience, draft, the sender run, receipts, pause, retry, delete. Real Postgres, fake Viber. */
let h: Harness;
let api: Api;
let sender: VibBroadcastSenderService;
const receipts: Array<{ orgId: number; channelUuid: string; receipt: Record<string, unknown> }> =
  [];

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  sender = h.app.get(VibBroadcastSenderService);
  sender.sleep = () => Promise.resolve();
  installFake(h);
  h.app.get(ChannelIngestPublisher).enqueueReceipt = (orgId, channelUuid, receipt) => {
    receipts.push({ orgId, channelUuid, receipt: { ...receipt, at: receipt.at.toISOString() } });
    return Promise.resolve('job');
  };
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  resetFake();
  receipts.length = 0;
});

/** A channel with `count` users who each wrote to it once (ids user-0.., titled Person0..). */
async function channelWithUsers(t: Tenant, count: number, viberId?: string) {
  const c = await connect(api, h, t, viberId);
  for (let i = 0; i < count; i++) {
    await push(api, c, textEvent(`user-${i}`, 'hi', `Person${i}`));
  }
  return c;
}
const ids = (count: number) => Array.from({ length: count }, (_, i) => `user-${i}`);

const post = (t: Tenant, path: string, body?: object) =>
  api
    .http()
    .post(`/v2/viber/${path}`)
    .set(bearer(t.admin))
    .set('idempotency-key', randomUUID())
    .send(body ?? {});
const create = (t: Tenant, c: Channel, over: object = {}) =>
  post(t, 'broadcasts', {
    name: 'Promo',
    channelId: c.uuid,
    body: 'Hello all',
    userIds: ids(3),
    ...over,
  });
const code = (res: { body: { code?: string; error?: { code?: string } } }) =>
  res.body.code ?? res.body.error?.code;
const recipients = async (id: string) =>
  (
    await h.owner.query(
      `SELECT r.viber_user_id, r.status, r.error, r.message_token, r.delivered_at, r.seen_at FROM viber_broadcast_recipients r
       JOIN viber_broadcasts b ON b.org_id = r.org_id AND b.id = r.viber_broadcast_id
       WHERE b.uuid = $1 ORDER BY r.id`,
      [id],
    )
  ).rows as Array<{
    viber_user_id: string;
    status: string;
    error: string | null;
    message_token: string | null;
    delivered_at: Date | null;
    seen_at: Date | null;
  }>;
const rowOf = async (id: string) =>
  (await h.owner.query(`SELECT * FROM viber_broadcasts WHERE uuid = $1`, [id])).rows[0];
const run = async (t: Tenant, id: string) => sender.run(t.orgId, Number((await rowOf(id)).id));
const calls = () => fake.calls.filter((c) => c.method === 'broadcast');

/** Adds `extra` pending recipients that have no thread, so one broadcast spans more than one call. */
async function pad(id: string, extra: number) {
  const b = await rowOf(id);
  await h.owner.query(
    `INSERT INTO viber_broadcast_recipients (org_id, viber_broadcast_id, viber_user_id, title, status)
     SELECT $1, $2, 'pad-' || g, 'Pad ' || g, 'pending' FROM generate_series(1, $3) g`,
    [b.org_id, b.id, extra],
  );
  await h.owner.query(`UPDATE viber_broadcasts SET total = total + $2 WHERE id = $1`, [
    b.id,
    extra,
  ]);
}

describe('TW-VIB-010: the audience is the users a channel carries', () => {
  it("lists only this channel's threads, newest first, and never another workspace's", async () => {
    const t = await api.signup('vb1');
    const u = await api.signup('vb1b');
    const a = await channelWithUsers(t, 2, 'acc-a');
    await channelWithUsers(t, 3, 'acc-b');
    const other = await channelWithUsers(u, 1);

    const res = await api.http().get(`/v2/viber/channels/${a.uuid}/users`).set(bearer(t.admin));
    expect(res.status).toBe(200);
    expect(res.body.data.map((x: { userId: string }) => x.userId).sort()).toEqual([
      'user-0',
      'user-1',
    ]);
    expect(res.body.data[0]).toMatchObject({
      title: expect.stringMatching(/^Person/),
      lastMessageAt: expect.any(String),
    });
    expect(
      (await api.http().get(`/v2/viber/channels/${other.uuid}/users`).set(bearer(t.admin))).status,
    ).toBe(404);
  });

  it('a user who only subscribed is in the audience too', async () => {
    const t = await api.signup('vb2');
    const c = await connect(api, h, t);
    await push(api, c, {
      event: 'subscribed',
      timestamp: 1,
      user: { id: 'only-sub', name: 'Quiet' },
    });
    const res = await api.http().get(`/v2/viber/channels/${c.uuid}/users`).set(bearer(t.admin));
    expect(res.body.data).toEqual([
      expect.objectContaining({ userId: 'only-sub', title: 'Quiet' }),
    ]);
  });
});

describe('TW-VIB-012: composing a draft', () => {
  it('freezes the recipients, drops forged ids, keeps the text encrypted at rest and totals what is left', async () => {
    const t = await api.signup('vb3');
    const u = await api.signup('vb3b');
    const c = await channelWithUsers(t, 3);
    await channelWithUsers(u, 1);

    const made = await create(t, c, {
      userIds: ['user-0', 'user-1', 'user-1', 'forged', 'user-0'],
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body).toMatchObject({
      name: 'Promo',
      channelId: c.uuid,
      status: 'draft',
      total: 2,
      sent: 0,
      failed: 0,
      delivered: 0,
      seen: 0,
      progress: 0,
      hasMedia: false,
    });
    expect((await recipients(made.body.id)).map((r) => r.viber_user_id)).toEqual([
      'user-0',
      'user-1',
    ]);
    const row = await rowOf(made.body.id);
    expect(row.body).not.toContain('Hello all');
    expect(row.body).toMatch(/^v1:/);
    expect((await api.events(t.orgId, 'viber.broadcast.created'))[0]).toMatchObject({ total: 2 });

    // Someone who writes after the draft is saved is not added.
    await push(api, c, textEvent('late-user', 'hi'));
    expect(await recipients(made.body.id)).toHaveLength(2);
  });

  it('refuses a draft with no message and no file, with nobody to send to, an unknown channel and a foreign one', async () => {
    const t = await api.signup('vb4');
    const u = await api.signup('vb4b');
    const c = await channelWithUsers(t, 2);
    const foreign = await channelWithUsers(u, 1);
    const empty = await create(t, c, { body: '' });
    expect(empty.status).toBe(422);
    expect(code(empty)).toBe('VIB_BROADCAST_EMPTY');
    const nobody = await create(t, c, { userIds: ['nobody'] });
    expect(nobody.status).toBe(422);
    expect(code(nobody)).toBe('VIB_NO_RECIPIENTS');
    expect((await create(t, { ...c, uuid: randomUUID() })).status).toBe(404);
    expect((await create(t, foreign)).status).toBe(404);
    expect((await create(t, c, { userIds: [] })).status).toBe(422);
    expect((await create(t, c, { name: '' })).status).toBe(422);
    expect((await create(t, c, { body: 'x'.repeat(7001) })).status).toBe(422);
  });

  it('takes a picture or mp4 up to 26 MB and refuses any other file, as Reference did', async () => {
    const t = await api.signup('vb5');
    const c = await channelWithUsers(t, 1);
    const one = { userIds: ['user-0'] };
    const pic = await create(t, c, { ...one, body: '', mediaUrl: 'https://files.test/a.png' });
    expect(pic.status, JSON.stringify(pic.body)).toBe(201);
    expect(pic.body.hasMedia).toBe(true);
    expect((await rowOf(pic.body.id)).media_kind).toBe('image');
    const vid = await create(t, c, {
      ...one,
      mediaUrl: 'https://files.test/a.mp4?sig=1',
      mediaSize: 5000,
    });
    expect(vid.status).toBe(201);
    expect(await rowOf(vid.body.id)).toMatchObject({ media_kind: 'video', media_size: 5000 });
    expect((await create(t, c, { ...one, mediaUrl: 'https://files.test/a.pdf' })).status).toBe(422);
    expect(
      (
        await create(t, c, {
          ...one,
          mediaUrl: 'https://files.test/a.mp4',
          mediaSize: 27 * 1024 * 1024,
        })
      ).status,
    ).toBe(422);
  });

  it('a Viber template fills an empty message and brings its buttons; only Viber templates are offered', async () => {
    const t = await api.signup('vb6');
    const c = await channelWithUsers(t, 1);
    await h.owner.query(
      `INSERT INTO wa_templates (org_id, template_name, template_body, channel) VALUES ($1, 'tg-one', 'telegram only', 'telegram')`,
      [t.orgId],
    );
    const tpl = (
      await h.owner.query(
        `INSERT INTO wa_templates (org_id, template_name, template_body, buttons, channel)
         VALUES ($1, 'vib-offer', 'Offer for you', $2::jsonb, 'viber') RETURNING uuid`,
        [
          t.orgId,
          JSON.stringify([
            { type: 'url', text: 'Shop', url: 'https://x.test' },
            { type: 'quick_reply', text: 'Yes' },
          ]),
        ],
      )
    ).rows[0];
    const compose = await api.http().get('/v2/viber/broadcasts/compose').set(bearer(t.admin));
    expect(compose.status).toBe(200);
    expect(compose.body.templates.map((x: { name: string }) => x.name)).toEqual(['vib-offer']);
    expect(compose.body.channels).toEqual([{ id: c.uuid, name: 'Shop', active: true }]);

    const made = await create(t, c, { body: '', templateId: tpl.uuid, userIds: ['user-0'] });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.templateId).toBe(tpl.uuid);
    await post(t, `broadcasts/${made.body.id}/start`);
    await run(t, made.body.id);
    // One text message with the template's two buttons as an inline keyboard.
    expect(calls()).toHaveLength(1);
    expect(calls()[0]!.message).toMatchObject({
      type: 'text',
      text: 'Offer for you',
      min_api_version: 3,
    });
    const keys = (calls()[0]!.message as { keyboard: { Buttons: Array<Record<string, string>> } })
      .keyboard.Buttons;
    expect(keys.map((k) => [k.ActionType, k.ActionBody])).toEqual([
      ['open-url', 'https://x.test'],
      ['reply', 'Yes'],
    ]);
    expect((await api.http().get('/v2/viber/broadcasts/compose').set(bearer(t.admin))).status).toBe(
      200,
    );
    expect((await create(t, c, { templateId: randomUUID() })).status).toBe(404);
  });
});

describe('TW-VIB-013: the send run', () => {
  it('sends one broadcast_message call per 300 users, records the token, marks failed_list users failed and mirrors each sent copy', async () => {
    const t = await api.signup('vr1');
    const c = await channelWithUsers(t, 3);
    const made = await create(t, c, { body: 'Big news', userIds: ids(3) });
    await pad(made.body.id, 299); // 302 in all: one call of 300 and one of 2
    fake.broadcast = (to) => ({
      ok: true,
      status: 0,
      data: {
        message_token: String(5_000_000_000_000_000_000n + BigInt(calls().length - 1)),
        failed_list: to.includes('user-1')
          ? [{ receiver: 'user-1', status: 6, status_message: 'receiverNotSubscribed' }]
          : [],
      },
    });

    const started = await post(t, `broadcasts/${made.body.id}/start`);
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body.status).toBe('sending');
    expect(await run(t, made.body.id)).toBe('done');

    expect(calls().map((x) => (x.to as string[]).length)).toEqual([300, 2]);
    for (const call of calls()) {
      expect(call.token).toBe(c.token);
      expect(call.sender).toMatchObject({ name: 'Shop' });
      expect(call.message).toEqual({ type: 'text', text: 'Big news' });
    }
    const rows = await recipients(made.body.id);
    const byUser = Object.fromEntries(rows.map((r) => [r.viber_user_id, r]));
    expect(byUser['user-1']).toMatchObject({
      status: 'failed',
      error: 'receiverNotSubscribed',
      message_token: null,
    });
    expect(byUser['user-0']).toMatchObject({
      status: 'sent',
      message_token: '5000000000000000000',
    });
    // Everyone of the first call shares its token; the second call has its own.
    expect(new Set(rows.filter((r) => r.status === 'sent').map((r) => r.message_token))).toEqual(
      new Set(['5000000000000000000', '5000000000000000001']),
    );

    const row = await rowOf(made.body.id);
    expect(row).toMatchObject({
      status: 'done',
      total: 302,
      sent: 301,
      failed: 1,
      last_error: null,
    });
    expect(row.started_at).not.toBeNull();
    expect(row.finished_at).not.toBeNull();

    // Each sent copy is in the user's thread as an outbound broadcast message; the failed one and the padded ones are not.
    const mirrored = (
      await h.owner.query(
        `SELECT m.body, m.direction, m.provider_message_id, m.meta, c.peer_key FROM messages m
         JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
         WHERE m.org_id = $1 AND m.direction = 'out' ORDER BY c.peer_key`,
        [t.orgId],
      )
    ).rows;
    expect(mirrored.map((m) => m.peer_key)).toEqual(['user-0', 'user-2']);
    expect(mirrored[0]).toMatchObject({
      body: 'Big news',
      provider_message_id: '5000000000000000000:user-0',
    });
    expect(mirrored[0]!.meta.source).toBe('broadcast');
    // A broadcast copy is not an unread customer message.
    const unread = await h.owner.query(
      `SELECT unread_count FROM conversations WHERE org_id = $1 AND peer_key = 'user-0'`,
      [t.orgId],
    );
    expect(unread.rows[0].unread_count).toBe(1);
  });

  it('a call Viber rejects as a whole fails the whole batch and the broadcast; retry and start send the rest and the failed ones again', async () => {
    const t = await api.signup('vr2');
    const c = await channelWithUsers(t, 2);
    const made = await create(t, c, { userIds: ids(2) });
    await pad(made.body.id, 300); // 302: the first call of 300 is the one rejected
    fake.broadcast = () => ({ ok: false, status: 7, error: '7 tooManyRequests' });
    await post(t, `broadcasts/${made.body.id}/start`);
    expect(await run(t, made.body.id)).toBe('failed');

    expect(calls()).toHaveLength(1);
    const after = await rowOf(made.body.id);
    expect(after).toMatchObject({
      status: 'failed',
      sent: 0,
      failed: 300,
      last_error: '7 tooManyRequests',
    });
    expect((await recipients(made.body.id)).filter((r) => r.status === 'pending')).toHaveLength(2);
    expect((await recipients(made.body.id)).find((r) => r.status === 'failed')!.error).toBe(
      '7 tooManyRequests',
    );

    // Retry puts the failed back; the broadcast is a draft again, and Start sends everyone once.
    resetFake();
    const retried = await post(t, `broadcasts/${made.body.id}/retry`);
    expect(retried.status).toBe(200);
    expect(retried.body).toEqual({ retried: 300 });
    expect(await rowOf(made.body.id)).toMatchObject({
      status: 'draft',
      failed: 0,
      finished_at: null,
      last_error: null,
    });
    await post(t, `broadcasts/${made.body.id}/start`);
    expect(await run(t, made.body.id)).toBe('done');
    expect(calls().map((x) => (x.to as string[]).length)).toEqual([300, 2]);
    expect(await rowOf(made.body.id)).toMatchObject({ status: 'done', sent: 302, failed: 0 });
  });

  it('a picture goes with the text as its caption; a video with its size; both without a keyboard', async () => {
    const t = await api.signup('vr3');
    const c = await channelWithUsers(t, 1);
    const pic = await create(t, c, {
      userIds: ['user-0'],
      body: 'Look',
      mediaUrl: 'https://files.test/a.jpg',
    });
    const vid = await create(t, c, {
      userIds: ['user-0'],
      body: '',
      mediaUrl: 'https://files.test/a.mp4',
      mediaSize: 4096,
    });
    await post(t, `broadcasts/${pic.body.id}/start`);
    await run(t, pic.body.id);
    await post(t, `broadcasts/${vid.body.id}/start`);
    await run(t, vid.body.id);
    expect(calls().map((x) => x.message)).toEqual([
      { type: 'picture', text: 'Look', media: 'https://files.test/a.jpg' },
      { type: 'video', media: 'https://files.test/a.mp4', size: 4096 },
    ]);
    // A copy of a file-only broadcast says what it was, not an empty bubble.
    const bodies = (
      await h.owner.query(
        `SELECT body FROM messages WHERE org_id = $1 AND direction = 'out' ORDER BY id`,
        [t.orgId],
      )
    ).rows.map((r) => r.body);
    expect(bodies).toEqual(['Look', '[video]']);
  });

  it('a channel that was paused, or removed, between Start and the run fails the broadcast without calling Viber', async () => {
    const t = await api.signup('vr4');
    const c = await channelWithUsers(t, 1);
    const made = await create(t, c, { userIds: ['user-0'] });
    await post(t, `broadcasts/${made.body.id}/start`);
    await h.owner.query(`UPDATE viber_channels SET active = false WHERE id = $1`, [c.rowId]);
    expect(await run(t, made.body.id)).toBe('failed');
    expect(calls()).toHaveLength(0);
    expect(await rowOf(made.body.id)).toMatchObject({
      status: 'failed',
      last_error: 'The Viber channel is unavailable.',
    });
  });

  it('a run for a broadcast that is not sending (paused, deleted) does nothing', async () => {
    const t = await api.signup('vr5');
    const c = await channelWithUsers(t, 2);
    const made = await create(t, c, { userIds: ids(2) });
    expect(await run(t, made.body.id)).toBe('skipped'); // a draft
    await post(t, `broadcasts/${made.body.id}/start`);
    await post(t, `broadcasts/${made.body.id}/pause`);
    expect(await run(t, made.body.id)).toBe('skipped');
    expect(calls()).toHaveLength(0);
    // Start again sends each user once.
    await post(t, `broadcasts/${made.body.id}/start`);
    expect(await run(t, made.body.id)).toBe('done');
    expect(await run(t, made.body.id)).toBe('skipped');
    expect(calls()).toHaveLength(1);
    expect((calls()[0]!.to as string[]).sort()).toEqual(['user-0', 'user-1']);
  });
});

describe('TW-VIB-014: start, pause, retry, delete', () => {
  it('start refuses a paused or removed channel and a broadcast with nobody pending; sending is returned as it is', async () => {
    const t = await api.signup('vt1');
    const c = await channelWithUsers(t, 1);
    const made = await create(t, c, { userIds: ['user-0'] });
    await h.owner.query(`UPDATE viber_channels SET active = false WHERE id = $1`, [c.rowId]);
    const paused = await post(t, `broadcasts/${made.body.id}/start`);
    expect(paused.status).toBe(422);
    expect(code(paused)).toBe('VIB_CHANNEL_UNAVAILABLE');
    expect((await rowOf(made.body.id)).status).toBe('draft');

    await h.owner.query(`UPDATE viber_channels SET active = true WHERE id = $1`, [c.rowId]);
    const first = await post(t, `broadcasts/${made.body.id}/start`);
    expect(first.body.status).toBe('sending');
    expect((await post(t, `broadcasts/${made.body.id}/start`)).body.status).toBe('sending');
    await run(t, made.body.id);
    const done = await post(t, `broadcasts/${made.body.id}/start`);
    expect(done.status).toBe(422);
    expect(code(done)).toBe('VIB_NOTHING_TO_SEND');
    expect((await api.events(t.orgId, 'viber.broadcast.started')).length).toBe(1);
  });

  it('retry needs a failed recipient and refuses while sending; pause is a no-op unless sending', async () => {
    const t = await api.signup('vt2');
    const c = await channelWithUsers(t, 1);
    const made = await create(t, c, { userIds: ['user-0'] });
    const none = await post(t, `broadcasts/${made.body.id}/retry`);
    expect(none.status).toBe(422);
    expect(code(none)).toBe('VIB_NOTHING_TO_RETRY');
    expect((await post(t, `broadcasts/${made.body.id}/pause`)).body.status).toBe('draft');
    await post(t, `broadcasts/${made.body.id}/start`);
    const busy = await post(t, `broadcasts/${made.body.id}/retry`);
    expect(busy.status).toBe(409);
    const paused = await post(t, `broadcasts/${made.body.id}/pause`);
    expect(paused.body.status).toBe('draft');
    expect((await api.events(t.orgId, 'viber.broadcast.paused')).length).toBe(1);
  });

  it('delete works in any status, takes the recipients with it, and a run in flight finds nothing', async () => {
    const t = await api.signup('vt3');
    const c = await channelWithUsers(t, 2);
    const made = await create(t, c, { userIds: ids(2) });
    await post(t, `broadcasts/${made.body.id}/start`);
    const batch = await rowOf(made.body.id);
    const del = await api
      .http()
      .delete(`/v2/viber/broadcasts/${made.body.id}`)
      .set(bearer(t.admin));
    expect(del.status).toBe(204);
    expect(await rowOf(made.body.id)).toBeUndefined();
    expect(
      (
        await h.owner.query(
          `SELECT 1 FROM viber_broadcast_recipients WHERE viber_broadcast_id = $1`,
          [batch.id],
        )
      ).rows,
    ).toHaveLength(0);
    expect(await sender.run(t.orgId, Number(batch.id))).toBe('skipped');
    expect(
      (await api.http().delete(`/v2/viber/broadcasts/${made.body.id}`).set(bearer(t.admin))).status,
    ).toBe(404);
    expect((await api.events(t.orgId, 'viber.broadcast.deleted'))[0]).toMatchObject({
      status: 'sending',
    });
  });

  it('the list shows the 50 newest with totals over all of them, and the progress of each', async () => {
    const t = await api.signup('vt4');
    const c = await channelWithUsers(t, 3);
    const a = await create(t, c, { name: 'A', userIds: ids(3) });
    await create(t, c, { name: 'B', userIds: ids(2) });
    fake.broadcast = () => ({
      ok: true,
      status: 0,
      data: { message_token: '1', failed_list: [{ receiver: 'user-2', status_message: 'nope' }] },
    });
    await post(t, `broadcasts/${a.body.id}/start`);
    await run(t, a.body.id);

    const res = await api.http().get('/v2/viber/broadcasts').set(bearer(t.admin));
    expect(res.status).toBe(200);
    expect(res.body.data.map((b: { name: string }) => b.name)).toEqual(['B', 'A']);
    expect(res.body.data[1]).toMatchObject({
      status: 'done',
      total: 3,
      sent: 2,
      failed: 1,
      progress: 100,
      channelName: 'Shop',
    });
    expect(res.body.stats).toEqual({
      total: 2,
      sent: 2,
      failed: 1,
      delivered: 0,
      seen: 0,
      audience: 5,
      sending: 0,
    });
  });
});

describe('TW-VIB-013: delivered and seen reach the broadcast (an improvement on Reference, which kept no token)', () => {
  async function sentBroadcast(t: Tenant, n = 2) {
    const c = await channelWithUsers(t, n);
    const made = await create(t, c, { userIds: ids(n) });
    fake.broadcast = () => ({
      ok: true,
      status: 0,
      data: { message_token: '5098034272017990042', failed_list: [] },
    });
    await post(t, `broadcasts/${made.body.id}/start`);
    expect(await run(t, made.body.id)).toBe('done');
    return { c, id: made.body.id as string };
  }
  const receipt = (event: string, user: string, extra: object = {}) => ({
    event,
    timestamp: 1,
    message_token: '@@5098034272017990042@@',
    user_id: user,
    ...extra,
  });

  it('delivered then seen stamp the recipient matched on token AND user, and the broadcast totals follow', async () => {
    const t = await api.signup('vd1');
    const { c, id } = await sentBroadcast(t, 2);
    expect((await push(api, c, receipt('delivered', 'user-0'))).status).toBe(200);
    let list = await api.http().get('/v2/viber/broadcasts').set(bearer(t.admin));
    expect(list.body.data[0]).toMatchObject({ sent: 2, delivered: 1, seen: 0 });

    await push(api, c, receipt('seen', 'user-0'));
    await push(api, c, receipt('seen', 'user-1')); // seen without a delivered: it was delivered too
    list = await api.http().get('/v2/viber/broadcasts').set(bearer(t.admin));
    expect(list.body.data[0]).toMatchObject({ delivered: 2, seen: 2 });
    expect(list.body.stats).toMatchObject({ delivered: 2, seen: 2 });
    const rows = await recipients(id);
    expect(rows.every((r) => r.delivered_at !== null && r.seen_at !== null)).toBe(true);

    // A repeat changes nothing; a user who was not in the batch matches nothing.
    await push(api, c, receipt('seen', 'user-0'));
    await push(api, c, receipt('seen', 'stranger'));
    list = await api.http().get('/v2/viber/broadcasts').set(bearer(t.admin));
    expect(list.body.data[0]).toMatchObject({ delivered: 2, seen: 2 });
  });

  it('the same receipt also moves the mirrored message in the thread (its ledger id is token:user)', async () => {
    const t = await api.signup('vd2');
    const { c } = await sentBroadcast(t, 1);
    await push(api, c, receipt('seen', 'user-0'));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.receipt).toMatchObject({
      providerMessageId: '5098034272017990042:user-0',
      status: 'read',
    });
    const job = receipts[0]!;
    expect(
      await h.app
        .get(ReceiptsService)
        .apply({ orgId: job.orgId, channelUuid: job.channelUuid, receipt: job.receipt as never }),
    ).toBe('applied');
    const copy = (
      await h.owner.query(
        `SELECT status, read_at FROM messages WHERE org_id = $1 AND direction = 'out'`,
        [t.orgId],
      )
    ).rows[0];
    expect(copy.status).toBe('read');
    expect(copy.read_at).not.toBeNull();
  });

  it("a failed receipt turns the recipient failed with Viber's reason, so a retry sends it again", async () => {
    const t = await api.signup('vd3');
    const { c, id } = await sentBroadcast(t, 2);
    await push(api, c, receipt('failed', 'user-1', { desc: 'user blocked the bot' }));
    const rows = await recipients(id);
    expect(rows.find((r) => r.viber_user_id === 'user-1')).toMatchObject({
      status: 'failed',
      error: 'user blocked the bot',
    });
    expect(await rowOf(id)).toMatchObject({ sent: 1, failed: 1 });
    const retried = await post(t, `broadcasts/${id}/retry`);
    expect(retried.body).toEqual({ retried: 1 });
    // The old token and receipts of that user are forgotten: it will be sent again.
    expect((await recipients(id)).find((r) => r.viber_user_id === 'user-1')).toMatchObject({
      status: 'pending',
      message_token: null,
      delivered_at: null,
    });
  });

  it("a receipt for another workspace's token changes nothing here", async () => {
    const a = await api.signup('vd4');
    const b = await api.signup('vd4b');
    const { id } = await sentBroadcast(a, 1);
    const cb = await channelWithUsers(b, 1);
    await push(api, cb, receipt('seen', 'user-0'));
    expect((await recipients(id))[0]!.seen_at).toBeNull();
  });
});

describe('isolation and access', () => {
  it("another workspace's broadcast is not found, whatever the action", async () => {
    const a = await api.signup('vx1');
    const b = await api.signup('vx1b');
    const c = await channelWithUsers(a, 1);
    const made = await create(a, c, { userIds: ['user-0'] });
    for (const action of ['start', 'pause', 'retry']) {
      expect((await post(b, `broadcasts/${made.body.id}/${action}`)).status, action).toBe(404);
    }
    expect(
      (await api.http().delete(`/v2/viber/broadcasts/${made.body.id}`).set(bearer(b.admin))).status,
    ).toBe(404);
    expect((await api.http().get('/v2/viber/broadcasts').set(bearer(b.admin))).body.data).toEqual(
      [],
    );
  });

  it('reading needs viber.broadcasts.read, writing needs viber.broadcasts.manage, and a sign-in is required', async () => {
    const t = await api.signup('vx2');
    const c = await channelWithUsers(t, 1);
    const reader = await api.member(t, 'reader', [['viber.broadcasts.read']]);
    const nobody = await api.member(t, 'nobody', [['tg.bots.read']]);
    expect((await api.http().get('/v2/viber/broadcasts')).status).toBe(401);
    expect((await api.http().get('/v2/viber/broadcasts').set(bearer(nobody.token))).status).toBe(
      403,
    );
    expect((await api.http().get('/v2/viber/broadcasts').set(bearer(reader.token))).status).toBe(
      200,
    );
    expect(
      (await api.http().get(`/v2/viber/channels/${c.uuid}/users`).set(bearer(reader.token))).status,
    ).toBe(200);
    const denied = await api
      .http()
      .post('/v2/viber/broadcasts')
      .set(bearer(reader.token))
      .set('idempotency-key', randomUUID())
      .send({ name: 'x', channelId: c.uuid, body: 'x', userIds: ['user-0'] });
    expect(denied.status).toBe(403);
  });

  it('a broadcast writes a body nobody can read from the table, and the API never returns it', async () => {
    const t = await api.signup('vx3');
    const c = await channelWithUsers(t, 1);
    const made = await create(t, c, { userIds: ['user-0'], body: 'Secret promo code 4242' });
    expect(JSON.stringify(made.body)).not.toContain('4242');
    const raw = (await rowOf(made.body.id)).body as string;
    expect(raw).not.toContain('4242');
    expect(h.app.get(CryptoService).decrypt(raw)).toBe('Secret promo code 4242');
  });
});
