import { randomUUID } from 'node:crypto';
import { UNOFFICIAL_WHATSAPP_GATE } from '../../../src/modules/auth/unofficial-whatsapp.port';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { QUEUES } from '../../../src/infra/queue/queues';
import { OutboxService } from '../../../src/kernel/outbox/outbox.service';
import {
  CapTally,
  PACING_SETTINGS,
  PacingRuntime,
  SenderLease,
  WALLET_GATE,
  type PacingSettingsSource,
  type WalletGate,
} from '../../../src/modules/broadcasts';
import { MergeTagService } from '../../../src/modules/crm';
import {
  OutboundRegistry,
  SenderResolver,
  type EngineTransport,
  type SendCommand,
} from '../../../src/modules/node-bridge-runtime';
import { MediaStorageService } from '../../../src/modules/platform-settings-branding-storage';
import { WarmerService } from '../../../src/modules/scheduled-queue-warmer';
import { ScheduleMessageBuilder } from '../../../src/modules/scheduled-queue-warmer/schedule-message-builder.service';
import { ScheduledRunService } from '../../../src/modules/scheduled-queue-warmer/scheduled-run.service';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * Template and file schedules, the edit screen's API and the detail page's funnel (TW-SCHED-006, 012, 016) through the real API on a
 * real Postgres and Redis. The providers are stand-ins: a transport per engine that records the command it was given, and an
 * in-memory object store behind the real storage service.
 */
let h: Harness;
let api: Api;
let n = 0;
let runService: ScheduledRunService;
let registry: OutboundRegistry;
let sent: Array<{ engine: string; command: SendCommand; reference: string }> = [];
const files = new Map<string, Buffer>();
const removed: string[] = [];

const FUTURE = '2031-03-10';
const LATER = '2031-03-12';

const transport = (engine: string): EngineTransport => ({
  open: () =>
    Promise.resolve({
      send: async (command, ctx) => {
        sent.push({ engine, command, reference: ctx.clientReference });
        return { providerMessageId: `wamid.${engine}.${randomUUID()}` };
      },
    }),
});

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  registry = h.app.get(OutboundRegistry);
  const runtime = h.app.get(PacingRuntime);
  runtime.sleep = () => Promise.resolve();
  const pacing = h.app.get<PacingSettingsSource>(PACING_SETTINGS);
  pacing.get = () =>
    Promise.resolve({
      msgGapSeconds: 3,
      enableBatches: false,
      batchSize: 50,
      batchGapMinutes: 5,
      baileysDailyCap: 4000,
    });
  void h.app.get<Queue>(getQueueToken(QUEUES.SCHED_RUN), { strict: false });
  runService = new ScheduledRunService(
    h.app.get(DatabaseService),
    h.app.get(SenderResolver),
    registry,
    h.app.get(MergeTagService, { strict: false }),
    h.app.get(ScheduleMessageBuilder),
    pacing as never,
    runtime,
    h.app.get(CapTally),
    h.app.get(SenderLease),
    h.app.get(WarmerService),
    h.app.get(UNOFFICIAL_WHATSAPP_GATE),
    h.app.get(OutboxService),
    h.app.get<WalletGate>(WALLET_GATE as never, { strict: false }),
  );
  // An object store in memory behind the real storage service. Until a test turns it on, media is local disk, as on a fresh install.
  const storage = h.app.get(MediaStorageService, { strict: false }) as unknown as Record<
    string,
    unknown
  >;
  storage.put = async (key: string, body: Buffer) =>
    cloud ? (files.set(key, body), { key }) : null;
  storage.url = async (key: string) => `https://files.test/${key}?sig=1`;
  storage.remove = async (key: string) => {
    files.delete(key);
    removed.push(key);
  };
}, 900_000);

let cloud = false;

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  sent = [];
  registry.register('baileys', transport('baileys'));
  registry.register('waba', transport('waba'));
  registry.register('twilio', transport('twilio'));
});

// --- arrangements --------------------------------------------------------------------------------------------------------------

async function arrange(label: string) {
  const t: Tenant = await api.signup(label);
  const device = (
    await h.owner.query(
      `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active)
       VALUES ($1, 'Phone', '+91', $2, 'connected', true) RETURNING id, uuid`,
      [t.orgId, `98111${String(10000 + n++)}`],
    )
  ).rows[0];
  const waba = (
    await h.owner.query(
      `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, display_label)
       VALUES ($1, 'waba', 'connected', $2, 'Acme Official') RETURNING id, uuid`,
      [t.orgId, `+91981112${String(n++).padStart(4, '0')}`],
    )
  ).rows[0];
  return {
    t,
    phone: { id: Number(device.id), key: `baileys:${device.uuid}` },
    cloud: { id: Number(waba.id), key: `waba:${waba.uuid}` },
  };
}

async function template(
  t: Tenant,
  o: {
    name?: string;
    body?: string;
    status?: string;
    metaStatus?: string | null;
    pausedUntil?: string;
    type?: string;
    config?: number;
  } = {},
) {
  const r = await h.owner.query(
    `INSERT INTO wa_templates (org_id, template_name, template_body, header, footer, category, meta_category, template_type, status,
                               meta_template_id, meta_status, paused_until, provider_config_id, variable_map, language)
     VALUES ($1, $2, $3, NULL, 'Reply STOP', 'marketing', 'marketing', $4, $5, $6, $7, $8, $9, $10::jsonb, 'en') RETURNING id, uuid`,
    [
      t.orgId,
      o.name ?? `promo_${n++}`,
      o.body ?? 'Hi {{1}}, your offer is ready',
      o.type ?? 'standard',
      o.status ?? 'approved',
      o.metaStatus === null ? null : `meta-${randomUUID()}`,
      o.metaStatus === null ? null : (o.metaStatus ?? 'APPROVED'),
      o.pausedUntil ?? null,
      o.config ?? null,
      JSON.stringify({ body: [{ num: 1, key: 'first_name' }] }),
    ],
  );
  return { id: Number(r.rows[0].id), uuid: r.rows[0].uuid as string };
}

async function group(t: Tenant, people: Array<{ name: string; first: string; phone: string }>) {
  const uuids = await api.seedContacts(
    t,
    people.map((p) => ({ name: p.name, phone: p.phone })),
  );
  for (const [i, u] of uuids.entries()) {
    await h.owner.query(`UPDATE contacts SET first_name = $1 WHERE uuid = $2`, [
      people[i]!.first,
      u,
    ]);
  }
  const g = (
    await h.owner.query(
      `INSERT INTO contact_groups (org_id, name) VALUES ($1, 'VIP') RETURNING id, uuid`,
      [t.orgId],
    )
  ).rows[0];
  for (const u of uuids) {
    await h.owner.query(
      `INSERT INTO contact_group_members (org_id, group_id, contact_id) SELECT $1, $2, id FROM contacts WHERE uuid = $3`,
      [t.orgId, g.id, u],
    );
  }
  return g.uuid as string;
}

const numbers = (k: number) =>
  Array.from({ length: k }, (_, i) => `+9198222${String(10000 + n++ + i)}`);
const body = (senders: string[], over: Record<string, unknown> = {}) => ({
  name: 'Spring offer',
  scheduleType: 'once',
  sendDate: FUTURE,
  sendTime: '10:30',
  timezone: 'UTC',
  senders,
  messageType: 'plain',
  message: 'Hello',
  recipientType: 'number',
  numbers: numbers(2),
  ...over,
});
const post = (t: Tenant, path: string, b: unknown = {}) =>
  api
    .as(t.admin)
    .post(path)
    .set('idempotency-key', `k${Math.random()}`)
    .send(b as object);
const get = (t: Tenant, path: string) => api.as(t.admin).get(path);
const patch = (t: Tenant, id: string, b: unknown) =>
  api
    .as(t.admin)
    .patch(`/v2/scheduled/${id}`)
    .send(b as object);
const row = async (uuid: string) =>
  (await h.owner.query(`SELECT * FROM scheduled_messages WHERE uuid = $1`, [uuid])).rows[0];
const ledger = async (deviceId: number, day: string) =>
  Number(
    (
      await h.owner.query(
        `SELECT count FROM warmer_daily_sends WHERE engine = 'baileys' AND device_id = $1 AND day = $2::date`,
        [deviceId, day],
      )
    ).rows[0]?.count ?? 0,
  );
const run = (t: Tenant, uuid: string) =>
  row(uuid).then((r) =>
    RequestContextStore.run(
      { requestId: `t-${uuid}`, orgId: t.orgId, actorType: 'system', actorId: null, userId: null },
      () => runService.run(t.orgId, Number(r.id)),
    ),
  );
const due = (uuid: string) =>
  h.owner.query(
    `UPDATE scheduled_messages SET scheduled_time = now() - interval '1 minute', next_run_at = now() - interval '1 minute' WHERE uuid = $1`,
    [uuid],
  );

/** A file that passes the upload policy's content check: the PNG signature, then padding to `size` bytes. */
const png = (size: number) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(Math.max(0, size - 8), 1),
  ]);
const upload = (t: Tenant, buf: Buffer, name = 'offer.png') =>
  api
    .as(t.admin)
    .post('/v2/scheduled/media')
    .attach('file', buf, { filename: name, contentType: 'image/png' });

// --- template schedules ----------------------------------------------------------------------------------------------------------

describe('template schedules (TW-SCHED-006)', () => {
  it('a Cloud API number takes only a template Meta approved, and the refusals say why', async () => {
    const { t, cloud: waba } = await arrange('tp1');
    const ok = await template(t, { config: waba.id });
    const pending = await template(t, { metaStatus: 'PENDING' });
    const local = await template(t, { metaStatus: null });
    const paused = await template(t, { pausedUntil: '2099-01-01T00:00:00Z' });
    const otp = await template(t, { type: 'auth' });
    const otherConfig = (
      await h.owner.query(
        `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, display_label)
         VALUES ($1, 'waba', 'connected', '+919811300001', 'Other') RETURNING id`,
        [t.orgId],
      )
    ).rows[0].id;
    const tied = await template(t, { config: Number(otherConfig) });

    const create = (templateId: string) =>
      post(
        t,
        '/v2/scheduled',
        body([waba.key], { messageType: 'template', message: undefined, templateId }),
      );
    for (const [tpl, re] of [
      [pending, /not approved by Meta/],
      [local, /not approved by Meta/],
      [paused, /paused/],
      [otp, /Authentication|OTP/],
      [tied, /another WhatsApp Cloud API number/],
    ] as const) {
      const res = await create(tpl.uuid);
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toMatch(re);
    }
    const good = await create(ok.uuid);
    expect(good.status, JSON.stringify(good.body)).toBe(201);
    const r = await row(good.body.ids[0]);
    expect(r).toMatchObject({ template_type: 'template', provider: 'waba', warmer_reserved: 0 });
    expect(Number(r.template_id)).toBe(ok.id);
    // a forged id (another workspace's template) is not found
    const other = await arrange('tp1b');
    const foreign = await template(other.t, { config: other.cloud.id });
    const forged = await create(foreign.uuid);
    expect(forged.status).toBe(422);
    expect(JSON.stringify(forged.body)).toMatch(/not found/);
  });

  it("the run sends a Cloud API number the Meta template with each contact's own values (no 24-hour window), and keeps the cleaned overrides", async () => {
    const { t, cloud: waba } = await arrange('tp2');
    const tpl = await template(t, { config: waba.id, body: 'Hi {{1}}, your offer is ready' });
    const g = await group(t, [
      { name: 'Asha K', first: 'Asha', phone: '+919822100001' },
      { name: 'Ravi S', first: 'Ravi', phone: '+919822100002' },
    ]);
    const res = await post(
      t,
      '/v2/scheduled',
      body([waba.key], {
        messageType: 'template',
        message: undefined,
        templateId: tpl.uuid,
        recipientType: 'group',
        groupIds: [g],
        numbers: undefined,
        templateOverrides: { body: ['VIP {{first_name}}'], rubbish: { a: 1 } },
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.ids[0];
    expect((await row(id)).template_overrides).toEqual({ body: ['VIP {{first_name}}'] });
    await due(id);
    expect(await run(t, id)).toBe('finished');
    expect(sent).toHaveLength(2);
    for (const s of sent) {
      expect(s.engine).toBe('waba');
      expect(s.command).toMatchObject({ type: 'template', language: 'en', category: 'marketing' });
    }
    const texts = sent.map((s) => {
      const c = s.command as Extract<SendCommand, { type: 'template' }>;
      return JSON.stringify(c.components);
    });
    expect(texts.some((x) => x.includes('VIP Asha'))).toBe(true);
    expect(texts.some((x) => x.includes('VIP Ravi'))).toBe(true);
    expect((await row(id)).status).toBe('completed');
  });

  it('a personal number or Twilio is given the approved text with the same values filled in', async () => {
    const { t, phone } = await arrange('tp3');
    const tpl = await template(t, { metaStatus: null, body: 'Hi {{1}}, your offer is ready' });
    const g = await group(t, [{ name: 'Asha K', first: 'Asha', phone: '+919822100011' }]);
    const res = await post(
      t,
      '/v2/scheduled',
      body([phone.key], {
        messageType: 'template',
        message: undefined,
        templateId: tpl.uuid,
        recipientType: 'group',
        groupIds: [g],
        numbers: undefined,
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await due(res.body.ids[0]);
    expect(await run(t, res.body.ids[0])).toBe('finished');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.engine).toBe('baileys');
    expect(sent[0]!.command).toMatchObject({ type: 'text' });
    expect((sent[0]!.command as { body: string }).body).toContain('Hi Asha, your offer is ready');
  });

  it('a template that Meta stops approving before the run fails the schedule once, with the reason, and sends nothing', async () => {
    const { t, cloud: waba } = await arrange('tp4');
    const tpl = await template(t, { config: waba.id });
    const res = await post(
      t,
      '/v2/scheduled',
      body([waba.key], { messageType: 'template', message: undefined, templateId: tpl.uuid }),
    );
    expect(res.status).toBe(201);
    await h.owner.query(`UPDATE wa_templates SET meta_status = 'REJECTED' WHERE id = $1`, [tpl.id]);
    await due(res.body.ids[0]);
    expect(await run(t, res.body.ids[0])).toBe('failed');
    expect(sent).toHaveLength(0);
    expect((await row(res.body.ids[0])).failure_reason).toMatch(/not approved by Meta/);
  });

  it('the composer offers each template with the engines that can send it', async () => {
    const { t, cloud: waba } = await arrange('tp5');
    await template(t, { name: 'meta_ok', config: waba.id });
    await template(t, { name: 'local_only', metaStatus: null });
    await template(t, { name: 'otp', type: 'auth' });
    const opts = (await get(t, '/v2/scheduled/options')).body;
    const by = Object.fromEntries(
      (opts.templates as Array<{ name: string; usableOn: string[]; senderKey: string | null }>).map(
        (x) => [x.name, x],
      ),
    );
    expect(by.meta_ok!.usableOn).toEqual(expect.arrayContaining(['waba', 'twilio', 'baileys']));
    expect(by.meta_ok!.senderKey).toBe(waba.key);
    expect(by.local_only!.usableOn).toEqual(['twilio', 'baileys']);
    expect(by.otp).toBeUndefined();
  });
});

// --- files ---------------------------------------------------------------------------------------------------------------------

describe('file schedules (TW-SCHED-006)', () => {
  it('refuses an upload while media is on local disk, with the reason', async () => {
    cloud = false;
    const { t } = await arrange('fl0');
    const res = await upload(t, png(2000));
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/cloud object storage/);
  });

  it('stores the file privately, checks it against the channel of each number, and sends it with its type and name', async () => {
    cloud = true;
    const { t, cloud: waba, phone } = await arrange('fl1');
    const small = await upload(t, png(2000));
    expect(small.status, JSON.stringify(small.body)).toBe(200);
    expect(small.body).toMatchObject({
      name: 'offer.png',
      mime: 'image/png',
      kind: 'image',
      size: 2000,
    });
    expect(small.body.url).toContain('https://files.test/scheduled/');
    const key = (
      await h.owner.query(`SELECT storage_key FROM scheduled_media WHERE uuid = $1`, [
        small.body.id,
      ])
    ).rows[0].storage_key as string;
    expect(key).toMatch(new RegExp(`^scheduled/${t.orgId}/`));
    expect(files.has(key)).toBe(true);

    // 6 MB: over the Cloud API's 5 MB for an image, fine for a personal number
    const big = await upload(t, png(6 * 1024 * 1024), 'big.png');
    expect(big.status).toBe(200);
    const refused = await post(
      t,
      '/v2/scheduled',
      body([waba.key], { messageType: 'media', message: undefined, mediaId: big.body.id }),
    );
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).toMatch(/bigger than WhatsApp Cloud API accepts \(5 MB\)/);
    const accepted = await post(
      t,
      '/v2/scheduled',
      body([phone.key], { messageType: 'media', message: 'Look', mediaId: big.body.id }),
    );
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    expect(await row(accepted.body.ids[0])).toMatchObject({
      template_type: 'media_with_caption',
      media_file: expect.stringMatching(/^scheduled\//),
    });

    const ok = await post(
      t,
      '/v2/scheduled',
      body([waba.key], { messageType: 'media', message: 'Look', mediaId: small.body.id }),
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    await due(ok.body.ids[0]);
    expect(await run(t, ok.body.ids[0])).toBe('finished');
    expect(sent).toHaveLength(2);
    expect(sent[0]!.command).toMatchObject({
      type: 'media',
      mimeType: 'image/png',
      fileName: 'offer.png',
      caption: 'Look',
    });
    // the sender is given a fresh signed link, not a stored key
    expect((sent[0]!.command as { mediaUrl: string }).mediaUrl).toMatch(
      /^https:\/\/files\.test\/scheduled\//,
    );

    const detail = (await get(t, `/v2/scheduled/${ok.body.ids[0]}`)).body;
    expect(detail.mediaFile).toMatchObject({ name: 'offer.png', kind: 'image', size: 2000 });
    expect(detail.media).toBeNull();
  });

  it("another workspace's upload cannot be attached, and a pasted link must be https for the Cloud API", async () => {
    cloud = true;
    const a = await arrange('fl2a');
    const b = await arrange('fl2b');
    const theirs = await upload(b.t, png(2000));
    const res = await post(
      a.t,
      '/v2/scheduled',
      body([a.cloud.key], { messageType: 'media', message: undefined, mediaId: theirs.body.id }),
    );
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/file was not found/);
    const plain = await post(
      a.t,
      '/v2/scheduled',
      body([a.cloud.key], {
        messageType: 'media',
        message: undefined,
        media: 'http://example.com/a.png',
      }),
    );
    expect(plain.status).toBe(422);
    expect(JSON.stringify(plain.body)).toMatch(/HTTPS/);
    const link = await post(
      a.t,
      '/v2/scheduled',
      body([a.cloud.key], {
        messageType: 'media',
        message: undefined,
        media: 'https://example.com/a.png',
      }),
    );
    expect(link.status, JSON.stringify(link.body)).toBe(201);
  });

  it('removes the stored file with the last schedule that used it, and not before', async () => {
    cloud = true;
    const { t, phone } = await arrange('fl3');
    const up = await upload(t, png(3000));
    const key = (
      await h.owner.query(`SELECT storage_key FROM scheduled_media WHERE uuid = $1`, [up.body.id])
    ).rows[0].storage_key as string;
    const a = await post(
      t,
      '/v2/scheduled',
      body([phone.key], { messageType: 'media', message: undefined, mediaId: up.body.id }),
    );
    const b = await post(
      t,
      '/v2/scheduled',
      body([phone.key], { messageType: 'media', message: undefined, mediaId: up.body.id }),
    );
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect((await api.as(t.admin).delete(`/v2/scheduled/${a.body.ids[0]}`)).status).toBe(204);
    expect(files.has(key)).toBe(true);
    expect(removed).not.toContain(key);
    expect((await api.as(t.admin).delete(`/v2/scheduled/${b.body.ids[0]}`)).status).toBe(204);
    expect(files.has(key)).toBe(false);
    expect(removed).toContain(key);
    expect(
      (await h.owner.query(`SELECT 1 FROM scheduled_media WHERE uuid = $1`, [up.body.id])).rows,
    ).toHaveLength(0);
  });

  it('needs the manage permission to upload', async () => {
    cloud = true;
    const { t } = await arrange('fl4');
    const reader = await api.member(t, 'reader', [['sched.schedules.read']]);
    const res = await api
      .http()
      .post('/v2/scheduled/media')
      .set('authorization', `Bearer ${reader.token}`)
      .attach('file', png(2000), { filename: 'offer.png', contentType: 'image/png' });
    expect(res.status).toBe(403);
  });
});

// --- edit ----------------------------------------------------------------------------------------------------------------------

describe('editing a schedule that has not started (TW-SCHED-016)', () => {
  const profile = {
    enabled: true,
    dailyBase: 20,
    stepPct: 0,
    stepDays: 1,
    maxDaily: 20,
    gapMin: 1,
    gapMax: 2,
    activeStart: 0,
    activeEnd: 0,
    spintax: false,
  };

  it('opens the composer on the stored schedule (the draft)', async () => {
    const { t, phone } = await arrange('ed1');
    const nums = numbers(2);
    const made = await post(
      t,
      '/v2/scheduled',
      body([phone.key], { numbers: nums, message: 'Hi there' }),
    );
    const id = made.body.ids[0];
    const d = await get(t, `/v2/scheduled/${id}/draft`);
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect(d.body).toMatchObject({
      id,
      name: 'Spring offer',
      scheduleType: 'once',
      sendDate: FUTURE,
      sendTime: '10:30',
      timezone: 'UTC',
      sender: phone.key,
      messageType: 'plain',
      message: 'Hi there',
      recipientType: 'number',
      totalRecipients: 2,
    });
    expect(d.body.numbers.map((x: string) => x.replace(/\D/g, '')).sort()).toEqual(
      nums.map((x) => x.replace(/\D/g, '')).sort(),
    );
    expect((await get(t, `/v2/scheduled/${id}`)).body.editable).toBe(true);
  });

  it('changes the time, the message, the number and the audience; moves the warmer budget; reseeds the recipients; audits and announces it', async () => {
    const { t } = await arrange('ed2');
    const second = (
      await h.owner.query(
        `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active)
         VALUES ($1, 'Second', '+91', '9811100077', 'connected', true) RETURNING id, uuid`,
        [t.orgId],
      )
    ).rows[0];
    const first = (
      await h.owner.query(`SELECT id, uuid FROM devices WHERE org_id = $1 ORDER BY id LIMIT 1`, [
        t.orgId,
      ])
    ).rows[0];
    const A = { id: Number(first.id), key: `baileys:${first.uuid}` };
    const B = { id: Number(second.id), key: `baileys:${second.uuid}` };
    await api.as(t.admin).put(`/v2/warmer/${A.key}`).send(profile);
    const made = await post(t, '/v2/scheduled', body([A.key], { numbers: numbers(3) }));
    const id = made.body.ids[0];
    expect(await ledger(A.id, FUTURE)).toBe(3);
    const v1 = (await get(t, `/v2/scheduled/${id}`)).body.rowVersion;

    // a later day on the same warming number with a different audience: the old day is given back, the new one reserved
    const nums = numbers(5);
    const r1 = await patch(t, id, {
      rowVersion: v1,
      sendDate: LATER,
      sendTime: '4:15 PM',
      messageType: 'plain',
      message: 'New words',
      recipientType: 'number',
      numbers: nums,
    });
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    expect(r1.body).toMatchObject({
      sendDate: LATER,
      sendTime: '16:15',
      message: 'New words',
      totalRecipients: 5,
    });
    expect(new Date(r1.body.nextRunAt).toISOString()).toBe('2031-03-12T16:15:00.000Z');
    expect(await ledger(A.id, FUTURE)).toBe(0);
    expect(await ledger(A.id, LATER)).toBe(5);
    const stored = await row(id);
    expect(stored).toMatchObject({ warmer_reserved: 5, total_recipients: 5 });
    expect(
      Number(
        (
          await h.owner.query(
            `SELECT count(*) FROM scheduled_message_contacts WHERE scheduled_message_id = $1`,
            [stored.id],
          )
        ).rows[0].count,
      ),
    ).toBe(5);

    // moving it to the other (not warming) number: the first number's reservation goes, the other reserves nothing
    const r2 = await patch(t, id, { rowVersion: r1.body.rowVersion, sender: B.key });
    expect(r2.status, JSON.stringify(r2.body)).toBe(200);
    expect(await ledger(A.id, LATER)).toBe(0);
    expect(await ledger(B.id, LATER)).toBe(0);
    expect(await row(id)).toMatchObject({ warmer_reserved: 0, provider: 'baileys' });
    expect(Number((await row(id)).device_id)).toBe(B.id);
    expect(r2.body.senderLabel).toBe('Second');

    // the trail and the event
    const audit = await h.owner.query(
      `SELECT action, delta FROM audit_log WHERE org_id = $1 AND module = 'scheduled_messages' AND record_id = $2 ORDER BY id`,
      [t.orgId, stored.id],
    );
    expect(audit.rows.map((x) => x.action)).toEqual(['update', 'update']);
    expect(audit.rows[0].delta).toMatchObject({
      sendDate: { old: FUTURE, new: LATER },
      message: { old: 'Hello', new: 'New words' },
    });
    const evs = await h.owner.query(
      `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = 'scheduled.updated' ORDER BY id`,
      [t.orgId],
    );
    expect(evs.rows).toHaveLength(2);
    expect(evs.rows[0].payload).toMatchObject({ uuid: id, name: 'Spring offer' });
    expect(JSON.stringify(evs.rows[0].payload)).not.toContain('New words');
  });

  it('holds the whole change when the new day does not fit the warming budget, and keeps the old reservation', async () => {
    const { t, phone } = await arrange('ed3');
    await api.as(t.admin).put(`/v2/warmer/${phone.key}`).send(profile);
    const made = await post(t, '/v2/scheduled', body([phone.key], { numbers: numbers(10) }));
    const other = await post(
      t,
      '/v2/scheduled',
      body([phone.key], { numbers: numbers(15), sendDate: LATER }),
    );
    expect(other.status).toBe(201);
    const id = made.body.ids[0];
    const v = (await get(t, `/v2/scheduled/${id}`)).body.rowVersion;
    const res = await patch(t, id, { rowVersion: v, sendDate: LATER });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/only 5 of its 20-message budget/);
    expect(await ledger(phone.id, FUTURE)).toBe(10);
    expect(await ledger(phone.id, LATER)).toBe(15);
    expect(
      (
        await h.owner.query(
          `SELECT to_char(send_date, 'YYYY-MM-DD') AS d FROM scheduled_messages WHERE uuid = $1`,
          [id],
        )
      ).rows[0].d,
    ).toBe(FUTURE);
  });

  it('is a 409 for a stale version, and for a schedule that is not waiting or paused or that already started', async () => {
    const { t, phone } = await arrange('ed4');
    const made = await post(t, '/v2/scheduled', body([phone.key]));
    const id = made.body.ids[0];
    const v = (await get(t, `/v2/scheduled/${id}`)).body.rowVersion;
    expect((await patch(t, id, { rowVersion: v, name: 'One' })).status).toBe(200);
    const stale = await patch(t, id, { rowVersion: v, name: 'Two' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');

    // running / completed / cancelled / failed
    for (const status of ['running', 'completed', 'cancelled', 'failed']) {
      await h.owner.query(`UPDATE scheduled_messages SET status = $1 WHERE uuid = $2`, [
        status,
        id,
      ]);
      const cur = (await get(t, `/v2/scheduled/${id}`)).body;
      expect(cur.editable, status).toBe(false);
      const res = await patch(t, id, { rowVersion: cur.rowVersion, name: 'X' });
      expect(res.status, status).toBe(409);
      expect((await get(t, `/v2/scheduled/${id}/draft`)).status, status).toBe(409);
    }
    // paused, but somebody has already been messaged: a one-off can no longer change
    await h.owner.query(`UPDATE scheduled_messages SET status = 'paused' WHERE uuid = $1`, [id]);
    await h.owner.query(
      `UPDATE scheduled_message_contacts SET status = 'sent', wa_message_id = 'wamid.x' WHERE id = (SELECT min(id) FROM scheduled_message_contacts WHERE scheduled_message_id = $1)`,
      [(await row(id)).id],
    );
    const started = await get(t, `/v2/scheduled/${id}`);
    expect(started.body.editable).toBe(false);
    const res = await patch(t, id, { rowVersion: started.body.rowVersion, name: 'Y' });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/already started sending/);
  });

  it('checks what create checks: the zone, the lead time of a changed time, the sender, the audience, the message and the plan', async () => {
    const { t, phone, cloud: waba } = await arrange('ed5');
    const made = await post(t, '/v2/scheduled', body([phone.key]));
    const id = made.body.ids[0];
    const ver = async () => (await get(t, `/v2/scheduled/${id}`)).body.rowVersion;
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ timezone: 'Mars/Phobos' }, /timezone/i],
      [{ sendDate: '2020-01-01' }, /2 minutes/],
      [{ sendTime: '99:99' }, /time/i],
      [{ sender: 'baileys:00000000-0000-4000-8000-000000000000' }, /not connected/],
      [{ recipientType: 'number', numbers: ['12345'] }, /recipients are empty/],
      [{ messageType: 'plain', message: '   ' }, /Write the message/],
      [{ scheduleType: 'recurring' }, /how often/],
      [{ messageType: 'template' }, /Choose a template/],
      [{ messageType: 'template', templateId: randomUUID() }, /not found/],
      [{ messageType: 'media', media: 'ftp://x/y.png' }, /link/],
      [{ endDate: '2020-01-01' }, /end date/i],
    ];
    for (const [change, re] of cases) {
      const res = await patch(t, id, { rowVersion: await ver(), ...change });
      expect(res.status, JSON.stringify(change) + JSON.stringify(res.body)).toBe(422);
      expect(JSON.stringify(res.body)).toMatch(re);
    }
    // a Cloud API number takes a template only when Meta approved it
    const pending = await template(t, { metaStatus: 'PENDING' });
    const res = await patch(t, id, {
      rowVersion: await ver(),
      sender: waba.key,
      messageType: 'template',
      templateId: pending.uuid,
    });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/not approved by Meta/);
    // nothing changed
    expect(await row(id)).toMatchObject({ schedule_name: 'Spring offer', template_type: 'text' });

    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"scheduled_messages":false}}'::jsonb WHERE org_id = $1`,
      [t.orgId],
    );
    const off = await patch(t, id, { rowVersion: await ver(), name: 'Plan off' });
    expect(off.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(off.body)).toMatch(/Scheduled messages|plan/i);
  });

  it('turns a plain message into a template on a Cloud API number, and a time left alone may stay past due', async () => {
    const { t, phone, cloud: waba } = await arrange('ed6');
    const tpl = await template(t, { config: waba.id });
    const made = await post(t, '/v2/scheduled', body([phone.key]));
    const id = made.body.ids[0];
    const v = (await get(t, `/v2/scheduled/${id}`)).body.rowVersion;
    const res = await patch(t, id, {
      rowVersion: v,
      sender: waba.key,
      messageType: 'template',
      templateId: tpl.uuid,
      templateOverrides: { body: ['{{first_name}}'] },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await row(id)).toMatchObject({ template_type: 'template', provider: 'waba' });
    expect(res.body.template).toMatchObject({
      name: expect.stringMatching(/^promo_/),
      language: 'en',
    });
    const d = (await get(t, `/v2/scheduled/${id}/draft`)).body;
    expect(d).toMatchObject({ messageType: 'template', templateId: tpl.uuid, sender: waba.key });
    expect(d.templateOverrides).toEqual({ body: ['{{first_name}}'] });

    // paused after its time passed: renaming it does not ask for a new time
    await h.owner.query(
      `UPDATE scheduled_messages SET status = 'paused', scheduled_time = now() - interval '1 day', next_run_at = now() - interval '1 day' WHERE uuid = $1`,
      [id],
    );
    const v2 = (await get(t, `/v2/scheduled/${id}`)).body.rowVersion;
    const rename = await patch(t, id, { rowVersion: v2, name: 'Still paused' });
    expect(rename.status, JSON.stringify(rename.body)).toBe(200);
    expect(rename.body.status).toBe('paused');
  });

  it('a recurring schedule may be edited between its runs, and its audience starts over at the next run', async () => {
    const { t, phone } = await arrange('ed7');
    const made = await post(
      t,
      '/v2/scheduled',
      body([phone.key], {
        scheduleType: 'recurring',
        repeatInterval: 'daily',
        numbers: numbers(2),
      }),
    );
    const id = made.body.ids[0];
    await due(id);
    expect(await run(t, id)).toBe('finished');
    const after = await row(id);
    expect(after).toMatchObject({ status: 'scheduled', recipients_spent: true });
    const cur = (await get(t, `/v2/scheduled/${id}`)).body;
    expect(cur.editable).toBe(true);
    const res = await patch(t, id, {
      rowVersion: cur.rowVersion,
      recipientType: 'number',
      numbers: numbers(3),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await row(id)).toMatchObject({ recipients_spent: false, total_recipients: 3 });
  });

  it("is a 404 for another workspace's schedule, and 403 without the manage key", async () => {
    const a = await arrange('ed8a');
    const b = await api.signup('ed8b');
    const made = await post(a.t, '/v2/scheduled', body([a.phone.key]));
    const id = made.body.ids[0];
    const v = (await get(a.t, `/v2/scheduled/${id}`)).body.rowVersion;
    expect((await get(b, `/v2/scheduled/${id}/draft`)).status).toBe(404);
    expect((await patch(b, id, { rowVersion: v, name: 'Mine now' })).status).toBe(404);
    const reader = await api.member(a.t, 'reader', [['sched.schedules.read']]);
    const asReader = (m: 'get' | 'patch', path: string, b2?: object) =>
      api
        .http()
        [m](path)
        .set('authorization', `Bearer ${reader.token}`)
        .send(b2 ?? {});
    expect((await asReader('get', `/v2/scheduled/${id}/draft`)).status).toBe(403);
    expect(
      (await asReader('patch', `/v2/scheduled/${id}`, { rowVersion: v, name: 'x' })).status,
    ).toBe(403);
    expect((await row(id)).schedule_name).toBe('Spring offer');
  });
});

// --- engagement ----------------------------------------------------------------------------------------------------------------

describe('the funnel over time and the filtered recipients (TW-SCHED-012)', () => {
  async function seeded(label: string) {
    const { t, phone } = await arrange(label);
    const made = await post(t, '/v2/scheduled', body([phone.key], { numbers: numbers(6) }));
    const id = made.body.ids[0];
    const sid = Number((await row(id)).id);
    const ids = (
      await h.owner.query(
        `SELECT id FROM scheduled_message_contacts WHERE scheduled_message_id = $1 ORDER BY id`,
        [sid],
      )
    ).rows.map((r) => Number(r.id));
    const at = (iso: string) => `'${iso}'::timestamptz`;
    const set = (i: number, sql: string) =>
      h.owner.query(`UPDATE scheduled_message_contacts SET ${sql} WHERE id = ${ids[i]}`);
    // 10:10 sent, 10:20 sent, 11:05 delivered then read at 11:40, 12:15 failed after sending, a failure that never sent
    await set(
      0,
      `status = 'read', sent_at = ${at('2031-03-10T10:10:00Z')}, delivered_at = ${at('2031-03-10T11:05:00Z')}, read_at = ${at('2031-03-10T11:40:00Z')}`,
    );
    await set(
      1,
      `status = 'delivered', sent_at = ${at('2031-03-10T10:20:00Z')}, delivered_at = ${at('2031-03-10T11:10:00Z')}`,
    );
    await set(2, `status = 'sent', sent_at = ${at('2031-03-10T10:25:00Z')}`);
    await set(
      3,
      `status = 'failed', sent_at = ${at('2031-03-10T10:30:00Z')}, failed_at = ${at('2031-03-10T12:15:00Z')}, error_message = 'Undeliverable'`,
    );
    await set(
      4,
      `status = 'failed', failed_at = ${at('2031-03-10T10:35:00Z')}, error_message = 'Not on WhatsApp'`,
    );
    return { t, id };
  }

  it('gives running totals per hour for queued, sent, delivered, read and failed from the stored statuses', async () => {
    const { t, id } = await seeded('en1');
    const res = await get(t, `/v2/scheduled/${id}/funnel`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.bucket).toBe('hour');
    expect(res.body.total).toBe(6);
    const by = Object.fromEntries(
      (res.body.points as Array<Record<string, number | string>>).map((p) => [
        String(p.at).slice(11, 16),
        p,
      ]),
    );
    expect(by['10:00']).toMatchObject({ queued: 1, sent: 4, delivered: 0, read: 0, failed: 1 });
    expect(by['11:00']).toMatchObject({ queued: 1, sent: 4, delivered: 2, read: 1, failed: 1 });
    expect(by['12:00']).toMatchObject({ queued: 1, sent: 4, delivered: 2, read: 1, failed: 2 });
    // the first point is the first event, the last the last, and every step only goes up
    expect(res.body.points[0].at).toBe('2031-03-10T10:00:00.000Z');
    expect(res.body.points.at(-1).at).toBe('2031-03-10T12:00:00.000Z');
    for (const k of ['sent', 'delivered', 'read', 'failed']) {
      const xs = (res.body.points as Array<Record<string, number>>).map((p) => p[k]!);
      expect([...xs].sort((a, b) => a! - b!)).toEqual(xs);
    }
  });

  it('draws nothing for a schedule that has sent nothing, and a long one by the day', async () => {
    const { t, phone } = await arrange('en2');
    const made = await post(t, '/v2/scheduled', body([phone.key]));
    const empty = await get(t, `/v2/scheduled/${made.body.ids[0]}/funnel`);
    expect(empty.body).toEqual({ bucket: 'hour', total: 2, points: [] });
    await h.owner.query(
      `UPDATE scheduled_message_contacts SET status = 'sent', sent_at = '2031-03-10T10:00:00Z' WHERE id = (SELECT min(id) FROM scheduled_message_contacts WHERE scheduled_message_id = $1)`,
      [(await row(made.body.ids[0])).id],
    );
    await h.owner.query(
      `UPDATE scheduled_message_contacts SET status = 'sent', sent_at = '2031-03-14T10:00:00Z' WHERE id = (SELECT max(id) FROM scheduled_message_contacts WHERE scheduled_message_id = $1)`,
      [(await row(made.body.ids[0])).id],
    );
    const days = await get(t, `/v2/scheduled/${made.body.ids[0]}/funnel`);
    expect(days.body.bucket).toBe('day');
    expect(days.body.points.map((p: { at: string }) => p.at.slice(0, 10))).toEqual([
      '2031-03-10',
      '2031-03-11',
      '2031-03-12',
      '2031-03-13',
      '2031-03-14',
    ]);
    expect(days.body.points.at(-1)).toMatchObject({ sent: 2, queued: 0 });
  });

  it('filters the recipients by status and by name or number, pages them, and counts every status', async () => {
    const { t, id } = await seeded('en3');
    const all = await get(t, `/v2/scheduled/${id}/recipients`);
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body.total).toBe(6);
    expect(all.body.counts).toEqual({ read: 1, delivered: 1, sent: 1, failed: 2, pending: 1 });
    const failed = await get(t, `/v2/scheduled/${id}/recipients?status=failed`);
    expect(failed.body.total).toBe(2);
    expect(failed.body.items.map((x: { error: string }) => x.error).sort()).toEqual([
      'Not on WhatsApp',
      'Undeliverable',
    ]);
    expect((await get(t, `/v2/scheduled/${id}/recipients?status=delivered`)).body.total).toBe(1);
    expect((await get(t, `/v2/scheduled/${id}/recipients?status=pending`)).body.total).toBe(1);
    const page = await get(t, `/v2/scheduled/${id}/recipients?limit=4&offset=4`);
    expect(page.body.items).toHaveLength(2);
    expect(page.body.total).toBe(6);
    const one = all.body.items[0].phone as string;
    const found = await get(t, `/v2/scheduled/${id}/recipients?q=${one.slice(-6)}`);
    expect(found.body.total).toBeGreaterThanOrEqual(1);
    expect(found.body.items.map((x: { phone: string }) => x.phone)).toContain(one);
    expect((await get(t, `/v2/scheduled/${id}/recipients?q=zzzznobody`)).body.total).toBe(0);
    expect((await get(t, `/v2/scheduled/${id}/recipients?status=bogus`)).status).toBe(422);
  });

  it('is a 404 for another workspace and 403 without the read key', async () => {
    const { t, id } = await seeded('en4');
    const other = await api.signup('en4b');
    const nobody = await api.member(t, 'nobody', []);
    for (const path of [`/v2/scheduled/${id}/funnel`, `/v2/scheduled/${id}/recipients`]) {
      expect((await get(other, path)).status).toBe(404);
      expect(
        (await api.http().get(path).set('authorization', `Bearer ${nobody.token}`)).status,
      ).toBe(403);
    }
  });
});
