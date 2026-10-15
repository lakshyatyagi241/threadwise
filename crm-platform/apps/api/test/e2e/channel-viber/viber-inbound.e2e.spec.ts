import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChannelIngestPublisher } from '../../../src/modules/chat-conversations';
import { ReceiptsService } from '../../../src/modules/chat-conversations/receipts.service';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';
import { connect, installFake, push, resetFake, sign, textEvent, type Channel } from './support';

/** The Viber webhook (TW-VIB-003 to 006): signature, inbox thread, contact, receipts, against a real Postgres and a fake Viber. */
let h: Harness;
let api: Api;

/** What the webhook put on the receipt queue. */
const receipts: Array<{ orgId: number; channelUuid: string; receipt: Record<string, unknown> }> =
  [];

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
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

const convs = async (t: Tenant) =>
  (
    await h.owner.query(
      `SELECT c.* FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
       WHERE c.org_id = $1 AND ch.kind = 'viber' ORDER BY c.id`,
      [t.orgId],
    )
  ).rows;
const msgs = async (t: Tenant) =>
  (await h.owner.query(`SELECT * FROM messages WHERE org_id = $1 ORDER BY id`, [t.orgId])).rows;
const contacts = async (t: Tenant) =>
  (await h.owner.query(`SELECT * FROM contacts WHERE org_id = $1 AND channel = 'viber'`, [t.orgId]))
    .rows;
const channelRow = async (c: Channel) =>
  (await h.owner.query(`SELECT * FROM viber_channels WHERE id = $1`, [c.rowId])).rows[0];

describe('TW-VIB-003: the webhook door', () => {
  it('an unknown routing token is acknowledged quietly', async () => {
    const res = await api.http().post('/v2/viber/inbound/nope').send(textEvent('u', 'x'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 0 });
  });

  it('a wrong, missing or foreign signature is refused (403) and nothing is written', async () => {
    const t = await api.signup('vw1');
    const c = await connect(api, h, t);
    const event = textEvent('u1', 'hi');
    for (const opts of [
      { signWith: 'another-auth-token' },
      { signature: null },
      { signature: 'ab' },
    ]) {
      const res = await push(api, c, event, opts);
      expect(res.status, JSON.stringify(opts)).toBe(403);
      expect(res.body).toMatchObject({ status: 1, status_message: 'bad signature' });
    }
    expect(await convs(t)).toHaveLength(0);
    expect(await msgs(t)).toHaveLength(0);
    expect((await channelRow(c)).last_inbound_at).toBeNull();
  });

  it('the signature covers the RAW body: the same JSON with other spacing needs its own signature', async () => {
    const t = await api.signup('vw2');
    const c = await connect(api, h, t);
    const compact = JSON.stringify(textEvent('u1', 'hi')).replace(/"@@(\d+)@@"/g, '$1');
    const spaced = compact.replace('{', '{ ');
    const res = await api
      .http()
      .post(`/v2/viber/inbound/${c.routing}`)
      .set('content-type', 'application/json')
      .set('x-viber-content-signature', sign(compact, c.token))
      .send(spaced);
    expect(res.status).toBe(403);
    expect(await msgs(t)).toHaveLength(0);
  });

  it("Viber's validation ping is acknowledged, a paused channel ignores everything, a junk body is quiet", async () => {
    const t = await api.signup('vw3');
    const c = await connect(api, h, t);
    const ping = await push(api, c, { event: 'webhook', timestamp: 1 });
    expect(ping.status).toBe(200);
    expect(ping.body).toEqual({ status: 0 });
    expect((await channelRow(c)).last_inbound_at).toBeNull();

    await h.owner.query(`UPDATE viber_channels SET active = false WHERE id = $1`, [c.rowId]);
    expect((await push(api, c, textEvent('u1', 'hi'))).status).toBe(200);
    expect(await convs(t)).toHaveLength(0);

    await h.owner.query(`UPDATE viber_channels SET active = true WHERE id = $1`, [c.rowId]);
    expect((await push(api, c, { nothing: true })).status).toBe(200);
    expect((await push(api, c, { event: 'client_status', timestamp: 1 })).status).toBe(200);
    expect(await convs(t)).toHaveLength(0);
  });
});

describe('TW-VIB-004: a message becomes a thread, a contact and a message', () => {
  it('first message: thread keyed by the Viber user id (case kept), contact keyed by the user, unread 1, channel marked alive', async () => {
    const t = await api.signup('vm1');
    const c = await connect(api, h, t);
    await h.owner.query(`UPDATE viber_channels SET last_error = 'old' WHERE id = $1`, [c.rowId]);

    const res = await push(
      api,
      c,
      textEvent('uSeR+Ab/9==', 'Hello there', 'Asha Rao', '5098034272017990123'),
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 0 });

    const [conv] = await convs(t);
    expect(conv).toMatchObject({
      peer_key: 'uSeR+Ab/9==',
      title: 'Asha Rao',
      peer_name: 'Asha Rao',
      status: 'open',
      unread_count: 1,
      preview: 'Hello there',
    });
    const [m] = await msgs(t);
    expect(m).toMatchObject({
      direction: 'in',
      kind: 'text',
      body: 'Hello there',
      status: 'received',
    });
    // A 64 bit token keeps every digit (a JavaScript number would round it).
    expect(m.meta.viber).toMatchObject({
      user_id: 'uSeR+Ab/9==',
      message_token: '5098034272017990123',
      msg_type: 'text',
    });
    expect(m.provider_message_id).toBe('5098034272017990123');

    const [contact] = await contacts(t);
    expect(contact).toMatchObject({
      name: 'Asha Rao',
      channel: 'viber',
      channel_uid: 'uSeR+Ab/9==',
      image_url: 'https://cdn.viber.com/a.jpg',
    });
    expect(Number(conv.contact_id)).toBe(Number(contact.id));
    const row = await channelRow(c);
    expect(row.last_inbound_at).not.toBeNull();
    expect(row.last_error).toBeNull();
  });

  it('the same user again: one thread, one contact, unread grows; the same token twice is stored once', async () => {
    const t = await api.signup('vm2');
    const c = await connect(api, h, t);
    await push(api, c, textEvent('u1', 'one', 'Asha'));
    await push(api, c, textEvent('u1', 'two', 'Asha'));
    const dup = textEvent('u1', 'three', 'Asha', '5098034272017990555');
    await push(api, c, dup);
    await push(api, c, dup);

    expect(await convs(t)).toHaveLength(1);
    expect(await contacts(t)).toHaveLength(1);
    expect((await convs(t))[0]!.unread_count).toBe(3);
    expect((await msgs(t)).map((m) => m.body)).toEqual(['one', 'two', 'three']);
  });

  it('a resolved thread reopens when the user writes again', async () => {
    const t = await api.signup('vm3');
    const c = await connect(api, h, t);
    await push(api, c, textEvent('u1', 'first'));
    await h.owner.query(`UPDATE conversations SET status = 'closed' WHERE org_id = $1`, [t.orgId]);
    await push(api, c, textEvent('u1', 'again'));
    expect((await convs(t))[0]!.status).toBe('open');
  });

  it('a user who sends no name gets a thread titled by their id, and a later name replaces it', async () => {
    const t = await api.signup('vm4');
    const c = await connect(api, h, t);
    await push(api, c, textEvent('u-noname', 'hi', null));
    expect((await convs(t))[0]!.title).toBe('u-noname');
    expect((await contacts(t))[0]!.name).toBe('Viber');
    await push(api, c, textEvent('u-noname', 'hi again', 'Ravi'));
    const [conv] = await convs(t);
    expect(conv).toMatchObject({ title: 'Ravi', peer_name: 'Ravi' });
    expect((await contacts(t))[0]!.name).toBe('Ravi');
  });

  it('two users are two threads and two contacts; the same Viber id in another workspace is separate', async () => {
    const a = await api.signup('vm5');
    const b = await api.signup('vm5b');
    const ca = await connect(api, h, a);
    const cb = await connect(api, h, b);
    await push(api, ca, textEvent('shared-id', 'to A'));
    await push(api, ca, textEvent('other-id', 'to A too'));
    await push(api, cb, textEvent('shared-id', 'to B'));
    expect(await convs(a)).toHaveLength(2);
    expect(await contacts(a)).toHaveLength(2);
    expect(await convs(b)).toHaveLength(1);
    expect(await contacts(b)).toHaveLength(1);
    expect((await msgs(b))[0]!.body).toBe('to B');
  });

  it('the inbox lists the thread on a connected viber channel', async () => {
    const t = await api.signup('vm6');
    const c = await connect(api, h, t);
    await push(api, c, textEvent('u1', 'hi', 'Asha'));
    const res = await api.http().get('/v2/inbox/conversations').set(bearer(t.admin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = (res.body.data ?? res.body.items ?? []) as Array<{
      peerKey?: string;
      title?: string;
    }>;
    expect(items.some((i) => i.title === 'Asha' || i.peerKey === 'u1')).toBe(true);
  });
});

describe("TW-VIB-004: what a user can send besides text (Reference's extract)", () => {
  const event = (message: object, user = 'u-kinds') => ({
    event: 'message',
    timestamp: 1,
    message_token: `@@${String(8_000_000_000_000_000_000n + BigInt(Math.floor(Math.random() * 1e9)))}@@`,
    sender: { id: user, name: 'Kind' },
    message,
  });

  it('a picture keeps its caption; the file that cannot be fetched is not lost', async () => {
    const t = await api.signup('vk1');
    const c = await connect(api, h, t);
    // The address is not one of Viber's hosts: the download guard refuses it, and the message is stored without the file.
    await push(
      api,
      c,
      event({ type: 'picture', text: 'look', media: 'https://example.test/p.jpg' }),
    );
    const [m] = await msgs(t);
    expect(m).toMatchObject({ direction: 'in', kind: 'image', body: 'look' });
  });

  it('a location, a contact, a sticker and an unknown type are each noted', async () => {
    const t = await api.signup('vk2');
    const c = await connect(api, h, t);
    await push(api, c, event({ type: 'location', location: { lat: 12.97, lon: 77.59 } }));
    await push(
      api,
      c,
      event({ type: 'contact', contact: { name: 'Ravi', phone_number: '+9199' } }),
    );
    await push(api, c, event({ type: 'sticker', sticker_id: 40100 }));
    await push(api, c, event({ type: 'poll' }));
    const all = await msgs(t);
    expect(all).toHaveLength(4);
    expect(all[0]).toMatchObject({ kind: 'location' });
    expect(Number(all[0]!.latitude)).toBeCloseTo(12.97);
    expect(all[1]).toMatchObject({ kind: 'contact' });
    expect(all[2]).toMatchObject({ body: '[sticker]' });
    expect(all[2]!.meta.viber.sticker_id).toBe('40100');
    expect(all[3]).toMatchObject({ body: '[poll]' });
  });
});

describe('TW-VIB-005: subscribe, conversation started, unsubscribe', () => {
  const sub = (event: string, id = 'u-sub') => ({
    event,
    timestamp: 1,
    user: { id, name: 'Meera', avatar: 'https://cdn.viber.com/m.jpg' },
  });

  it('a subscribe creates the thread and the contact, so the user can be messaged, with one small system line', async () => {
    const t = await api.signup('vs1');
    const c = await connect(api, h, t);
    expect((await push(api, c, sub('subscribed'))).status).toBe(200);
    const [conv] = await convs(t);
    expect(conv).toMatchObject({ peer_key: 'u-sub', title: 'Meera' });
    const [contact] = await contacts(t);
    expect(contact).toMatchObject({ channel_uid: 'u-sub', name: 'Meera' });
    expect(Number(conv.contact_id)).toBe(Number(contact.id));
    const all = await msgs(t);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: 'system', sender_kind: 'system' });
    // No unread: nobody wrote anything.
    expect(conv.unread_count).toBe(0);
  });

  it('conversation_started also creates the thread (Reference); a second event adds nothing', async () => {
    const t = await api.signup('vs2');
    const c = await connect(api, h, t);
    await push(api, c, sub('conversation_started'));
    await push(api, c, sub('subscribed'));
    await push(api, c, sub('subscribed'));
    expect(await convs(t)).toHaveLength(1);
    expect(await contacts(t)).toHaveLength(1);
    expect(await msgs(t)).toHaveLength(1);
  });

  it('a user who already wrote gets no extra line when they subscribe', async () => {
    const t = await api.signup('vs3');
    const c = await connect(api, h, t);
    await push(api, c, textEvent('u-sub', 'hello', 'Meera'));
    await push(api, c, sub('subscribed'));
    expect((await msgs(t)).map((m) => m.kind)).toEqual(['text']);
  });

  it('an unsubscribe changes nothing in the inbox (Reference only logs it) and is acknowledged', async () => {
    const t = await api.signup('vs4');
    const c = await connect(api, h, t);
    await push(api, c, textEvent('u-bye', 'hi'));
    const res = await push(api, c, { event: 'unsubscribed', timestamp: 1, user_id: 'u-bye' });
    expect(res.status).toBe(200);
    expect(await convs(t)).toHaveLength(1);
    expect(await msgs(t)).toHaveLength(1);
  });
});

describe('TW-VIB-006: delivered, seen and failed receipts', () => {
  it('a receipt for a reply sent from the inbox is matched on the message token', async () => {
    const t = await api.signup('vr1');
    const c = await connect(api, h, t);
    const res = await push(api, c, {
      event: 'seen',
      timestamp: 1,
      message_token: '@@5098034272017990999@@',
      user_id: 'u1',
    });
    expect(res.status).toBe(200);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.receipt).toMatchObject({
      providerMessageId: '5098034272017990999',
      status: 'read',
    });
    const inboxChannel = (
      await h.owner.query(`SELECT uuid FROM channels WHERE org_id = $1 AND kind = 'viber'`, [
        t.orgId,
      ])
    ).rows[0];
    expect(receipts[0]!.channelUuid).toBe(inboxChannel.uuid);
    expect(receipts[0]!.orgId).toBe(t.orgId);
  });

  it("a failed receipt carries Viber's reason; a receipt without a token is ignored", async () => {
    const t = await api.signup('vr2');
    const c = await connect(api, h, t);
    await push(api, c, {
      event: 'failed',
      timestamp: 1,
      message_token: '@@5098034272017990111@@',
      user_id: 'u1',
      desc: 'user blocked',
    });
    expect(receipts[0]!.receipt).toMatchObject({ status: 'failed', errorMessage: 'user blocked' });
    receipts.length = 0;
    await push(api, c, { event: 'delivered', timestamp: 1, user_id: 'u1' });
    expect(receipts).toHaveLength(0);
  });

  it('applied to a message in a thread, the receipt moves its status forward', async () => {
    const t = await api.signup('vr3');
    const c = await connect(api, h, t);
    await push(api, c, textEvent('u1', 'hello', 'Asha'));
    // A reply that left through the adapter is a stored outbound message whose provider id is Viber\'s token.
    const channel = (
      await h.owner.query(`SELECT * FROM channels WHERE org_id = $1 AND kind = 'viber'`, [t.orgId])
    ).rows[0];
    const { CONVERSATIONS_FACADE } = await import('../../../src/modules/chat-conversations');
    const { RequestContextStore } = await import('../../../src/common/context/request-context');
    await RequestContextStore.run(
      { requestId: 'r', orgId: t.orgId, actorType: 'system', actorId: null, userId: null },
      () =>
        h.app.get(CONVERSATIONS_FACADE).recordOutbound({
          channelId: channel.uuid,
          peerKey: 'u1',
          source: 'test',
          body: 'reply',
          providerMessageId: '5098034272017990321',
        }),
    );
    await push(api, c, {
      event: 'seen',
      timestamp: 1,
      message_token: '@@5098034272017990321@@',
      user_id: 'u1',
    });
    const job = receipts[0]!;
    const outcome = await h.app.get(ReceiptsService).apply({
      orgId: job.orgId,
      channelUuid: job.channelUuid,
      receipt: job.receipt as never,
    });
    expect(outcome).toBe('applied');
    const reply = (await msgs(t)).find((m) => m.body === 'reply')!;
    expect(reply.status).toBe('read');
    expect(reply.read_at).not.toBeNull();
  });
});

describe('TW-VIB-016: insights', () => {
  it('seven days of volume, active users and the receipts on what was sent; a thread of another channel is not counted', async () => {
    const t = await api.signup('vx1');
    const c = await connect(api, h, t, 'acc-x1', 'First');
    const other = await connect(api, h, t, 'acc-x2', 'Second');
    await push(api, c, textEvent('u1', 'one'));
    await push(api, c, textEvent('u2', 'two'));
    await push(api, other, textEvent('u3', 'elsewhere'));

    const res = await api.http().get('/v2/viber/insights?tz=Asia/Kolkata').set(bearer(t.admin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.channels.map((x: { name: string }) => x.name)).toEqual(['First', 'Second']);
    expect(res.body.channelId).toBe(c.uuid);
    expect(res.body.rows).toHaveLength(7);
    expect(res.body.rows.reduce((n: number, r: { in: number }) => n + r.in, 0)).toBe(2);
    expect(res.body.totals).toMatchObject({
      in: 2,
      out: 0,
      users: 2,
      delivered: 0,
      seen: 0,
      failed: 0,
    });

    const second = await api
      .http()
      .get(`/v2/viber/insights?channel=${other.uuid}`)
      .set(bearer(t.admin));
    expect(second.body.totals).toMatchObject({ in: 1, users: 1 });
  });

  it('with no channel it is empty, not an error; reading needs viber.channels.read', async () => {
    const t = await api.signup('vx2');
    const res = await api.http().get('/v2/viber/insights').set(bearer(t.admin));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ channels: [], channelId: null });
    expect(res.body.rows).toHaveLength(7);
    const nobody = await api.member(t, 'nobody', [['tg.bots.read']]);
    expect((await api.http().get('/v2/viber/insights').set(bearer(nobody.token))).status).toBe(403);
  });
});
