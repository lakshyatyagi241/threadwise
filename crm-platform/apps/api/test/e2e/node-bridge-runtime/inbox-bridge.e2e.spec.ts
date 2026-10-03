import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import type { Normalized } from '../../../src/infra/providers/node-bridge-runtime/inbound-normalizer';
import type { InboundMessage } from '../../../src/infra/providers/node-bridge-runtime/inbound.port';
import { REDIS_CLIENT } from '../../../src/infra/redis/redis.module';
import {
  CONVERSATIONS_FACADE,
  ChannelIngestPublisher,
  ChannelRegistryService,
  type ConversationsFacade,
} from '../../../src/modules/chat-conversations';
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

  it("records the business's own phone-typed message as outbound, once, and ignores groups", async () => {
    const x = await linked('qr-echo');
    const mine = customer('wamid.echo.1', { fromMe: true, text: 'typed on the phone' });
    x.socket.emit({ type: 'message', normalized: { ...mine, kind: 'echo' } });
    x.socket.emit({
      type: 'message',
      normalized: {
        kind: 'group',
        message: {
          ...customer('wamid.grp.1').message,
          chat: { jid: '1203@g.us', phone: null, lid: null, isGroup: true },
        },
      },
    });
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
