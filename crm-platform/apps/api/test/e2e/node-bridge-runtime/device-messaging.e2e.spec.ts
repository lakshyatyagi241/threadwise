import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { UnsupportedSendError } from '../../../src/infra/providers/node-bridge-runtime/outbound.port';
import type { Normalized } from '../../../src/infra/providers/node-bridge-runtime/inbound-normalizer';
import { BroadcastReceiptsService } from '../../../src/modules/broadcasts';
import { OutboundRegistry, SenderResolver } from '../../../src/modules/node-bridge-runtime';
import { TwilioTransport } from '../../../src/modules/node-bridge-runtime/outbound/twilio.transport';
import type { DeviceRuntimeService } from '../../../src/modules/node-bridge-runtime/runtime/device-runtime.service';
import {
  InboundRouter,
  ReceiptRouter,
} from '../../../src/modules/node-bridge-runtime/runtime/routers';
import { ScheduledReceiptsService } from '../../../src/modules/scheduled-queue-warmer/scheduled-receipts.service';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';
import { rig, worker as buildWorker, type FakeSocket, type Rig } from './support';

/**
 * Sending, receiving and receipts through the unofficial engine and Twilio (WD-NODE-016 to 025, 027): real Postgres and Redis,
 * a fake socket for WhatsApp, a local stand-in for Twilio.
 */
let h: Harness;
let api: Api;
let r: Rig;
const runtimes: DeviceRuntimeService[] = [];
const worker = async (o: Parameters<typeof buildWorker>[2] = {}) => {
  const w = await buildWorker(h, r, o);
  runtimes.push(w.rt);
  return w;
};

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  r = rig(h);
}, 240_000);

afterEach(async () => {
  for (const rt of runtimes.splice(0)) await rt.onApplicationShutdown();
  await h.owner.query(`DELETE FROM device_auth_state`);
  const keys = await r.redis.keys('wa:*');
  if (keys.length) await r.redis.del(...keys);
});
afterAll(async () => {
  await h?.stop();
});

/** Transports read the number's row the way a job does: inside the organization's context. */
const inOrg = <T>(t: Tenant, fn: () => Promise<T>) =>
  RequestContextStore.run(
    { requestId: 't', orgId: t.orgId, actorType: 'system', actorId: null, userId: null },
    fn,
  );

let seq = 0;
const settle = () => new Promise<void>((res) => setTimeout(res, 120));
async function arrange(label: string) {
  const t = await api.signup(label);
  const phone = `97${String(2000000 + seq++).padStart(8, '0')}`;
  const dev = (
    await h.owner.query(
      `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active)
       VALUES ($1, 'Main', '+91', $2, 'disconnected', false) RETURNING id`,
      [t.orgId, phone],
    )
  ).rows[0];
  return { t, deviceId: Number(dev.id), digits: `91${phone}` };
}
/** A connected device on a worker, with the socket that carries its sends. */
async function connected(label: string, o: Parameters<typeof buildWorker>[2] = {}) {
  const x = await arrange(label);
  const w = await worker(o);
  await w.rt.adopt(x.t.orgId, x.deviceId);
  await settle();
  return { ...x, ...w, socket: w.factory.last as FakeSocket };
}

describe('sending through a connected number (WD-NODE-022 to 024)', () => {
  it('goes straight to the socket when this process owns the device', async () => {
    const d = await connected('local');
    const out = await r.control.sendMessage(
      d.t.orgId,
      d.deviceId,
      { type: 'text', to: '919800000001', body: 'Hi' },
      { clientReference: 'ref-1' },
    );
    expect(out).toEqual({ providerMessageId: 'wamid.fake.1' });
    expect(d.socket.sends[0]).toEqual({
      command: { type: 'text', to: '919800000001', body: 'Hi' },
      context: { clientReference: 'ref-1' },
    });
  });

  it('is relayed to the worker that owns the device when this one does not', async () => {
    const d = await connected('remote');
    r.control.local = null; // the HTTP process: it owns no sockets
    const out = await r.control.sendMessage(
      d.t.orgId,
      d.deviceId,
      { type: 'location', to: '919800000002', latitude: 12.9, longitude: 77.6, name: 'Office' },
      { clientReference: 'ref-2' },
    );
    expect(out.providerMessageId).toBe('wamid.fake.1');
    expect(d.socket.sends[0]!.command).toMatchObject({ type: 'location', latitude: 12.9 });
  });

  it('every kind of command reaches the socket intact', async () => {
    const d = await connected('kinds');
    const cmds = [
      { type: 'text', to: '9198', body: 'x', footer: 'F' },
      {
        type: 'media',
        to: '9198',
        mediaUrl: 'https://x.test/a.png',
        caption: 'c',
        voiceNote: false,
      },
      { type: 'contact', to: '9198', name: 'Ravi', phone: '+919000000001' },
      {
        type: 'group_text',
        groupJid: '12036300',
        body: 'hello @919800000001',
        mentions: ['919800000001'],
      },
    ] as const;
    for (const c of cmds)
      await r.control.sendMessage(d.t.orgId, d.deviceId, c, { clientReference: 'k' });
    expect(d.socket.sends.map((s) => s.command)).toEqual(cmds);
  });

  it("a number nobody owns says so at once, in WaDesk's words, without waiting", async () => {
    const x = await arrange('nobody');
    r.control.local = null;
    const t0 = Date.now();
    await expect(
      r.control.sendMessage(
        x.t.orgId,
        x.deviceId,
        { type: 'text', to: '1', body: 'x' },
        { clientReference: 'n' },
      ),
    ).rejects.toThrow('Sender device is not connected.');
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it('a socket that is not up yet makes a send wait briefly, then refuse', async () => {
    const x = await arrange('notready');
    const w = await worker();
    w.factory.script = () => undefined; // connects but never opens
    await w.rt.adopt(x.t.orgId, x.deviceId);
    (w.rt as unknown as { owned: Map<string, { session: { readyWaitMs: number } }> }).owned.get(
      `${x.t.orgId}:${x.deviceId}`,
    )!.session.readyWaitMs = 300;
    await expect(
      r.control.sendMessage(
        x.t.orgId,
        x.deviceId,
        { type: 'text', to: '1', body: 'x' },
        { clientReference: 'nr' },
      ),
    ).rejects.toThrow('Sender device is not connected.');
  });

  it('a failed send carries the reason, and an unsupported kind keeps its type through the relay', async () => {
    const d = await connected('fail');
    d.socket.onSend = (n) =>
      n === 1
        ? new Error('Number is not on WhatsApp')
        : new UnsupportedSendError('Not on this engine.');
    await expect(
      r.control.sendMessage(
        d.t.orgId,
        d.deviceId,
        { type: 'text', to: '1', body: 'x' },
        { clientReference: 'f1' },
      ),
    ).rejects.toThrow('Number is not on WhatsApp');
    r.control.local = null;
    await expect(
      r.control.sendMessage(
        d.t.orgId,
        d.deviceId,
        { type: 'text', to: '1', body: 'x' },
        { clientReference: 'f2' },
      ),
    ).rejects.toBeInstanceOf(UnsupportedSendError);
  });

  it('is registered under the engine name, so a schedule or a broadcast finds it', async () => {
    const d = await connected('registry');
    const registry = h.app.get(OutboundRegistry);
    const sender = await inOrg(d.t, () =>
      r.db.tx((tx) =>
        h.app
          .get(SenderResolver)
          .resolve(tx, d.t.orgId, { provider: 'baileys', deviceId: d.deviceId }),
      ),
    );
    expect(sender).toMatchObject({ engine: 'baileys', id: d.deviceId, phoneDigits: d.digits });
    const open = await inOrg(d.t, () => registry.get('baileys')!.open(d.t.orgId, sender!));
    expect(
      await open.send(
        { type: 'text', to: '9198', body: 'via registry' },
        { clientReference: 'reg' },
      ),
    ).toEqual({
      providerMessageId: 'wamid.fake.1',
    });
  });
});

describe('changing a message already sent (WD-NODE-025)', () => {
  it('reaction, pin, star, edit and delete reach the socket with the message id', async () => {
    const d = await connected('actions');
    const actions = [
      { type: 'react', to: '9198', messageId: 'M1', fromMe: false, emoji: '👍' },
      { type: 'pin', to: '9198', messageId: 'M2', fromMe: true, pin: true },
      { type: 'star', to: '9198', messageId: 'M3', fromMe: true, star: true },
      { type: 'edit', to: '9198', messageId: 'M4', text: 'fixed' },
      { type: 'delete', to: '9198', messageId: 'M5', fromMe: true },
    ] as const;
    for (const a of actions) await r.control.messageAction(d.t.orgId, d.deviceId, a);
    r.control.local = null;
    await r.control.messageAction(d.t.orgId, d.deviceId, actions[0]);
    expect(d.socket.actions).toEqual([...actions, actions[0]]);
  });
});

describe('groups (WD-NODE-021)', () => {
  it('management commands go to the owning socket and the answer comes back', async () => {
    const d = await connected('groups');
    d.socket.groupResult = {
      group: { jid: '1203@g.us', subject: 'Team', description: null, size: 2 },
    };
    r.control.local = null;
    const res = await r.control.groupAction(d.t.orgId, d.deviceId, {
      type: 'create',
      subject: 'Team',
      participants: ['919800000001'],
    });
    expect(res).toEqual({
      ok: true,
      status: 'group',
      result: { group: { jid: '1203@g.us', subject: 'Team', description: null, size: 2 } },
    });
    expect(d.socket.groupCalls).toEqual([
      { type: 'create', subject: 'Team', participants: ['919800000001'] },
    ]);
  });

  it('a device that is not connected refuses with the message WaDesk used', async () => {
    const x = await arrange('groupsoff');
    r.control.local = null;
    expect(await r.control.groupAction(x.t.orgId, x.deviceId, { type: 'list' })).toEqual({
      ok: false,
      status: 'not_ready',
      message: 'Sender device is not connected.',
    });
  });

  it('a change to the groups reaches every consumer', async () => {
    const inbound = new InboundRouter(r.redis);
    const seen: string[][] = [];
    inbound.register({
      message: async () => undefined,
      groups: async (_c, g) => void seen.push(g.map((x) => x.jid)),
    });
    const d = await connected('groupsync', { inbound });
    d.socket.emit({
      type: 'groups',
      groups: [{ jid: '1@g.us', subject: 'A', description: null, size: 3 }],
    });
    await settle();
    expect(seen).toEqual([['1@g.us']]);
  });
});

describe('what arrives (WD-NODE-016, 017, 018)', () => {
  const inbound = (kind: Normalized['kind'], id: string): Normalized => ({
    kind,
    message: {
      providerMessageId: id,
      chat: {
        jid: '919800000009@s.whatsapp.net',
        phone: '919800000009',
        lid: null,
        isGroup: kind === 'group',
      },
      fromMe: kind === 'echo',
      participant: null,
      pushName: 'Asha',
      timestamp: new Date(),
      text: 'Hello',
      media: null,
      location: null,
      contact: null,
      reaction: null,
      forwarded: null,
    },
  });

  it('is delivered once to every consumer, with the organization and device it belongs to', async () => {
    const router = new InboundRouter(r.redis);
    const a: Array<[number, number, string]> = [];
    const b: string[] = [];
    router.register({
      message: async (c, n) => void a.push([c.orgId, c.deviceId, n.message.providerMessageId]),
    });
    router.register({ message: async (_c, n) => void b.push(n.kind) });
    const d = await connected('arrive', { inbound: router });
    d.socket.emit({ type: 'message', normalized: inbound('inbound', 'IN1') });
    await settle();
    expect(a).toEqual([[d.t.orgId, d.deviceId, 'IN1']]);
    expect(b).toEqual(['inbound']);
  });

  it("the same message arriving again (a replay, or the phone's echo of a mirror) is dropped; a different kind with the same id is not", async () => {
    const router = new InboundRouter(r.redis);
    const seen: string[] = [];
    router.register({
      message: async (_c, n) => void seen.push(`${n.kind}:${n.message.providerMessageId}`),
    });
    const d = await connected('dedup', { inbound: router });
    for (const n of [
      inbound('inbound', 'D1'),
      inbound('inbound', 'D1'),
      inbound('echo', 'D1'),
      inbound('inbound', 'D2'),
    ]) {
      d.socket.emit({ type: 'message', normalized: n });
    }
    await settle();
    expect(seen).toEqual(['inbound:D1', 'echo:D1', 'inbound:D2']);
  });

  it('echoes and group messages are delivered as what they are', async () => {
    const router = new InboundRouter(r.redis);
    const kinds: string[] = [];
    router.register({ message: async (_c, n) => void kinds.push(n.kind) });
    const d = await connected('kindsin', { inbound: router });
    d.socket.emit({ type: 'message', normalized: inbound('echo', 'E1') });
    d.socket.emit({ type: 'message', normalized: inbound('group', 'G1') });
    await settle();
    expect(kinds).toEqual(['echo', 'group']);
  });

  it('one consumer failing does not stop the others or lose the message for them', async () => {
    const router = new InboundRouter(r.redis);
    const seen: string[] = [];
    router.register({
      message: async () => {
        throw new Error('inbox down');
      },
    });
    router.register({ message: async (_c, n) => void seen.push(n.message.providerMessageId) });
    const d = await connected('failing', { inbound: router });
    d.socket.emit({ type: 'message', normalized: inbound('inbound', 'F1') });
    await settle();
    expect(seen).toEqual(['F1']);
  });

  it('with no consumer registered the message is reported as unclaimed instead of silently vanishing', async () => {
    const router = new InboundRouter(r.redis);
    expect(router.hasSinks).toBe(false);
    expect(await router.message(1, 1, inbound('inbound', 'U1'))).toBe('no_consumer');
    expect(await router.message(1, 1, inbound('inbound', 'U1'))).toBe('duplicate');
  });

  it("a tenant's tenants are kept apart: the same message id on two devices is two messages", async () => {
    const router = new InboundRouter(r.redis);
    const seen: number[] = [];
    router.register({ message: async (c) => void seen.push(c.deviceId) });
    await router.message(1, 10, inbound('inbound', 'S1'));
    await router.message(1, 11, inbound('inbound', 'S1'));
    expect(seen).toEqual([10, 11]);
  });
});

describe('delivery receipts (WD-NODE-020)', () => {
  async function scheduledRecipient(t: Tenant, waId: string, status: string) {
    const sm = (
      await h.owner.query(
        `INSERT INTO scheduled_messages (org_id, schedule_name, template_type, schedule_type, send_date, send_time, scheduled_time, timezone, recipient_type, status)
         VALUES ($1, 'R', 'text', 'once', '2026-10-05', '09:00', now(), 'UTC', 'numbers', 'completed') RETURNING id`,
        [t.orgId],
      )
    ).rows[0].id;
    const c = (
      await h.owner.query(
        `INSERT INTO scheduled_message_contacts (org_id, scheduled_message_id, phone, status, wa_message_id) VALUES ($1, $2, '919800000001', $3, $4) RETURNING id`,
        [t.orgId, sm, status, waId],
      )
    ).rows[0].id;
    return { sm: Number(sm), c: Number(c) };
  }
  const state = async (c: number, sm: number) => ({
    contact: (
      await h.owner.query(
        `SELECT status, delivered_at, read_at FROM scheduled_message_contacts WHERE id = $1`,
        [c],
      )
    ).rows[0],
    delivered: (
      await h.owner.query(`SELECT total_delivered FROM scheduled_messages WHERE id = $1`, [sm])
    ).rows[0].total_delivered,
  });
  const wire = (router: ReceiptRouter) => {
    const bc = h.app.get(BroadcastReceiptsService, { strict: false });
    const sc = new ScheduledReceiptsService(r.db);
    router.register((x) => bc.handle(x));
    router.register((x) => sc.handle(x));
  };
  const ack = (socket: FakeSocket, id: string, level: number) =>
    socket.emit({
      type: 'receipt',
      receipt: { providerMessageId: id, chatJid: '919800000001@s.whatsapp.net', ack: level },
    });

  it('delivered then read move a scheduled recipient up, once each, and the count of delivered moves once', async () => {
    const receipts = new ReceiptRouter();
    wire(receipts);
    const d = await connected('rcpt', { receipts });
    const { sm, c } = await scheduledRecipient(d.t, 'wamid.R1', 'sent');
    ack(d.socket, 'wamid.R1', 3);
    await settle();
    expect(await state(c, sm)).toMatchObject({ contact: { status: 'delivered' }, delivered: 1 });
    expect((await state(c, sm)).contact.delivered_at).not.toBeNull();
    ack(d.socket, 'wamid.R1', 4);
    await settle();
    const after = await state(c, sm);
    expect(after.contact.status).toBe('read');
    expect(after.contact.read_at).not.toBeNull();
    expect(after.delivered).toBe(1); // not counted again
  });

  it('a late delivered after read, a repeat, a pending ack and played all behave', async () => {
    const receipts = new ReceiptRouter();
    wire(receipts);
    const d = await connected('rcpt2', { receipts });
    const { sm, c } = await scheduledRecipient(d.t, 'wamid.R2', 'sent');
    ack(d.socket, 'wamid.R2', 1);
    ack(d.socket, 'wamid.R2', 2);
    await settle();
    expect((await state(c, sm)).contact.status).toBe('sent'); // pending and server acks say nothing new
    ack(d.socket, 'wamid.R2', 5); // played counts as read
    await settle();
    expect((await state(c, sm)).contact.status).toBe('read');
    ack(d.socket, 'wamid.R2', 3);
    ack(d.socket, 'wamid.R2', 4);
    await settle();
    expect(await state(c, sm)).toMatchObject({ contact: { status: 'read' }, delivered: 1 });
  });

  it('a report for a message nobody owns is claimed by nobody, and a failed recipient is not resurrected', async () => {
    const receipts = new ReceiptRouter();
    wire(receipts);
    const sc = new ScheduledReceiptsService(r.db);
    expect(
      await sc.handle({
        providerMessageId: 'wamid.UNKNOWN',
        status: 'delivered',
        occurredAt: new Date(),
      }),
    ).toBe(false);
    expect(
      await receipts.route(
        { orgId: 1, deviceId: 1 },
        { providerMessageId: 'wamid.UNKNOWN', chatJid: 'x', ack: 3 },
      ),
    ).toBe(false);
    expect(
      await receipts.route(
        { orgId: 1, deviceId: 1 },
        { providerMessageId: 'wamid.UNKNOWN', chatJid: 'x', ack: 1 },
      ),
    ).toBe(false);
  });
});

describe('Twilio (WD-NODE-027)', () => {
  let stub: Server;
  let base = '';
  const seen: Array<{ url: string; auth: string | undefined; form: URLSearchParams }> = [];
  let reply: { status: number; body: unknown } = { status: 201, body: { sid: 'SM123' } };

  beforeAll(async () => {
    stub = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({
          url: req.url!,
          auth: req.headers.authorization,
          form: new URLSearchParams(body),
        });
        res
          .writeHead(reply.status, { 'content-type': 'application/json' })
          .end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((res) => stub.listen(0, '127.0.0.1', res));
    base = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  });
  afterAll(() => stub.close());

  async function twilioSender(label: string, creds: Record<string, string>) {
    const t = await api.signup(label);
    const crypto = h.app.get(CryptoService, { strict: false });
    const row = (
      await h.owner.query(
        `INSERT INTO wa_provider_configs (org_id, provider, phone_number, status, is_primary, credentials_json)
         VALUES ($1, 'twilio', '+14155238886', 'connected', true, $2) RETURNING id`,
        [t.orgId, crypto.encrypt(JSON.stringify(creds))],
      )
    ).rows[0];
    const transport = h.app.get(TwilioTransport);
    transport.baseUrl = base;
    const sender = { engine: 'twilio', id: Number(row.id), phoneDigits: '14155238886', label: 'T' };
    return { t, transport, sender };
  }
  const good = { account_sid: 'ACtest', auth_token: 'tok', from_number: 'whatsapp:+14155238886' };

  it("sends text, media with a caption and a location pin as Twilio expects, with the number's own credentials", async () => {
    const { t, transport, sender } = await twilioSender('tw1', good);
    seen.length = 0;
    const open = await inOrg(t, () => transport.open(t.orgId, sender));
    expect(
      await open.send(
        { type: 'text', to: '+91 98000 00001', body: 'Hi', footer: 'Bye' },
        { clientReference: 'x' },
      ),
    ).toEqual({ providerMessageId: 'SM123' });
    await open.send(
      { type: 'media', to: '919800000001', mediaUrl: 'https://x.test/a.png', caption: 'Look' },
      { clientReference: 'x' },
    );
    await open.send(
      { type: 'location', to: '919800000001', latitude: 12.9, longitude: 77.6 },
      { clientReference: 'x' },
    );
    expect(seen.every((s) => s.url === '/2010-04-01/Accounts/ACtest/Messages.json')).toBe(true);
    expect(seen[0]!.auth).toBe(`Basic ${Buffer.from('ACtest:tok').toString('base64')}`);
    expect(Object.fromEntries(seen[0]!.form)).toEqual({
      From: 'whatsapp:+14155238886',
      To: 'whatsapp:+919800000001',
      Body: 'Hi\n\nBye',
    });
    expect(Object.fromEntries(seen[1]!.form)).toMatchObject({
      MediaUrl: 'https://x.test/a.png',
      Body: 'Look',
    });
    expect(Object.fromEntries(seen[2]!.form)).toMatchObject({
      PersistentAction: 'geo:12.9,77.6',
      Body: 'Location',
    });
  });

  it("reports Twilio's own refusal, and says what cannot be sent through it", async () => {
    const { t, transport, sender } = await twilioSender('tw2', good);
    const open = await inOrg(t, () => transport.open(t.orgId, sender));
    reply = { status: 400, body: { code: 63016, message: 'Outside the 24 hour window' } };
    await expect(
      open.send({ type: 'text', to: '919800000001', body: 'x' }, { clientReference: 'x' }),
    ).rejects.toThrow('Twilio refused the message (63016): Outside the 24 hour window');
    reply = { status: 201, body: { sid: 'SM123' } };
    await expect(
      open.send({ type: 'contact', to: '1', name: 'R', phone: '2' }, { clientReference: 'x' }),
    ).rejects.toBeInstanceOf(UnsupportedSendError);
    await expect(
      open.send({ type: 'group_text', groupJid: '1', body: 'x' }, { clientReference: 'x' }),
    ).rejects.toBeInstanceOf(UnsupportedSendError);
  });

  it('refuses to open a number with incomplete or unreadable credentials', async () => {
    const a = await twilioSender('tw3', { account_sid: 'ACtest', auth_token: '', from_number: '' });
    await expect(inOrg(a.t, () => a.transport.open(a.t.orgId, a.sender))).rejects.toThrow(
      'no account SID, auth token or from-number',
    );
    const b = await twilioSender('tw4', good);
    await h.owner.query(
      `UPDATE wa_provider_configs SET credentials_json = 'garbage' WHERE id = $1`,
      [b.sender.id],
    );
    await expect(inOrg(b.t, () => b.transport.open(b.t.orgId, b.sender))).rejects.toThrow(
      'cannot be read',
    );
  });

  it('is registered as the twilio engine', () => {
    expect(h.app.get(OutboundRegistry).get('twilio')).toBe(h.app.get(TwilioTransport));
  });
});
