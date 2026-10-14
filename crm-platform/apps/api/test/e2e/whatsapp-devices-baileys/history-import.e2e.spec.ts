import type { Redis } from 'ioredis';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PERSONAL_WA_NOTICE_VERSION, REALTIME_EVENT } from '@crm/contracts';
import { DatabaseService } from '../../../src/infra/db/database.service';
import type { Normalized } from '../../../src/infra/providers/node-bridge-runtime/inbound-normalizer';
import type { HistoryBatch } from '../../../src/infra/providers/node-bridge-runtime/history.port';
import type { InboundMessage } from '../../../src/infra/providers/node-bridge-runtime/inbound.port';
import { REDIS_CLIENT } from '../../../src/infra/redis/redis.module';
import { UNOFFICIAL_WHATSAPP_GATE } from '../../../src/modules/auth/unofficial-whatsapp.port';
import {
  ChannelRegistryService,
  InboundIngestService,
  InboundMessageHooks,
  type InboundMessageListener,
} from '../../../src/modules/chat-conversations';
import { DeviceRuntimeService } from '../../../src/modules/node-bridge-runtime/runtime/device-runtime.service';
import { HistoryImportRepository } from '../../../src/modules/whatsapp-devices-baileys/history-import.repository';
import { HistoryImportService } from '../../../src/modules/whatsapp-devices-baileys/history-import.service';
import { HistoryImportSink } from '../../../src/modules/whatsapp-devices-baileys/history-import.sink';
import { HistoryImportSweepService } from '../../../src/modules/whatsapp-devices-baileys/history-import-sweep.service';
import { OutboxSubscriberRegistry } from '../../../src/kernel/outbox/outbox-subscribers';
import { MemberDirectory, RealtimeEmitter } from '../../../src/realtime';
import { OutboxDrainService } from '../../../src/workers/outbox-drain.service';
import { HistoryImportRealtimeConsumer } from '../../../src/modules/whatsapp-devices-baileys/history-import-realtime.consumer';
import { bearer, type Tenant } from '../contacts-attributes-tags/support';
import {
  eventsOf,
  listen,
  startPipeline,
  until,
  type Pipeline,
} from '../chat-conversations/pipeline-support';
import {
  rig,
  worker as buildWorker,
  type FakeSocket,
  type Rig,
} from '../node-bridge-runtime/support';

/**
 * The opt-in import of a personal number's chats (TW-WAHIST): the real app, Postgres, Redis and the inbox pipeline, with a FAKE socket
 * standing in for WhatsApp. NOT verified against a live WhatsApp account: the `messaging-history.set` event is simulated by handing the
 * importer the batches the socket adapter would produce (the adapter's own reading of the event is covered by unit tests with a mocked
 * library).
 */
let p: Pipeline;
let r: Rig;
let sink: HistoryImportSink;
let sweep: HistoryImportSweepService;
let drainer: OutboxDrainService;
const runtimes: DeviceRuntimeService[] = [];
const ACK = { version: PERSONAL_WA_NOTICE_VERSION, items: [true, true, true], locale: 'en' };

beforeAll(async () => {
  p = await startPipeline();
  r = rig(p.h);
  const app = p.h.app;
  const repo = app.get(HistoryImportRepository);
  const service = app.get(HistoryImportService);
  sink = new HistoryImportSink(
    r.inbound,
    app.get(DatabaseService),
    repo,
    service,
    app.get(InboundIngestService),
    app.get(ChannelRegistryService),
    app.get<Redis>(REDIS_CLIENT),
    app.get(UNOFFICIAL_WHATSAPP_GATE),
  );
  sink.onModuleInit();
  sweep = new HistoryImportSweepService(app.get(DatabaseService), repo, service);
  // The worker's drain loop with the realtime hint of a finished import on it, as the worker module wires it.
  const registry = app.get(OutboxSubscriberRegistry);
  new HistoryImportRealtimeConsumer(
    registry,
    app.get(MemberDirectory),
    app.get(RealtimeEmitter),
    app.get(UNOFFICIAL_WHATSAPP_GATE),
  ).onModuleInit();
  drainer = new OutboxDrainService(app.get(DatabaseService), registry);
}, 300_000);

afterEach(async () => {
  for (const rt of runtimes.splice(0)) await rt.onApplicationShutdown();
  await p.h.owner.query(`DELETE FROM device_auth_state`);
  delete process.env.WA_HISTORY_IMPORT_MAX_MESSAGES_PER_CHAT;
  delete process.env.WA_HISTORY_IMPORT_MAX_CHATS;
});
afterAll(async () => {
  await p?.stop();
});

const get = (t: string, path: string) => p.api.http().get(path).set(bearer(t));
const post = (t: string, path: string, body: object = {}, key?: string) => {
  const req = p.api.http().post(path).set(bearer(t));
  if (key) req.set('idempotency-key', key);
  return req.send(body);
};

let seq = 0;
const phoneOf = () => `97${String(1000000 + seq++).padStart(8, '0')}`;
const DAY = 86_400_000;
const ago = (days: number) => Date.now() - days * DAY;

async function tenant(
  label: string,
  limits: Record<string, number> = {},
  features: Record<string, boolean> = { personal_history_full: true },
): Promise<Tenant> {
  const t = await p.api.signup(label);
  await p.h.owner.query(
    `UPDATE org_plan_state SET overrides = jsonb_build_object('limits', $2::jsonb, 'features', $3::jsonb) WHERE org_id = $1`,
    [t.orgId, JSON.stringify({ devices: -1, ...limits }), JSON.stringify(features)],
  );
  return t;
}

/** A created device, a worker holding its (fake) socket, and the QR attempt started with the given choice. */
async function pairing(
  t: Tenant,
  importHistory?: 'none' | 'recent' | 'full',
  /** A second number of the same workspace is owned by the same worker. */
  reuse?: Awaited<ReturnType<typeof buildWorker>>,
) {
  const phone = phoneOf();
  const created = await post(t.admin, '/v2/devices', {
    name: 'Shop line',
    countryCode: '+91',
    phone,
    acknowledgement: ACK,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const w = reuse ?? (await buildWorker(p.h, r));
  if (!reuse) runtimes.push(w.rt);
  w.factory.script = (s) =>
    setImmediate(() => {
      s.emit({ type: 'connecting' });
      s.emit({ type: 'qr', qr: 'QR-FAKE' });
    });
  const id = created.body.id as string;
  const start = await post(
    t.admin,
    `/v2/devices/${id}/pairing/qr`,
    importHistory ? { importHistory } : {},
  );
  expect(start.status, JSON.stringify(start.body)).toBe(200);
  const digits = `91${phone}`;
  const dev = (await p.h.owner.query(`SELECT id FROM devices WHERE uuid = $1`, [id])).rows[0];
  return { id, w, digits, deviceId: Number(dev.id) };
}

/** The phone scans: the socket restarts and opens as the right number. Returns the socket history will arrive on. */
async function link(x: Awaited<ReturnType<typeof pairing>>): Promise<FakeSocket> {
  const s = x.w.factory.last;
  s.emit({ type: 'creds' });
  s.emit({ type: 'connecting' });
  s.emit({ type: 'open', linkedId: `${x.digits}:1@s.whatsapp.net` });
  await new Promise((res) => setTimeout(res, 150));
  return s;
}

const personMsg = (
  phone: string,
  id: string,
  at: number,
  over: Partial<InboundMessage> = {},
): Normalized => ({
  kind: over.fromMe ? 'echo' : 'inbound',
  message: {
    providerMessageId: id,
    chat: { jid: `${phone}@s.whatsapp.net`, phone, lid: null, isGroup: false },
    fromMe: false,
    participant: null,
    pushName: 'Push Name',
    timestamp: new Date(at),
    text: `hello ${id}`,
    media: null,
    location: null,
    contact: null,
    reaction: null,
    forwarded: null,
    ...over,
  },
});
const groupMsg = (gid: string, id: string, at: number): Normalized => ({
  kind: 'group',
  message: {
    providerMessageId: id,
    chat: { jid: `${gid}@g.us`, phone: null, lid: null, isGroup: true },
    fromMe: false,
    participant: { phone: '919800000077', lid: null, name: 'Member' },
    pushName: 'Member',
    timestamp: new Date(at),
    text: `group ${id}`,
    media: null,
    location: null,
    contact: null,
    reaction: null,
    forwarded: null,
  },
});
const batch = (messages: Normalized[], over: Partial<HistoryBatch> = {}): HistoryBatch => ({
  syncType: 'recent',
  progress: 50,
  chats: [],
  contacts: [],
  messages,
  skipped: 0,
  last: true,
  ...over,
});

const one = async (sql: string, params: unknown[] = []) =>
  (await p.h.owner.query(sql, params)).rows[0] as Record<string, unknown> | undefined;
const count = async (sql: string, params: unknown[] = []) =>
  Number((await one(sql, params))?.n ?? 0);
const status = async (t: Tenant, id: string) =>
  (await get(t.admin, `/v2/devices/${id}/history-import`)).body.status as Record<string, unknown>;

describe('choosing before the scan', () => {
  it('records the choice on the device before the worker is asked for a QR, and the socket is built with it', async () => {
    const t = await tenant('hist-choice');
    const x = await pairing(t, 'recent');
    expect(x.w.factory.targets.at(-1)?.historyImport).toBe('recent');
    const dev = await one(`SELECT history_import_mode FROM devices WHERE uuid = $1`, [x.id]);
    expect(dev!.history_import_mode).toBe('recent');
    const detail = (await get(t.admin, `/v2/devices/${x.id}`)).body;
    expect(detail.historyImport).toMatchObject({
      state: 'idle',
      mode: 'recent',
      messages: 0,
      chats: 0,
      contacts: 0,
    });
    expect(detail.historyImport.windowDays).toBe(90);
    // audited, with an event that carries counts only
    expect(
      await count(
        `SELECT count(*)::int AS n FROM event_outbox WHERE org_id = $1 AND event_type = 'device.history_import_requested'`,
        [t.orgId],
      ),
    ).toBe(1);
  });

  it('a pairing that does not choose imports nothing and the socket is built as before', async () => {
    const t = await tenant('hist-default');
    const x = await pairing(t);
    expect(x.w.factory.targets.at(-1)?.historyImport).toBe('none');
    expect((await status(t, x.id)).state).toBe('not_requested');
    expect(
      await count(`SELECT count(*)::int AS n FROM wa_device_history_imports WHERE org_id = $1`, [
        t.orgId,
      ]),
    ).toBe(0);
    // history that arrives anyway is dropped, not stored
    const s = await link(x);
    await s.emitHistory(batch([personMsg('919800000001', 'X1', ago(3))]));
    expect(
      await count(`SELECT count(*)::int AS n FROM conversations WHERE org_id = $1`, [t.orgId]),
    ).toBe(0);
  });

  it('a second attempt that does not choose again supersedes the first: a re-link imports only if chosen again', async () => {
    const t = await tenant('hist-relink');
    const x = await pairing(t, 'recent');
    await post(t.admin, `/v2/devices/${x.id}/pairing/qr`, { relink: true });
    const rows = (
      await p.h.owner.query(`SELECT state FROM wa_device_history_imports WHERE org_id = $1`, [
        t.orgId,
      ])
    ).rows;
    expect(rows.map((r) => r.state)).toEqual(['cancelled']);
    expect(
      (await one(`SELECT history_import_mode AS m FROM devices WHERE uuid = $1`, [x.id]))!.m,
    ).toBe('none');
  });
});

describe('what the import stores', () => {
  it('stores chats quietly: read, dated as sent, with a contact for a person and none for a group, and never any consent', async () => {
    const t = await tenant('hist-store');
    const x = await pairing(t, 'recent');
    const s = await link(x);
    const hooks = p.h.app.get(InboundMessageHooks);
    const seen: string[] = [];
    const spy: InboundMessageListener = {
      name: `spy-${t.orgId}`,
      onStored: async (e) => void seen.push(e.peerKey),
    };
    hooks.register(spy);

    const at = ago(10);
    await s.emitHistory(
      batch(
        [
          personMsg('919800000001', 'P1', at),
          personMsg('919800000001', 'P2', at + 60_000, { fromMe: true, text: 'we replied' }),
          personMsg('919800000001', 'P3', at + 120_000, {
            text: 'a photo',
            media: { kind: 'image', mimeType: 'image/jpeg', fileName: null, sizeBytes: 5 },
          }),
          groupMsg('120363000000000001', 'G1', at + 5_000),
        ],
        {
          chats: [
            { jid: '919800000001@s.whatsapp.net', name: null },
            { jid: '120363000000000001@g.us', name: 'Team chat' },
          ],
          contacts: [
            {
              jid: '919800000001@s.whatsapp.net',
              phoneJid: null,
              name: 'Asha (saved)',
              notify: 'Asha N',
            },
          ],
        },
      ),
    );

    const conv = await one(
      `SELECT c.* FROM conversations c WHERE c.org_id = $1 AND c.peer_key = '919800000001'`,
      [t.orgId],
    );
    expect(conv).toBeDefined();
    expect(Number(conv!.unread_count ?? 0)).toBe(0);
    expect(conv!.waiting_since ?? null).toBeNull();
    expect(new Date(conv!.last_message_at as string).getTime()).toBe(at + 120_000);
    const msgs = (
      await p.h.owner.query(`SELECT * FROM messages WHERE conversation_id = $1 ORDER BY seq`, [
        conv!.id,
      ])
    ).rows;
    expect(msgs.map((m) => [m.direction, m.body])).toEqual([
      ['in', 'hello P1'],
      ['out', 'we replied'],
      ['in', '[Photo] a photo'],
    ]);
    expect(msgs.every((m) => m.meta.historySync === true)).toBe(true);
    expect(msgs[2].meta.mediaOmitted).toBe('image');
    expect(msgs[2].media_key ?? null).toBeNull();
    expect(new Date(msgs[0].created_at).getTime()).toBe(at);

    // the contact: named from the phone book, quiet, no consent, counted
    const contact = await one(`SELECT * FROM contacts WHERE org_id = $1`, [t.orgId]);
    expect(contact).toMatchObject({ name: 'Asha (saved)', source: 'whatsapp_personal_import' });
    expect(
      await count(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [t.orgId]),
    ).toBe(1);
    expect(
      await count(`SELECT count(*)::int AS n FROM contact_consent_events WHERE org_id = $1`, [
        t.orgId,
      ]),
    ).toBe(0);
    expect(
      await count(`SELECT count(*)::int AS n FROM contact_consent_state WHERE org_id = $1`, [
        t.orgId,
      ]),
    ).toBe(0);
    expect(conv!.contact_id).toBe(contact!.id);

    // the group: its own thread, a title, no contact
    const grp = await one(
      `SELECT * FROM conversations WHERE org_id = $1 AND peer_key = 'g:120363000000000001'`,
      [t.orgId],
    );
    expect(grp).toBeDefined();
    expect(grp!.contact_id ?? null).toBeNull();
    expect(grp!.title).toBe('Team chat');

    // nothing was announced: no alert event, no new-contact or new-conversation event, no listener
    for (const ev of ['message.received', 'contact.created', 'conversation.created']) {
      expect(
        await count(
          `SELECT count(*)::int AS n FROM event_outbox WHERE org_id = $1 AND event_type = $2`,
          [t.orgId, ev],
        ),
      ).toBe(0);
    }
    await new Promise((res) => setTimeout(res, 300));
    expect(seen).toEqual([]);

    // the counters
    expect(await status(t, x.id)).toMatchObject({
      state: 'running',
      chats: 2,
      contacts: 1,
      messages: 4,
      progress: 50,
    });
  });

  it('is idempotent: the same batch delivered again adds no message, thread or contact and no count', async () => {
    const t = await tenant('hist-idem');
    const x = await pairing(t, 'recent');
    const s = await link(x);
    const b = batch([
      personMsg('919800000001', 'D1', ago(5)),
      personMsg('919800000001', 'D2', ago(5) + 1000),
      groupMsg('120363000000000002', 'D3', ago(5)),
    ]);
    await s.emitHistory(b);
    const before = await status(t, x.id);
    await s.emitHistory(b);
    await s.emitHistory(b);
    expect(
      await count(`SELECT count(*)::int AS n FROM messages WHERE org_id = $1`, [t.orgId]),
    ).toBe(3);
    expect(
      await count(`SELECT count(*)::int AS n FROM conversations WHERE org_id = $1`, [t.orgId]),
    ).toBe(2);
    expect(
      await count(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [t.orgId]),
    ).toBe(1);
    expect(await status(t, x.id)).toMatchObject({
      chats: before.chats,
      contacts: before.contacts,
      messages: before.messages,
    });
  });

  it('an older message arriving later never moves the last message of a thread back, and an imported thread has no unread', async () => {
    const t = await tenant('hist-live');
    const x = await pairing(t, 'recent');
    const s = await link(x);
    await s.emitHistory(batch([personMsg('919800000001', 'H1', ago(20))]));
    const conv = await one(
      `SELECT * FROM conversations WHERE org_id = $1 AND peer_key = '919800000001'`,
      [t.orgId],
    );
    expect(Number(conv!.unread_count ?? 0)).toBe(0);
    // an older message arriving later never moves the preview back
    await s.emitHistory(batch([personMsg('919800000001', 'H0', ago(40))]));
    const after = await one(`SELECT last_message_at FROM conversations WHERE id = $1`, [conv!.id]);
    expect(new Date(after!.last_message_at as string).getTime()).toBe(
      new Date(conv!.last_message_at as string).getTime(),
    );
  });
});

describe('the limits', () => {
  it('per-chat and per-number caps are applied from the run, newest kept, and the run says it stopped at the cap', async () => {
    process.env.WA_HISTORY_IMPORT_MAX_MESSAGES_PER_CHAT = '2';
    const t = await tenant('hist-cap');
    const x = await pairing(t, 'recent');
    const s = await link(x);
    await s.emitHistory(
      batch([1, 2, 3, 4].map((i) => personMsg('919800000001', `C${i}`, ago(30) + i * 1000))),
    );
    const bodies = (
      await p.h.owner.query(`SELECT body FROM messages WHERE org_id = $1 ORDER BY seq`, [t.orgId])
    ).rows.map((m) => m.body);
    expect(bodies).toEqual(['hello C3', 'hello C4']);
  });

  it('a chat over the chat cap ends the run as done with a visible reason', async () => {
    process.env.WA_HISTORY_IMPORT_MAX_CHATS = '1';
    const t = await tenant('hist-chatcap');
    const x = await pairing(t, 'recent');
    const s = await link(x);
    await s.emitHistory(
      batch([personMsg('919800000001', 'K1', ago(2)), personMsg('919800000002', 'K2', ago(2))]),
    );
    expect(
      await count(`SELECT count(*)::int AS n FROM conversations WHERE org_id = $1`, [t.orgId]),
    ).toBe(1);
    expect(await status(t, x.id)).toMatchObject({
      state: 'done',
      lastError: { code: 'chat_cap_reached' },
    });
    expect(
      (await one(`SELECT history_import_mode AS m FROM devices WHERE uuid = $1`, [x.id]))!.m,
    ).toBe('none');
  });

  it("the plan's contact limit stops the import cleanly: limit_reached, what was stored stays, nothing more is taken", async () => {
    const t = await tenant('hist-limit', { contacts: 1 });
    const x = await pairing(t, 'recent');
    const s = await link(x);
    await s.emitHistory(
      batch([
        personMsg('919800000001', 'L1', ago(3)),
        personMsg('919800000002', 'L2', ago(3)),
        personMsg('919800000003', 'L3', ago(3)),
      ]),
    );
    const st = await status(t, x.id);
    expect(st).toMatchObject({
      state: 'limit_reached',
      contacts: 1,
      lastError: { code: 'contact_limit_reached' },
    });
    expect(
      await count(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [t.orgId]),
    ).toBe(1);
    // the third chat was never taken
    expect(
      await count(
        `SELECT count(*)::int AS n FROM conversations WHERE org_id = $1 AND peer_key = '919800000003'`,
        [t.orgId],
      ),
    ).toBe(0);
    // later batches are refused: the run is over
    await s.emitHistory(batch([personMsg('919800000004', 'L4', ago(3))]));
    expect(
      await count(
        `SELECT count(*)::int AS n FROM conversations WHERE org_id = $1 AND peer_key = '919800000004'`,
        [t.orgId],
      ),
    ).toBe(0);
    expect(
      (await one(`SELECT history_import_mode AS m FROM devices WHERE uuid = $1`, [x.id]))!.m,
    ).toBe('none');
  });
});

describe('ending a run', () => {
  it('the final slice of the last sync type finishes it, and a reconnect then asks WhatsApp for nothing', async () => {
    const t = await tenant('hist-final');
    const x = await pairing(t, 'recent');
    const s = await link(x);
    await s.emitHistory(batch([personMsg('919800000001', 'F1', ago(1))], { progress: 100 }));
    expect(await status(t, x.id)).toMatchObject({
      state: 'done',
      progress: 100,
      lastError: null,
      messages: 1,
    });
    expect((await status(t, x.id)).finishedAt).not.toBeNull();
    // the choice is spent: the next socket for this number is built without history
    expect(
      (await one(`SELECT history_import_mode AS m FROM devices WHERE uuid = $1`, [x.id]))!.m,
    ).toBe('none');
    // a later batch is dropped
    await s.emitHistory(batch([personMsg('919800000001', 'F2', ago(1))]));
    expect(
      await count(`SELECT count(*)::int AS n FROM messages WHERE org_id = $1`, [t.orgId]),
    ).toBe(1);
  });

  it('cancel stops further batches, keeps what was stored, resets the choice and is audited; a second cancel is a 409', async () => {
    const t = await tenant('hist-cancel');
    const x = await pairing(t, 'recent');
    const s = await link(x);
    await s.emitHistory(batch([personMsg('919800000001', 'X1', ago(4))]));
    const res = await post(t.admin, `/v2/devices/${x.id}/history-import/cancel`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      cancelled: true,
      status: { state: 'cancelled', messages: 1 },
    });
    await s.emitHistory(batch([personMsg('919800000001', 'X2', ago(4))]));
    expect(
      await count(`SELECT count(*)::int AS n FROM messages WHERE org_id = $1`, [t.orgId]),
    ).toBe(1);
    expect(
      (await one(`SELECT history_import_mode AS m FROM devices WHERE uuid = $1`, [x.id]))!.m,
    ).toBe('none');
    const again = await post(t.admin, `/v2/devices/${x.id}/history-import/cancel`);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('HISTORY_IMPORT_NOT_ACTIVE');
    expect(
      await count(
        `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'devices' AND delta ? 'history_import'`,
        [t.orgId],
      ),
    ).toBeGreaterThanOrEqual(2);
  });

  it('the sweep finishes a run that went quiet and gives up on one whose history never came', async () => {
    const t = await tenant('hist-sweep');
    const a = await pairing(t, 'recent');
    const s = await link(a);
    await s.emitHistory(batch([personMsg('919800000001', 'W1', ago(1))], { progress: 60 }));
    await p.h.owner.query(
      `UPDATE wa_device_history_imports SET last_batch_at = now() - interval '10 minutes' WHERE org_id = $1`,
      [t.orgId],
    );
    const t2 = await tenant('hist-sweep2');
    const b = await pairing(t2, 'full');
    await p.h.owner.query(
      `UPDATE wa_device_history_imports SET created_at = now() - interval '2 hours' WHERE org_id = $1`,
      [t2.orgId],
    );
    expect(await sweep.run()).toBeGreaterThanOrEqual(2);
    expect(await status(t, a.id)).toMatchObject({ state: 'done' });
    expect(await status(t2, b.id)).toMatchObject({
      state: 'failed',
      lastError: { code: 'history_not_received' },
    });
    expect(await sweep.run()).toBe(0);
  });

  it('a disconnect ends a waiting import', async () => {
    const t = await tenant('hist-disc');
    const x = await pairing(t, 'recent');
    await post(t.admin, `/v2/devices/${x.id}/disconnect`);
    expect((await status(t, x.id)).state).toBe('cancelled');
  });
});

describe('the full history is a plan feature', () => {
  it('a workspace without the feature gets 422 PLAN_FEATURE_LOCKED for full, nothing is recorded, and recent still works', async () => {
    const t = await tenant('hist-nofull', {}, { personal_history_full: false });
    const phone = phoneOf();
    const created = await post(t.admin, '/v2/devices', {
      name: 'Shop line',
      countryCode: '+91',
      phone,
      acknowledgement: ACK,
    });
    const id = created.body.id as string;
    const w = await buildWorker(p.h, r);
    runtimes.push(w.rt);
    w.factory.script = (s) =>
      setImmediate(() => {
        s.emit({ type: 'connecting' });
        s.emit({ type: 'qr', qr: 'QR-FAKE' });
      });
    const list = await get(t.admin, '/v2/devices');
    expect(list.body.meta.historyFullAllowed).toBe(false);
    const refused = await post(t.admin, `/v2/devices/${id}/pairing/qr`, { importHistory: 'full' });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('PLAN_FEATURE_LOCKED');
    expect(refused.body.errors).toEqual(
      expect.arrayContaining([{ path: 'feature', message: 'personal_history_full' }]),
    );
    expect(
      await count(`SELECT count(*)::int AS n FROM wa_device_history_imports WHERE org_id = $1`, [
        t.orgId,
      ]),
    ).toBe(0);
    expect(
      (await one(`SELECT history_import_mode AS m FROM devices WHERE uuid = $1`, [id]))!.m,
    ).toBe('none');
    expect(w.factory.targets).toHaveLength(0); // the worker was never asked for a QR
    const ok = await post(t.admin, `/v2/devices/${id}/pairing/qr`, { importHistory: 'recent' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await status(t, id)).state).toBe('idle');
  });

  it('a workspace with the feature may choose full, and the list says so', async () => {
    const t = await tenant('hist-full');
    const x = await pairing(t, 'full');
    expect((await status(t, x.id)).mode).toBe('full');
    expect(x.w.factory.targets.at(-1)?.historyImport).toBe('full');
    expect((await get(t.admin, '/v2/devices')).body.meta.historyFullAllowed).toBe(true);
  });
});

describe('the imported marker and the one realtime hint', () => {
  /** What the worker's drain loop does: hand every pending outbox row to the subscribers. */
  async function deliver(): Promise<void> {
    for (let i = 0; i < 40; i += 1) {
      await drainer.drain();
      const left = await p.h.owner.query(
        `SELECT count(*)::int AS n FROM event_outbox WHERE status IN ('pending','processing')`,
      );
      if (left.rows[0].n === 0) return;
      await new Promise((res) => setTimeout(res, 50));
    }
    throw new Error('the outbox did not drain');
  }

  it('threads and messages carry the flag the inbox marks, and a thread that existed before is not marked', async () => {
    const t = await tenant('hist-marker');
    const x = await pairing(t, 'recent');
    const s = await link(x);
    await s.emitHistory(
      batch([
        personMsg('919800000001', 'M1', ago(6)),
        personMsg('919800000001', 'M2', ago(6) + 1000),
      ]),
    );
    const list = await get(t.admin, '/v2/inbox/conversations');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const row = (list.body.data as Array<Record<string, unknown>>).find(
      (c) => c.title !== undefined,
    )!;
    expect(row.imported).toBe(true);
    const msgs = await get(t.admin, `/v2/inbox/conversations/${row.id}/messages`);
    const bodies = msgs.body.data as Array<Record<string, unknown>>;
    expect(bodies).toHaveLength(2);
    expect(bodies.every((m) => m.imported === true)).toBe(true);
    // a thread that already existed (a live message first) is never marked by a later import
    const channel = (await one(
      `SELECT uuid FROM channels WHERE org_id = $1 AND kind = 'whatsapp_qr'`,
      [t.orgId],
    ))!.uuid as string;
    await RequestContextStore.run(
      { requestId: 'live-1', orgId: t.orgId, actorType: 'system', actorId: null, userId: null },
      () =>
        p.h.app.get(InboundIngestService).ingest({
          orgId: t.orgId,
          channelUuid: channel,
          message: {
            providerMessageId: 'LIVE1',
            peerKey: '919800000009',
            kind: 'text',
            body: 'hello from a live chat',
            providerTimestamp: new Date().toISOString(),
          },
        }),
    );
    await s.emitHistory(batch([personMsg('919800000009', 'OLD9', ago(8))]));
    expect(
      (await one(
        `SELECT imported_at FROM conversations WHERE org_id = $1 AND peer_key = '919800000009'`,
        [t.orgId],
      ))!.imported_at,
    ).toBeNull();
    expect(
      (await one(
        `SELECT imported_at FROM conversations WHERE org_id = $1 AND peer_key = '919800000001'`,
        [t.orgId],
      ))!.imported_at,
    ).not.toBeNull();
  });

  it('sends ONE hint when the import ends, to people who can read the inbox or the numbers, and none per message', async () => {
    const t = await tenant('hist-rt');
    const reader = await p.api.member(t, 'inboxreader', [['inbox.conversation.read']]);
    const outsider = await p.api.member(t, 'outsider', [['record.contacts.read']]);
    const a = await listen(p, reader.token);
    const b = await listen(p, outsider.token);
    const x = await pairing(t, 'recent');
    const s = await link(x);
    await deliver();
    const hints = (c: typeof a) => eventsOf(c, REALTIME_EVENT.historyImported);
    const before = hints(a).length;
    await s.emitHistory(
      batch([personMsg('919800000001', 'R1', ago(5)), personMsg('919800000002', 'R2', ago(5))], {
        progress: 60,
      }),
    );
    await s.emitHistory(batch([personMsg('919800000001', 'R3', ago(5) + 1000)], { progress: 80 }));
    await deliver();
    await new Promise((res) => setTimeout(res, 300));
    expect(hints(a).length).toBe(before); // still running: nothing is announced, however many messages arrived
    await s.emitHistory(batch([personMsg('919800000003', 'R4', ago(5))], { progress: 100 }));
    await deliver();
    await until('the hint', () => (hints(a).length > before ? true : undefined));
    await new Promise((res) => setTimeout(res, 300));
    const got = hints(a).slice(before);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ payload: { state: 'done' } });
    expect(JSON.stringify(got[0])).not.toMatch(/9198000|hello/); // a uuid and a state, never a number or a text
    expect(hints(b)).toHaveLength(0);
  });

  it('a cancel after something was stored sends the hint once; a cancel that stored nothing sends none', async () => {
    const t = await tenant('hist-rt2');
    const reader = await p.api.member(t, 'inboxreader2', [['inbox.conversation.read']]);
    const a = await listen(p, reader.token);
    const hints = () => eventsOf(a, REALTIME_EVENT.historyImported);
    const empty = await pairing(t, 'recent');
    await post(t.admin, `/v2/devices/${empty.id}/history-import/cancel`);
    await deliver();
    await new Promise((res) => setTimeout(res, 300));
    expect(hints()).toHaveLength(0);
    const used = await pairing(t, 'recent', empty.w);
    const s = await link(used);
    await s.emitHistory(batch([personMsg('919800000001', 'C1', ago(3))], { progress: 30 }));
    await post(t.admin, `/v2/devices/${used.id}/history-import/cancel`);
    await deliver();
    await until('the hint', () => (hints().length > 0 ? true : undefined));
    await new Promise((res) => setTimeout(res, 300));
    expect(hints()).toHaveLength(1);
    expect(hints()[0]).toMatchObject({ payload: { state: 'cancelled', deviceId: used.id } });
  });
});

describe('who may do what, and whose it is', () => {
  it('status needs wa.devices.read, cancel needs wa.devices.pair, and a request that names none is 401', async () => {
    const t = await tenant('hist-perm');
    const x = await pairing(t, 'recent');
    const reader = await p.api.member(t, 'reader', [['wa.devices.read']]);
    const pairer = await p.api.member(t, 'pairer', [['wa.devices.pair']]);
    const nobody = await p.api.member(t, 'nobody', [['record.contacts.read']]);
    expect((await get(reader.token, `/v2/devices/${x.id}/history-import`)).status).toBe(200);
    expect((await get(nobody.token, `/v2/devices/${x.id}/history-import`)).status).toBe(403);
    expect((await post(reader.token, `/v2/devices/${x.id}/history-import/cancel`)).status).toBe(
      403,
    );
    expect((await post(nobody.token, `/v2/devices/${x.id}/history-import/cancel`)).status).toBe(
      403,
    );
    expect((await p.api.http().get(`/v2/devices/${x.id}/history-import`)).status).toBe(401);
    expect((await post(pairer.token, `/v2/devices/${x.id}/history-import/cancel`)).status).toBe(
      200,
    );
  });

  it('another workspace gets a 404 for the status and the cancel, and cannot see the run or its threads', async () => {
    const a = await tenant('hist-iso-a');
    const b = await tenant('hist-iso-b');
    const x = await pairing(a, 'recent');
    const s = await link(x);
    await s.emitHistory(batch([personMsg('919800000001', 'T1', ago(2))]));
    expect((await get(b.admin, `/v2/devices/${x.id}/history-import`)).status).toBe(404);
    expect((await post(b.admin, `/v2/devices/${x.id}/history-import/cancel`)).status).toBe(404);
    expect((await get(a.admin, `/v2/devices/${x.id}/history-import`)).status).toBe(200);
    expect(
      await count(`SELECT count(*)::int AS n FROM conversations WHERE org_id = $1`, [b.orgId]),
    ).toBe(0);
    expect(
      await count(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [b.orgId]),
    ).toBe(0);
  });
});
