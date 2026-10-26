import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { jpegOfSize } from '../../support/images';
import { INBOUND_HOOKS, type InboundHooks } from '../../../src/modules/channel-line/_shims/tokens';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';
import { FakeLine, connectChannel, delivery, deliver, sign, textEvent, userId } from './support';

/** The LINE webhook: signature on the raw body, inbox thread, contact, media, taps, groups and automation, against a real Postgres. */
let h: Harness;
let api: Api;
const fake = new FakeLine();

const handed: Array<{ kind: 'flow' | 'automate'; ctx: Record<string, unknown> }> = [];
let consume = false;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  fake.install(h);
  const hooks = h.app.get<InboundHooks>(INBOUND_HOOKS);
  hooks.handoffToFlow = (ctx) => {
    handed.push({ kind: 'flow', ctx: { ...ctx } });
    return Promise.resolve(consume);
  };
  hooks.automate = (ctx) => {
    handed.push({ kind: 'automate', ctx: { ...ctx } });
    return Promise.resolve();
  };
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  fake.reset();
  handed.length = 0;
  consume = false;
});

const convs = async (t: Tenant) =>
  (
    await h.owner.query(
      `SELECT c.* FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
       WHERE c.org_id = $1 AND ch.kind = 'line' ORDER BY c.id`,
      [t.orgId],
    )
  ).rows;
const msgs = async (t: Tenant) =>
  (await h.owner.query(`SELECT * FROM messages WHERE org_id = $1 ORDER BY id`, [t.orgId])).rows;
const contacts = async (t: Tenant) =>
  (
    await h.owner.query(
      `SELECT * FROM contacts WHERE org_id = $1 AND channel = 'line' ORDER BY id`,
      [t.orgId],
    )
  ).rows;

describe('the webhook door', () => {
  it('a wrong or missing signature is refused with 401 and writes nothing; LINE sees 200 for an unknown address', async () => {
    const t = await api.signup('lw1');
    const c = await connectChannel(h, api, fake, t);
    const body = delivery(textEvent(userId(1), 'hello'));

    const wrong = await deliver(api, c, body, { secret: 'some-other-channel-secret' });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual({ ok: false, error: 'bad signature' });
    const none = await deliver(api, c, body, { secret: null });
    expect(none.status).toBe(401);

    const unknown = await deliver(api, { webhookToken: 'nope', secret: c.secret }, body);
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual({ ok: true, note: 'unknown channel' });

    expect(await convs(t)).toHaveLength(0);
    expect(await msgs(t)).toHaveLength(0);
  });

  it("the signature covers the exact bytes: a body signed for other bytes is refused, the other channel's secret too", async () => {
    const t = await api.signup('lw2');
    const a = await connectChannel(h, api, fake, t);
    const b = await connectChannel(h, api, fake, t);
    const body = delivery(textEvent(userId(2), 'hi'));
    const raw = JSON.stringify(body);
    const tampered = await api
      .http()
      .post(`/v2/line/inbound/${a.webhookToken}`)
      .set('content-type', 'application/json')
      .set('x-line-signature', sign(a.secret, raw))
      .send(raw.replace('hi', 'HI'));
    expect(tampered.status).toBe(401);
    expect(
      (await deliver(api, { webhookToken: a.webhookToken, secret: b.secret }, body)).status,
    ).toBe(401);
    expect(await msgs(t)).toHaveLength(0);
  });

  it("LINE's own verify (a signed delivery with no events) and a paused channel answer 200 and write nothing", async () => {
    const t = await api.signup('lw3');
    const c = await connectChannel(h, api, fake, t);
    const verify = await deliver(api, c, delivery());
    expect(verify.status).toBe(200);
    expect(verify.body).toEqual({ ok: true, note: 'ok' });

    await h.owner.query(`UPDATE line_channels SET active = false WHERE id = $1`, [c.rowId]);
    const paused = await deliver(api, c, delivery(textEvent(userId(3), 'hi')));
    expect(paused.status).toBe(200);
    expect(paused.body.note).toBe('channel disabled');
    expect(await msgs(t)).toHaveLength(0);
  });

  it('events nobody handles are acknowledged: follow, unfollow, join, an event without a source, and a body with no events', async () => {
    const t = await api.signup('lw4');
    const c = await connectChannel(h, api, fake, t);
    const res = await deliver(
      api,
      c,
      delivery(
        { type: 'follow', source: { type: 'user', userId: userId(4) }, replyToken: 'r' },
        { type: 'unfollow', source: { type: 'user', userId: userId(4) } },
        { type: 'join', source: { type: 'group', groupId: 'Cg' } },
        { type: 'message' },
      ),
    );
    expect(res.status).toBe(200);
    expect(res.body.note).toBe('ok');
    expect(await convs(t)).toHaveLength(0);
    expect(fake.of('getProfile')).toHaveLength(0);
    // The channel is alive: a verified delivery marks it.
    const row = (
      await h.owner.query(`SELECT last_inbound_at FROM line_channels WHERE id = $1`, [c.rowId])
    ).rows[0];
    expect(row.last_inbound_at).not.toBeNull();

    // A signed body that is not an object with events is read as nothing.
    const raw = '[]';
    const odd = await api
      .http()
      .post(`/v2/line/inbound/${c.webhookToken}`)
      .set('content-type', 'application/json')
      .set('x-line-signature', sign(c.secret, raw))
      .send(raw);
    expect(odd.status).toBe(200);
    expect(odd.body.note).toBe('ok');

    // A correctly signed empty body has nothing to read.
    const empty = await api
      .http()
      .post(`/v2/line/inbound/${c.webhookToken}`)
      .set('x-line-signature', sign(c.secret, ''));
    expect(empty.status).toBe(200);
    expect(empty.body.note).toBe('not json');
  });
});

describe('a message becomes a thread, a contact and a message', () => {
  it('first message: thread keyed by the LINE user id (case kept), named after the profile, contact linked, unread 1, channel alive', async () => {
    const t = await api.signup('lm1');
    const c = await connectChannel(h, api, fake, t);
    await h.owner.query(`UPDATE line_channels SET last_error = 'old' WHERE id = $1`, [c.rowId]);
    const uid = 'Uab12CD34ef56GH78ij90KL12mn34OP56';
    fake.profile = () => ({
      ok: true,
      status: 200,
      data: { displayName: 'Asha Rao', pictureUrl: 'https://p.example.com/asha.png' },
    });
    const event = textEvent(uid, 'Hello there');
    const res = await deliver(api, c, delivery(event));
    expect(res.body).toEqual({ ok: true, note: 'ok' });

    const [conv] = await convs(t);
    expect(conv).toMatchObject({
      peer_key: uid,
      title: 'Asha Rao',
      status: 'open',
      unread_count: 1,
      preview: 'Hello there',
    });
    const channel = (
      await h.owner.query(`SELECT kind, external_id FROM channels WHERE id = $1`, [conv.channel_id])
    ).rows[0];
    expect(channel).toMatchObject({ kind: 'line', external_id: String(c.rowId) });

    const [m] = await msgs(t);
    expect(m).toMatchObject({
      direction: 'in',
      body: 'Hello there',
      status: 'received',
      kind: 'text',
      sender_kind: 'customer',
      provider_message_id: event.message.id,
    });
    expect(m.meta.line).toMatchObject({
      source_type: 'user',
      source_id: uid,
      message_id: event.message.id,
      reply_token: event.replyToken,
      webhook_event_id: event.webhookEventId,
    });
    expect(Number(m.meta.line.reply_token_at)).toBeGreaterThan(1_700_000_000);

    const [contact] = await contacts(t);
    expect(contact).toMatchObject({
      channel_uid: uid,
      name: 'Asha Rao',
      message: 'Source: LINE',
      image_url: 'https://p.example.com/asha.png',
    });
    expect(conv.contact_id).toBe(contact.id);

    const row = (
      await h.owner.query(`SELECT last_inbound_at, last_error FROM line_channels WHERE id = $1`, [
        c.rowId,
      ])
    ).rows[0];
    expect(row.last_inbound_at).not.toBeNull();
    expect(row.last_error).toBeNull();
    // The profile was asked with the channel's own token.
    expect(fake.of('getProfile')[0]).toMatchObject({ token: c.accessToken, args: [uid] });
  });

  it('a second message joins the thread and contact and asks LINE for no profile again; a resolved thread reopens', async () => {
    const t = await api.signup('lm2');
    const c = await connectChannel(h, api, fake, t);
    await deliver(api, c, delivery(textEvent(userId(20), 'one')));
    await h.owner.query(`UPDATE conversations SET status = 'resolved' WHERE org_id = $1`, [
      t.orgId,
    ]);
    await deliver(api, c, delivery(textEvent(userId(20), 'two')));
    expect(await convs(t)).toHaveLength(1);
    expect((await convs(t))[0]).toMatchObject({ status: 'open', unread_count: 2, preview: 'two' });
    expect(await contacts(t)).toHaveLength(1);
    expect(fake.of('getProfile')).toHaveLength(1);
  });

  it('without a profile the thread is called "LINE user"', async () => {
    const t = await api.signup('lm3');
    const c = await connectChannel(h, api, fake, t);
    fake.profile = () => ({ ok: false, status: 404, error: 'Not found' });
    await deliver(api, c, delivery(textEvent(userId(30), 'hi')));
    expect((await convs(t))[0].title).toBe('LINE user');
    expect((await contacts(t))[0].name).toBe('LINE user');
  });

  it('a redelivered event is stored once and runs no automation a second time', async () => {
    const t = await api.signup('lm4');
    const c = await connectChannel(h, api, fake, t);
    const body = delivery(textEvent(userId(40), 'only once'));
    await deliver(api, c, body);
    await deliver(api, c, body);
    expect(await msgs(t)).toHaveLength(1);
    expect((await convs(t))[0].unread_count).toBe(1);
    expect(handed.filter((x) => x.kind === 'flow')).toHaveLength(1);
  });

  it('several events in one delivery are all stored, in order, even when one of them fails', async () => {
    const t = await api.signup('lm5');
    const c = await connectChannel(h, api, fake, t);
    await deliver(
      api,
      c,
      delivery(
        textEvent(userId(50), 'first'),
        {
          type: 'message',
          source: { type: 'user' },
          message: { type: 'text', id: 'x', text: 'no source' },
        },
        textEvent(userId(51), 'third'),
      ),
    );
    expect((await msgs(t)).map((m) => m.body)).toEqual(['first', 'third']);
    expect(await convs(t)).toHaveLength(2);
  });

  it('a postback is replayed as typed text; a sticker, a location and a file become a line of text', async () => {
    const t = await api.signup('lm6');
    const c = await connectChannel(h, api, fake, t);
    const u = userId(60);
    await deliver(
      api,
      c,
      delivery(
        {
          type: 'postback',
          source: { type: 'user', userId: u },
          webhookEventId: 'PB1',
          replyToken: 'rt',
          postback: { data: 'size=M' },
        },
        textEvent(u, '', {
          message: { type: 'sticker', id: 's1', packageId: '1', stickerId: '2' },
        }),
        textEvent(u, '', {
          message: { type: 'location', id: 'l1', latitude: 35.68, longitude: 139.76 },
        }),
        textEvent(u, '', {
          message: { type: 'file', id: 'f1', fileName: 'invoice.pdf', fileSize: 10 },
        }),
      ),
    );
    expect((await msgs(t)).map((m) => m.body)).toEqual([
      'size=M',
      '[sticker]',
      '📍 35.68, 139.76',
      'invoice.pdf',
    ]);
    // The same postback delivered again is the same event.
    await deliver(
      api,
      c,
      delivery({
        type: 'postback',
        source: { type: 'user', userId: u },
        webhookEventId: 'PB1',
        postback: { data: 'size=M' },
      }),
    );
    expect(await msgs(t)).toHaveLength(4);
  });
});

describe('files', () => {
  it('an image is downloaded with the channel token; when LINE has no file the message is stored without it', async () => {
    const t = await api.signup('lf1');
    const c = await connectChannel(h, api, fake, t);
    const u = userId(70);
    await deliver(
      api,
      c,
      delivery(
        textEvent(u, '', {
          message: { type: 'image', id: 'img-1', contentProvider: { type: 'line' } },
        }),
      ),
    );
    expect(fake.of('getMessageContent')[0]).toMatchObject({
      token: c.accessToken,
      args: ['img-1'],
    });
    const [m] = await msgs(t);
    expect(m).toMatchObject({ kind: 'image', media_key: null });
    expect(m.meta.line.message_id).toBe('img-1');

    fake.content = () => ({ bytes: new Uint8Array(jpegOfSize()), mime: 'image/jpeg' });
    await deliver(
      api,
      c,
      delivery(
        textEvent(u, '', {
          message: { type: 'image', id: 'img-2', contentProvider: { type: 'line' } },
        }),
      ),
    );
    const stored = (await msgs(t))[1];
    expect(stored.kind).toBe('image');
    expect(stored.media_key).toMatch(/^chat\//);
  });
});

describe('groups and automation', () => {
  it('a group is one thread of its own, with no contact and no flow; the writer is not mixed into their 1:1 thread', async () => {
    const t = await api.signup('lg1');
    const c = await connectChannel(h, api, fake, t);
    await deliver(
      api,
      c,
      delivery(
        textEvent(userId(80), 'hi all', {
          source: { type: 'group', groupId: 'Cgroup0001', userId: userId(80) },
        }),
        textEvent(userId(80), 'a room', { source: { type: 'room', roomId: 'Rroom0001' } }),
      ),
    );
    const all = await convs(t);
    expect(all.map((x: { peer_key: string }) => x.peer_key).sort()).toEqual([
      'Cgroup0001',
      'Rroom0001',
    ]);
    expect(all.every((x: { title: string }) => x.title === 'LINE')).toBe(true);
    expect(await contacts(t)).toHaveLength(0);
    expect(fake.of('getProfile')).toHaveLength(0);
    expect(handed.map((x) => x.kind)).toEqual(['automate', 'automate']);
    expect((await msgs(t))[0].meta.line).toMatchObject({
      source_type: 'group',
      source_id: 'Cgroup0001',
    });
  });

  it('a flow gets a 1:1 message first; only when it does not consume it does automation run', async () => {
    const t = await api.signup('lg2');
    const c = await connectChannel(h, api, fake, t);
    consume = true;
    await deliver(api, c, delivery(textEvent(userId(90), 'start')));
    expect(handed.map((x) => x.kind)).toEqual(['flow']);
    expect(handed[0]!.ctx).toMatchObject({
      orgId: t.orgId,
      channelRowId: c.rowId,
      sourceId: userId(90),
      sourceType: 'user',
      text: 'start',
      newThread: true,
    });
    expect(handed[0]!.ctx.replyToken).toMatch(/^reply-token-/);

    handed.length = 0;
    consume = false;
    await deliver(api, c, delivery(textEvent(userId(90), 'again')));
    expect(handed.map((x) => x.kind)).toEqual(['flow', 'automate']);
    expect(handed[0]!.ctx.newThread).toBe(false);
  });
});

describe('isolation', () => {
  it("one workspace's channel can never write into another workspace", async () => {
    const t = await api.signup('lx1');
    const u = await api.signup('lx1b');
    const a = await connectChannel(h, api, fake, t);
    await connectChannel(h, api, fake, u);
    await deliver(api, a, delivery(textEvent(userId(100), 'mine')));
    expect(await msgs(t)).toHaveLength(1);
    expect(await msgs(u)).toHaveLength(0);
    expect(await convs(u)).toHaveLength(0);
  });
});
