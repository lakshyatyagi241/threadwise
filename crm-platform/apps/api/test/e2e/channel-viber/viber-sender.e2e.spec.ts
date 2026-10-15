import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { DatabaseService } from '../../../src/infra/db/database.service';
import type { ChannelRuntime } from '../../../src/infra/providers/chat-conversations';
import { ChannelError } from '../../../src/infra/providers/chat-conversations/channel.port';
import {
  ChannelAdapterRegistry,
  ChannelDispatcher,
  ChannelRegistryService,
} from '../../../src/modules/chat-conversations';
import { ViberChannelAdapter } from '../../../src/modules/channel-viber/viber-channel.adapter';
import { ViberSenderService } from '../../../src/modules/channel-viber/viber-sender.service';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';
import { connect, fake, installFake, resetFake, type Channel } from './support';

/** A reply in a Viber thread (TW-VIB-008, 009): the channel named in the thread sends it. Real Postgres, fake Viber. */
let h: Harness;
let api: Api;
let sender: ViberSenderService;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  sender = h.app.get(ViberSenderService);
  installFake(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => resetFake());

/** The channel as the inbox's send pipeline hands it to an adapter. */
async function runtimeOf(t: Tenant, c: Channel): Promise<ChannelRuntime> {
  const row = (
    await h.owner.query(
      `SELECT uuid FROM channels WHERE org_id = $1 AND kind = 'viber' AND external_id = $2`,
      [t.orgId, String(c.rowId)],
    )
  ).rows[0];
  const svc = h.app.get(ChannelRegistryService);
  return RequestContextStore.run(
    {
      requestId: 'rt',
      orgId: t.orgId,
      actorType: 'user',
      actorId: t.adminUserId,
      userId: t.adminUserId,
    },
    () =>
      h.app
        .get(DatabaseService)
        .tx(async (tx) => svc.runtime(tx, t.orgId, await svc.row(tx, t.orgId, row.uuid as string))),
  );
}

const sends = () => fake.calls.filter((c) => c.method === 'sendMessage');

describe('the adapter is registered', () => {
  it('the inbox has a live viber adapter with no window, and it is the one this module registered', () => {
    const adapter = h.app.get(ChannelAdapterRegistry).find('viber');
    expect(adapter).toBe(h.app.get(ViberChannelAdapter));
    expect(adapter).toMatchObject({ kind: 'viber', live: true, publicWebhook: false });
    const caps = adapter!.capabilities({} as ChannelRuntime);
    expect(caps).toMatchObject({ windowHours: null, templates: false });
    expect(caps.receipts).toEqual(['sent', 'delivered', 'read']);
    expect(adapter!.windowInfo({} as ChannelRuntime, null, new Date())).toEqual({
      open: true,
      expiresAt: null,
    });
  });
});

describe('TW-VIB-008: a reply from the inbox', () => {
  it("text goes out as the bot, to the user id as given, and the answer is Viber's message token", async () => {
    const t = await api.signup('vs1');
    const c = await connect(api, h, t, 'acc-s1', 'Shop');
    fake.send = () => ({ ok: true, status: 0, data: { message_token: '5098034272017990777' } });
    const out = await sender.reply(t.orgId, {
      channelRowId: c.rowId,
      userId: 'uSeR+9==',
      text: 'Hi there',
    });
    expect(out).toEqual({ ok: true, providerMessageId: '5098034272017990777', error: null });
    expect(sends()).toHaveLength(1);
    expect(sends()[0]).toMatchObject({
      token: c.token,
      to: 'uSeR+9==',
      sender: { name: 'Shop', avatar: 'https://cdn.viber.com/i.png' },
      message: { type: 'text', text: 'Hi there' },
    });
  });

  it('a channel that is gone is "not connected" and Viber is never called; a paused one still sends', async () => {
    const t = await api.signup('vs2');
    const c = await connect(api, h, t);
    const gone = await sender.reply(t.orgId, { channelRowId: 999_999, userId: 'u', text: 'x' });
    expect(gone).toEqual({
      ok: false,
      providerMessageId: null,
      error: 'Viber channel not connected',
    });
    expect(sends()).toHaveLength(0);

    await h.owner.query(`UPDATE viber_channels SET active = false WHERE id = $1`, [c.rowId]);
    expect(
      (await sender.reply(t.orgId, { channelRowId: c.rowId, userId: 'u', text: 'x' })).ok,
    ).toBe(true);
  });

  it("another workspace's channel is not reachable by its row id", async () => {
    const a = await api.signup('vs3');
    const b = await api.signup('vs3b');
    const c = await connect(api, h, a);
    const out = await sender.reply(b.orgId, { channelRowId: c.rowId, userId: 'u', text: 'x' });
    expect(out.ok).toBe(false);
    expect(sends()).toHaveLength(0);
  });

  it("a user who never subscribed gets the plain explanation (status 6); any other refusal is Viber's own words", async () => {
    const t = await api.signup('vs4');
    const c = await connect(api, h, t);
    fake.send = () => ({ ok: false, status: 6, error: '6 receiverNotSubscribed' });
    const out = await sender.reply(t.orgId, { channelRowId: c.rowId, userId: 'u', text: 'x' });
    expect(out).toEqual({
      ok: false,
      providerMessageId: null,
      error: 'The Viber user must open a chat with you before you can message them.',
    });
    fake.send = () => ({ ok: false, status: 12, error: '12 tooManyRequests' });
    expect(
      (await sender.reply(t.orgId, { channelRowId: c.rowId, userId: 'u', text: 'x' })).error,
    ).toBe('12 tooManyRequests');
  });

  it('an empty text is one space (Viber refuses an empty text)', async () => {
    const t = await api.signup('vs5');
    const c = await connect(api, h, t);
    await sender.reply(t.orgId, { channelRowId: c.rowId, userId: 'u', text: '' });
    expect(sends()[0]!.message).toMatchObject({ type: 'text', text: ' ' });
  });
});

describe('TW-VIB-009: files in a reply (Reference dispatchViber)', () => {
  const reply = (kind: 'image' | 'video' | 'audio' | 'document', text = 'cap') => ({
    userId: 'u',
    text,
    media: { kind, url: 'https://files.test/f', size: 2048, name: 'plan.pdf' },
  });

  it('a picture carries the text as its caption in one message', async () => {
    const t = await api.signup('vf1');
    const c = await connect(api, h, t);
    await sender.reply(t.orgId, { channelRowId: c.rowId, ...reply('image') });
    expect(sends().map((s) => s.message)).toEqual([
      { type: 'picture', text: 'cap', media: 'https://files.test/f' },
    ]);
  });

  it('a video or a file is its own message, with its real size, and the text goes first as a message of its own', async () => {
    const t = await api.signup('vf2');
    const c = await connect(api, h, t);
    await sender.reply(t.orgId, { channelRowId: c.rowId, ...reply('video') });
    await sender.reply(t.orgId, { channelRowId: c.rowId, ...reply('document') });
    await sender.reply(t.orgId, { channelRowId: c.rowId, ...reply('audio', '') });
    expect(sends().map((s) => s.message)).toEqual([
      { type: 'text', text: 'cap' },
      { type: 'video', media: 'https://files.test/f', size: 2048 },
      { type: 'text', text: 'cap' },
      { type: 'file', media: 'https://files.test/f', size: 2048, file_name: 'plan.pdf' },
      { type: 'file', media: 'https://files.test/f', size: 2048, file_name: 'plan.pdf' },
    ]);
  });
});

describe('through the inbox send pipeline (ChannelDispatcher)', () => {
  const consent = { purpose: 'service_messaging' as const };

  it('a text leaves through the viber adapter and is idempotent per client reference', async () => {
    const t = await api.signup('vd1');
    const c = await connect(api, h, t);
    const runtime = await runtimeOf(t, c);
    const dispatcher = h.app.get(ChannelDispatcher);
    const run = (fn: () => Promise<unknown>) =>
      RequestContextStore.run(
        {
          requestId: 'd',
          orgId: t.orgId,
          actorType: 'user',
          actorId: t.adminUserId,
          userId: t.adminUserId,
        },
        fn,
      );
    fake.send = () => ({ ok: true, status: 0, data: { message_token: '5098034272017990888' } });
    const ref = randomUUID();
    const envelope = {
      kind: 'text',
      to: 'u-d1',
      clientReference: ref,
      body: 'Hello from the inbox',
    };
    const first = (await run(() =>
      dispatcher.send({ channel: runtime, envelope, lastInboundAt: null, consent }),
    )) as { providerMessageId: string; replayed: boolean };
    expect(first).toMatchObject({ providerMessageId: '5098034272017990888', replayed: false });
    const again = (await run(() =>
      dispatcher.send({ channel: runtime, envelope, lastInboundAt: null, consent }),
    )) as { replayed: boolean };
    expect(again.replayed).toBe(true);
    expect(sends()).toHaveLength(1);
    expect(sends()[0]).toMatchObject({ to: 'u-d1', message: { text: 'Hello from the inbox' } });
  });

  it('a Viber refusal becomes a failed send with a reason the agent can read, not retried', async () => {
    const t = await api.signup('vd2');
    const c = await connect(api, h, t);
    const runtime = await runtimeOf(t, c);
    fake.send = () => ({ ok: false, status: 6, error: '6 x' });
    const adapter = h.app.get(ViberChannelAdapter);
    const err = (await adapter
      .send(runtime, {
        kind: 'text',
        to: 'u',
        clientReference: randomUUID(),
        attempt: 1,
        body: 'x',
      })
      .catch((e: unknown) => e)) as ChannelError;
    expect(err).toBeInstanceOf(ChannelError);
    expect(err).toMatchObject({ code: 'VIBER_SEND_REJECTED', retryable: false });
    expect(err.message).toMatch(/open a chat with you/);
  });

  it('a deleted channel is CHANNEL_DISCONNECTED; a message kind Viber cannot carry is refused', async () => {
    const t = await api.signup('vd3');
    const c = await connect(api, h, t);
    const runtime = await runtimeOf(t, c);
    const adapter = h.app.get(ViberChannelAdapter);
    await h.owner.query(`DELETE FROM viber_channels WHERE id = $1`, [c.rowId]);
    const gone = (await adapter
      .send(runtime, {
        kind: 'text',
        to: 'u',
        clientReference: randomUUID(),
        attempt: 1,
        body: 'x',
      })
      .catch((e: unknown) => e)) as ChannelError;
    expect(gone.code).toBe('CHANNEL_DISCONNECTED');
    const unsupported = (await adapter
      .send(runtime, {
        kind: 'reaction',
        to: 'u',
        clientReference: randomUUID(),
        attempt: 1,
        reaction: { providerMessageId: 'x', emoji: '👍' },
      })
      .catch((e: unknown) => e)) as ChannelError;
    expect(unsupported.code).toBe('CHANNEL_CAPABILITY_UNSUPPORTED');
  });

  it('a file from a local-disk store cannot be fetched by Viber and says so', async () => {
    const t = await api.signup('vd4');
    const c = await connect(api, h, t);
    const runtime = await runtimeOf(t, c);
    const err = (await h.app
      .get(ViberChannelAdapter)
      .send(runtime, {
        kind: 'media',
        to: 'u',
        clientReference: randomUUID(),
        attempt: 1,
        media: { key: `chat/${t.orgId}/x/a.jpg`, mediaKind: 'image', mime: 'image/jpeg' },
      })
      .catch((e: unknown) => e)) as ChannelError;
    expect(err.code).toBe('MEDIA_NOT_REACHABLE');
    expect(sends()).toHaveLength(0);
  });
});
