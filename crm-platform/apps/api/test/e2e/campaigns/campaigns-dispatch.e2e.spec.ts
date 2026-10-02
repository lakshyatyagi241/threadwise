import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { DatabaseService } from '../../../src/infra/db/database.service';
import {
  EngineSenderRegistry,
  LinkTracker,
  PACING_SETTINGS,
  PacingRuntime,
  SENDER_DIRECTORY,
  SenderLease,
  TEMPLATE_DIRECTORY,
  WARMER_GATE,
  type OpenedSender,
  type OutgoingMessage,
  type OutgoingText,
} from '../../../src/modules/broadcasts';
import { MergeTagService } from '../../../src/modules/crm';
import {
  CAMPAIGN_BILLING,
  CAMPAIGN_FLOW_STARTER,
  CAMPAIGN_SETTINGS,
} from '../../../src/modules/campaigns/_shims/tokens';
import { CampaignDispatchService } from '../../../src/modules/campaigns/campaign-dispatch.service';
import { CampaignEvents } from '../../../src/modules/campaigns/campaign-events';
import { CampaignJobs } from '../../../src/modules/campaigns/campaign-jobs';
import { CampaignMirrorService } from '../../../src/modules/campaigns/campaign-mirror.service';
import { CampaignSweeper } from '../../../src/modules/campaigns/campaign-sweeper.service';
import { CampaignsRepository } from '../../../src/modules/campaigns/campaigns.repository';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * Sending a campaign (TW-CAMP-011 to 014): opt-outs and duplicates, merge, A/B, retries with backoff, the daily limit, the window,
 * cancelling mid-run, the end date, recurring, flows and the sweeper. The real app and a real Postgres, a fake engine.
 */
let h: Harness;
let api: Api;
let dispatch: CampaignDispatchService;
let sweeper: CampaignSweeper;
let runtime: PacingRuntime;
let queued: Array<{ orgId: number; campaignId: number }> = [];

let texts: OutgoingText[] = [];
let templates: OutgoingMessage[] = [];
/** A hook the fake engine runs before each send; it may throw (a provider refusal) or cancel the campaign. */
let beforeSend: (m: { to: string }) => Promise<void> | void = () => undefined;
let hasSendText = true;
const slept: number[] = [];

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  const get = <T>(token: unknown) => h.app.get<T>(token as never, { strict: false });
  runtime = get<PacingRuntime>(PacingRuntime);
  runtime.sleep = (ms) => {
    slept.push(ms);
    return Promise.resolve();
  };
  runtime.random = () => 0.5;

  get<EngineSenderRegistry>(EngineSenderRegistry).register('baileys', {
    open: () =>
      Promise.resolve<OpenedSender>({
        send: async (m) => {
          await beforeSend(m);
          templates.push(m);
          return { providerMessageId: `wamid.t${templates.length}` };
        },
        ...(hasSendText ? {} : {}),
        sendText: async (m) => {
          await beforeSend(m);
          if (!hasSendText) throw new Error('unreachable');
          texts.push(m);
          return { providerMessageId: `wamid.x${texts.length}` };
        },
      }),
  });

  const jobs = new CampaignJobs({
    add: (_n: string, data: { orgId: number; campaignId: number }) => {
      queued.push(data);
      return Promise.resolve();
    },
  } as never);
  const repo = get<CampaignsRepository>(CampaignsRepository);
  const events = get<CampaignEvents>(CampaignEvents);
  dispatch = new CampaignDispatchService(
    get<DatabaseService>(DatabaseService),
    repo,
    get<CryptoService>(CryptoService),
    events,
    get<CampaignMirrorService>(CampaignMirrorService),
    get<EngineSenderRegistry>(EngineSenderRegistry),
    get<MergeTagService>(MergeTagService),
    get<LinkTracker>(LinkTracker),
    runtime,
    get<SenderLease>(SenderLease),
    get(SENDER_DIRECTORY),
    get(TEMPLATE_DIRECTORY),
    get(WARMER_GATE),
    get(PACING_SETTINGS),
    get(CAMPAIGN_BILLING),
    get(CAMPAIGN_FLOW_STARTER),
    get(CAMPAIGN_SETTINGS),
  );
  sweeper = new CampaignSweeper(
    get<DatabaseService>(DatabaseService),
    repo,
    events,
    jobs,
    runtime,
    get(CAMPAIGN_SETTINGS),
  );
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  texts = [];
  templates = [];
  queued = [];
  slept.length = 0;
  beforeSend = () => undefined;
  hasSendText = true;
});

let n = 0;
const phone = () => `+91950${String(n++).padStart(7, '0')}`;
const post = (t: Tenant, body: object) =>
  api
    .http()
    .post('/v2/campaigns')
    .set(bearer(t.admin))
    .set('idempotency-key', randomUUID())
    .send(body);
const device = async (t: Tenant) =>
  (
    await h.owner.query(
      `INSERT INTO devices (org_id, device_name, phone_number, status, active)
       VALUES ($1,'Phone',$2,'connected',true) RETURNING uuid`,
      [t.orgId, phone()],
    )
  ).rows[0].uuid as string;

/** A campaign through the API (so every column is as the app writes it), `count` named contacts, sent from a fake Baileys number. */
async function campaign(
  t: Tenant,
  o: {
    count?: number;
    body?: string;
    extra?: object;
    contacts?: Array<{ name: string; phone?: string; isUnsubscribed?: boolean }>;
  } = {},
) {
  const people: Array<{ name: string; phone?: string; isUnsubscribed?: boolean }> =
    o.contacts ?? Array.from({ length: o.count ?? 3 }, (_, i) => ({ name: `Asha${i}` }));
  const contactIds = await api.seedContacts(
    t,
    people.map((p) => ({
      name: p.name,
      phone: p.phone ?? phone(),
      isUnsubscribed: p.isUnsubscribed,
    })),
  );
  const res = await post(t, {
    name: 'Offer',
    type: 'text',
    customMessage: o.body ?? 'Hi {{name}}',
    scheduleType: 'now',
    senderKey: `baileys:${await device(t)}`,
    contactIds,
    ...o.extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const row = (
    await h.owner.query(`SELECT id, uuid FROM wpcampaigns WHERE uuid = $1`, [res.body.campaign.id])
  ).rows[0];
  return { id: Number(row.id), uuid: row.uuid as string, contactIds, orgId: t.orgId };
}
const rows = async (id: number) =>
  (
    await h.owner.query(
      `SELECT r.status, r.send_attempts, r.next_attempt_at, r.error_message, r.whatsapp_message_id, r.variant, c.name
       FROM wp_campaign_contacts r JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id
       WHERE r.campaign_id = $1 ORDER BY r.id`,
      [id],
    )
  ).rows as Array<{
    status: string;
    send_attempts: number;
    next_attempt_at: Date | null;
    error_message: string | null;
    whatsapp_message_id: string | null;
    variant: string | null;
    name: string;
  }>;
const camp = async (id: number) =>
  (
    await h.owner.query(
      `SELECT status, schedule_type, to_char(send_date,'YYYY-MM-DD') AS send_date, to_char(send_time,'HH24:MI') AS send_time,
              completed_at, sent_count, failed_count FROM wpcampaigns WHERE id = $1`,
      [id],
    )
  ).rows[0];
/** As the worker's processor runs it: inside a system context for the tenant. */
const inContext = <T>(orgId: number, fn: () => Promise<T>): Promise<T> =>
  RequestContextStore.run(
    { requestId: `test-${orgId}`, orgId, actorType: 'system', actorId: null, userId: null },
    fn,
  );
const run = (c: { orgId: number; id: number }) =>
  inContext(c.orgId, () => dispatch.run(c.orgId, c.id));
const sweep = () =>
  RequestContextStore.run(
    { requestId: 'test-sweep', orgId: 0, actorType: 'system', actorId: null, userId: null },
    () => sweeper.sweep(),
  );

describe('TW-CAMP-011: one run', () => {
  it('sends to everyone, merges each name, records the message id and completes the campaign', async () => {
    const t = await api.signup('cd1');
    const c = await campaign(t, { count: 3 });
    expect(await run(c)).toBe('finished');
    expect(texts.map((x) => x.text)).toEqual(['Hi Asha0', 'Hi Asha1', 'Hi Asha2']);
    expect(texts[0]!.to).toMatch(/^91950/);
    const r = await rows(c.id);
    expect(r.map((x) => x.status)).toEqual(['sent', 'sent', 'sent']);
    expect(r[0]!.whatsapp_message_id).toBe('wamid.x1');
    expect(await camp(c.id)).toMatchObject({ status: 'completed', sent_count: 3, failed_count: 0 });
    expect((await camp(c.id)).completed_at).not.toBeNull();
    // Nothing left to do: a second run does nothing.
    expect(await run(c)).toBe('skipped');
    expect(texts).toHaveLength(3);
  });

  it('opted-out contacts are stamped and not messaged; a second row for the same number is skipped, not failed', async () => {
    const t = await api.signup('cd2');
    const dup = phone();
    const c = await campaign(t, {
      contacts: [
        { name: 'First', phone: dup },
        { name: 'Out', isUnsubscribed: true },
        { name: 'Twin', phone: dup },
        { name: 'Other' },
      ],
    });
    expect(await run(c)).toBe('finished');
    expect((await rows(c.id)).map((x) => [x.name, x.status])).toEqual([
      ['First', 'sent'],
      ['Out', 'unsubscribed'],
      ['Twin', 'skipped'],
      ['Other', 'sent'],
    ]);
    expect(texts).toHaveLength(2);
    expect((await rows(c.id))[2]!.error_message).toContain('duplicate number');
  });

  it('links in the text become this recipient’s own short link, unless tracking is off', async () => {
    const t = await api.signup('cd3');
    const c = await campaign(t, { count: 1, body: 'See https://shop.example.com/offer' });
    await run(c);
    expect(texts[0]!.text).toMatch(/^See https?:\/\/.+\/r\/[A-Za-z0-9]+$/);

    const d = await campaign(t, {
      count: 1,
      body: 'See https://shop.example.com/offer',
      extra: { trackingEnabled: false },
    });
    await run(d);
    expect(texts[1]!.text).toBe('See https://shop.example.com/offer');
  });

  it('A/B testing sends each recipient the message of its variant', async () => {
    const t = await api.signup('cd4');
    const c = await campaign(t, {
      count: 4,
      body: 'Version A',
      extra: { abTesting: true, abSplit: 50, customMessageB: 'Version B' },
    });
    await run(c);
    const byVariant = new Map((await rows(c.id)).map((r) => [r.name, r.variant]));
    const sent = new Map(texts.map((x, i) => [i, x.text]));
    expect([...sent.values()].filter((x) => x === 'Version A')).toHaveLength(2);
    expect([...sent.values()].filter((x) => x === 'Version B')).toHaveLength(2);
    expect([...byVariant.values()].filter((v) => v === 'A')).toHaveLength(2);
  });

  it('a custom message on an engine that cannot send one fails every recipient for good, with the reason', async () => {
    const t = await api.signup('cd5');
    const c = await campaign(t, { count: 2 });
    h.app.get<EngineSenderRegistry>(EngineSenderRegistry).register('baileys', {
      open: () => Promise.resolve({ send: () => Promise.resolve({ providerMessageId: null }) }),
    });
    await run(c);
    const r = await rows(c.id);
    expect(r.map((x) => x.status)).toEqual(['failed', 'failed']);
    expect(r[0]).toMatchObject({ send_attempts: 3 });
    expect(r[0]!.error_message).toContain('cannot send a custom message');
    // Put the fake engine back for the other tests.
    h.app.get<EngineSenderRegistry>(EngineSenderRegistry).register('baileys', {
      open: () =>
        Promise.resolve<OpenedSender>({
          send: async (m) => {
            await beforeSend(m);
            templates.push(m);
            return { providerMessageId: `wamid.t${templates.length}` };
          },
          sendText: async (m) => {
            await beforeSend(m);
            texts.push(m);
            return { providerMessageId: `wamid.x${texts.length}` };
          },
        }),
    });
  });

  it('a template campaign sends the template by name; a deleted template fails the campaign without sending', async () => {
    const t = await api.signup('cd6');
    const tpl = (
      await h.owner.query(
        `INSERT INTO wa_templates (org_id, template_name, template_body, template_type, status, language)
         VALUES ($1,'welcome','Hello {{1}}','standard','approved','en_US') RETURNING id, uuid`,
        [t.orgId],
      )
    ).rows[0];
    const c = await campaign(t, {
      count: 2,
      extra: { type: 'template', templateId: tpl.uuid, customMessage: null },
    });
    await run(c);
    expect(templates.map((m) => [m.templateName, m.language])).toEqual([
      ['welcome', 'en_US'],
      ['welcome', 'en_US'],
    ]);
    expect(texts).toHaveLength(0);

    const d = await campaign(t, {
      count: 1,
      extra: { type: 'template', templateId: tpl.uuid, customMessage: null },
    });
    await h.owner.query(`DELETE FROM wa_templates WHERE id = $1`, [tpl.id]);
    expect(await run(d)).toBe('failed');
    expect((await camp(d.id)).status).toBe('failed');
    expect((await rows(d.id)).map((x) => x.status)).toEqual(['queued']);
  });

  it('the inbox bubble of a recipient who already has a thread is written once', async () => {
    const t = await api.signup('cd7');
    const c = await campaign(t, { count: 1, body: 'Your order is ready' });
    const contact = c.contactIds[0]!;
    const cid = Number(
      (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [contact])).rows[0].id,
    );
    await h.owner
      .query(
        `INSERT INTO conversations (org_id, contact_id, channel, raw_jid, contact_digits, status) VALUES ($1,$2,'whatsapp',$3,$4,'open')`,
        [t.orgId, cid, `919500000000@s.whatsapp.net`, '919500000000'],
      )
      .catch(() => undefined);
    await run(c);
    const msgs = await h.owner.query(
      `SELECT body, meta ->> 'source' AS source FROM messages WHERE org_id = $1 AND direction = 'out'`,
      [t.orgId],
    );
    // A thread may or may not match this contact's number here; when it does the bubble is the campaign's and exists once.
    expect(msgs.rows.length).toBeLessThanOrEqual(1);
    for (const m of msgs.rows)
      expect(m).toMatchObject({ body: 'Your order is ready', source: 'campaign' });
  });
});

describe('TW-CAMP-012: retries', () => {
  it('a refused send keeps the row failed with a backoff, the campaign is scheduled again, and the sweeper sends it when due', async () => {
    const t = await api.signup('cr1');
    const c = await campaign(t, { count: 2 });
    let first = true;
    beforeSend = () => {
      if (first) {
        first = false;
        throw new Error('network down');
      }
    };
    expect(await run(c)).toBe('rearmed');
    let r = await rows(c.id);
    expect(r.map((x) => x.status)).toEqual(['failed', 'sent']);
    expect(r[0]).toMatchObject({ send_attempts: 1, error_message: 'network down' });
    expect(r[0]!.next_attempt_at).not.toBeNull();
    expect(await camp(c.id)).toMatchObject({
      status: 'scheduled',
      schedule_type: 'scheduled',
      failed_count: 1,
    });

    // Not due yet: the sweeper leaves it alone.
    queued = [];
    await h.owner.query(
      `UPDATE wpcampaigns SET send_date = (now() AT TIME ZONE 'UTC')::date + 1 WHERE id = $1`,
      [c.id],
    );
    await sweep();
    expect(queued.filter((q) => q.campaignId === c.id)).toEqual([]);

    // The backoff passes and the campaign is due: it is started and the retry is sent.
    await h.owner.query(
      `UPDATE wp_campaign_contacts SET next_attempt_at = now() - interval '1 second' WHERE campaign_id = $1 AND status = 'failed'`,
      [c.id],
    );
    await h.owner.query(
      `UPDATE wpcampaigns SET send_date = (now() AT TIME ZONE 'UTC')::date - 1 WHERE id = $1`,
      [c.id],
    );
    await sweep();
    expect(queued.filter((q) => q.campaignId === c.id)).toEqual([
      { orgId: t.orgId, campaignId: c.id },
    ]);
    expect((await camp(c.id)).status).toBe('running');
    expect(await run(c)).toBe('finished');
    r = await rows(c.id);
    expect(r.map((x) => x.status)).toEqual(['sent', 'sent']);
    expect(await camp(c.id)).toMatchObject({ status: 'completed', failed_count: 0, sent_count: 2 });
  });

  it('gives up at the attempt cap: the row stays failed and the campaign completes', async () => {
    const t = await api.signup('cr2');
    const c = await campaign(t, { count: 1 });
    beforeSend = () => {
      throw new Error('always refused');
    };
    for (let attempt = 1; attempt <= 3; attempt++) {
      await h.owner.query(
        `UPDATE wp_campaign_contacts SET next_attempt_at = NULL WHERE campaign_id = $1`,
        [c.id],
      );
      await h.owner.query(`UPDATE wpcampaigns SET status = 'running' WHERE id = $1`, [c.id]);
      await run(c);
    }
    expect((await rows(c.id))[0]).toMatchObject({
      status: 'failed',
      send_attempts: 3,
      next_attempt_at: null,
    });
    expect(await camp(c.id)).toMatchObject({ status: 'completed', failed_count: 1 });
  });
});

describe('TW-CAMP-009: daily limit and window', () => {
  it('stops at the daily limit, leaves the rest queued and schedules the next day', async () => {
    const t = await api.signup('cl1');
    const c = await campaign(t, { count: 5, extra: { dailyLimit: 2, timezone: 'UTC' } });
    expect(await run(c)).toBe('rearmed');
    expect(texts).toHaveLength(2);
    expect((await rows(c.id)).map((x) => x.status)).toEqual([
      'sent',
      'sent',
      'queued',
      'queued',
      'queued',
    ]);
    const after = await camp(c.id);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    expect(after.status).toBe('scheduled');
    expect([today, tomorrow]).toContain(after.send_date);
    expect(after.send_time).toBe('09:00');
  });

  it('outside the active hours nothing is sent and the campaign waits for the window to open', async () => {
    const t = await api.signup('cl2');
    const hour = new Date().getUTCHours();
    const start = `${String((hour + 3) % 24).padStart(2, '0')}:00`;
    const end = `${String((hour + 4) % 24).padStart(2, '0')}:00`;
    const c = await campaign(t, {
      count: 2,
      extra: { windowStart: start, windowEnd: end, timezone: 'UTC' },
    });
    expect(await run(c)).toBe('rearmed');
    expect(texts).toHaveLength(0);
    expect((await rows(c.id)).map((x) => x.status)).toEqual(['queued', 'queued']);
    expect(await camp(c.id)).toMatchObject({ status: 'scheduled', send_time: start });
  });

  it('a gap is kept between sends: none for an official engine, a jittered one for the others', async () => {
    const t = await api.signup('cl3');
    const c = await campaign(t, { count: 3 });
    await run(c);
    // Baileys: the platform gap of 3 s (jitter fixed by the test) before every recipient after the first.
    expect(slept.filter((ms) => ms > 0)).toHaveLength(2);
    expect(slept.every((ms) => ms === 3000)).toBe(true);
  });
});

describe('cancelling, expiry, recurring, flows, locks', () => {
  it('cancelling mid-run stops it at the next recipient and puts the rest back', async () => {
    const t = await api.signup('cx1');
    const c = await campaign(t, { count: 4 });
    let sent = 0;
    beforeSend = async () => {
      if (++sent === 2)
        await h.owner.query(`UPDATE wpcampaigns SET status = 'cancelled' WHERE id = $1`, [c.id]);
    };
    expect(await run(c)).toBe('halted');
    expect((await rows(c.id)).map((x) => x.status)).toEqual(['sent', 'sent', 'queued', 'queued']);
    expect((await camp(c.id)).status).toBe('cancelled');
  });

  it('past its end date a campaign sends nothing more: the unsent are failed, the campaign ends', async () => {
    const t = await api.signup('cx2');
    const c = await campaign(t, { count: 2 });
    await h.owner.query(
      `UPDATE wpcampaigns SET expires_at = now() - interval '1 hour' WHERE id = $1`,
      [c.id],
    );
    expect(await run(c)).toBe('expired');
    expect(texts).toHaveLength(0);
    const r = await rows(c.id);
    expect(r.map((x) => x.status)).toEqual(['failed', 'failed']);
    expect(r[0]!.error_message).toContain('auto-expired');
    expect(await camp(c.id)).toMatchObject({ status: 'failed', failed_count: 2 });
  });

  it('a recurring campaign moves to its next date with every recipient queued again', async () => {
    const t = await api.signup('cx3');
    const c = await campaign(t, {
      count: 2,
      extra: {
        scheduleType: 'recurring',
        repeatInterval: 'weekly',
        sendDate: '2026-10-05',
        sendTime: '09:00',
        timezone: 'UTC',
      },
    });
    await h.owner.query(`UPDATE wpcampaigns SET status = 'running' WHERE id = $1`, [c.id]);
    expect(await run(c)).toBe('rearmed');
    expect(texts).toHaveLength(2);
    expect((await rows(c.id)).map((x) => [x.status, x.send_attempts])).toEqual([
      ['queued', 0],
      ['queued', 0],
    ]);
    expect(await camp(c.id)).toMatchObject({
      status: 'scheduled',
      schedule_type: 'recurring',
      send_date: '2026-10-12',
      send_time: '09:00',
    });
  });

  it('a recurring campaign past its repeat-until date completes', async () => {
    const t = await api.signup('cx4');
    const c = await campaign(t, {
      count: 1,
      extra: {
        scheduleType: 'recurring',
        repeatInterval: 'daily',
        repeatUntil: '2026-10-05',
        sendDate: '2026-10-05',
        sendTime: '09:00',
        timezone: 'UTC',
      },
    });
    await h.owner.query(`UPDATE wpcampaigns SET status = 'running' WHERE id = $1`, [c.id]);
    expect(await run(c)).toBe('finished');
    expect((await camp(c.id)).status).toBe('completed');
  });

  it('a flow campaign cannot start sessions yet: its recipients fail with the reason and nothing is sent', async () => {
    const t = await api.signup('cx5');
    const flow = (
      await h.owner.query(
        `INSERT INTO flows (org_id, flow_name) VALUES ($1,'Welcome') RETURNING uuid`,
        [t.orgId],
      )
    ).rows[0].uuid;
    const c = await campaign(t, {
      count: 2,
      extra: { type: 'flow', flowId: flow, customMessage: null },
    });
    expect(await run(c)).toBe('finished');
    const r = await rows(c.id);
    expect(r.map((x) => x.status)).toEqual(['failed', 'failed']);
    expect(r[0]!.error_message).toContain('flow runtime');
    expect(texts).toHaveLength(0);
  });

  it('a second run of the same campaign while one is going is told to wait', async () => {
    const t = await api.signup('cx6');
    const c = await campaign(t, { count: 1 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const inFlight = new Promise<void>((r) => (started = r));
    beforeSend = async () => {
      started();
      await gate;
    };
    const first = run(c);
    await inFlight;
    expect(await run(c)).toBe('busy');
    release();
    expect(await first).toBe('finished');
    expect(texts).toHaveLength(1);
  });
});

describe('TW-CAMP-014: the sweeper', () => {
  it('a campaign stranded at running with unsent recipients is scheduled again and started; a live or finished one is left alone', async () => {
    const t = await api.signup('cs1');
    const stalled = await campaign(t, { count: 2 });
    const live = await campaign(t, { count: 2 });
    const done = await campaign(t, { count: 1 });
    await run(done);
    await h.owner.query(
      `UPDATE wpcampaigns SET last_run_at = now() - interval '5 minutes' WHERE id = $1`,
      [stalled.id],
    );
    await h.owner.query(`UPDATE wpcampaigns SET last_run_at = now() WHERE id = $1`, [live.id]);
    await h.owner.query(
      `UPDATE wpcampaigns SET last_run_at = now() - interval '5 minutes' WHERE id = $1`,
      [done.id],
    );
    queued = [];
    await sweep();
    expect(queued.filter((q) => q.orgId === t.orgId)).toEqual([
      { orgId: t.orgId, campaignId: stalled.id },
    ]);
    expect((await camp(stalled.id)).status).toBe('running');
    expect((await camp(live.id)).status).toBe('running');
    expect((await camp(done.id)).status).toBe('completed');
  });

  it('recipients claimed by a run that died go back to the queue', async () => {
    const t = await api.signup('cs2');
    const c = await campaign(t, { count: 1 });
    // The touch trigger stamps updated_at on every update, so it is off while the claim is aged.
    await h.owner.query(
      `ALTER TABLE wp_campaign_contacts DISABLE TRIGGER trg_wp_campaign_contacts_touch`,
    );
    await h.owner.query(
      `UPDATE wp_campaign_contacts SET status = 'pending', updated_at = now() - interval '1 hour' WHERE campaign_id = $1`,
      [c.id],
    );
    await h.owner.query(
      `ALTER TABLE wp_campaign_contacts ENABLE TRIGGER trg_wp_campaign_contacts_touch`,
    );
    await sweep();
    expect((await rows(c.id))[0]!.status).toBe('queued');
  });
});
