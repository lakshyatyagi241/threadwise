import { UNOFFICIAL_WHATSAPP_GATE } from '../../../src/modules/auth/unofficial-whatsapp.port';
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
import { SendWindowService } from '../../../src/modules/compliance-center';
import { ConsentGate, ConsentPolicyService } from '../../../src/modules/contact-consent';
import { MergeTagService } from '../../../src/modules/crm';
import {
  CAMPAIGN_BILLING,
  CAMPAIGN_FLOW_STARTER,
  CAMPAIGN_SETTINGS,
} from '../../../src/modules/campaigns/_shims/tokens';
import { CampaignDispatchService } from '../../../src/modules/campaigns/campaign-dispatch.service';
import { CampaignEvents } from '../../../src/modules/campaigns/campaign-events';
import { CampaignMirrorService } from '../../../src/modules/campaigns/campaign-mirror.service';
import { CampaignsRepository } from '../../../src/modules/campaigns/campaigns.repository';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * Quiet hours at the campaign sender (BL-177): a marketing campaign DEFERS the recipients whose local time is inside the workspace's
 * quiet hours (back to `queued` with the instant they may go; the claim leaves them alone), sends everyone else, and re-arms itself for
 * the first opening. On the next run the ConsentGate screens the audience again. A campaign of utility templates is never held.
 * The real app and Postgres, a fake engine and a fixed clock.
 */
let h: Harness;
let api: Api;
let dispatch: CampaignDispatchService;
let runtime: PacingRuntime;
let window: SendWindowService;
let texts: OutgoingText[] = [];
let templates: OutgoingMessage[] = [];

/** 21:30 in India (quiet 21:00 to 09:00), 12:00 in New York (open). */
const EVENING = new Date('2026-10-15T16:00:00Z');
const MORNING = new Date('2026-10-16T03:31:00Z');
const OPENS = '2026-10-16T03:30:00.000Z';

const setClock = (d: Date) => {
  runtime.now = () => d;
  window.now = () => d;
};

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  const get = <T>(token: unknown) => h.app.get<T>(token as never, { strict: false });
  runtime = get<PacingRuntime>(PacingRuntime);
  runtime.sleep = () => Promise.resolve();
  runtime.random = () => 0.5;
  window = get<SendWindowService>(SendWindowService);
  get<EngineSenderRegistry>(EngineSenderRegistry).register('baileys', {
    open: () =>
      Promise.resolve<OpenedSender>({
        send: async (m) => {
          templates.push(m);
          return { providerMessageId: `wamid.t${templates.length}` };
        },
        sendText: async (m) => {
          texts.push(m);
          return { providerMessageId: `wamid.x${texts.length}` };
        },
      }),
  });
  dispatch = new CampaignDispatchService(
    get<DatabaseService>(DatabaseService),
    get<CampaignsRepository>(CampaignsRepository),
    get<CryptoService>(CryptoService),
    get<CampaignEvents>(CampaignEvents),
    get<CampaignMirrorService>(CampaignMirrorService),
    get<EngineSenderRegistry>(EngineSenderRegistry),
    get<MergeTagService>(MergeTagService),
    get<LinkTracker>(LinkTracker),
    runtime,
    get<SenderLease>(SenderLease),
    get(SENDER_DIRECTORY),
    get(UNOFFICIAL_WHATSAPP_GATE),
    get(TEMPLATE_DIRECTORY),
    get(WARMER_GATE),
    get(PACING_SETTINGS),
    get(CAMPAIGN_BILLING),
    get(CAMPAIGN_FLOW_STARTER),
    get(CAMPAIGN_SETTINGS),
    get<ConsentPolicyService>(ConsentPolicyService),
    get<ConsentGate>(ConsentGate),
    window,
  );
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  texts = [];
  templates = [];
  setClock(EVENING);
});

let n = 0;
const phone = () => `+91951${String(n++).padStart(7, '0')}`;

async function campaign(
  t: Tenant,
  contacts: Array<{ name: string; zone?: string }>,
  o: { quietHours?: boolean; template?: 'marketing' | 'utility' } = {},
) {
  if (o.quietHours !== false) {
    await h.owner.query(
      `INSERT INTO compliance_settings (org_id, quiet_hours_enabled, quiet_start, quiet_end)
       VALUES ($1, true, '21:00', '09:00') ON CONFLICT (org_id) DO NOTHING`,
      [t.orgId],
    );
  }
  const contactIds = await api.seedContacts(
    t,
    contacts.map((c) => ({
      name: c.name,
      phone: phone(),
      ...(c.zone ? { data: { timezone: c.zone } } : {}),
    })),
  );
  const dev = (
    await h.owner.query(
      `INSERT INTO devices (org_id, device_name, phone_number, status, active)
       VALUES ($1,'Phone',$2,'connected',true) RETURNING uuid`,
      [t.orgId, phone()],
    )
  ).rows[0].uuid as string;
  let body: Record<string, unknown> = { type: 'text', customMessage: 'Hi {{name}}' };
  if (o.template) {
    const tpl = (
      await h.owner.query(
        `INSERT INTO wa_templates (org_id, template_name, template_body, template_type, status, language, category)
         VALUES ($1,'offer','Hello','standard','approved','en_US',$2) RETURNING uuid`,
        [t.orgId, o.template],
      )
    ).rows[0].uuid as string;
    body = { type: 'template', templateId: tpl, customMessage: null };
  }
  const res = await api
    .http()
    .post('/v2/campaigns')
    .set(bearer(t.admin))
    .set('idempotency-key', randomUUID())
    .send({ name: 'Offer', scheduleType: 'now', senderKey: `baileys:${dev}`, contactIds, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const row = (
    await h.owner.query(`SELECT id, uuid FROM wpcampaigns WHERE uuid = $1`, [res.body.campaign.id])
  ).rows[0];
  return { id: Number(row.id), uuid: row.uuid as string, orgId: t.orgId, t };
}

const rows = async (id: number) =>
  (
    await h.owner.query(
      `SELECT c.name, r.status, r.held_until, r.held_reason
         FROM wp_campaign_contacts r JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id
        WHERE r.campaign_id = $1 ORDER BY r.id`,
      [id],
    )
  ).rows as Array<{
    name: string;
    status: string;
    held_until: Date | null;
    held_reason: string | null;
  }>;
const camp = async (id: number) =>
  (
    await h.owner.query(
      `SELECT status, to_char(send_date,'YYYY-MM-DD') AS send_date, to_char(send_time,'HH24:MI') AS send_time, timezone
         FROM wpcampaigns WHERE id = $1`,
      [id],
    )
  ).rows[0] as { status: string; send_date: string; send_time: string; timezone: string | null };
const run = (c: { orgId: number; id: number }) =>
  RequestContextStore.run(
    {
      requestId: `qh-${c.id}`,
      orgId: c.orgId,
      actorType: 'system',
      actorId: null,
      userId: null,
    },
    () => dispatch.run(c.orgId, c.id),
  );

/** Time passes: the held recipients' hour is past on the database clock, the campaign is running again, the app clock is the morning. */
async function nextMorning(c: { id: number }) {
  await h.owner.query(
    `UPDATE wp_campaign_contacts SET held_until = now() - interval '1 minute' WHERE campaign_id = $1 AND held_until IS NOT NULL`,
    [c.id],
  );
  await h.owner.query(`UPDATE wpcampaigns SET status = 'running' WHERE id = $1`, [c.id]);
  setClock(MORNING);
}

describe('BL-177: a marketing campaign is deferred, not denied, in the quiet hours', () => {
  it('sends whoever is awake, holds whoever is in their quiet hours, and is scheduled again for the first opening', async () => {
    const c = await campaign(await api.signup('cq1'), [
      { name: 'Asha', zone: 'Asia/Kolkata' },
      { name: 'Ned', zone: 'America/New_York' },
      { name: 'Ravi' }, // read from the +91 number
    ]);
    expect(await run(c)).toBe('rearmed');

    const r = Object.fromEntries((await rows(c.id)).map((x) => [x.name, x]));
    expect(r.Ned!.status).toBe('sent');
    expect(r.Asha).toMatchObject({ status: 'queued', held_reason: 'quiet_hours' });
    expect(r.Ravi).toMatchObject({ status: 'queued', held_reason: 'quiet_hours' });
    expect(r.Asha!.held_until!.toISOString()).toBe(OPENS);
    expect(texts).toHaveLength(1);

    // Scheduled again for the minute the first of them opens, on the campaign's own clock.
    const row = await camp(c.id);
    expect(row.status).toBe('scheduled');
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: row.timezone ?? 'UTC',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(OPENS));
    const get = (k: string) => local.find((p) => p.type === k)!.value;
    expect([row.send_date, row.send_time]).toEqual([
      `${get('year')}-${get('month')}-${get('day')}`,
      `${get('hour')}:${get('minute')}`,
    ]);

    const heldRows = await h.owner.query(
      `SELECT count(*)::int AS n FROM wp_campaign_contacts WHERE campaign_id = $1 AND status = 'queued' AND held_until IS NOT NULL`,
      [c.id],
    );
    expect(heldRows.rows[0].n).toBe(2);
  });

  it('the claim leaves a held recipient alone until its hour has come', async () => {
    const c = await campaign(await api.signup('cq2'), [{ name: 'Asha', zone: 'Asia/Kolkata' }]);
    expect(await run(c)).toBe('rearmed');
    await h.owner.query(`UPDATE wpcampaigns SET status = 'running' WHERE id = $1`, [c.id]);
    await run(c); // still the evening
    expect(texts).toHaveLength(0);
    expect((await rows(c.id))[0]).toMatchObject({ status: 'queued' });
  });

  it('sends the held recipients when the hours open, and completes', async () => {
    const c = await campaign(await api.signup('cq3'), [
      { name: 'Asha', zone: 'Asia/Kolkata' },
      { name: 'Ravi' },
    ]);
    expect(await run(c)).toBe('rearmed');
    await nextMorning(c);
    expect(await run(c)).toBe('finished');
    expect(texts).toHaveLength(2);
    const r = await rows(c.id);
    expect(r.map((x) => x.status)).toEqual(['sent', 'sent']);
    expect(r.every((x) => x.held_until === null && x.held_reason === null)).toBe(true);
    expect((await camp(c.id)).status).toBe('completed');
  });

  it('a contact who unsubscribed while the message waited is not messaged on release', async () => {
    const c = await campaign(await api.signup('cq4'), [
      { name: 'Asha', zone: 'Asia/Kolkata' },
      { name: 'Ravi' },
    ]);
    expect(await run(c)).toBe('rearmed');
    await h.owner.query(
      `UPDATE contacts SET is_unsubscribed = true WHERE org_id = $1 AND name = 'Asha'`,
      [c.orgId],
    );
    await nextMorning(c);
    expect(await run(c)).toBe('finished');
    const r = Object.fromEntries((await rows(c.id)).map((x) => [x.name, x.status]));
    expect(r).toEqual({ Asha: 'unsubscribed', Ravi: 'sent' });
    expect(texts).toHaveLength(1);
  });

  it('a campaign of utility templates is never held', async () => {
    const c = await campaign(await api.signup('cq5'), [{ name: 'Asha', zone: 'Asia/Kolkata' }], {
      template: 'utility',
    });
    expect(await run(c)).toBe('finished');
    expect(templates).toHaveLength(1);
    expect((await rows(c.id))[0]!.status).toBe('sent');
  });

  it('a marketing template campaign is held', async () => {
    const c = await campaign(await api.signup('cq6'), [{ name: 'Asha', zone: 'Asia/Kolkata' }], {
      template: 'marketing',
    });
    expect(await run(c)).toBe('rearmed');
    expect(templates).toHaveLength(0);
  });

  it('shows the held count on the live stats and the reason on the recipients', async () => {
    const t = await api.signup('cq7');
    const c = await campaign(t, [
      { name: 'Asha', zone: 'Asia/Kolkata' },
      { name: 'Ned', zone: 'America/New_York' },
    ]);
    await run(c);
    const live = await api.http().get(`/v2/campaigns/${c.uuid}/live`).set(bearer(t.admin));
    expect(live.status, JSON.stringify(live.body)).toBe(200);
    expect(live.body).toMatchObject({ queued: 1, held: 1 });
    const rec = await api.http().get(`/v2/campaigns/${c.uuid}/recipients`).set(bearer(t.admin));
    const held = rec.body.data.find((x: { name: string }) => x.name === 'Asha');
    expect(held).toMatchObject({ status: 'queued', heldUntil: OPENS, heldReason: 'quiet_hours' });
  });

  it('with the quiet hours off (the default) nothing is held', async () => {
    const c = await campaign(await api.signup('cq8'), [{ name: 'Asha', zone: 'Asia/Kolkata' }], {
      quietHours: false,
    });
    expect(await run(c)).toBe('finished');
    expect((await rows(c.id))[0]!.status).toBe('sent');
  });
});
