import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import type { Normalized } from '../../../src/infra/providers/node-bridge-runtime/inbound-normalizer';
import type { InboundMessage } from '../../../src/infra/providers/node-bridge-runtime/inbound.port';
import { REDIS_CLIENT } from '../../../src/infra/redis/redis.module';
import {
  CONVERSATIONS_FACADE,
  ChannelIngestPublisher,
  ChannelRegistryService,
  InboundMessageHooks,
  type ConversationsFacade,
  type InboundMessageListener,
} from '../../../src/modules/chat-conversations';
import { DeviceGroupRetitleConsumer } from '../../../src/modules/chat-conversations/device-group-retitle.consumer';
import { UNOFFICIAL_WHATSAPP_GATE } from '../../../src/modules/auth/unofficial-whatsapp.port';
import { inboxKeys } from '../../../src/modules/node-bridge-runtime/inbox/inbox-keys';
import { InboxBridge } from '../../../src/modules/node-bridge-runtime/inbox/inbox-bridge.service';
import type { DeviceRuntimeService } from '../../../src/modules/node-bridge-runtime/runtime/device-runtime.service';
import {
  asUser,
  conversationOf,
  messagesOf,
  startPipeline,
  until,
  type Pipeline,
} from '../chat-conversations/pipeline-support';
import { rig, worker as buildWorker, type FakeSocket, type Rig } from './support';

/**
 * The unofficial engine in the inbox (TW-NODE-017, 018, 020): what a linked number receives comes out as a thread and a message
 * through the inbox's own ingest queue, and what an agent replies goes out through the device. Real Postgres, Redis and BullMQ
 * workers, a fake socket for WhatsApp.
 */
let p: Pipeline;
let r: Rig;
let facade: ConversationsFacade;
let bridge: InboxBridge;
const runtimes: DeviceRuntimeService[] = [];

beforeAll(async () => {
  p = await startPipeline();
  r = rig(p.h);
  facade = p.h.app.get<ConversationsFacade>(CONVERSATIONS_FACADE);
  // The worker module registers this in a real worker; here it is wired to the routers the fake runtime uses.
  bridge = new InboxBridge(
    p.h.app.get(DatabaseService),
    p.h.app.get<Redis>(REDIS_CLIENT),
    r.inbound,
    r.receipts,
    p.h.app.get(ChannelIngestPublisher),
    p.h.app.get(ChannelRegistryService),
    facade,
  );
  bridge.onModuleInit();
}, 300_000);

afterEach(async () => {
  for (const rt of runtimes.splice(0)) await rt.onApplicationShutdown();
  await p.h.owner.query(`DELETE FROM device_auth_state`);
});
afterAll(async () => {
  await p?.stop();
});

let seq = 0;
async function linked(label: string) {
  const t = await p.api.signup(label);
  const phone = `96${String(3000000 + seq++).padStart(8, '0')}`;
  const dev = (
    await p.h.owner.query(
      `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active)
       VALUES ($1, 'Shop phone', '+91', $2, 'disconnected', false) RETURNING id, uuid`,
      [t.orgId, phone],
    )
  ).rows[0];
  const w = await buildWorker(p.h, r);
  runtimes.push(w.rt);
  await w.rt.adopt(t.orgId, Number(dev.id));
  const socket = w.factory.last as FakeSocket;
  const channel = await until(
    'the device channel',
    async () =>
      (
        await p.h.owner.query(
          `SELECT id, uuid, status, name, display_address, external_id, kind, settings
           FROM channels WHERE org_id = $1 AND kind = 'whatsapp_qr' AND status = 'connected'`,
          [t.orgId],
        )
      ).rows[0],
  );
  return { t, w, socket, deviceId: Number(dev.id), deviceUuid: dev.uuid as string, channel, phone };
}

const customer = (id: string, over: Partial<InboundMessage> = {}): Normalized => ({
  kind: 'inbound',
  message: {
    providerMessageId: id,
    chat: { jid: '919800000001@s.whatsapp.net', phone: '919800000001', lid: null, isGroup: false },
    fromMe: false,
    participant: null,
    pushName: 'Asha',
    timestamp: new Date(),
    text: 'hello',
    media: null,
    location: null,
    contact: null,
    reaction: null,
    forwarded: null,
    ...over,
  },
});

const threadOf = async (x: Awaited<ReturnType<typeof linked>>, peer = '919800000001') =>
  conversationOf(p, x.t, { id: x.channel.uuid, internalId: Number(x.channel.id) }, peer);

describe('the device as an inbox channel (TW-NODE-017)', () => {
  it('creates one channel per device, named and addressed like the number, and keeps its status', async () => {
    const x = await linked('qr-chan');
    expect(x.channel).toMatchObject({
      kind: 'whatsapp_qr',
      status: 'connected',
      name: 'Shop phone',
      external_id: x.deviceUuid,
      display_address: `+91${x.phone}`,
    });
    expect(x.channel.settings).toMatchObject({ metered: false });

    await x.w.rt.applyStatus(x.t.orgId, x.deviceId, { status: 'disconnected', progress: 0 });
    await until(
      'disconnected',
      async () =>
        (
          await p.h.owner.query(
            `SELECT 1 FROM channels WHERE id = $1 AND status = 'disconnected'`,
            [x.channel.id],
          )
        ).rows[0],
    );
    // Reconnecting reuses the same channel.
    await x.w.rt.applyStatus(x.t.orgId, x.deviceId, { status: 'open', progress: 100 });
    await until(
      'connected again',
      async () =>
        (
          await p.h.owner.query(`SELECT 1 FROM channels WHERE id = $1 AND status = 'connected'`, [
            x.channel.id,
          ])
        ).rows[0],
    );
    expect(
      (
        await p.h.owner.query(
          `SELECT count(*)::int AS n FROM channels WHERE org_id = $1 AND kind = 'whatsapp_qr'`,
          [x.t.orgId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
});

describe('inbound (TW-NODE-016, 017, 018)', () => {
  it('a customer message becomes a thread and a message, once, however often it is delivered', async () => {
    const x = await linked('qr-in');
    x.socket.emit({ type: 'message', normalized: customer('wamid.in.1') });
    x.socket.emit({ type: 'message', normalized: customer('wamid.in.1') });
    const conv = await until('the thread', async () => threadOf(x));
    await until('the message', async () => (await messagesOf(p, conv.id as number)).length >= 1);
    await new Promise((res) => setTimeout(res, 300));
    const msgs = await messagesOf(p, conv.id as number);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ direction: 'in', kind: 'text', body: 'hello' });
    expect(conv).toMatchObject({ peer_name: 'Asha', peer_key: '919800000001' });
  });

  it('keeps a small customer file, and says so when the file did not come', async () => {
    const x = await linked('qr-media');
    const image = { kind: 'image' as const, mimeType: 'image/png', fileName: null, sizeBytes: 70 };
    // A real 1x1 PNG, so the inbox's upload check accepts it.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    x.socket.emit({
      type: 'message',
      normalized: customer('wamid.img.1', { text: 'look', media: image }),
      media: png,
    });
    x.socket.emit({
      type: 'message',
      normalized: customer('wamid.img.2', { text: null, media: image }),
    });
    const conv = await until('the thread', async () => threadOf(x));
    const msgs = await until('both messages', async () => {
      const m = await messagesOf(p, conv.id as number);
      return m.length >= 2 ? m : undefined;
    });
    const withFile = msgs.find((m) => m.provider_message_id === 'wamid.img.1' || m.body === 'look');
    expect(withFile).toMatchObject({ kind: 'image', body: 'look' });
    expect(String((withFile as Record<string, unknown>).media_key)).toMatch(/^chat\//);
    expect(msgs.some((m) => String(m.body).includes('Photo not available'))).toBe(true);
  });

  it("records the business's own phone-typed message as outbound, once", async () => {
    const x = await linked('qr-echo');
    const mine = customer('wamid.echo.1', { fromMe: true, text: 'typed on the phone' });
    x.socket.emit({ type: 'message', normalized: { ...mine, kind: 'echo' } });
    x.socket.emit({ type: 'message', normalized: { ...mine, kind: 'echo' } });
    const conv = await until('the thread', async () => threadOf(x));
    const msgs = await until('the echo', async () => {
      const m = await messagesOf(p, conv.id as number);
      return m.length >= 1 ? m : undefined;
    });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ direction: 'out', body: 'typed on the phone' });
    expect(
      (
        await p.h.owner.query(`SELECT count(*)::int AS n FROM conversations WHERE org_id = $1`, [
          x.t.orgId,
        ])
      ).rows[0].n,
    ).toBe(1);
  });
});

describe('replying from the inbox (TW-NODE-017, 020)', () => {
  it('sends through the device, then follows the delivery and read receipts', async () => {
    const x = await linked('qr-out');
    x.socket.emit({ type: 'message', normalized: customer('wamid.q.1') });
    const conv = await until('the thread', async () => threadOf(x));
    await until('the message', async () => (await messagesOf(p, conv.id as number)).length >= 1);

    const sent = await asUser(x.t.orgId, x.t.adminUserId, () =>
      facade.enqueueOutbound({
        conversationId: conv.uuid as string,
        clientMessageId: randomUUID(),
        content: { kind: 'text', body: 'We are open until 9' },
      }),
    );
    const status = async (s: string) =>
      until(`message ${s}`, async () => {
        const row = (
          await p.h.owner.query(
            `SELECT status, provider_message_id FROM messages WHERE uuid = $1`,
            [sent.message.id],
          )
        ).rows[0];
        return row?.status === s ? row : undefined;
      });
    const row = await status('sent');
    expect(x.socket.sends).toHaveLength(1);
    expect(x.socket.sends[0]!.command).toMatchObject({
      type: 'text',
      to: '919800000001',
      body: 'We are open until 9',
    });
    expect(row.provider_message_id).toBe('wamid.fake.1');

    x.socket.emit({
      type: 'receipt',
      receipt: { providerMessageId: 'wamid.fake.1', chatJid: 'x', ack: 3 },
    });
    await status('delivered');
    x.socket.emit({
      type: 'receipt',
      receipt: { providerMessageId: 'wamid.fake.1', chatJid: 'x', ack: 4 },
    });
    await status('read');
  });

  it(
    'fails a send to a disconnected device with a reason the agent can retry',
    { timeout: 30_000 },
    async () => {
      const x = await linked('qr-down');
      x.socket.emit({ type: 'message', normalized: customer('wamid.d.1') });
      const conv = await until('the thread', async () => threadOf(x));
      await until('the message', async () => (await messagesOf(p, conv.id as number)).length >= 1);
      await x.w.rt.onApplicationShutdown();
      const sent = await asUser(x.t.orgId, x.t.adminUserId, () =>
        facade.enqueueOutbound({
          conversationId: conv.uuid as string,
          clientMessageId: randomUUID(),
          content: { kind: 'text', body: 'anyone there?' },
        }),
      ).catch(() => null);
      // Whether the guard refuses it up front or the send fails and waits to be retried, nothing goes out and nothing is claimed sent.
      await new Promise((res) => setTimeout(res, 1_500));
      if (sent) {
        const row = (
          await p.h.owner.query(`SELECT status FROM messages WHERE uuid = $1`, [sent.message.id])
        ).rows[0];
        expect(['queued', 'failed']).toContain(row.status);
      }
      expect(x.socket.sends).toHaveLength(0);
    },
  );
});

// --- groups on a personal number (inventory TW-WAGRP-015 to 021, 032 to 034) ------------------------------------------------

const GROUP_ID = '120363111111111111';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** The directory row the groups API keeps (the thread title, the left flag and the announce rule read it). */
async function directoryRow(
  x: Awaited<ReturnType<typeof linked>>,
  over: { subject?: string | null; announce?: boolean; isAdmin?: boolean; groupId?: string } = {},
) {
  await p.h.owner.query(
    `INSERT INTO wa_device_groups (org_id, device_id, group_jid, subject, announce, is_admin, size, participants)
     VALUES ($1, $2, $3, $4, $5, $6, 3, $7::jsonb)`,
    [
      x.t.orgId,
      x.deviceId,
      over.groupId ?? GROUP_ID,
      over.subject === undefined ? 'Neighbourhood sellers' : over.subject,
      over.announce ?? false,
      over.isAdmin ?? true,
      JSON.stringify([
        {
          jid: '919000000001@s.whatsapp.net',
          phone: '919000000001',
          lid: null,
          name: 'Asha',
          admin: 'admin',
        },
        {
          jid: '919000000002@s.whatsapp.net',
          phone: '919000000002',
          lid: null,
          name: 'Ravi',
          admin: null,
        },
        { jid: '55512345@lid', phone: null, lid: '55512345', name: null, admin: null },
      ]),
    ],
  );
}

const groupMsg = (
  id: string,
  over: Partial<InboundMessage> = {},
  groupId = GROUP_ID,
): Normalized => ({
  kind: 'group',
  message: {
    ...customer(id).message,
    chat: { jid: `${groupId}@g.us`, phone: null, lid: null, isGroup: true },
    participant: { phone: '919000000001', lid: null, name: 'Asha' },
    pushName: 'Asha',
    text: 'who has stock?',
    ...over,
  },
});

const groupThread = (x: Awaited<ReturnType<typeof linked>>, groupId = GROUP_ID) =>
  threadOf(x, `g:${groupId}`);

const failureOf = async (uuid: string) =>
  (await p.h.owner.query(`SELECT status, failure_code FROM messages WHERE uuid = $1`, [uuid]))
    .rows[0];

const sendText = (
  x: Awaited<ReturnType<typeof linked>>,
  conversationId: string,
  content: Parameters<ConversationsFacade['enqueueOutbound']>[0]['content'],
  extra: { replyToMessageId?: string } = {},
) =>
  asUser(x.t.orgId, x.t.adminUserId, () =>
    facade.enqueueOutbound({
      conversationId,
      clientMessageId: randomUUID(),
      content,
      ...extra,
    }),
  );

describe('a group message is a thread message (TW-WAGRP-015, 016, 017)', () => {
  it('files it on one g: thread titled with the subject, names each speaker, makes no contact and runs no listener', async () => {
    const x = await linked('qr-grp-in');
    await directoryRow(x);
    const seen: string[] = [];
    const spy: InboundMessageListener = {
      name: 'spy-group-regression',
      onStored: async (e) => {
        seen.push(e.peerKey);
      },
    };
    p.h.app.get(InboundMessageHooks).register(spy);

    x.socket.emit({ type: 'message', normalized: groupMsg('wamid.g.1') });
    x.socket.emit({
      type: 'message',
      normalized: groupMsg('wamid.g.2', {
        text: 'me, 12 left',
        participant: { phone: '919000000002', lid: null, name: 'Ravi K' },
        pushName: 'Ravi K',
      }),
    });
    // A speaker WhatsApp knows only by an anonymous id: no phone, the id travels instead.
    x.socket.emit({
      type: 'message',
      normalized: groupMsg('wamid.g.3', {
        text: 'count me in',
        participant: { phone: null, lid: '55512345', name: null },
        pushName: null,
      }),
    });
    const conv = await groupThread(x);
    const msgs = await until('three messages', async () => {
      const m = await messagesOf(p, conv.id as number);
      return m.length >= 3 ? m : undefined;
    });
    expect(conv).toMatchObject({
      title: 'Neighbourhood sellers',
      peer_key: `g:${GROUP_ID}`,
      contact_id: null,
    });
    expect(conv.peer_name ?? null).toBeNull();
    const byId = (id: string) =>
      msgs.find((m) => m.provider_message_id === id) as Record<string, any>;
    expect(byId('wamid.g.1').meta.group).toMatchObject({
      participant: '919000000001',
      senderName: 'Asha',
    });
    expect(byId('wamid.g.2').meta.group).toMatchObject({
      participant: '919000000002',
      senderName: 'Ravi K',
    });
    expect(byId('wamid.g.3').meta.group).toMatchObject({ participant: '', senderLid: '55512345' });
    expect(byId('wamid.g.3').direction).toBe('in');

    // One thread for the group, however many speak; nobody became a contact.
    const convs = await p.h.owner.query(
      `SELECT count(*)::int AS n FROM conversations WHERE org_id = $1`,
      [x.t.orgId],
    );
    expect(convs.rows[0].n).toBe(1);
    const contacts = await p.h.owner.query(
      `SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`,
      [x.t.orgId],
    );
    expect(contacts.rows[0].n).toBe(0);

    // The proof the spy works: a one-to-one message does reach it. The group messages never did.
    x.socket.emit({ type: 'message', normalized: customer('wamid.one.1') });
    await until('the one-to-one listener run', () => (seen.length > 0 ? true : undefined));
    expect(seen).toEqual(['919800000001']);
  });

  it('stores a redelivery once, and a reaction on the message it answers', async () => {
    const x = await linked('qr-grp-dup');
    await directoryRow(x);
    x.socket.emit({ type: 'message', normalized: groupMsg('wamid.dup.1') });
    x.socket.emit({ type: 'message', normalized: groupMsg('wamid.dup.1') });
    const conv = await groupThread(x);
    await until('the message', async () => (await messagesOf(p, conv.id as number)).length >= 1);
    x.socket.emit({
      type: 'message',
      normalized: groupMsg('wamid.dup.r', {
        text: null,
        reaction: { emoji: '👍', targetMessageId: 'wamid.dup.1' },
      }),
    });
    await until('the reaction', async () => {
      const m = (await messagesOf(p, conv.id as number)) as Array<Record<string, unknown>>;
      return m[0]?.reaction === '👍' ? true : undefined;
    });
    await new Promise((res) => setTimeout(res, 300));
    expect(await messagesOf(p, conv.id as number)).toHaveLength(1);
  });

  it('keeps a member’s photo, a shared place and a contact card', async () => {
    const x = await linked('qr-grp-kinds');
    await directoryRow(x);
    x.socket.emit({
      type: 'message',
      normalized: groupMsg('wamid.k.img', {
        text: 'stock photo',
        media: { kind: 'image', mimeType: 'image/png', fileName: null, sizeBytes: 70 },
      }),
      media: PNG,
    });
    x.socket.emit({
      type: 'message',
      normalized: groupMsg('wamid.k.big', {
        text: null,
        media: { kind: 'video', mimeType: 'video/mp4', fileName: null, sizeBytes: 90_000_000 },
      }),
    });
    x.socket.emit({
      type: 'message',
      normalized: groupMsg('wamid.k.loc', {
        text: null,
        location: { latitude: 12.9, longitude: 77.6, name: 'Shop', address: null },
      }),
    });
    x.socket.emit({
      type: 'message',
      normalized: groupMsg('wamid.k.card', {
        text: null,
        contact: { name: 'Meera', phone: '+919811111111', vcard: 'BEGIN:VCARD\nEND:VCARD' },
      }),
    });
    const conv = await groupThread(x);
    const msgs = (await until('four messages', async () => {
      const m = await messagesOf(p, conv.id as number);
      return m.length >= 4 ? m : undefined;
    })) as Array<Record<string, any>>;
    const kind = (id: string) => msgs.find((m) => m.provider_message_id === id)!;
    expect(kind('wamid.k.img')).toMatchObject({ kind: 'image', body: 'stock photo' });
    expect(String(kind('wamid.k.img').media_key)).toMatch(/^chat\//);
    // Over the size cap the socket gives no bytes: the message is kept and says the file did not come.
    expect(String(kind('wamid.k.big').body)).toContain('Video not available');
    expect(kind('wamid.k.loc')).toMatchObject({ kind: 'location' });
    expect(kind('wamid.k.card')).toMatchObject({ kind: 'contact' });
    expect(kind('wamid.k.card').meta.group).toMatchObject({ participant: '919000000001' });
  });

  it('mirrors a message typed on the phone as outbound once, and never a message this inbox just sent', async () => {
    const x = await linked('qr-grp-echo');
    await directoryRow(x);
    // No inbound yet: the phone-typed message opens the thread, titled with the subject.
    const mine = groupMsg('wamid.phone.1', {
      fromMe: true,
      text: 'typed on the phone',
      participant: null,
      pushName: null,
    });
    x.socket.emit({ type: 'message', normalized: mine });
    x.socket.emit({ type: 'message', normalized: mine });
    const conv = await groupThread(x);
    expect(conv.title).toBe('Neighbourhood sellers');
    const msgs = await until('the echo', async () => {
      const m = await messagesOf(p, conv.id as number);
      return m.length >= 1 ? m : undefined;
    });
    await new Promise((res) => setTimeout(res, 300));
    expect(await messagesOf(p, conv.id as number)).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ direction: 'out', body: 'typed on the phone' });
    expect((msgs[0] as Record<string, any>).meta.source).toBe('phone');

    // Our own send leaves its id in the sent marker; the same message echoed back by WhatsApp is not a second bubble.
    await p.h.app
      .get<Redis>(REDIS_CLIENT)
      .set(inboxKeys.sent('wamid.ours.1'), x.channel.uuid, 'EX', 60);
    x.socket.emit({
      type: 'message',
      normalized: groupMsg('wamid.ours.1', {
        fromMe: true,
        text: 'sent from the inbox',
        participant: null,
      }),
    });
    await new Promise((res) => setTimeout(res, 500));
    expect(await messagesOf(p, conv.id as number)).toHaveLength(1);
  });
});

describe('replying into a group from the inbox (TW-WAGRP-019, 020, 034)', () => {
  it('goes out as a group text with the mentioned members, quoting the message it answers', async () => {
    const x = await linked('qr-grp-out');
    await directoryRow(x);
    x.socket.emit({ type: 'message', normalized: groupMsg('wamid.o.1') });
    const conv = await groupThread(x);
    const first = (await until('the message', async () => {
      const m = await messagesOf(p, conv.id as number);
      return m[0];
    })) as Record<string, any>;

    const sent = await sendText(
      x,
      conv.uuid as string,
      {
        kind: 'text',
        body: 'Hi @Ravi we have it',
        mentions: [{ jid: '919000000002@s.whatsapp.net', name: 'Ravi' }],
      },
      { replyToMessageId: first.uuid },
    );
    const row = await until('sent', async () => {
      const r = await failureOf(sent.message.id);
      return r?.status === 'sent' ? r : undefined;
    });
    expect(row.status).toBe('sent');
    expect(x.socket.sends).toHaveLength(1);
    expect(x.socket.sends[0]!.command).toMatchObject({
      type: 'group_text',
      groupJid: GROUP_ID,
      body: 'Hi @919000000002 we have it',
      mentions: ['919000000002@s.whatsapp.net'],
      quote: {
        providerMessageId: 'wamid.o.1',
        fromMe: false,
        participant: '919000000001@s.whatsapp.net',
      },
    });
    // The thread shows the mention that went out.
    const page = await asUser(x.t.orgId, x.t.adminUserId, () =>
      facade.listMessages(conv.uuid as string, { limit: 10 } as never),
    );
    const outbound = page.data.find((m) => m.direction === 'out')!;
    expect(outbound.mentions).toEqual([{ jid: '919000000002@s.whatsapp.net', name: 'Ravi' }]);
  });

  it('sends a plain text, a place, a card, a reaction and a file into the group, never to a phone number', async () => {
    const x = await linked('qr-grp-kinds-out');
    await directoryRow(x);
    x.socket.emit({ type: 'message', normalized: groupMsg('wamid.ko.1') });
    const conv = await groupThread(x);
    const first = (await until(
      'the message',
      async () => (await messagesOf(p, conv.id as number))[0],
    )) as Record<string, any>;
    const go = async (content: Parameters<typeof sendText>[2], extra = {}) => {
      const s = await sendText(x, conv.uuid as string, content, extra);
      await until('sent', async () =>
        (await failureOf(s.message.id))?.status === 'sent' ? true : undefined,
      );
    };
    await go({ kind: 'text', body: 'plain' });
    await go({ kind: 'location', latitude: 1.5, longitude: 2.5 });
    await go({
      kind: 'contacts',
      contacts: [{ name: 'Meera', phones: ['+919811111111'], emails: [] }],
    });
    await go({ kind: 'reaction', emoji: '👍' }, { replyToMessageId: first.uuid });
    const cmds = x.socket.sends.map((s) => s.command);
    expect(cmds[0]).toMatchObject({ type: 'text', to: GROUP_ID, toGroup: true, body: 'plain' });
    expect(cmds[1]).toMatchObject({ type: 'location', to: GROUP_ID, toGroup: true });
    expect(cmds[2]).toMatchObject({ type: 'contact', to: GROUP_ID, toGroup: true });
    expect(x.socket.actions[0]).toMatchObject({
      type: 'react',
      to: `${GROUP_ID}@g.us`,
      messageId: 'wamid.ko.1',
      fromMe: false,
      participant: '919000000001@s.whatsapp.net',
    });
  });

  it('refuses a template and buttons in a group before anything is stored', async () => {
    const x = await linked('qr-grp-tpl');
    await directoryRow(x);
    x.socket.emit({ type: 'message', normalized: groupMsg('wamid.t.1') });
    const conv = await groupThread(x);
    await until('the message', async () => (await messagesOf(p, conv.id as number)).length >= 1);
    const refused = await sendText(x, conv.uuid as string, {
      kind: 'template',
      name: 'promo',
      language: 'en',
      variables: {},
      body: 'x',
    }).catch((e: unknown) => e as { code?: string });
    expect((refused as { code?: string }).code).toBe('CHANNEL_CAPABILITY_UNSUPPORTED');
    expect(x.socket.sends).toHaveLength(0);
  });

  it('refuses every send once the number left the group, while the thread stays readable', async () => {
    const x = await linked('qr-grp-left');
    await directoryRow(x);
    x.socket.emit({ type: 'message', normalized: groupMsg('wamid.l.1') });
    const conv = await groupThread(x);
    await until('the message', async () => (await messagesOf(p, conv.id as number)).length >= 1);
    await p.h.owner.query(`UPDATE wa_device_groups SET left_at = now() WHERE org_id = $1`, [
      x.t.orgId,
    ]);

    const refused = await sendText(x, conv.uuid as string, {
      kind: 'text',
      body: 'still there?',
    }).catch((e: unknown) => e as { code?: string });
    expect((refused as { code?: string }).code).toBe('WA_GROUP_LEFT');
    expect(x.socket.sends).toHaveLength(0);

    const detail = await p.api.as(x.t.admin).get(`/v2/inbox/conversations/${conv.uuid}`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body.personalGroup).toMatchObject({
      groupId: GROUP_ID,
      left: true,
      canSend: false,
      memberCount: 3,
    });
    const read = await p.api.as(x.t.admin).get(`/v2/inbox/conversations/${conv.uuid}/messages`);
    expect(read.status).toBe(200);
    expect(read.body.data).toHaveLength(1);
  });

  it('refuses a send into an announce-only group when the number is not an admin, and lets an admin number write', async () => {
    const x = await linked('qr-grp-announce');
    await directoryRow(x, { announce: true, isAdmin: false });
    x.socket.emit({ type: 'message', normalized: groupMsg('wamid.a.1') });
    const conv = await groupThread(x);
    await until('the message', async () => (await messagesOf(p, conv.id as number)).length >= 1);

    const refused = await sendText(x, conv.uuid as string, { kind: 'text', body: 'hello' }).catch(
      (e: unknown) => e as { code?: string },
    );
    expect((refused as { code?: string }).code).toBe('WA_GROUP_ANNOUNCE_ONLY');
    const detail = await p.api.as(x.t.admin).get(`/v2/inbox/conversations/${conv.uuid}`);
    expect(detail.body.personalGroup).toMatchObject({
      announce: true,
      isAdmin: false,
      announceOnly: true,
      canSend: false,
      left: false,
    });

    await p.h.owner.query(`UPDATE wa_device_groups SET is_admin = true WHERE org_id = $1`, [
      x.t.orgId,
    ]);
    const ok = await sendText(x, conv.uuid as string, { kind: 'text', body: 'hello' });
    await until('sent', async () =>
      (await failureOf(ok.message.id))?.status === 'sent' ? true : undefined,
    );
    expect(x.socket.sends).toHaveLength(1);
  });

  it('does not count a group send against the plan: one message, no wallet', async () => {
    const x = await linked('qr-grp-meter');
    await directoryRow(x);
    expect(x.channel.settings).toMatchObject({ metered: false });
    x.socket.emit({ type: 'message', normalized: groupMsg('wamid.m.1') });
    const conv = await groupThread(x);
    await until('the message', async () => (await messagesOf(p, conv.id as number)).length >= 1);
    const s = await sendText(x, conv.uuid as string, { kind: 'text', body: 'ok' });
    await until('sent', async () =>
      (await failureOf(s.message.id))?.status === 'sent' ? true : undefined,
    );
    const wallet = await p.h.owner.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'wallet_ledger'`,
    );
    if (wallet.rows[0].n > 0) {
      const used = await p.h.owner.query(
        `SELECT count(*)::int AS n FROM wallet_ledger WHERE org_id = $1`,
        [x.t.orgId],
      );
      expect(used.rows[0].n).toBe(0);
    }
  });

  it('fails a group send, without a retry, when the platform switch is off', async () => {
    const x = await linked('qr-grp-gate');
    await directoryRow(x);
    x.socket.emit({ type: 'message', normalized: groupMsg('wamid.gt.1') });
    const conv = await groupThread(x);
    await until('the message', async () => (await messagesOf(p, conv.id as number)).length >= 1);
    const gate = p.h.app.get(UNOFFICIAL_WHATSAPP_GATE);
    const off = vi.spyOn(gate, 'isEnabledFor').mockResolvedValue(false);
    try {
      const s = await sendText(x, conv.uuid as string, { kind: 'text', body: 'anyone?' });
      const row = await until('failed', async () => {
        const r = await failureOf(s.message.id);
        return r?.status === 'failed' ? r : undefined;
      });
      expect(row.failure_code).toBe('WA_UNOFFICIAL_DISABLED');
      expect(x.socket.sends).toHaveLength(0);
    } finally {
      off.mockRestore();
    }
  });
});

describe('the thread follows the group and offers its members (TW-WAGRP-032, 033)', () => {
  it('retitles the thread when the directory row is renamed, and lists the members for @mentions', async () => {
    const x = await linked('qr-grp-title');
    // The first message arrives before the directory knows the group: the generic title, until the subject is known.
    x.socket.emit({ type: 'message', normalized: groupMsg('wamid.ti.1') });
    const conv = await groupThread(x);
    expect(conv.title).toBe('WhatsApp group');
    await directoryRow(x, { subject: 'Wholesale buyers' });
    const row = (
      await p.h.owner.query(`SELECT id FROM wa_device_groups WHERE org_id = $1`, [x.t.orgId])
    ).rows[0];
    // The consumer registered in the worker module takes the outbox event the groups API writes when the subject changes.
    const consumer = p.h.app.get(DeviceGroupRetitleConsumer, { strict: false });
    const event = {
      id: '1',
      orgId: x.t.orgId,
      aggregateModule: 'whatsapp-devices-baileys',
      aggregateId: String(row.id),
      eventType: 'whatsapp.device_group.updated',
      payload: {},
    };
    await consumer.handle(event);
    // At-least-once delivery: the same event again changes nothing.
    await consumer.handle(event);
    const after = await p.h.owner.query(`SELECT title FROM conversations WHERE id = $1`, [conv.id]);
    expect(after.rows[0].title).toBe('Wholesale buyers');

    const members = await p.api
      .as(x.t.admin)
      .get(`/v2/inbox/conversations/${conv.uuid}/group-members?q=ra`);
    expect(members.status, JSON.stringify(members.body)).toBe(200);
    expect(members.body.total).toBe(3);
    expect(members.body.members).toEqual([
      { jid: '919000000002@s.whatsapp.net', name: 'Ravi', phone: '+919000000002', admin: null },
    ]);
    // The generic title also does not survive a LID-only member showing as a number-less row.
    const all = await p.api.as(x.t.admin).get(`/v2/inbox/conversations/${conv.uuid}/group-members`);
    expect(all.body.members.map((m: { jid: string }) => m.jid)).toContain('55512345@lid');
  });
});
